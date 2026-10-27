/**
 * MF-A3 job cards `JCD/FY…` (table `job_cards`, `doc.create`, audited, dated by the first entry): ONE row per
 * production order per operation, with an `entries` array (start / stop, good / rejected / rework, operator, machine,
 * scrap kg) — a 20-machine shop logs ≈ 30,000 entries a year in ≈ 3,000 rows. Totals are derived on read.
 *
 *  - Flow rule: an operation cannot report more good units than the previous operation's good output (+ its own
 *    rework) unless the routing allows out-of-sequence work.
 *  - Scrap kg on an entry is production of the scrap item: it reaches stock ONCE, as `mf_jc` scrap lines of the order's
 *    next output journal (R4-A `buildOutputVoucher` extra argument) — lines already posted are subtracted on read, so
 *    deleting the journal makes the scrap due again.
 *  - Good units of employee operators feed payroll production units (one import per month); karigars feed C4.
 * Pure helpers above the storage divider.
 */
import './mf-registry';
import type { JobCard, JobCardEntry, MfOrderOp } from '../../types/mfg-r13';
import type { ProductionOrder } from '../../types/production-r4';
import type { ManufacturingVoucher, VoucherOutputLine } from '../../types/manufacturing';
import type { StockItem } from '../inventory';
import { num, round2 } from '../invoice-calc';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { MF_SERIES, MF_TABLES } from './mf-shared';

const r3 = (x: number) => Math.round((num(x) + Number.EPSILON) * 1000) / 1000 || 0;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface CardTotals { good: number; rejected: number; rework: number; hours: number; scrapKg: number }

export function cardTotals(c: Pick<JobCard, 'entries'>): CardTotals {
  const t = { good: 0, rejected: 0, rework: 0, hours: 0, scrapKg: 0 };
  for (const e of c.entries ?? []) {
    t.good += num(e.good);
    t.rejected += num(e.rejected);
    t.rework += num(e.rework);
    t.hours += num(e.hours);
    t.scrapKg += num(e.scrap_kg);
  }
  return { good: r3(t.good), rejected: r3(t.rejected), rework: r3(t.rework), hours: round2(t.hours), scrapKg: r3(t.scrapKg) };
}

/** Hours between two local times (`HH:mm`); an end before the start runs past midnight. 2 decimals. */
export function hoursBetween(start: string, end: string): number {
  if (!HM.test(start) || !HM.test(end)) return 0;
  const m = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
  const d = m(end) - m(start);
  return round2((d < 0 ? d + 1440 : d) / 60);
}

/** The highest total good an operation may report: the previous operation's good + this card's rework (∞ for the first). */
export function goodLimit(ops: readonly Pick<MfOrderOp, 'id' | 'seq'>[], opId: string, cards: readonly Pick<JobCard, 'op_id' | 'entries'>[]): number {
  const sorted = [...ops].sort((a, b) => a.seq - b.seq);
  const i = sorted.findIndex((o) => o.id === opId);
  if (i <= 0) return Infinity;
  const total = (id: string) => cards.filter((c) => c.op_id === id).reduce((s, c) => s + cardTotals(c).good, 0);
  const rework = cards.filter((c) => c.op_id === opId).reduce((s, c) => s + cardTotals(c).rework, 0);
  return r3(total(sorted[i - 1].id) + rework);
}

/** Overlapping timed entries on the same work centre and machine (warnings, never a refusal). */
export function overlapWarnings(cards: readonly Pick<JobCard, 'number' | 'work_centre_id' | 'entries'>[], entry: Pick<JobCardEntry, 'id' | 'date' | 'start' | 'end' | 'machine'>, centreId: string): string[] {
  if (!entry.start || !entry.end) return [];
  const m = (x: string) => +x.slice(0, 2) * 60 + +x.slice(3, 5);
  const span = (e: Pick<JobCardEntry, 'start' | 'end'>) => [m(e.start!), m(e.end!) + (e.end! < e.start! ? 1440 : 0)] as const;
  const [a0, a1] = span(entry);
  const out: string[] = [];
  for (const c of cards) {
    if (c.work_centre_id !== centreId) continue;
    for (const e of c.entries) {
      if (e.id === entry.id || e.date !== entry.date || !e.start || !e.end || (e.machine ?? '') !== (entry.machine ?? '')) continue;
      const [b0, b1] = span(e);
      if (a0 < b1 && b0 < a1) out.push(`Overlaps ${c.number} ${e.start}–${e.end}${e.machine ? ` on ${e.machine}` : ''}.`);
    }
  }
  return out;
}

