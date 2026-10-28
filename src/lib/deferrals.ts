/**
 * Deferred revenue and prepaid expense schedules (R2-C2).
 *
 * A schedule spreads one invoice line (revenue) or one purchase-bill line (prepaid expense) over its
 * service period. GST, GSTR-1 and receivables are untouched — time of supply stays the document date;
 * only the P&L timing changes (verify with your CA: AS 9 / Ind AS 115 basis).
 *
 * Postings are ordinary manual JOURNAL vouchers (`saveVoucher`, period lock and audit included):
 *   - on the document date, the amount moves out of the P&L account into the holding account
 *       revenue: Dr Sales / Cr Income received in advance;   expense: Dr Prepaid expenses / Cr expense;
 *   - on each month end, that month's share moves back (the mirror image);
 *   - stopping a schedule (e.g. the source was cancelled) moves the unreleased balance back on the stop day.
 * Vouchers are written when their date arrives (`postDue`, run on open, idempotent; a locked period is
 * skipped and reported) or all at once up to a date. The holding accounts are created as user
 * accounts on first use (the default chart is not edited).
 *
 * Methods: 'months' — equal shares, one per calendar month from the start month; 'days' — each calendar
 * month's share is proportional to the days of the service period in it (leap years counted). Paise
 * rounding goes to the last share so the shares always add up to the amount.
 *
 * Table `deferrals` (dated). Reads purchases through `readPurchase` / `readPurchaseLines` (Critical Rule 9).
 */

import type { InvoiceRecord } from '../types/invoice';
import type { Deferral, DeferralMethod } from '../types/books-r2';
import { requireAccess } from './access';
import { audit } from './audit';
import { isoDay } from './dates';
import { allocateProportionally, calcInputFromRecord, calculateInvoice, isExcludedLine, round2 } from './invoice-calc';
import { inrValue } from './fx';
import { assertUnlocked, isPeriodLockedError } from './period-lock';
import { withTablesRollback } from './table-txn';
import { readPurchase, readPurchaseLines } from './purchase-normalize';
import { generateId, getTable, setTable } from './storage';
import { formatMoney } from './utils';
import { A, EXPENSE_CATEGORY_ACCOUNTS, chartOf, loadUserAccounts, saveUserAccount, type Account } from './ledger/accounts';
import { VOUCHERS_TABLE, deleteVoucher, loadVouchers, saveVoucher, type ManualVoucher } from './ledger/vouchers';

export const DEFERRALS_TABLE = 'deferrals';
export const DEFERRAL_CLASS = 'Deferral';
export const ADVANCE_INCOME_NAME = 'Income received in advance';
export const PREPAID_NAME = 'Prepaid expenses';

/* ── Dates (bare local days, string arithmetic) ───────────────── */

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** First day of the month `k` months after `day`'s month. */
function monthStart(day: string, k = 0): string {
  const y = +day.slice(0, 4);
  const m = +day.slice(5, 7) - 1 + k;
  return ymd(y + Math.floor(m / 12), (((m % 12) + 12) % 12) + 1, 1);
}
function monthEnd(day: string): string {
  const y = +day.slice(0, 4);
  const m = +day.slice(5, 7);
  return ymd(y, m, daysInMonth(y, m));
}
function addDays(day: string, n: number): string {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n));
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
function dayCount(from: string, to: string): number {
  const u = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((u(to) - u(from)) / 86_400_000) + 1;
}
/** Same day `k` months later (clamped to the month's last day). */
function addMonths(day: string, k: number): string {
  const first = monthStart(day, k);
  const y = +first.slice(0, 4);
  const m = +first.slice(5, 7);
  return ymd(y, m, Math.min(+day.slice(8, 10), daysInMonth(y, m)));
}

/** Last day of the service period: start + months − 1 day. */
export function serviceEnd(start: string, months: number): string {
  return addDays(addMonths(start, Math.max(1, Math.floor(months))), -1);
}

/** Whole months from `start` to `end` (inclusive end), at least 1 — for an "end date" entry. */
export function monthsBetween(start: string, end: string): number {
  let k = 1;
  while (k < 600 && serviceEnd(start, k) < end) k++;
  return k;
}

export interface ScheduleRow {
  /** 1-based share number. */
  n: number;
  /** Release day (a month end, or the service end for the last share of the days method). */
  date: string;
  /** Integer paise. */
  amount: number;
}

