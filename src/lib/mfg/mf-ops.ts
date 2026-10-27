/**
 * MF-A2 operation maths and the release hook, kept small: `production/orders.ts` imports only this file (release copies
 * the default routing while the `shopfloor` pack is on), so the production chunk does not carry the routing editor's
 * CSV code. Pure apart from the two table reads (`routings`, `work_centres`, only with the pack on).
 */
import type { MfOrderOp, Routing, RoutingOp, WorkCentre } from '../../types/mfg-r13';
import type { ProductionOrder } from '../../types/production-r4';
import { num, round2 } from '../invoice-calc';
import { peekTable } from '../storage';
import { impliedPacks } from '../shop-mode';
import { localDb } from '../localDb';
import { MF_TABLES } from './mf-shared';

/** ₹ / hour: machine + labour + power + overhead (2 decimals). */
export const machineHourRate = (c: Pick<WorkCentre, 'hourly_rate' | 'labour_rate' | 'power_rate' | 'overhead_rate'>): number =>
  round2(num(c.hourly_rate) + num(c.labour_rate) + num(c.power_rate) + num(c.overhead_rate));

/** Run minutes for `qty` units: per batch (ceil(qty ÷ batch) × minutes per batch) or per unit / units per hour. */
export function runMinutes(op: Pick<RoutingOp, 'run_min_per_unit' | 'run_units_per_hour' | 'batch_size'>, qty: number): number {
  const q = Math.max(num(qty), 0);
  if (num(op.batch_size) > 0) return Math.ceil(q / num(op.batch_size)) * Math.max(num(op.run_min_per_unit), 0);
  const per = num(op.run_min_per_unit) > 0 ? num(op.run_min_per_unit) : num(op.run_units_per_hour) > 0 ? 60 / num(op.run_units_per_hour) : 0;
  return q * per;
}

/** Planned hours of an operation for `qty` units on its centre: (set-up + run) ÷ efficiency, 2 decimals. */
export function plannedHours(op: Pick<RoutingOp, 'setup_min' | 'run_min_per_unit' | 'run_units_per_hour' | 'batch_size'>, qty: number, centre?: Pick<WorkCentre, 'efficiency_pct'>): number {
  const eff = num(centre?.efficiency_pct, 100) > 0 ? num(centre?.efficiency_pct, 100) / 100 : 1;
  return round2((Math.max(num(op.setup_min), 0) + runMinutes(op, qty)) / 60 / eff);
}

/** The order's operations for a planned quantity (snapshot copied at release). */
export function opsForQty(r: Pick<Routing, 'ops'>, qty: number, centres: readonly WorkCentre[]): MfOrderOp[] {
  const byId = new Map(centres.map((c) => [c.id, c]));
  return [...r.ops].sort((a, b) => a.seq - b.seq).map((op) => {
    const c = byId.get(op.work_centre_id);
    return { ...op, planned_hours: plannedHours(op, qty, c), rate: c ? machineHourRate(c) : 0 };
  });
}

/** The item's default routing (else its only one). */
export function defaultRoutingOf(itemId: string, rows: readonly Routing[] = peekTable<Routing>(MF_TABLES.routings)): Routing | undefined {
  const mine = rows.filter((r) => r?.item_id === itemId && Array.isArray(r.ops));
  return mine.find((r) => r.is_default) ?? (mine.length === 1 ? mine[0] : undefined);
}

/** True when the company has the shop-floor pack on (read once per call; no table is read otherwise). */
export const shopfloorOn = (): boolean => impliedPacks(localDb.settings.get()).includes('shopfloor');

/**
 * The operations a release copies onto the order: the item's default routing for the planned quantity, only while the
 * `shopfloor` pack is on (else `undefined`, and the order is released exactly as before).
 */
export function opsForRelease(order: Pick<ProductionOrder, 'item_id' | 'planned_qty'>): MfOrderOp[] | undefined {
  if (!shopfloorOn()) return undefined;
  const r = defaultRoutingOf(order.item_id);
  return r?.ops.length ? opsForQty(r, num(order.planned_qty), peekTable<WorkCentre>(MF_TABLES.centres)) : undefined;
}

/** A4: manufacturing lead days of an item = its default routing's hours for `qty` ÷ the slowest centre's daily hours, rounded up. */
export function makeDaysOf(itemId: string, qty = 1): number {
  const r = defaultRoutingOf(itemId);
  if (!r?.ops.length) return 0;
  const centres = peekTable<WorkCentre>(MF_TABLES.centres);
  const ops = opsForQty(r, qty, centres);
  const daily = ops.map((o) => centres.find((c) => c.id === o.work_centre_id)).map((c) => (c ? c.shifts.reduce((s, x) => s + num(x.hours), 0) * Math.max(num(c.capacity_units, 1), 1) : 0)).filter((h) => h > 0);
  const hours = ops.reduce((s, o) => s + o.planned_hours, 0);
  return daily.length ? Math.ceil(hours / Math.min(...daily)) : 0;
}
