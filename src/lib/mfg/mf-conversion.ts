/**
 * MF-D5 WIP and finished goods with conversion cost (pack `shopfloor`; MF24):
 *  - setting `mfg_settings.absorb` — a dated, audited list of switches ({ on, from }); **off by default**. Turning it on
 *    changes stock values only for output journals dated on / after `from`;
 *  - conversion of an order = Σ over its job cards: hours × the operation's machine-hour rate snapshotted at release
 *    (`MfOrderOp.rate` = machine + labour + power + overhead), with the fixed-overhead part capped at normal capacity
 *    (AS 2): a work centre's `overhead_rate` is absorbed on actual hours, but never above `normal_hours` for the FY —
 *    the excess is unabsorbed overhead, a period cost shown in the working only;
 *  - the output journal of a reported quantity carries what the cards have spent and earlier outputs of the order did
 *    not absorb, as one `AdditionalCost` (mode `amount`, id `mf_conv`) — passed to `buildOutputVoucher` through MF-A's
 *    `{ conversion }` argument (without it the journal is byte-identical to before);
 *  - conversion spent on cards of orders still open and not yet absorbed is a **memo** WIP addition at report time
 *    (never in the stock engine). Nothing else posts.
 * Pure maths plus thin loaders. Working paper — verify MF24 with your CA.
 */
import type { AdditionalCost, ManufacturingVoucher } from '../../types/manufacturing';
import type { ProductionOrder } from '../../types/production-r4';
import type { JobCard, MfgSettings, WorkCentre } from '../../types/mfg-r13';
import { num, round2 } from '../invoice-calc';
import { audit } from '../audit';
import { cardTotals, loadCards } from './mf-jobcards';
import { readMfgSettings } from './mf-settings';
import { loadCentres } from './mf-centres';
import { manufacturingDb } from '../manufacturing';
import { productionOrdersDb } from '../production/orders';

export const CONVERSION_COST_ID = 'mf_conv';
export const CONVERSION_LABEL = 'Conversion (job cards: machine, labour, power, overhead)';

/* ── Dated switch ─────────────────────────────────────────────── */

/** Absorption in force on `date`: the latest switch with `from` ≤ date (none = off). */
export function absorbOn(s: Pick<MfgSettings, 'absorb'> | null | undefined, date: string): boolean {
  let hit: { on: boolean; from: string } | undefined;
  for (const x of s?.absorb ?? []) if (x && typeof x.from === 'string' && x.from <= date && (!hit || x.from >= hit.from)) hit = x;
  return !!hit?.on;
}

/** The settings patch for a new switch row (append-only; same `from` replaces that row). */
export function absorbPatch(s: Pick<MfgSettings, 'absorb'> | null | undefined, on: boolean, from: string, at = new Date().toISOString()): Pick<MfgSettings, 'absorb'> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('Choose the date absorption applies from.');
  const rest = (s?.absorb ?? []).filter((x) => x.from !== from);
  return { absorb: [...rest, { on, from, changed_at: at }].sort((a, b) => a.from.localeCompare(b.from)) };
}

/** Audit line for a switch change (the settings save itself is audited by `saveMfgSettings`). */
export function auditAbsorb(on: boolean, from: string): void {
  try {
    audit.record({ entity: 'settings', entity_id: 'mfg_settings', action: 'update', summary: `Conversion absorption ${on ? 'ON' : 'OFF'} from ${from} (stock values change from that date — MF24)` });
  } catch {
    /* logging never blocks */
  }
}

/* ── Conversion maths (pure) ──────────────────────────────────── */

const fyOf = (d: string) => (+d.slice(5, 7) >= 4 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);

/** Hours each work centre logged in the FY of `date` (all cards, up to `date`). */
export function centreHoursInFy(cards: readonly Pick<JobCard, 'work_centre_id' | 'entries'>[], date: string): Map<string, number> {
  const fy = fyOf(date);
  const out = new Map<string, number>();
  for (const c of cards) for (const e of c.entries ?? []) if (e.date <= date && fyOf(e.date) === fy) out.set(c.work_centre_id, (out.get(c.work_centre_id) ?? 0) + num(e.hours));
  return out;
}

/** Share of the fixed overhead absorbed per hour at a centre: 1, or normal hours ÷ actual hours when above normal. */
export function overheadFactor(centre: Pick<WorkCentre, 'normal_hours'> | undefined, actualFyHours: number): number {
  const normal = num(centre?.normal_hours);
  return normal > 0 && actualFyHours > normal ? normal / actualFyHours : 1;
}

export interface OpConversion {
  op_id: string;
  name: string;
  hours: number;
  rate: number;
  /** Overhead absorbed (after the normal-capacity cap) and the unabsorbed part (period cost). */
  overhead: number;
  unabsorbed: number;
  amount: number;
}

