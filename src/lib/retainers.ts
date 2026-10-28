/**
 * Prepaid retainer hours (R3-B3): "20 hours a month for ₹ 40,000".
 *
 * A retainer is a block of hours per period (month, or Indian-FY quarter Apr–Jun / Jul–Sep / Oct–Dec /
 * Jan–Mar) for one client, optionally limited to some projects (cost centres). The client's billable
 * time draws the period down in date order (then creation time). Minutes inside the block are
 * *covered*: they are left out of the Unbilled flow, so they are never billed again. Minutes beyond
 * the block are *overage* and bill through the normal Unbilled flow at the overage rate.
 *
 * Coverage is DERIVED (like the rest of time billing): from the retainer row while a period is open,
 * and from the entries' `retainer_id` / `retainer_period` stamps once the period is closed. A period
 * whose fee invoice exists but is cancelled covers nothing (its entries become unbilled again); a
 * period without a fee invoice yet still covers ("pending fee"). The fee invoice is found by its
 * link (`fee_invoices` / the close row) or as the linked recurring template's invoice dated inside the
 * period. The saved fee invoice is never edited (Critical Rule 3).
 *
 * Closing a period records the rollover (leftover up to the cap) and the forfeited hours, and stamps
 * the covered entries. GST: the fee invoice is an ordinary tax invoice on its own issue date. Time of
 * supply for advance / periodic services is a statutory point — verify with your CA.
 *
 * Pure above the "Storage" divider (tests/retainers.test.ts). No import of `timesheets.ts` (which
 * imports this module): the billing step arrives as a `billable(e)` function.
 */