/** Good units of the order's last operation (the "ready to report" figure for R4-A's output dialog, before output). */
export function lastOpGood(order: Pick<ProductionOrder, 'id' | 'mf'>, cards: readonly JobCard[]): number {
  const ops = [...(order.mf?.ops ?? [])].sort((a, b) => a.seq - b.seq);
  const last = ops.at(-1);
  return last ? r3(cards.filter((c) => c.order_id === order.id && c.op_id === last.id).reduce((s, c) => s + cardTotals(c).good, 0)) : 0;
}

/**
 * Scrap lines still to post for an order: Σ job-card scrap kg per scrap item − Σ `mf_jc` scrap lines already in the
 * order's manufacturing journals. Valued at the scrap item's sale (else opening) rate as a fixed value.
 */
export function scrapDue(order: Pick<ProductionOrder, 'id'>, cards: readonly JobCard[], vouchers: readonly Pick<ManufacturingVoucher, 'production_order_id' | 'outputs'>[], items: readonly Pick<StockItem, 'id' | 'sale_rate' | 'opening_rate'>[], fallbackItem?: string, newId: () => string = generateId): VoucherOutputLine[] {
  const due = new Map<string, number>();
  for (const c of cards) {
    if (c.order_id !== order.id) continue;
    for (const e of c.entries) {
      const item = e.scrap_item_id || fallbackItem;
      if (item && num(e.scrap_kg) > 0) due.set(item, r3((due.get(item) ?? 0) + num(e.scrap_kg)));
    }
  }
  for (const v of vouchers) {
    if (v.production_order_id !== order.id) continue;
    for (const o of v.outputs ?? []) if (o.mf_jc && due.has(o.item_id)) due.set(o.item_id, r3((due.get(o.item_id) ?? 0) - num(o.qty)));
  }
  return [...due].filter(([, q]) => q > 0.0005).map(([item_id, qty]) => {
    const it = items.find((i) => i.id === item_id);
    return { id: newId(), item_id, qty, kind: 'scrap', rate: round2(num(it?.sale_rate) || num(it?.opening_rate)), mf_jc: true };
  });
}

/** Good units per employee operator in a month (`YYYY-MM`), for payroll production units. */
export function unitsByEmployee(cards: readonly JobCard[], month: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cards) for (const e of c.entries) if (e.operator?.kind === 'employee' && e.date.startsWith(month)) out[e.operator.id] = r3((out[e.operator.id] ?? 0) + num(e.good));
  return out;
}

const OPEN: readonly string[] = ['released', 'in_progress', 'completed'];

/**
 * The cards of orders open between `from` and `to` (released / in progress, dated on or before `to`, not closed before
 * `from`): an index by order id, so a week's load reads only those orders' cards, not a year of them.
 */
export function cardsOfOpenOrders(orders: readonly Pick<ProductionOrder, 'id' | 'status' | 'date' | 'closed_at'>[], cards: readonly JobCard[], from: string, to: string): JobCard[] {
  const open = new Set(orders.filter((o) => OPEN.includes(o.status) && o.date <= to && !(o.closed_at && o.closed_at.slice(0, 10) < from)).map((o) => o.id));
  const byOrder = new Map<string, JobCard[]>();
  for (const c of cards) if (open.has(c.order_id)) byOrder.set(c.order_id, [...(byOrder.get(c.order_id) ?? []), c]);
  return [...byOrder.values()].flat();
}

/* ── Storage ───────────────────────────────────────────────────── */

const T = MF_TABLES.jobCards;
export const loadCards = (): JobCard[] => getTable<JobCard>(T).filter((c) => c && typeof c.id === 'string' && Array.isArray(c.entries));
const lockOf = (c: Pick<JobCard, 'id' | 'date' | 'number'>) => ({ id: c.id, issue_date: c.date, invoice_number: c.number });
const orderOf = (id: string) => peekTable<ProductionOrder>('production_orders').find((o) => o?.id === id);

