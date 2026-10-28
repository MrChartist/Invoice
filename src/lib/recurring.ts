/**
 * Recurring invoices (subscriptions / retainers).
 *
 * Pure date arithmetic on `YYYY-MM-DD` strings (no timezone traps), schedule
 * state transitions, and the generator that turns a schedule occurrence into a
 * real, numbered `InvoiceRecord`.
 *
 * Idempotency: every generated invoice carries `recurring_id` +
 * `recurring_date` (the occurrence it stands for). Before creating one we look
 * for an existing invoice with the same pair, so two open tabs, a crash between
 * "save invoice" and "advance schedule", or a manual re-run can never produce
 * the same occurrence twice.
 */

import type { Client, DocumentType, InvoiceItem, InvoiceRecord, SenderProfile } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, num, round2 } from './invoice-calc';
import { localDb } from './localDb';
import { generateId, getTable, setTable } from './storage';
import { isPeriodLockedError } from './period-lock';
import { normalizeRecord } from '../store/invoice-defaults';
import { liveDocTrackingIssues } from './stock-tracking';
import { loadPaymentTerms, termPatch, type PaymentTerm } from './payment-terms';
import { leaseLineRates } from './property/escalation'; // R5-C5
import { withIssueSnapshot } from './khata-actions'; // R6-C5

export const RECURRING_TABLE = 'recurring';
/** Most missed occurrences materialised in a single catch-up. */
export const MAX_CATCH_UP = 12;

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly' | 'custom-days';
export type RecurringMode = 'draft' | 'issue';
export type ScheduleStatus = 'active' | 'paused' | 'ended';

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  'half-yearly': 'Half-yearly',
  yearly: 'Yearly',
  'custom-days': 'Every N days',
};

/** Fields of an invoice that a schedule snapshots and re-uses on every run. */
export interface RecurringTemplate {
  doc_type: DocumentType;
  currency: string;
  template_id: string;
  client: Client;
  sender: SenderProfile | null;
  items: InvoiceItem[];
  gst_mode: InvoiceRecord['gst_mode'];
  place_of_supply: string;
  reverse_charge: boolean;
  discount_type: InvoiceRecord['discount_type'];
  discount_rate: number;
  tax_rate: number;
  shipping: number;
  other_charges: number;
  round_off_enabled: boolean;
  notes: string;
  terms: string;
  po_number?: string;
  /* Additive: the tax setup of the source invoice. Without these a recurring export /
     LUT / TDS / tax-inclusive invoice would silently turn into a plain one. */
  supply_type?: InvoiceRecord['supply_type'];
  lut_number?: string;
  lut_date?: string;
  price_includes_tax?: boolean;
  round_mode?: InvoiceRecord['round_mode'];
  tcs_enabled?: boolean;
  tcs_rate?: number;
  tcs_base?: InvoiceRecord['tcs_base'];
  tcs_label?: string;
  tds_enabled?: boolean;
  tds_section?: string;
  tds_rate?: number;
  tds_on_taxable?: boolean;
  /** Additive: freight / other charges are taxed (roadmap 3.3). The exchange rate is NOT kept:
      each occurrence needs the rate of its own date. */
  charges_taxable?: boolean;
  /** Additive (6.16): cost centre each generated invoice is booked to. */
  cost_centre_id?: string;
  /** Additive (6.23, PENDING #25): document / party custom fields copied onto every generated invoice. */
  custom_values?: InvoiceRecord['custom_values'];
}

export interface RecurringHistoryEntry {
  /** Occurrence date the invoice stands for (YYYY-MM-DD). */
  date: string;
  invoice_id: string;
  invoice_number: string;
}

export interface RecurringSchedule {
  id: string;
  name: string;
  template: RecurringTemplate;
  frequency: Frequency;
  /** Every N units of `frequency` (N days for custom-days). */
  interval: number;
  /** First occurrence; also the anchor day-of-month for month-based rules. */
  start_date: string;
  end_date?: string;
  max_runs?: number;
  next_run: string;
  last_run?: string;
  run_count: number;
  /** Occurrences deliberately skipped (skip-next, catch-up overflow). */
  skipped_count?: number;
  due_in_days: number;
  /** Additive (R2-A1): payment term applied to every generated document (its schedule / snapshot are recomputed on issue). */
  payment_terms_id?: string;
  mode: RecurringMode;
  active: boolean;
  history: RecurringHistoryEntry[];
  created_at?: string;
  updated_at?: string;
}