import type { InvoiceRecord } from '../types/invoice';
import type { TimeEntry } from '../types/time';
import type {} from '../types/service-r3';
import { num, round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { assertUnlocked } from './period-lock';
import { withTablesRollback } from './table-txn';
import { audit } from './audit';

export const RETAINERS_TABLE = 'retainers';

export type RetainerPeriodKind = 'month' | 'quarter';

/** A recorded period close. */
export interface RetainerClose {
  /** First local day of the period. */
  period: string;
  /** Covered minutes. */
  used: number;
  /** Minutes carried into the next period. */
  rolled: number;
  /** Leftover minutes beyond the rollover cap. */
  forfeited: number;
  /** ISO time of the close. */
  at: string;
  fee_invoice_id?: string;
  /** Covered minutes per stamped entry id (QA5-2 F4): a partly covered entry keeps its overage billable. */
  covered?: Record<string, number>;
}

export interface Retainer {
  id: string;
  /** `clientKey` of the client: the CRM id, else `name:<lower-cased name>`. */
  client_key: string;
  client_name?: string;
  hours_per_period: number;
  period: RetainerPeriodKind;
  /** Fee per period (rupees, before GST). */
  fee: number;
  /** Local day the retainer starts (its first period is the one containing this day). */
  start: string;
  /** Hours that may roll into the next period (0 = none). */
  rollover_cap: number;
  /** Rate for overage entries (absent = the entry's own captured rate). */
  overage_rate?: number;
  /** Recurring template that issues the fee invoice. */
  recurring_id?: string;
  /** Only time on these projects draws the block down (absent / empty = all the client's time). */
  cost_centre_ids?: string[];
  /** Fee invoice linked by hand per period (first day → invoice id). */
  fee_invoices?: Record<string, string>;
  closes: RetainerClose[];
  inactive?: boolean;
  created_at?: string;
  updated_at?: string;
}

// ── Pure: periods (local days, never `new Date(str)`) ────────────

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => {
  const dt = new Date(y, m - 1, d);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};
const parts = (day: string) => day.split('-').map(Number) as [number, number, number];

/** First day of the period containing `day`. Quarters follow the Indian FY (Apr, Jul, Oct, Jan). */
export function periodStart(day: string, kind: RetainerPeriodKind): string {
  const [y, m] = parts(day);
  if (kind === 'month') return ymd(y, m, 1);
  return ymd(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
}

export function nextPeriod(start: string, kind: RetainerPeriodKind): string {
  const [y, m] = parts(start);
  return ymd(y, m + (kind === 'month' ? 1 : 3), 1);
}

export function periodEnd(start: string, kind: RetainerPeriodKind): string {
  const [y, m] = parts(nextPeriod(start, kind));
  return ymd(y, m, 0);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 2026" or "Q3 FY26-27". */
export function periodLabel(start: string, kind: RetainerPeriodKind): string {
  const [y, m] = parts(start);
  if (kind === 'month') return `${MONTHS[m - 1]} ${y}`;
  const fy = m >= 4 ? y : y - 1;
  const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
  return `Q${q} FY${String(fy % 100).padStart(2, '0')}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

/** Period starts from the retainer's first period through the one containing `upTo`. */
export function periodsThrough(r: Pick<Retainer, 'start' | 'period'>, upTo: string): string[] {
  const out: string[] = [];
  if (!r.start || upTo < r.start) return out;
  const last = periodStart(upTo, r.period);
  for (let p = periodStart(r.start, r.period); p <= last && out.length < 600; p = nextPeriod(p, r.period)) out.push(p);
  return out;
}

// ── Pure: drawdown ───────────────────────────────────────────────

export const retainerClientKey = (row: { client_id?: string; client_name?: string }): string =>
  row.client_id ? row.client_id : `name:${(row.client_name ?? '').trim().toLowerCase()}`;

export type FeeState = 'pending' | 'live' | 'cancelled';

export interface RetainerPeriod {
  period: string;
  end: string;
  label: string;
  /** Minutes available: the block plus what rolled in. */
  allowance: number;
  rolled_in: number;
  used: number;
  remaining: number;
  overage_minutes: number;
  rolled_out: number;
  forfeited: number;
  closed: boolean;
  /** Period over (its last day is before `today`). */
  ended: boolean;
  fee_state: FeeState;
  fee_invoice_id?: string;
  /** Covered minutes per entry id. */
  covered: Map<string, number>;
  /** Overage minutes per entry id. */
  overage: Map<string, number>;
}

type FeeDoc = Pick<InvoiceRecord, 'id' | 'status' | 'issue_date' | 'recurring_id'>;

/** The period's fee invoice: linked by the close / by hand, else the recurring template's invoice in the period. */
export function feeInvoiceFor(r: Retainer, period: string, invoices: readonly FeeDoc[]): FeeDoc | undefined {
  const end = periodEnd(period, r.period);
  const linked = r.closes.find((c) => c.period === period)?.fee_invoice_id || r.fee_invoices?.[period];
  if (linked) return invoices.find((i) => i.id === linked);
  if (!r.recurring_id) return undefined;
  const hits = invoices.filter((i) => i.recurring_id === r.recurring_id && i.issue_date >= period && i.issue_date <= end);
  return hits.find((i) => i.status !== 'Cancelled') ?? hits[0];
}

export function eligibleEntry(r: Retainer, e: TimeEntry): boolean {
  if (!e.billable || retainerClientKey(e) !== r.client_key || !e.date || e.date < r.start) return false;
  const only = r.cost_centre_ids ?? [];
  return !only.length || (!!e.cost_centre_id && only.includes(e.cost_centre_id));
}

const order = (a: TimeEntry, b: TimeEntry) =>
  a.date.localeCompare(b.date) || (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id);

/**
 * Every period of the retainer up to `today`, in order: allowance (block + rollover in), covered and
 * overage minutes per entry, rollover out and forfeited minutes. `billable(e)` is the billing step.
 */
export function drawdown(
  r: Retainer,
  entries: readonly TimeEntry[],
  billable: (e: TimeEntry) => number,
  invoices: readonly FeeDoc[],
  today: string,
): RetainerPeriod[] {
  const block = Math.max(Math.round(num(r.hours_per_period) * 60), 0);
  const cap = Math.max(Math.round(num(r.rollover_cap) * 60), 0);
  const mine = entries.filter((e) => eligibleEntry(r, e)).sort(order);
  const lastDay = [today, ...mine.map((e) => e.date)].sort().pop() ?? today;
  const out: RetainerPeriod[] = [];
  let rolledIn = 0;
  for (const period of periodsThrough(r, lastDay)) {
    const end = periodEnd(period, r.period);
    const close = r.closes.find((c) => c.period === period);
    const fee = feeInvoiceFor(r, period, invoices);
    const feeState: FeeState = !fee ? 'pending' : fee.status === 'Cancelled' ? 'cancelled' : 'live';
    const inPeriod = mine.filter((e) => e.date >= period && e.date <= end);
    const allowance = feeState === 'cancelled' ? 0 : block + rolledIn;
    const covered = new Map<string, number>();
    const overage = new Map<string, number>();
    let used = 0;
    for (const e of inPeriod) {
      const m = Math.max(billable(e), 0);
      // A closed period keeps what it stamped (the minutes recorded per entry; a close row from before
      // QA5-2 F4 has no per-entry split, so its recorded `used` caps the stamps in date order);
      // an open one draws down in date order.
      const stamped = !!close && e.retainer_id === r.id && e.retainer_period === period && feeState !== 'cancelled';
      const take = close
        ? (stamped ? Math.min(m, close.covered ? (Object.hasOwn(close.covered, e.id) ? Math.max(num(close.covered[e.id]), 0) : 0) : Math.max(num(close.used) - used, 0)) : 0)
        : Math.min(m, Math.max(allowance - used, 0));
      if (take > 0) covered.set(e.id, take);
      if (m - take > 0) overage.set(e.id, m - take);
      used += take;
    }
    const leftover = Math.max(allowance - used, 0);
    const rolledOut = close ? close.rolled : Math.min(leftover, cap);
    const forfeited = close ? close.forfeited : leftover - rolledOut;
    out.push({
      period, end, label: periodLabel(period, r.period), allowance, rolled_in: rolledIn, used, remaining: leftover,
      overage_minutes: [...overage.values()].reduce((s, v) => s + v, 0), rolled_out: rolledOut, forfeited,
      closed: !!close, ended: end < today, fee_state: feeState, ...(fee ? { fee_invoice_id: fee.id } : {}), covered, overage,
    });
    rolledIn = feeState === 'cancelled' ? 0 : rolledOut;
  }
  return out;
}

/** What the Unbilled flow needs: covered minutes and the overage rate per entry, over all retainers. */
export interface RetainerCover {
  covered: Map<string, number>;
  overageRate: Map<string, number>;
}

export function retainerCover(
  retainers: readonly Retainer[],
  entries: readonly TimeEntry[],
  billable: (e: TimeEntry) => number,
  invoices: readonly FeeDoc[],
  today: string,
): RetainerCover {
  const covered = new Map<string, number>();
  const overageRate = new Map<string, number>();
  for (const r of retainers) {
    if (r.inactive) continue;
    for (const p of drawdown(r, entries, billable, invoices, today)) {
      for (const [id, m] of p.covered) covered.set(id, (covered.get(id) ?? 0) + m);
      if (num(r.overage_rate) > 0) for (const id of p.overage.keys()) overageRate.set(id, round2(num(r.overage_rate)));
    }
  }
  return { covered, overageRate };
}

/**
 * Close a period: the covered entries get `retainer_id` / `retainer_period`, the close row records
 * used / rolled / forfeited minutes. Pure — returns the new retainer and the entry ids to stamp.
 */
export function closePeriod(
  r: Retainer,
  period: string,
  entries: readonly TimeEntry[],
  billable: (e: TimeEntry) => number,
  invoices: readonly FeeDoc[],
  today: string,
  at: string = new Date().toISOString(),
): { retainer: Retainer; stamp: string[]; row: RetainerClose } {
  if (r.closes.some((c) => c.period === period)) throw new Error('This period is already closed.');
  const p = drawdown(r, entries, billable, invoices, today).find((x) => x.period === period);
  if (!p) throw new Error('That period is outside the retainer.');
  const earlier = drawdown(r, entries, billable, invoices, today).filter((x) => x.period < period && !x.closed);
  if (earlier.length) throw new Error(`Close ${earlier[0].label} first.`);
  const row: RetainerClose = {
    period, used: p.used, rolled: p.rolled_out, forfeited: p.forfeited, at,
    covered: Object.fromEntries(p.covered),
    ...(p.fee_invoice_id ? { fee_invoice_id: p.fee_invoice_id } : {}),
  };
  return { retainer: { ...r, closes: [...r.closes, row].sort((a, b) => a.period.localeCompare(b.period)) }, stamp: [...p.covered.keys()], row };
}

/** Periods that ended and are still open (offered for closing on the first open after the period end). */
export const periodsToClose = (periods: readonly RetainerPeriod[]): RetainerPeriod[] => periods.filter((p) => p.ended && !p.closed);

export interface RetainerReportRow {
  period: string;
  label: string;
  fee_invoice: string;
  allowance_h: number;
  used_h: number;
  remaining_h: number;
  rolled_h: number;
  forfeited_h: number;
  overage_h: number;
  /** Overage value already invoiced (entries billed by a live invoice). */
  overage_invoiced: number;
  state: string;
}

const h = (m: number) => round2(m / 60);

/** Statement-style rows per period (B3 report). */
export function retainerReport(
  periods: readonly RetainerPeriod[],
  numbers: ReadonlyMap<string, string>,
  overageValue: (entryId: string, minutes: number) => number,
  billedIds: ReadonlySet<string>,
): RetainerReportRow[] {
  return periods.map((p) => ({
    period: p.period,
    label: p.label,
    fee_invoice: p.fee_invoice_id ? numbers.get(p.fee_invoice_id) ?? '' : '',
    allowance_h: h(p.allowance),
    used_h: h(p.used),
    remaining_h: h(p.remaining),
    rolled_h: h(p.rolled_out),
    forfeited_h: h(p.forfeited),
    overage_h: h(p.overage_minutes),
    overage_invoiced: round2([...p.overage].filter(([id]) => billedIds.has(id)).reduce((s, [id, m]) => s + overageValue(id, m), 0)),
    state: p.closed ? 'Closed' : p.ended ? 'Ended — not closed' : 'Open',
  }));
}

export function validateRetainer(r: Partial<Retainer>): string {
  if (!r.client_key) return 'Choose a client.';
  if (!(num(r.hours_per_period) > 0)) return 'Enter the hours per period.';
  if (num(r.fee) < 0) return 'The fee cannot be negative.';
  if (!r.start || !/^\d{4}-\d{2}-\d{2}$/.test(r.start)) return 'Enter the start date.';
  if (num(r.rollover_cap) < 0) return 'The rollover cap cannot be negative.';
  return '';
}

export function normalizeRetainers(rows: readonly unknown[]): Retainer[] {
  const out: Retainer[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Partial<Retainer>;
    if (!o.id || !o.client_key || !o.start) continue;
    out.push({
      ...o,
      id: o.id,
      client_key: o.client_key,
      hours_per_period: Math.max(num(o.hours_per_period), 0),
      period: o.period === 'quarter' ? 'quarter' : 'month',
      fee: Math.max(round2(num(o.fee)), 0),
      start: o.start,
      rollover_cap: Math.max(num(o.rollover_cap), 0),
      closes: Array.isArray(o.closes) ? o.closes.filter((c) => c && typeof c.period === 'string') : [],
    });
  }
  return out;
}

// ── Storage ──────────────────────────────────────────────────────

export const loadRetainers = (): Retainer[] => normalizeRetainers(getTable<unknown>(RETAINERS_TABLE));

export function saveRetainer(input: Omit<Retainer, 'id' | 'closes'> & { id?: string; closes?: RetainerClose[] }): Retainer {
  requireAccess('books.edit');
  const err = validateRetainer(input);
  if (err) throw new Error(err);
  const all = loadRetainers();
  const prev = input.id ? all.find((r) => r.id === input.id) : undefined;
  const now = new Date().toISOString();
  const row = normalizeRetainers([{ ...prev, ...input, id: prev?.id ?? input.id ?? generateId(), closes: prev?.closes ?? input.closes ?? [], created_at: prev?.created_at ?? now, ...(prev ? { updated_at: now } : {}) }])[0];
  setTable(RETAINERS_TABLE, prev ? all.map((r) => (r.id === row.id ? row : r)) : [...all, row]);
  return row;
}

/** A retainer with a closed period stays (its stamps explain covered time): it is made inactive instead. */
export function deleteRetainer(id: string): 'deleted' | 'inactive' {
  requireAccess('books.edit');
  const all = loadRetainers();
  const r = all.find((x) => x.id === id);
  if (!r) return 'deleted';
  if (r.closes.length) {
    setTable(RETAINERS_TABLE, all.map((x) => (x.id === id ? { ...x, inactive: true } : x)));
    return 'inactive';
  }
  setTable(RETAINERS_TABLE, all.filter((x) => x.id !== id));
  return 'deleted';
}

/** Close a period (role-gated, refused in a locked period, all-or-nothing across both tables). */
export function commitClose(id: string, period: string, billable: (e: TimeEntry) => number, invoices: readonly FeeDoc[], today: string): RetainerClose {
  requireAccess('books.edit');
  const r = loadRetainers().find((x) => x.id === id);
  if (!r) throw new Error('Retainer not found.');
  assertUnlocked({ issue_date: periodEnd(period, r.period) }, 'edit');
  return withTablesRollback([RETAINERS_TABLE, 'time_entries'], () => {
    const entries = getTable<TimeEntry>('time_entries');
    const res = closePeriod(r, period, entries, billable, invoices, today);
    const stamp = new Set(res.stamp);
    setTable('time_entries', entries.map((e) => (stamp.has(e.id) ? { ...e, retainer_id: r.id, retainer_period: period } : e)));
    setTable(RETAINERS_TABLE, loadRetainers().map((x) => (x.id === id ? res.retainer : x)));
    audit.record({
      entity: 'client',
      entity_id: r.client_key,
      action: 'update',
      summary: `Retainer ${periodLabel(period, r.period)} closed for ${r.client_name ?? r.client_key}: used ${h(res.row.used)} h, rolled ${h(res.row.rolled)} h, forfeited ${h(res.row.forfeited)} h`,
    });
    return res.row;
  });
}