/** The release shares of a schedule (pure). */
export function scheduleRows(amountPaise: number, start: string, months: number, method: DeferralMethod): ScheduleRow[] {
  const total = Math.max(0, Math.round(amountPaise));
  const n = Math.max(1, Math.floor(months));
  if (!isoDay(start) || !total) return [];
  const rows: ScheduleRow[] = [];
  if (method === 'months') {
    const each = Math.floor(total / n);
    for (let i = 0; i < n; i++) rows.push({ n: i + 1, date: monthEnd(monthStart(start, i)), amount: i === n - 1 ? total - each * (n - 1) : each });
    return rows;
  }
  const end = serviceEnd(start, n);
  const all = dayCount(start, end);
  let cursor = start;
  let given = 0;
  let k = 1;
  while (cursor <= end) {
    const me = monthEnd(cursor);
    const last = me >= end;
    const segEnd = last ? end : me;
    const amount = last ? total - given : Math.round((total * dayCount(cursor, segEnd)) / all);
    rows.push({ n: k++, date: segEnd, amount });
    given += amount;
    cursor = addDays(segEnd, 1);
  }
  return rows;
}

/* ── Accounts ─────────────────────────────────────────────────── */

/** The holding account for a kind, created as a user account on first use. */
export function ensureHoldingAccount(kind: Deferral['kind'], chart: readonly Account[] = chartOf(loadUserAccounts())): string {
  const name = kind === 'revenue' ? ADVANCE_INCOME_NAME : PREPAID_NAME;
  const hit = chart.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const used = new Set(chart.map((a) => a.code));
  let code = kind === 'revenue' ? 2290 : 3290;
  while (used.has(String(code))) code++;
  return saveUserAccount({ code: String(code), name, group: kind === 'revenue' ? 'OTHER_CL' : 'LOANS_ADV_ST' }).id;
}

/** P&L account a purchase line posted to (same rule as the ledger's purchase postings). */
export function expenseAccountOf(raw: unknown, chart: readonly Account[] = chartOf(loadUserAccounts())): string {
  const c = readPurchase(raw);
  const cat = (c?.category ?? '').trim().toLowerCase();
  const own = cat ? chart.find((a) => !a.system && a.name.toLowerCase() === cat) : undefined;
  if (own) return own.id;
  if (!c?.isExpense) return A.purchases;
  return EXPENSE_CATEGORY_ACCOUNTS[cat] ?? A.otherExp;
}

/* ── Sources ──────────────────────────────────────────────────── */

export interface SourceLine {
  kind: 'invoice' | 'purchase';
  id: string;
  line_index: number;
  number: string;
  party: string;
  name: string;
  /** Document date (time of supply) — the initial deferral is posted on it. */
  date: string;
  /**
   * Line taxable value in rupees: after the line and invoice-level discounts (allocated pro-rata as the
   * invoice calc does), with tax backed out of a tax-inclusive price, converted at the document's rate.
   */
  amount: number;
  cancelled: boolean;
}

/** Deferrable lines of a sales invoice (not credit notes / quotations / challans). */
export function invoiceSourceLines(inv: InvoiceRecord): SourceLine[] {
  if (!['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY'].includes(inv.doc_type)) return [];
  const date = isoDay(inv.issue_date);
  if (!date) return [];
  // The calc lines mirror the items minus unselected optional / alternative lines (QA5-2 F5).
  const calcLines = calculateInvoice(calcInputFromRecord(inv, { amount_paid: 0 })).lines;
  const out: SourceLine[] = [];
  let k = 0;
  (inv.items ?? []).forEach((it, i) => {
    if (isExcludedLine(it)) return;
    const cl = calcLines[k++];
    if (!cl) return;
    out.push({
      kind: 'invoice',
      id: inv.id,
      line_index: i,
      number: inv.invoice_number,
      party: inv.client?.company || inv.client?.name || '',
      name: it.name,
      date,
      amount: inrValue(cl.taxable, inv),
      cancelled: inv.status === 'Cancelled',
    });
  });
  return out.filter((l) => l.amount > 0);
}

