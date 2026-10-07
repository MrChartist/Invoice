/**
 * Late-payment interest — INFORMATIONAL ONLY.
 *
 * The user chooses a rate that matches what their own invoice terms / contract say;
 * this module never supplies one (the stored default is "off, 0 %"), never implies
 * the interest is legally recoverable, and never touches an invoice total. The only
 * way it reaches a document is `buildInterestItem`, called on an explicit click.
 *
 * Maths (per invoice, no rounding until each breakdown row):
 *  - principal = total - TDS withheld (the amount actually payable, as `localDb` treats it);
 *  - interest starts the day AFTER `due_date + grace_days` (grace is interest-free);
 *  - day `t` accrues on the balance left after every payment / credit note dated BEFORE `t`,
 *    so paying on day D costs interest up to and including D (D - due days late);
 *  - `annual`       rate % per year, simple, on a 365-day year;
 *  - `monthly_flat` rate % per month, simple, pro-rated by day on a 30-day month;
 *  - `compounding`  (off by default) lets accrued interest earn interest, daily;
 *  - `cap_percent`  stops the total at that % of the principal;
 *  - a settled invoice stops accruing on the day its balance reaches zero.
 */

import type { InvoiceItem, InvoiceRecord, Payment } from '../types/invoice';
import { DB_PREFIX, generateId, getJson, setJson } from './storage';
import { num, round2 } from './invoice-calc';
import { creditNotesFor, readLinks, type DocLink } from './documents';
import { localDb } from './localDb';
import { termsMentionInterest } from './reminders';

export const LATE_FEE_KEY = `${DB_PREFIX}late_fee`;

export type LateFeeMode = 'annual' | 'monthly_flat';

export interface LateFeeConfig {
  enabled: boolean;
  mode: LateFeeMode;
  /** Percent. Per year for `annual`, per month for `monthly_flat`. */
  rate: number;
  grace_days: number;
  /** Total interest never exceeds this % of the principal. */
  cap_percent?: number;
  /** Interest earns interest (daily). Off unless the user's terms say so. */
  compounding?: boolean;
}

/** Nothing is on and no rate is assumed. */
export const DEFAULT_LATE_FEE: LateFeeConfig = {
  enabled: false,
  mode: 'annual',
  rate: 0,
  grace_days: 0,
};

/** Wording every surface shows next to an interest figure. */
export const INTEREST_DISCLAIMER =
  'Based on the rate you entered in Settings, to match your own invoice terms. It is not added to the invoice total, and whether it can be charged depends on your agreement with the customer.';

/* ── Config storage ───────────────────────────────────────────── */