/** Conversion spent on an order's job cards up to `date` (₹), by operation. */
export function orderConversion(
  order: Pick<ProductionOrder, 'id' | 'mf'>, cards: readonly JobCard[], centres: readonly WorkCentre[], date: string, fyHours: ReadonlyMap<string, number> = centreHoursInFy(cards, date),
): { ops: OpConversion[]; total: number; unabsorbed: number } {
  const byId = new Map(centres.map((c) => [c.id, c]));
  const ops: OpConversion[] = [];
  for (const op of order.mf?.ops ?? []) {
    let hours = 0;
    for (const c of cards) if (c.order_id === order.id && c.op_id === op.id) hours += (c.entries ?? []).filter((e) => e.date <= date).reduce((s, e) => s + num(e.hours), 0);
    hours = round2(hours);
    if (!(hours > 0)) continue;
    const centre = byId.get(op.work_centre_id);
    const ohRate = Math.min(num(centre?.overhead_rate), num(op.rate));
    const full = round2(ohRate * hours);
    const overhead = round2(full * overheadFactor(centre, fyHours.get(op.work_centre_id) ?? 0));
    ops.push({ op_id: op.id, name: op.name, hours, rate: num(op.rate), overhead, unabsorbed: round2(full - overhead), amount: round2((num(op.rate) - ohRate) * hours + overhead) });
  }
  return { ops, total: round2(ops.reduce((s, o) => s + o.amount, 0)), unabsorbed: round2(ops.reduce((s, o) => s + o.unabsorbed, 0)) };
}

/** Conversion already put into the order's output journals (`mf_conv` cost lines). */
export function absorbedSoFar(orderId: string, vouchers: readonly Pick<ManufacturingVoucher, 'production_order_id' | 'costs'>[]): number {
  return round2(vouchers.filter((v) => v.production_order_id === orderId).reduce((s, v) => s + (v.costs ?? []).filter((c) => c.id === CONVERSION_COST_ID && c.mode === 'amount').reduce((t, c) => t + num(c.value), 0), 0));
}

/**
 * The conversion line for an output journal dated `date`: undefined while absorption is off on that day or nothing is
 * left to absorb (so `buildOutputVoucher` gets no `conversion` and the journal is unchanged).
 */
export function conversionLine(
  order: Pick<ProductionOrder, 'id' | 'mf'>, cards: readonly JobCard[], centres: readonly WorkCentre[], vouchers: readonly Pick<ManufacturingVoucher, 'production_order_id' | 'costs'>[], settings: Pick<MfgSettings, 'absorb'> | null | undefined, date: string,
): AdditionalCost[] | undefined {
  if (!absorbOn(settings, date) || !order.mf?.ops?.length) return undefined;
  const left = round2(orderConversion(order, cards, centres, date).total - absorbedSoFar(order.id, vouchers));
  return left > 0 ? [{ id: CONVERSION_COST_ID, label: CONVERSION_LABEL, mode: 'amount', value: left }] : undefined;
}

export interface MemoRow {
  order_id: string;
  number: string;
  spent: number;
  absorbed: number;
  /** Memo WIP addition (spent − absorbed), ₹. */
  memo: number;
}

/** Memo conversion on open orders at `date` (report time only) and the FY's unabsorbed overhead (period cost). */
export function memoConversion(
  orders: readonly (Pick<ProductionOrder, 'id' | 'number' | 'status' | 'mf'> & { closed_at?: string })[], cards: readonly JobCard[], centres: readonly WorkCentre[], vouchers: readonly Pick<ManufacturingVoucher, 'production_order_id' | 'costs' | 'date'>[], date: string,
): { rows: MemoRow[]; total: number; unabsorbed: number } {
  const fyHours = centreHoursInFy(cards, date);
  const upTo = vouchers.filter((v) => v.date <= date);
  const rows: MemoRow[] = [];
  let unabsorbed = 0;
  for (const o of orders) {
    if (!o.mf?.ops?.length) continue;
    const c = orderConversion(o, cards, centres, date, fyHours);
    unabsorbed += c.unabsorbed;
    // QA16 P3: an order closed after `date` was still open on it.
    if ((o.status === 'closed' && !(o.closed_at && o.closed_at > date)) || o.status === 'cancelled') continue;
    const absorbed = absorbedSoFar(o.id, upTo);
    const memo = round2(Math.max(c.total - absorbed, 0));
    if (memo > 0) rows.push({ order_id: o.id, number: o.number, spent: c.total, absorbed, memo });
  }
  return { rows, total: round2(rows.reduce((s, r) => s + r.memo, 0)), unabsorbed: round2(unabsorbed) };
}

/** Hours on the cards (for the working). */
export const cardHours = (cards: readonly JobCard[]) => round2(cards.reduce((s, c) => s + cardTotals(c).hours, 0));

/* ── Live (lazy callers: the output dialog, Floor → WIP, the inventories split) ─────────────── */

/** The `conversion` argument for an output of `order` on `date` (undefined = absorption off / nothing to absorb). */
export const outputConversion = (order: Pick<ProductionOrder, 'id' | 'mf'>, date: string): AdditionalCost[] | undefined =>
  conversionLine(order, loadCards(), loadCentres(), manufacturingDb.all(), readMfgSettings(), date);

/** Memo conversion of every open order on `date`. */
export const liveMemoConversion = (date: string) => memoConversion(productionOrdersDb.all(), loadCards(), loadCentres(), manufacturingDb.all(), date);