/** Deferrable lines of a purchase bill / expense, read through the shared purchase reader. */
export function purchaseSourceLines(raw: unknown): SourceLine[] {
  const c = readPurchase(raw);
  if (!c) return [];
  const cancelled = c.status === 'cancelled' || c.status === 'void';
  const lines = readPurchaseLines(raw);
  const out: SourceLine[] = lines.map((l, i) => ({
    kind: 'purchase' as const,
    id: c.id,
    line_index: i,
    number: c.number,
    party: c.partyName,
    name: l.name || c.category || 'Bill line',
    date: c.date,
    amount: round2(l.quantity * l.unitCost),
    cancelled,
  }));
  // A bill-level discount (lines worth more than the bill's taxable value) is spread pro-rata (QA5-2 F5).
  const linesValue = round2(out.reduce((s, l) => s + l.amount, 0));
  if (out.length && c.taxable > 0 && linesValue > c.taxable + 0.01) {
    const shares = allocateProportionally(out.map((l) => l.amount), c.taxable);
    out.forEach((l, i) => { l.amount = round2(shares[i]); });
  }
  // A lump-sum expense without lines: the whole taxable value is one line.
  if (!out.length && c.taxable > 0) out.push({ kind: 'purchase', id: c.id, line_index: 0, number: c.number, party: c.partyName, name: c.category || 'Expense', date: c.date, amount: c.taxable, cancelled });
  return out.filter((l) => l.amount > 0);
}

/* ── Storage ─────────────────────────────────────────────────── */

type Stored = Deferral;

export function loadDeferrals(): Stored[] {
  return getTable<Stored>(DEFERRALS_TABLE).filter((d) => d && typeof d.id === 'string' && d.source && Number.isFinite(d.amount_paise));
}

export class DeferralError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeferralError';
  }
}

export interface DeferralInput {
  source: SourceLine;
  amount_paise: number;
  start: string;
  months: number;
  method: DeferralMethod;
  /** P&L account; defaults to Sales (revenue) / the bill's expense account. */
  account_id?: string;
}

export function validateDeferral(input: DeferralInput): string[] {
  const e: string[] = [];
  if (!(input.amount_paise > 0)) e.push('Enter the amount to defer.');
  if (Math.round(input.amount_paise) > Math.round(input.source.amount * 100) + 0) e.push('The amount is more than the line value.');
  if (!isoDay(input.start)) e.push('Choose the start of the service period.');
  if (!(input.months >= 1 && input.months <= 120)) e.push('The schedule runs 1 to 120 months.');
  if (input.source.cancelled) e.push('The source document is cancelled.');
  if (loadDeferrals().some((d) => d.status !== 'stopped' && d.source.kind === input.source.kind && d.source.id === input.source.id && d.source.line_index === input.source.line_index)) e.push('This line already has a schedule.');
  return e;
}

/** Create a schedule (nothing is posted until `postDue`). */
export function createDeferral(input: DeferralInput, purchaseRaw?: unknown): Stored {
  requireAccess('books.edit');
  const errors = validateDeferral(input);
  if (errors.length) throw new DeferralError(errors[0]);
  // The initial deferral is posted on the source date: a schedule that could only release (its first
  // entry falls in the period lock) is refused, never half-posted (QA5-2 F6).
  assertUnlocked({ issue_date: isoDay(input.source.date) || isoDay(input.start), invoice_number: input.source.number }, 'create');
  const kind: Deferral['kind'] = input.source.kind === 'invoice' ? 'revenue' : 'expense';
  const chart = chartOf(loadUserAccounts());
  const holding = ensureHoldingAccount(kind, chart);
  const account = input.account_id || (kind === 'revenue' ? A.sales : expenseAccountOf(purchaseRaw, chart));
  const row: Stored = {
    id: generateId(),
    kind,
    source: { kind: input.source.kind, id: input.source.id, line_index: input.source.line_index, number: input.source.number, party: input.source.party, name: input.source.name, date: input.source.date },
    amount_paise: Math.round(input.amount_paise),
    start: isoDay(input.start),
    months: Math.floor(input.months),
    method: input.method,
    account_id: account,
    holding_account_id: holding,
    voucher_ids: [],
    status: 'active',
    created_at: new Date().toISOString(),
  };
  setTable(DEFERRALS_TABLE, [...loadDeferrals(), row]);
  audit.record({ entity: 'voucher', entity_id: row.id, action: 'create', doc_number: input.source.number, summary: `Deferral schedule for ${input.source.number} (${input.source.name}): ₹${formatMoney(row.amount_paise / 100)} over ${row.months} month(s) from ${row.start}` });
  return row;
}

/** Source document date stored on the row (the initial deferral's date). */
const sourceDate = (d: Stored) => isoDay(d.source.date) || d.start;

export interface PlannedEntry {
  key: string;
  date: string;
  amount: number;
  /** 'defer' moves P&L → holding; 'release' moves holding → P&L. */
  kind: 'defer' | 'release';
}