/** Clean and check one entry; throws a refusal. */
function cleanEntry(e: Partial<JobCardEntry>): JobCardEntry {
  if (!e.date || !DAY.test(e.date)) throw new Error('Choose the date of the work.');
  const hours = e.start && e.end ? hoursBetween(e.start, e.end) : round2(num(e.hours));
  if (hours < 0 || hours > 24) throw new Error('Hours are between 0 and 24.');
  for (const k of ['good', 'rejected', 'rework', 'scrap_kg'] as const) if (num(e[k]) < 0) throw new Error('Quantities cannot be negative.');
  if (!(num(e.good) + num(e.rejected) + num(e.rework) > 0) && !(hours > 0) && !(num(e.scrap_kg) > 0)) throw new Error('Report the hours or a quantity.');
  if (num(e.rejected) > 0 && !e.reason?.trim()) throw new Error('Give the reject reason.');
  return {
    id: e.id || generateId(), date: e.date, ...(e.start ? { start: e.start } : {}), ...(e.end ? { end: e.end } : {}), hours,
    ...(e.setup ? { setup: true } : {}), ...(e.operator?.id ? { operator: e.operator } : {}), ...(e.machine?.trim() ? { machine: e.machine.trim().slice(0, 30) } : {}),
    good: r3(num(e.good)), rejected: r3(num(e.rejected)), rework: r3(num(e.rework)), ...(e.reason?.trim() ? { reason: e.reason.trim() } : {}),
    ...(num(e.scrap_kg) > 0 ? { scrap_kg: r3(num(e.scrap_kg)) } : {}), ...(e.scrap_item_id ? { scrap_item_id: e.scrap_item_id } : {}),
    ...(e.note?.trim() ? { note: e.note.trim().slice(0, 200) } : {}),
  };
}

/**
 * Report one entry on an order's operation (creates the card `JCD/FY…` on the first entry). Returns the card and any
 * overlap warnings. Refused above the flow limit unless `allowOutOfSequence`, and in a locked period.
 */
export function reportEntry(orderId: string, opId: string, input: Partial<JobCardEntry>, opts: { allowOutOfSequence?: boolean } = {}): { card: JobCard; warnings: string[] } {
  requireAccess('doc.create');
  const order = orderOf(orderId);
  const op = order?.mf?.ops?.find((o) => o.id === opId);
  if (!order || !op) throw new Error('This order has no such operation (release it with a routing first).');
  if (order.status === 'closed' || order.status === 'cancelled') throw new Error(`Production order ${order.number} is ${order.status}.`);
  const entry = cleanEntry(input);
  const all = loadCards();
  const prev = all.find((c) => c.order_id === orderId && c.op_id === opId);
  const date = prev && prev.entries.length ? (prev.date < entry.date ? prev.date : entry.date) : entry.date;
  const number = prev?.number ?? nextSeriesNumberFor(MF_SERIES.jobCards, date, all.map((c) => c.number));
  const id = prev?.id ?? generateId();
  assertUnlocked(lockOf({ id, date: entry.date, number }), prev ? 'edit' : 'create');
  const entries = [...(prev?.entries ?? []).filter((x) => x.id !== entry.id), entry].sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''));
  const card: JobCard = {
    ...prev, id, number, date, order_id: orderId, op_id: opId, work_centre_id: op.work_centre_id,
    planned: prev?.planned ?? { qty: num(order.planned_qty), hours: num(op.planned_hours) }, entries, status: 'running',
    created_at: prev?.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const others = all.filter((c) => c.id !== id);
  const limit = goodLimit(order.mf?.ops ?? [], opId, [...others, card]);
  if (!opts.allowOutOfSequence && cardTotals(card).good > limit + 0.0005) throw new Error(`Only ${limit} good unit(s) came from the previous operation: report those first, or allow out-of-sequence work on the routing.`);
  card.status = cardTotals(card).good + 0.0005 >= num(card.planned.qty) ? 'done' : 'running';
  setTable(T, prev ? all.map((c) => (c.id === id ? card : c)) : [...all, card]);
  if (!prev) recordSeries(number);
  return { card, warnings: overlapWarnings(others, entry, op.work_centre_id) };
}

/** Remove one entry (the card stays, its number reserved); a card with no entry left is deleted through the bin. */
export function removeEntry(cardId: string, entryId: string): void {
  requireAccess('doc.create');
  const all = loadCards();
  const c = all.find((x) => x.id === cardId);
  if (!c) return;
  const e = c.entries.find((x) => x.id === entryId);
  if (e) assertUnlocked(lockOf({ ...c, date: e.date }), 'delete');
  const entries = c.entries.filter((x) => x.id !== entryId);
  setTable(T, entries.length ? all.map((x) => (x.id === cardId ? { ...c, entries, status: 'running', updated_at: new Date().toISOString() } : x)) : all.filter((x) => x.id !== cardId));
}

/** Output extras for an order (lazy, from R4-A's output dialog): scrap lines due and the last operation's good units. */
export function outputExtras(order: ProductionOrder, items: readonly StockItem[], scrapItem?: string): { scrapLines: VoucherOutputLine[]; ready: number } {
  const cards = loadCards().filter((c) => c.order_id === order.id);
  const vouchers = peekTable<ManufacturingVoucher>('manufacturing_vouchers');
  return { scrapLines: scrapDue(order, cards, vouchers, items, scrapItem), ready: lastOpGood(order, cards) };
}