interface StoredLateFee extends Partial<LateFeeConfig> {
  /** Optional per-sender-profile overrides, keyed by profile id. */
  profiles?: Record<string, Partial<LateFeeConfig>>;
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Coerce anything (hand-edited backup, old version) into a safe config. */
export function sanitizeLateFee(input: unknown, base: LateFeeConfig = DEFAULT_LATE_FEE): LateFeeConfig {
  const o = (input && typeof input === 'object' ? input : {}) as Partial<LateFeeConfig>;
  const capRaw = o.cap_percent ?? base.cap_percent;
  const cap = capRaw === undefined || capRaw === null || (capRaw as unknown) === '' ? undefined : clampNum(capRaw, 0, 1000, 0);
  const out: LateFeeConfig = {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    mode: o.mode === 'annual' || o.mode === 'monthly_flat' ? o.mode : base.mode,
    rate: round2(clampNum(o.rate, 0, 100, base.rate)),
    grace_days: Math.round(clampNum(o.grace_days, 0, 365, base.grace_days)),
  };
  if (cap !== undefined && cap > 0) out.cap_percent = round2(cap);
  const comp = typeof o.compounding === 'boolean' ? o.compounding : base.compounding;
  if (comp) out.compounding = true;
  return out;
}

function readStored(): StoredLateFee {
  const v = getJson<unknown>(LATE_FEE_KEY, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as StoredLateFee) : {};
}

/** Global default, overlaid with the profile's own override when `profileId` has one. */
export function getLateFeeConfig(profileId?: string | null): LateFeeConfig {
  const stored = readStored();
  const global = sanitizeLateFee(stored);
  const own = profileId ? stored.profiles?.[profileId] : undefined;
  return own ? sanitizeLateFee(own, global) : global;
}

/** True when this profile has its own override rather than inheriting the default. */
export function hasProfileLateFee(profileId: string): boolean {
  return !!readStored().profiles?.[profileId];
}

/** Save the global default, or one profile's override when `profileId` is given. */
export function saveLateFeeConfig(config: Partial<LateFeeConfig>, profileId?: string | null): LateFeeConfig {
  const stored = readStored();
  if (profileId) {
    const base = sanitizeLateFee(stored);
    const clean = sanitizeLateFee(config, base);
    setJson(LATE_FEE_KEY, { ...stored, profiles: { ...(stored.profiles ?? {}), [profileId]: clean } });
    return clean;
  }
  const clean = sanitizeLateFee(config, sanitizeLateFee(stored));
  setJson(LATE_FEE_KEY, { ...clean, ...(stored.profiles ? { profiles: stored.profiles } : {}) });
  return clean;
}

/** Drop a profile's override so it inherits the default again. */
export function clearProfileLateFee(profileId: string): void {
  const stored = readStored();
  if (!stored.profiles?.[profileId]) return;
  const { [profileId]: _gone, ...rest } = stored.profiles;
  void _gone;
  setJson(LATE_FEE_KEY, { ...stored, profiles: rest });
}

/* ── Day arithmetic (calendar days, no time zones) ────────────── */

const DAY_MS = 86400000;

function ymd(d: string | Date): string | null {
  if (typeof d === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayNo(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function isoOf(day: number): string {
  const dt = new Date(day * DAY_MS);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Hard stop so a bad date (year 1900) can never spin the loop. */
const MAX_DAYS = 3660;

/* ── Computation ──────────────────────────────────────────────── */

export interface InterestEvent {
  /** YYYY-MM-DD (a longer ISO timestamp is accepted; only the date is used). */
  date: string;
  amount: number;
}

export interface InterestSegment {
  from: string;
  to: string;
  days: number;
  /** Principal outstanding during the segment. */
  balance: number;
  amount: number;
}

export type InterestIneligible =
  | 'not_invoice'
  | 'draft_or_cancelled'
  | 'no_due_date'
  | 'disabled'
  | 'no_rate'
  | 'nothing_due';

export interface InterestResult {
  eligible: boolean;
  reason?: InterestIneligible;
  /** Total interest, rounded to paise. 0 when not eligible or not yet accruing. */
  amount: number;
  principal: number;
  /** Days between the due date and the as-of date (or the settling date). Never negative. */
  days_late: number;
  /** Days that actually accrued (after grace, only while a balance remained). */
  chargeable_days: number;
  /** Date from which interest runs (due date + grace). */
  accrues_from: string | null;
  /** Date accrual was computed to (as-of, or the day the balance cleared). */
  accrued_to: string | null;
  segments: InterestSegment[];
  capped: boolean;
  cap_amount?: number;
  settled: boolean;
  settled_on?: string;
  /** Unpaid principal on the as-of date. */
  outstanding: number;
}

export interface InterestInput {
  doc_type: InvoiceRecord['doc_type'];
  status: InvoiceRecord['status'];
  due_date: string;
  total: number;
  tds_amount?: number;
  payments?: InterestEvent[];
  /** Credit notes issued against this invoice, dated by their issue date. */
  credits?: InterestEvent[];
}

function empty(reason: InterestIneligible, principal = 0): InterestResult {
  return {
    eligible: false,
    reason,
    amount: 0,
    principal,
    days_late: 0,
    chargeable_days: 0,
    accrues_from: null,
    accrued_to: null,
    segments: [],
    capped: false,
    settled: false,
    outstanding: principal,
  };
}

/**
 * Interest on one invoice up to `asOf` (or its settling date, whichever is first).
 * Pure: pass payments and credit notes in.
 */
export function computeInterest(
  inv: InterestInput,
  config: LateFeeConfig,
  asOf: string | Date = new Date(),
): InterestResult {
  if (inv.doc_type !== 'INVOICE' && inv.doc_type !== 'TAX_INVOICE') return empty('not_invoice');
  if (inv.status === 'Draft' || inv.status === 'Cancelled') return empty('draft_or_cancelled');
  const principal = round2(Math.max(num(inv.total) - num(inv.tds_amount), 0));
  if (!config.enabled) return empty('disabled', principal);
  if (!(config.rate > 0)) return empty('no_rate', principal);
  const dueIso = ymd(inv.due_date ?? '');
  const asOfIso = ymd(asOf);
  if (!dueIso || !asOfIso) return empty('no_due_date', principal);
  if (!(principal > 0)) return empty('nothing_due', principal);

  const due = dayNo(dueIso);
  const today = dayNo(asOfIso);
  const grace = Math.max(0, Math.round(num(config.grace_days)));
  const start = due + grace;

  // Everything that reduces the balance, earliest first.
  const events = [...(inv.payments ?? []), ...(inv.credits ?? [])]
    .map((e) => ({ day: ymd(e.date ?? ''), amount: round2(Math.max(num(e.amount), 0)) }))
    .filter((e): e is { day: string; amount: number } => !!e.day && e.amount > 0)
    .map((e) => ({ day: dayNo(e.day), amount: e.amount }))
    .sort((a, b) => a.day - b.day);

  let balance = principal;
  let ei = 0;
  let clearedDay: number | undefined;
  const applyThrough = (day: number) => {
    while (ei < events.length && events[ei].day <= day) {
      const wasOpen = balance > 0;
      balance = round2(Math.max(balance - events[ei].amount, 0));
      if (wasOpen && balance <= 0) clearedDay = events[ei].day;
      ei++;
    }
  };
  // The balance entering the first chargeable day reflects everything dated on/before `start`
  // (never a payment dated after the as-of day).
  applyThrough(Math.min(start, today));

  const daily =
    config.mode === 'monthly_flat' ? config.rate / 100 / 30 : config.rate / 100 / 365;
  const compounding = !!config.compounding;
  const capAmount =
    config.cap_percent && config.cap_percent > 0 ? round2((principal * config.cap_percent) / 100) : undefined;

  const segments: InterestSegment[] = [];
  let accruedExact = 0;
  let chargeableDays = 0;
  let cur: { from: number; to: number; balance: number; exact: number } | null = null;
  let accruedTo: number | null = null;

  const horizon = Math.min(today, start + MAX_DAYS);
  for (let t = start + 1; t <= horizon && balance > 0; t++) {
    // balance now = after events dated < t  (events on t apply from t+1)
    const base = compounding ? balance + accruedExact : balance;
    const dayInterest = base * daily;
    if (!cur || cur.balance !== balance) {
      if (cur) segments.push(finish(cur));
      cur = { from: t, to: t, balance, exact: 0 };
    }
    cur.to = t;
    cur.exact += dayInterest;
    accruedExact += dayInterest;
    chargeableDays++;
    accruedTo = t;
    applyThrough(t);
  }
  if (cur) segments.push(finish(cur));

  function finish(c: { from: number; to: number; balance: number; exact: number }): InterestSegment {
    return {
      from: isoOf(c.from),
      to: isoOf(c.to),
      days: c.to - c.from + 1,
      balance: c.balance,
      amount: round2(c.exact),
    };
  }

  let amount = round2(segments.reduce((s, x) => s + x.amount, 0));
  let capped = false;
  if (capAmount !== undefined && amount > capAmount) {
    amount = capAmount;
    capped = true;
  }

  const settled = balance <= 0;
  const endDay = settled && clearedDay !== undefined ? Math.min(clearedDay, today) : today;

  return {
    eligible: true,
    amount,
    principal,
    days_late: Math.max(0, endDay - due),
    chargeable_days: chargeableDays,
    accrues_from: isoOf(start),
    accrued_to: accruedTo !== null ? isoOf(accruedTo) : null,
    segments,
    capped,
    cap_amount: capAmount,
    settled,
    settled_on: settled && clearedDay !== undefined ? isoOf(clearedDay) : undefined,
    outstanding: balance,
  };
}

/* ── Gathering inputs from stored records ─────────────────────── */

/** Build the pure input for one stored invoice. */
export function interestInputFor(
  invoice: InvoiceRecord,
  payments: Pick<Payment, 'invoice_id' | 'amount' | 'date'>[],
  links: DocLink[],
  allInvoices: InvoiceRecord[],
): InterestInput {
  return {
    doc_type: invoice.doc_type,
    status: invoice.status,
    due_date: invoice.due_date,
    total: invoice.total,
    tds_amount: invoice.tds_amount,
    payments: payments
      .filter((p) => p.invoice_id === invoice.id)
      .map((p) => ({ date: p.date, amount: p.amount })),
    credits: creditNotesFor(invoice.id, links, allInvoices).map((c) => ({
      date: c.issue_date,
      amount: Math.max(num(c.total), 0),
    })),
  };
}

/** Interest for a stored invoice using the saved config of its sender profile. Reads storage. */
export function accruedInterestFor(invoice: InvoiceRecord, asOf: string | Date = new Date()): InterestResult {
  const config = getLateFeeConfig(invoice.sender?.id);
  const input = interestInputFor(invoice, localDb.payments.listFor(invoice.id), readLinks(), localDb.invoices.getAll());
  return computeInterest(input, config, asOf);
}

/**
 * Amount to quote in a payment reminder: only when late fees are on AND the invoice's own terms
 * mention interest / late fees (we never raise the subject unprompted). `undefined` otherwise.
 */
export function interestForReminder(invoice: InvoiceRecord, asOf: Date = new Date()): number | undefined {
  if (!termsMentionInterest(invoice)) return undefined;
  const r = accruedInterestFor(invoice, asOf);
  return r.eligible && r.amount > 0 ? r.amount : undefined;
}

/* ── Invoice line ─────────────────────────────────────────────── */

export interface InterestItemOptions {
  /** GST % to put on the line. Left at 0 — whether GST applies is for the user's CA. */
  taxRate?: number;
  /** HSN/SAC to print, if the user has one. */
  hsn?: string;
}

function rateText(config: LateFeeConfig): string {
  return config.mode === 'annual' ? `${config.rate}% p.a.` : `${config.rate}% per month`;
}

/**
 * The line item for an explicit "Add interest to a new invoice" click. Nothing
 * calls this automatically; the lead decides where the click lives.
 */
export function buildInterestItem(
  result: InterestResult,
  config: LateFeeConfig,
  invoiceNumber: string,
  opts: InterestItemOptions = {},
): InvoiceItem | null {
  if (!result.eligible || !(result.amount > 0)) return null;
  const period = result.accrues_from && result.accrued_to ? ` from ${result.accrues_from} to ${result.accrued_to}` : '';
  return {
    id: generateId(),
    name: `Interest on overdue ${invoiceNumber || 'invoice'}`,
    description: `Late-payment interest at ${rateText(config)}${period}, as per agreed terms.`,
    type: 'service',
    hsn: opts.hsn,
    unit: 'NOS',
    quantity: 1,
    rate: result.amount,
    tax_rate: opts.taxRate ?? 0,
    amount: result.amount,
  };
}

/** One-line description of the basis, for chips and tooltips. */
export function describeBasis(config: LateFeeConfig): string {
  const parts = [rateText(config), config.mode === 'annual' ? 'simple interest' : 'pro-rated by day (30-day month)'];
  if (config.grace_days > 0) parts.push(`${config.grace_days} grace day${config.grace_days === 1 ? '' : 's'}`);
  if (config.cap_percent) parts.push(`capped at ${config.cap_percent}% of the invoice`);
  if (config.compounding) parts.push('compounded daily');
  return parts.join(', ');
}