/** Every entry the schedule should have, by key ('init', 'r1'…, 'stop'). */
export function plannedEntries(d: Stored): PlannedEntry[] {
  const out: PlannedEntry[] = [{ key: 'init', date: sourceDate(d), amount: d.amount_paise, kind: 'defer' }];
  const rows = scheduleRows(d.amount_paise, d.start, d.months, d.method);
  if (d.status === 'stopped' && d.stopped_on) {
    let released = 0;
    for (const r of rows) {
      if (r.date >= d.stopped_on || d.posted?.[`r${r.n}`] === undefined) continue;
      out.push({ key: `r${r.n}`, date: r.date, amount: r.amount, kind: 'release' });
      released += r.amount;
    }
    if (d.amount_paise - released > 0) out.push({ key: 'stop', date: d.stopped_on, amount: d.amount_paise - released, kind: 'release' });
    return out;
  }
  for (const r of rows) out.push({ key: `r${r.n}`, date: r.date, amount: r.amount, kind: 'release' });
  return out;
}

function voucherFor(d: Stored, e: PlannedEntry) {
  const pnl = d.account_id;
  const hold = d.holding_account_id;
  // revenue defer: Dr P&L / Cr holding; revenue release: Dr holding / Cr P&L. Expense is the mirror image.
  const drAcc = (d.kind === 'revenue') === (e.kind === 'defer') ? pnl : hold;
  const crAcc = drAcc === pnl ? hold : pnl;
  const what = e.key === 'init' ? 'deferred' : e.key === 'stop' ? 'released (schedule stopped)' : `released, share ${e.key.slice(1)} of ${d.months}`;
  return {
    type: 'JOURNAL' as const,
    date: e.date,
    narration: `${d.kind === 'revenue' ? 'Income received in advance' : 'Prepaid expense'} ${what} — ${d.source.number ?? ''} ${d.source.name ?? ''}`.trim(),
    voucher_class: DEFERRAL_CLASS,
    lines: [
      { account_id: drAcc, dr: e.amount, cr: 0 },
      { account_id: crAcc, dr: 0, cr: e.amount },
    ],
  };
}

export interface PostResult {
  posted: number;
  /** Entries skipped because their date is inside the period lock. */
  locked: number;
  errors: string[];
}

/**
 * Write every due entry (date ≤ `upTo`) that is not yet posted. Idempotent: an entry is posted once
 * (its voucher id is kept under its key). Entries inside the period lock are skipped and counted.
 * No release is posted while the initial deferral is unposted (it would move income that was never
 * deferred): such releases are held and counted with the locked entries (QA5-2 F6).
 */
export function postDue(upTo: string, ids?: readonly string[]): PostResult {
  const res: PostResult = { posted: 0, locked: 0, errors: [] };
  const all = loadDeferrals();
  const live = new Set(loadVouchers().map((v) => v.id));
  let changed = false;
  const next = all.map((d) => {
    if (ids && !ids.includes(d.id)) return d;
    if (d.status === 'completed') return d;
    const posted = { ...(d.posted ?? {}) };
    // A voucher deleted by hand is posted again.
    for (const [k, v] of Object.entries(posted)) if (!live.has(v)) delete posted[k];
    for (const e of plannedEntries({ ...d, posted })) {
      if (posted[e.key] || e.date > upTo || e.amount <= 0) continue;
      if (e.kind === 'release' && !posted.init) {
        res.locked++;
        continue;
      }
      try {
        const v = saveVoucher(voucherFor(d, e));
        posted[e.key] = v.id;
        res.posted++;
      } catch (err) {
        if (isPeriodLockedError(err)) res.locked++;
        else res.errors.push(`${d.source.number ?? d.id}: ${(err as Error).message}`);
      }
    }
    const plan = plannedEntries({ ...d, posted });
    const done = d.status === 'active' && plan.every((e) => posted[e.key]);
    const row: Stored = { ...d, posted, voucher_ids: Object.values(posted), ...(done ? { status: 'completed' as const } : {}) };
    if (JSON.stringify(row) !== JSON.stringify(d)) changed = true;
    return row;
  });
  if (changed) setTable(DEFERRALS_TABLE, next);
  return res;
}