/** Extra fields stamped on generated invoices (additive, ignored elsewhere). */
export type GeneratedInvoice = InvoiceRecord & { recurring_id?: string; recurring_date?: string };

/* ── Date arithmetic ──────────────────────────────────────────── */

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function parseYmd(s: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  if (!match) return null;
  const y = +match[1];
  const m = +match[2];
  const d = +match[3];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function fmt({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Add whole days (negative allowed). Returns the input unchanged if unparsable. */
export function addDays(date: string, days: number): string {
  const p = parseYmd(date);
  if (!p) return date;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return fmt({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/**
 * Add calendar months, clamping to month-end: 31 Jan + 1 month = 28/29 Feb.
 * `anchorDay` is the day-of-month to aim for (defaults to the date's own day),
 * so a series started on the 31st returns to the 31st in 31-day months.
 */
export function addMonths(date: string, months: number, anchorDay?: number): string {
  const p = parseYmd(date);
  if (!p) return date;
  const total = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return fmt({ y, m, d: Math.min(anchorDay ?? p.d, daysInMonth(y, m)) });
}

/** Whole days from `from` to `to` (negative when in the past). */
export function daysBetween(from: string, to: string): number {
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

/* ── Frequency rules ──────────────────────────────────────────── */

type Step = { kind: 'days' | 'months'; n: number };

function stepFor(s: Pick<RecurringSchedule, 'frequency' | 'interval'>): Step {
  const k = Math.max(1, Math.floor(num(s.interval, 1)));
  switch (s.frequency) {
    case 'weekly': return { kind: 'days', n: 7 * k };
    case 'custom-days': return { kind: 'days', n: k };
    case 'quarterly': return { kind: 'months', n: 3 * k };
    case 'half-yearly': return { kind: 'months', n: 6 * k };
    case 'yearly': return { kind: 'months', n: 12 * k };
    default: return { kind: 'months', n: k };
  }
}

type RuleInput = Pick<RecurringSchedule, 'frequency' | 'interval' | 'start_date'>;

/**
 * Lower bound for the index of the first occurrence at/after `day`, so the scans
 * below start near the answer instead of at 0 (a daily schedule started years
 * ago would otherwise cost O(n^2) date maths to catch up).
 */
function indexHint(rule: RuleInput, day: string): number {
  const a = parseYmd(rule.start_date);
  const b = parseYmd(day);
  if (!a || !b) return 0;
  const step = stepFor(rule);
  const span =
    step.kind === 'days' ? daysBetween(rule.start_date, day) : (b.y - a.y) * 12 + (b.m - a.m);
  return Math.max(0, Math.floor(span / step.n) - 1);
}

/** The n-th occurrence (0 = start_date), always computed from the anchor to avoid drift. */
export function occurrenceDate(rule: RuleInput, n: number): string {
  const step = stepFor(rule);
  if (step.kind === 'days') return addDays(rule.start_date, step.n * n);
  return addMonths(rule.start_date, step.n * n, parseYmd(rule.start_date)?.d);
}

const SCAN_LIMIT = 20000;

/** First occurrence strictly after `after`. */
export function nextOccurrence(rule: RuleInput, after: string): string {
  if (!parseYmd(rule.start_date)) return after;
  for (let n = indexHint(rule, after); n < SCAN_LIMIT; n++) {
    const d = occurrenceDate(rule, n);
    if (d > after) return d;
  }
  return after;
}

/** First occurrence on or after `from`. */
export function firstOccurrenceOnOrAfter(rule: RuleInput, from: string): string {
  if (!parseYmd(rule.start_date)) return from;
  for (let n = indexHint(rule, from); n < SCAN_LIMIT; n++) {
    const d = occurrenceDate(rule, n);
    if (d >= from) return d;
  }
  return from;
}

/**
 * QA-3 F6: default first date of a schedule made from an invoice. The invoice already bills its own
 * date, so the schedule starts at the next occurrence after it (anchored on that date), and never in
 * the past (no catch-up run of months that were billed by hand).
 */
export function startAfterInvoice(rule: Pick<RecurringSchedule, 'frequency' | 'interval'>, invoiceDate: string, today: string): string {
  if (!parseYmd(invoiceDate)) return today;
  const from = addDays(invoiceDate, 1);
  return firstOccurrenceOnOrAfter({ ...rule, start_date: invoiceDate }, from > today ? from : today);
}

/** True when "Run now" would bill an occurrence that is not due yet (it asks first). */
export function runNowIsEarly(s: Pick<RecurringSchedule, 'next_run'>, today: string): boolean {
  return s.next_run > today;
}

/** The next `count` occurrences starting at `from` (inclusive) — for the editor preview. */
export function previewOccurrences(
  rule: RuleInput & Pick<RecurringSchedule, 'end_date' | 'max_runs'>,
  count = 6,
  from?: string,
  alreadyConsumed = 0,
): string[] {
  const out: string[] = [];
  if (!parseYmd(rule.start_date)) return out;
  let cur = firstOccurrenceOnOrAfter(rule, from ?? rule.start_date);
  const max = rule.max_runs && rule.max_runs > 0 ? rule.max_runs : Infinity;
  while (out.length < count && alreadyConsumed + out.length < max) {
    if (rule.end_date && cur > rule.end_date) break;
    out.push(cur);
    cur = nextOccurrence(rule, cur);
  }
  return out;
}

/* ── Schedule state ───────────────────────────────────────────── */

function consumedCount(s: RecurringSchedule): number {
  return (s.run_count || 0) + (s.skipped_count || 0);
}

export function isEnded(s: RecurringSchedule): boolean {
  if (s.max_runs && s.max_runs > 0 && consumedCount(s) >= s.max_runs) return true;
  if (s.end_date && s.next_run > s.end_date) return true;
  return false;
}

export function scheduleStatus(s: RecurringSchedule): ScheduleStatus {
  if (isEnded(s)) return 'ended';
  return s.active ? 'active' : 'paused';
}

export interface DueRuns {
  /** Occurrences to generate now, oldest first (at most `cap`). */
  dates: string[];
  /** Older missed occurrences dropped because they exceeded the cap. */
  skipped: number;
  /** Where next_run lands once everything above is consumed. */
  nextRun: string;
}

/**
 * Every occurrence that is due on or before `today`. If more than `cap` were
 * missed (app closed for ages) only the most recent `cap` are kept and the
 * rest are counted as skipped, so a dormant schedule can never flood the ledger.
 */
export function dueRunsDetailed(s: RecurringSchedule, today: string, cap = MAX_CATCH_UP): DueRuns {
  const none: DueRuns = { dates: [], skipped: 0, nextRun: s.next_run };
  if (!s.active || isEnded(s) || !parseYmd(s.next_run)) return none;

  const budget = s.max_runs && s.max_runs > 0 ? s.max_runs - consumedCount(s) : Infinity;
  const missed: string[] = [];
  let cur = s.next_run;
  while (cur <= today && missed.length < budget && !(s.end_date && cur > s.end_date)) {
    missed.push(cur);
    cur = nextOccurrence(s, cur);
  }
  if (missed.length === 0) return none;
  const limit = Math.max(1, cap);
  const dates = missed.slice(-limit);
  return { dates, skipped: missed.length - dates.length, nextRun: cur };
}

export function dueRuns(s: RecurringSchedule, today: string, cap = MAX_CATCH_UP): string[] {
  return dueRunsDetailed(s, today, cap).dates;
}

/* ── Template tokens ──────────────────────────────────────────── */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * `{month}` `{mon}` `{year}` `{period}` `{date}` in item names, descriptions and
 * notes become the occurrence's values: "Research plan — {month} {year}".
 */
export function applyTokens(text: string | undefined, date: string): string {
  if (!text) return text ?? '';
  const p = parseYmd(date);
  if (!p) return text;
  const month = MONTHS[p.m - 1];
  return text
    .replace(/\{month\}/gi, month)
    .replace(/\{mon\}/gi, month.slice(0, 3))
    .replace(/\{year\}/gi, String(p.y))
    .replace(/\{period\}/gi, `${month.slice(0, 3)} ${p.y}`)
    .replace(/\{date\}/gi, date);
}

/* ── Building invoices ────────────────────────────────────────── */

export function templateFromInvoice(inv: InvoiceRecord): RecurringTemplate {
  return {
    doc_type: inv.doc_type,
    currency: inv.currency,
    template_id: inv.template_id,
    client: { ...inv.client },
    sender: inv.sender ? { ...inv.sender } : null,
    // Serials and batches belong to one sale: every occurrence picks its own (6.6 / 6.11).
    items: inv.items
      .filter((i) => i.name?.trim() || num(i.rate) > 0)
      .map(({ serials: _s, batch_no: _b, batch_expiry: _e, batch_mfg: _m, ...i }) => {
        void [_s, _b, _e, _m];
        return { ...i };
      }),
    gst_mode: inv.gst_mode,
    place_of_supply: inv.place_of_supply,
    reverse_charge: inv.reverse_charge,
    discount_type: inv.discount_type,
    discount_rate: inv.discount_rate,
    tax_rate: inv.tax_rate,
    shipping: inv.shipping,
    other_charges: inv.other_charges,
    round_off_enabled: inv.round_off_enabled,
    notes: inv.notes,
    terms: inv.terms,
    po_number: inv.po_number,
    supply_type: inv.supply_type,
    lut_number: inv.lut_number,
    lut_date: inv.lut_date,
    price_includes_tax: inv.price_includes_tax,
    round_mode: inv.round_mode,
    tcs_enabled: inv.tcs_enabled,
    tcs_rate: inv.tcs_rate,
    tcs_base: inv.tcs_base,
    tcs_label: inv.tcs_label,
    tds_enabled: inv.tds_enabled,
    tds_section: inv.tds_section,
    tds_rate: inv.tds_rate,
    tds_on_taxable: inv.tds_on_taxable,
    ...(inv.charges_taxable ? { charges_taxable: true } : {}),
    ...(inv.cost_centre_id ? { cost_centre_id: inv.cost_centre_id } : {}),
    ...(inv.custom_values?.length ? { custom_values: inv.custom_values.map((v) => ({ ...v })) } : {}),
  };
}

/** Totals for one run of a template, via the same engine the creator uses. */
export function templateTotals(t: RecurringTemplate) {
  // Each run is a new document: on reverse charge the tax stays out of its total (src/lib/rcm.ts).
  return calculateInvoice(calcInputFromRecord(t as Partial<InvoiceRecord>, { amount_paid: 0, rcm_exclude_tax: !!t.reverse_charge }));
}

/** Approximate revenue per month if the schedule runs forever. */
export function monthlyValue(s: RecurringSchedule): number {
  const step = stepFor(s);
  const perMonth = step.kind === 'days' ? 30.4375 / step.n : 1 / step.n;
  return round2(templateTotals(s.template).total * perMonth);
}

export function createSchedule(input: {
  name: string;
  template: RecurringTemplate;
  frequency: Frequency;
  interval?: number;
  start_date: string;
  end_date?: string;
  max_runs?: number;
  due_in_days?: number;
  mode?: RecurringMode;
}): RecurringSchedule {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: input.name.trim() || 'Recurring invoice',
    template: input.template,
    frequency: input.frequency,
    interval: Math.max(1, Math.floor(num(input.interval, 1))),
    start_date: input.start_date,
    end_date: input.end_date || undefined,
    max_runs: input.max_runs && input.max_runs > 0 ? Math.floor(input.max_runs) : undefined,
    next_run: input.start_date,
    run_count: 0,
    skipped_count: 0,
    due_in_days: Math.max(0, Math.floor(num(input.due_in_days, 14))),
    mode: input.mode ?? 'draft',
    active: true,
    history: [],
    created_at: now,
    updated_at: now,
  };
}

/**
 * R5-C5: the generator's optional line-amount hook. A lease schedule (`lease_id` + `escalation`) bills rent / CAM
 * escalated from each step date and pro rata by days; every other schedule gets its template lines unchanged.
 */
export function amountHook(s: RecurringSchedule, occurrence: string): InvoiceItem[] {
  return s.lease_id && s.escalation ? leaseLineRates(s.template.items, s.escalation, s.start_date, occurrence, nextOccurrence(s, occurrence)) : s.template.items;
}

/** Pure: one invoice for one occurrence. No storage access. */
/** Id of the document generated for one occurrence of a schedule (stable across devices). */
export const recurringDocId = (scheduleId: string, occurrence: string): string => `rec-${scheduleId}-${occurrence}`;

export function buildInvoiceFromSchedule(
  s: RecurringSchedule,
  occurrence: string,
  opts: { invoiceNumber: string; issueDate?: string; terms?: readonly PaymentTerm[] },
): GeneratedInvoice {
  const t = s.template;
  const issue = opts.issueDate || occurrence;
  // Deterministic ids per (schedule, occurrence): with folder sync (5.7) two devices generating the same
  // occurrence produce ONE document (merged by id), never two invoices with two numbers.
  const docId = recurringDocId(s.id, occurrence);
  const raw = {
    ...t,
    id: docId,
    invoice_number: opts.invoiceNumber,
    issue_date: issue,
    due_date: addDays(issue, s.due_in_days),
    status: s.mode === 'issue' ? 'Sent' : 'Draft',
    amount_paid: 0,
    items: amountHook(s, occurrence).map((i, n) => ({
      ...i,
      id: `${docId}-l${n + 1}`,
      name: applyTokens(i.name, occurrence),
      description: applyTokens(i.description, occurrence),
    })),
    notes: applyTokens(t.notes, occurrence),
    terms: applyTokens(t.terms, occurrence),
  };
  const normalized = normalizeRecord(raw, t.template_id);
  // A generated document is new: on reverse charge its tax stays out of the total (src/lib/rcm.ts).
  const rec = normalized.reverse_charge && normalized.doc_type !== 'BILL_OF_SUPPLY' ? { ...normalized, rcm_tax_excluded: true } : normalized;
  const totals = calculateInvoice(calcInputFromRecord(rec, { amount_paid: 0 }));
  return {
    ...rec,
    subtotal: totals.subtotal,
    discount_amount: totals.discount_amount,
    taxable_value: totals.taxable_value,
    cgst_amount: totals.cgst_amount,
    sgst_amount: totals.sgst_amount,
    igst_amount: totals.igst_amount,
    tax_amount: totals.tax_amount,
    round_off: totals.round_off,
    total: totals.total,
    balance_due: totals.balance_due,
    cess_amount: totals.cess_amount,
    tcs_amount: totals.tcs_amount,
    tds_amount: totals.tds_amount,
    recurring_id: s.id,
    recurring_date: occurrence,
    // R2-A1: the term is recomputed for this issue date (a copied snapshot / schedule would carry stale dates).
    ...termFields(s, issue, totals.total, totals.tds_amount, opts.terms),
  };
}

function termFields(s: RecurringSchedule, issue: string, total: number, tds: number | undefined, terms?: readonly PaymentTerm[]): Partial<InvoiceRecord> {
  const term = s.payment_terms_id ? (terms ?? []).find((t) => t.id === s.payment_terms_id) : undefined;
  if (!term) return s.payment_terms_id ? { payment_terms: undefined } : {};
  return termPatch(term, { issue_date: issue, total, tds_amount: tds ?? 0 });
}

/* ── Persistence ──────────────────────────────────────────────── */

export const recurringDb = {
  getAll: (): RecurringSchedule[] => getTable<RecurringSchedule>(RECURRING_TABLE),
  getById: (id: string) => recurringDb.getAll().find((s) => s.id === id),
  save: (schedule: RecurringSchedule): RecurringSchedule => {
    const rows = recurringDb.getAll();
    const idx = rows.findIndex((r) => r.id === schedule.id);
    const toSave = { ...schedule, updated_at: new Date().toISOString() };
    if (idx >= 0) rows[idx] = toSave;
    else rows.push(toSave);
    setTable(RECURRING_TABLE, rows);
    return toSave;
  },
  remove: (id: string) => setTable(RECURRING_TABLE, recurringDb.getAll().filter((r) => r.id !== id)),
};

function findGenerated(scheduleId: string, occurrence: string): GeneratedInvoice | undefined {
  return (localDb.invoices.getAll() as GeneratedInvoice[]).find(
    (i) => i.recurring_id === scheduleId && i.recurring_date === occurrence,
  );
}

export interface GenerateResult {
  invoice: InvoiceRecord;
  /** False when the occurrence had already been generated (idempotent hit). */
  created: boolean;
  /**
   * 'issue' schedules only: why the invoice was saved as a Draft instead (batch / serial / godown checks
   * failed — recurring templates carry no serials or batches, so tracked items must be picked by hand).
   */
  heldAsDraft?: string[];
}

/**
 * Create (once) the invoice for one occurrence and save it. Numbering comes
 * from `localDb.invoices.nextNumber`, keyed on the issue date, so a run on
 * 1 Apr starts the new FY series.
 */
export function generateInvoiceFromSchedule(
  s: RecurringSchedule,
  occurrence: string,
  issueDate?: string,
): GenerateResult {
  const existing = findGenerated(s.id, occurrence);
  if (existing) return { invoice: existing, created: false };

  const issue = issueDate || occurrence;
  // QA-3 F6: a draft takes no number (a deleted draft would leave a hole that GSTR-1 reports as
  // cancelled); it is numbered in its FY series when issued (`localDb` numberOnIssue / the editor).
  // P1-13: the template's voucher type series numbers an issued run.
  const invoiceNumber = s.mode === 'issue'
    ? localDb.invoices.nextNumber(issue, s.template.doc_type, s.template.sender?.invoicePrefix || undefined, (s.template as { voucher_type_id?: string }).voucher_type_id)
    : '';
  let built = buildInvoiceFromSchedule(s, occurrence, { invoiceNumber, issueDate: issue, terms: s.payment_terms_id ? loadPaymentTerms() : undefined });
  // Issuing straight away skips the editor, so run its stock checks here; a tracked item that needs a
  // serial / batch (or an expired batch) keeps the invoice a Draft for the user to complete.
  let heldAsDraft: string[] | undefined;
  if (built.status !== 'Draft') {
    const issues = liveDocTrackingIssues(built);
    const problems = [...issues.errors, ...issues.expired];
    if (problems.length) {
      heldAsDraft = problems;
      built = { ...built, status: 'Draft', invoice_number: '' };
    }
  }
  // R6-C5 (8.7): an occurrence issued straight away freezes the party's previous balance, as the editor does.
  if (built.status !== 'Draft') built = withIssueSnapshot(built);
  const saved = localDb.invoices.save(built);
  return { invoice: saved, created: true, ...(heldAsDraft ? { heldAsDraft } : {}) };
}

/** Pure: schedule after consuming occurrences (generated and/or skipped). */
export function advanceSchedule(
  s: RecurringSchedule,
  consumedDates: string[],
  entries: RecurringHistoryEntry[],
  skipped = 0,
): RecurringSchedule {
  const lastConsumed = consumedDates[consumedDates.length - 1];
  const nextRun = lastConsumed ? nextOccurrence(s, lastConsumed) : s.next_run;
  return {
    ...s,
    next_run: nextRun,
    run_count: s.run_count + entries.length,
    skipped_count: (s.skipped_count || 0) + skipped,
    last_run: entries.length ? entries[entries.length - 1].date : s.last_run,
    history: [...s.history, ...entries].slice(-60),
  };
}

export interface RunReport {
  generated: InvoiceRecord[];
  errors: string[];
}

function recordGenerated(
  schedule: RecurringSchedule,
  occurrence: string,
  invoice: InvoiceRecord,
): RecurringSchedule {
  const known = schedule.history.some((h) => h.date === occurrence);
  const entries = known
    ? []
    : [{ date: occurrence, invoice_id: invoice.id, invoice_number: invoice.invoice_number }];
  return recurringDb.save(advanceSchedule(schedule, [occurrence], entries));
}

/** Generate everything due on or before `today` across all active schedules. */
export function runDueSchedules(today: string): RunReport {
  const report: RunReport = { generated: [], errors: [] };
  for (const listed of recurringDb.getAll()) {
    // Re-read: another tab may have advanced it since the list was taken.
    let current = recurringDb.getById(listed.id);
    if (!current) continue;
    const due = dueRunsDetailed(current, today);
    if (due.dates.length === 0) continue;

    try {
      if (due.skipped > 0) {
        // Jump over the overflow (counted as skipped) to the first kept date.
        current = recurringDb.save({
          ...current,
          next_run: due.dates[0],
          skipped_count: (current.skipped_count || 0) + due.skipped,
        });
      }
      for (const occurrence of due.dates) {
        try {
          const { invoice, created, heldAsDraft } = generateInvoiceFromSchedule(current, occurrence);
          current = recordGenerated(current, occurrence, invoice);
          if (created) report.generated.push(invoice);
          if (heldAsDraft) report.errors.push(`${listed.name}: ${invoice.invoice_number} saved as a draft — ${heldAsDraft[0]}`);
        } catch (err) {
          // An occurrence inside the locked period is skipped (counted), never forced in.
          if (!isPeriodLockedError(err)) throw err;
          current = recurringDb.save(advanceSchedule(current, [occurrence], [], 1));
          report.errors.push(`${listed.name}: skipped ${occurrence} — ${err.message}`);
        }
      }
    } catch (err) {
      report.errors.push(`${listed.name}: ${(err as Error).message}`);
    }
  }
  return report;
}

export { recurringToastMessage } from './recurring-message';

/* ── Manual actions ───────────────────────────────────────────── */

/**
 * Generate the next occurrence immediately, dated `today`. An occurrence that is not due yet (a
 * future period) is billed only with `early` (the page asks first); the schedule is re-read, so a
 * stale list never bills the same period twice.
 */
export function runNow(id: string, today: string, opts: { early?: boolean } = {}): GenerateResult | null {
  const s = recurringDb.getById(id);
  if (!s || isEnded(s)) return null;
  if (runNowIsEarly(s, today) && !opts.early) throw new Error(`The next invoice is for ${s.next_run}, which is not due yet. Confirm to bill it early.`);
  const occurrence = s.next_run;
  const result = generateInvoiceFromSchedule(s, occurrence, today);
  recordGenerated(s, occurrence, result.invoice);
  return result;
}

export function pauseSchedule(id: string): RecurringSchedule | null {
  const s = recurringDb.getById(id);
  return s ? recurringDb.save({ ...s, active: false }) : null;
}

/** Resuming never back-fills the paused period: next_run jumps to the first date >= today. */
export function resumeSchedule(id: string, today: string): RecurringSchedule | null {
  const s = recurringDb.getById(id);
  if (!s) return null;
  const next = s.next_run < today ? firstOccurrenceOnOrAfter(s, today) : s.next_run;
  return recurringDb.save({ ...s, active: true, next_run: next });
}

/** Skip the upcoming occurrence without generating an invoice. */
export function skipNext(id: string): RecurringSchedule | null {
  const s = recurringDb.getById(id);
  if (!s || isEnded(s)) return null;
  return recurringDb.save(advanceSchedule(s, [s.next_run], [], 1));
}

/** Permanently end the schedule (history is kept). */
export function stopSchedule(id: string, today: string): RecurringSchedule | null {
  const s = recurringDb.getById(id);
  if (!s) return null;
  const dayBefore = addDays(s.next_run, -1);
  return recurringDb.save({ ...s, active: false, end_date: dayBefore < today ? dayBefore : today });
}

/** Human summary, e.g. "Every 2 months" / "Monthly" / "Every 10 days". */
export function describeFrequency(s: Pick<RecurringSchedule, 'frequency' | 'interval'>): string {
  const k = Math.max(1, Math.floor(num(s.interval, 1)));
  if (s.frequency === 'custom-days') return k === 1 ? 'Daily' : `Every ${k} days`;
  if (k === 1) return FREQUENCY_LABELS[s.frequency];
  const unit = {
    weekly: 'weeks',
    monthly: 'months',
    quarterly: 'quarters',
    'half-yearly': 'half-years',
    yearly: 'years',
  }[s.frequency];
  return `Every ${k} ${unit}`;
}
