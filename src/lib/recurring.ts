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
import { calculateInvoice, num, round2 } from './invoice-calc';
import { localDb } from './localDb';
import { generateId, getTable, setTable } from './storage';
import { normalizeRecord } from '../store/invoice-defaults';

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
  for (let n = 0; n < SCAN_LIMIT; n++) {
    const d = occurrenceDate(rule, n);
    if (d > after) return d;
  }
  return after;
}

/** First occurrence on or after `from`. */
export function firstOccurrenceOnOrAfter(rule: RuleInput, from: string): string {
  if (!parseYmd(rule.start_date)) return from;
  for (let n = 0; n < SCAN_LIMIT; n++) {
    const d = occurrenceDate(rule, n);
    if (d >= from) return d;
  }
  return from;
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
    items: inv.items.filter((i) => i.name?.trim() || num(i.rate) > 0).map((i) => ({ ...i })),
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
  };
}

/** Totals for one run of a template, via the same engine the creator uses. */
export function templateTotals(t: RecurringTemplate) {
  return calculateInvoice({
    items: t.items,
    gst_mode: t.gst_mode,
    discount_type: t.discount_type,
    discount_rate: t.discount_rate,
    tax_rate: t.tax_rate,
    shipping: t.shipping,
    other_charges: t.other_charges,
    round_off_enabled: t.round_off_enabled,
    amount_paid: 0,
  });
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

/** Pure: one invoice for one occurrence. No storage access. */
export function buildInvoiceFromSchedule(
  s: RecurringSchedule,
  occurrence: string,
  opts: { invoiceNumber: string; issueDate?: string },
): GeneratedInvoice {
  const t = s.template;
  const issue = opts.issueDate || occurrence;
  const raw = {
    ...t,
    id: '',
    invoice_number: opts.invoiceNumber,
    issue_date: issue,
    due_date: addDays(issue, s.due_in_days),
    status: s.mode === 'issue' ? 'Sent' : 'Draft',
    amount_paid: 0,
    items: t.items.map((i) => ({
      ...i,
      id: generateId(),
      name: applyTokens(i.name, occurrence),
      description: applyTokens(i.description, occurrence),
    })),
    notes: applyTokens(t.notes, occurrence),
    terms: applyTokens(t.terms, occurrence),
  };
  const rec = normalizeRecord(raw, t.template_id);
  const totals = calculateInvoice({
    items: rec.items,
    gst_mode: rec.gst_mode,
    discount_type: rec.discount_type,
    discount_rate: rec.discount_rate,
    tax_rate: rec.tax_rate,
    shipping: rec.shipping,
    other_charges: rec.other_charges,
    round_off_enabled: rec.round_off_enabled,
    amount_paid: 0,
  });
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
    recurring_id: s.id,
    recurring_date: occurrence,
  };
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
  // Midday local time: a bare YYYY-MM-DD is parsed as UTC and can land on the
  // wrong side of 1 April in timezones west of Greenwich.
  const invoiceNumber = localDb.invoices.nextNumber(`${issue}T12:00:00`, s.template.doc_type);
  const built = buildInvoiceFromSchedule(s, occurrence, { invoiceNumber, issueDate: issue });
  const saved = localDb.invoices.save(built);
  return { invoice: saved, created: true };
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
        const { invoice, created } = generateInvoiceFromSchedule(current, occurrence);
        current = recordGenerated(current, occurrence, invoice);
        if (created) report.generated.push(invoice);
      }
    } catch (err) {
      report.errors.push(`${listed.name}: ${(err as Error).message}`);
    }
  }
  return report;
}

export function recurringToastMessage(generated: InvoiceRecord[]): string {
  const n = generated.length;
  if (n === 0) return '';
  const drafts = generated.filter((g) => g.status === 'Draft').length;
  const base = `${n} recurring invoice${n === 1 ? '' : 's'} created`;
  return drafts === n ? `${base} as draft${n === 1 ? '' : 's'} for review` : base;
}

/* ── Manual actions ───────────────────────────────────────────── */

/** Generate the next occurrence immediately, dated `today`. */
export function runNow(id: string, today: string): GenerateResult | null {
  const s = recurringDb.getById(id);
  if (!s || isEnded(s)) return null;
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