/** Stop a schedule on `on`: future shares are dropped and the unreleased amount is released that day. */
export function stopDeferral(id: string, on: string): PostResult {
  requireAccess('books.edit');
  const day = isoDay(on);
  if (!day) throw new DeferralError('Choose the day to stop on.');
  const all = loadDeferrals();
  const d = all.find((x) => x.id === id);
  if (!d) throw new DeferralError('Schedule not found.');
  setTable(DEFERRALS_TABLE, all.map((x) => (x.id === id ? { ...x, status: 'stopped' as const, stopped_on: day, updated_at: new Date().toISOString() } : x)));
  audit.record({ entity: 'voucher', entity_id: id, action: 'update', doc_number: d.source.number, summary: `Deferral schedule for ${d.source.number ?? ''} stopped on ${day}; unreleased amount released` });
  return postDue(day, [id]);
}

/**
 * Delete a schedule and every voucher it wrote — all or nothing (QA5-2 F22): every journal's lock is
 * checked before any is deleted, and the two tables roll back together if a delete still fails.
 */
export function deleteDeferral(id: string): void {
  requireAccess('books.edit');
  const d = loadDeferrals().find((x) => x.id === id);
  if (!d) return;
  const own = new Set(d.voucher_ids);
  for (const v of loadVouchers()) {
    if (!own.has(v.id)) continue;
    assertUnlocked({ id: v.id, issue_date: v.date, invoice_number: v.number }, 'delete');
    if (v.reverse_on) assertUnlocked({ id: v.id, issue_date: v.reverse_on, invoice_number: v.number }, 'delete');
  }
  withTablesRollback([VOUCHERS_TABLE, DEFERRALS_TABLE], () => {
    for (const v of d.voucher_ids) deleteVoucher(v);
    setTable(DEFERRALS_TABLE, loadDeferrals().filter((x) => x.id !== id));
  });
  audit.record({ entity: 'voucher', entity_id: id, action: 'delete', doc_number: d.source.number, summary: `Deferral schedule for ${d.source.number ?? ''} deleted with its journals` });
}

/** Active schedules whose source document is now cancelled (or deleted) — the UI offers to stop them. */
export function cancelledSources(deferrals: readonly Stored[], invoices: readonly InvoiceRecord[], purchases: readonly unknown[]): Stored[] {
  const inv = new Map(invoices.map((i) => [i.id, i]));
  const bills = new Map<string, ReturnType<typeof readPurchase>>();
  for (const p of purchases) {
    const c = readPurchase(p);
    if (c) bills.set(c.id, c);
  }
  return deferrals.filter((d) => {
    if (d.status === 'stopped') return false;
    if (d.source.kind === 'invoice') {
      const i = inv.get(d.source.id);
      return !i || i.status === 'Cancelled';
    }
    const b = bills.get(d.source.id);
    return !b || b.status === 'cancelled' || b.status === 'void';
  });
}

/* ── Register ─────────────────────────────────────────────────── */

export interface RegisterRow {
  deferral: Stored;
  opening: number;
  deferred: number;
  released: number;
  closing: number;
}

/** Posted movements of one schedule inside [from, to] and before `from` (paise), from its vouchers. */
function movements(d: Stored, vouchers: ReadonlyMap<string, ManualVoucher>, from: string, to: string) {
  let before = 0;
  let deferred = 0;
  let released = 0;
  for (const [key, vid] of Object.entries(d.posted ?? {})) {
    const v = vouchers.get(vid);
    if (!v) continue;
    const amt = v.lines.reduce((s, l) => s + l.dr, 0);
    const sign = key === 'init' ? 1 : -1;
    if (v.date < from) before += sign * amt;
    else if (v.date <= to) {
      if (key === 'init') deferred += amt;
      else released += amt;
    }
  }
  return { before, deferred, released };
}

/** Deferral register for a period (normally an FY): opening, deferred, released, closing per schedule. */
export function deferralRegister(period: { start: string; end: string }, rows: readonly Stored[] = loadDeferrals(), vouchers: readonly ManualVoucher[] = loadVouchers()): { rows: RegisterRow[]; totals: Omit<RegisterRow, 'deferral'> } {
  const byId = new Map(vouchers.map((v) => [v.id, v]));
  const out: RegisterRow[] = [];
  const t = { opening: 0, deferred: 0, released: 0, closing: 0 };
  for (const d of rows) {
    const m = movements(d, byId, period.start, period.end);
    const row = { deferral: d, opening: m.before, deferred: m.deferred, released: m.released, closing: m.before + m.deferred - m.released };
    if (!row.opening && !row.deferred && !row.released && !row.closing) continue;
    out.push(row);
    t.opening += row.opening;
    t.deferred += row.deferred;
    t.released += row.released;
    t.closing += row.closing;
  }
  return { rows: out, totals: t };
}
