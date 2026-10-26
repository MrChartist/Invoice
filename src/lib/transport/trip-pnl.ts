/**
 * R5-B3: trip P&L — freight of the LRs carried − trip expenses − lorry hire = margin; per trip, per vehicle and per
 * month. Freight of an LR is its own freight, or — when it was billed on a freight bill with other LRs — the bill's
 * taxable value allocated over the bill's LRs by charged weight. Mileage (km ÷ litres) is flagged outside the
 * vehicle's typed normal range. Pure; reads `purchases` through `readPurchase` (purchase contract).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { ConsignmentNote, Trip, Vehicle } from '../../types/transport-works-r5';
import { num, round2 } from '../invoice-calc';
import { readPurchase } from '../purchase-normalize';
import { freightOf } from './consignment-notes';
import { HIRE_CATEGORY } from './trips';

export interface TripPnl {
  trip: Trip;
  vehicle?: Vehicle;
  freight: number;
  expenses: number;
  hire: number;
  margin: number;
  km: number;
  litres: number;
  kmpl: number | null;
  mileageFlag: '' | 'low' | 'high';
}

const weight = (lr: ConsignmentNote) => lr.lines.reduce((s, l) => s + num(l.charged_weight ?? l.actual_weight ?? 0), 0);

/** Freight income per LR id: own freight, or its charged-weight share of a live multi-LR bill's taxable value. */
export function lrIncome(lrs: readonly ConsignmentNote[], invoices: readonly Pick<InvoiceRecord, 'id' | 'status' | 'taxable_value' | 'lr_ids'>[]): Map<string, number> {
  const byId = new Map(lrs.map((l) => [l.id, l]));
  const out = new Map<string, number>();
  for (const lr of lrs) out.set(lr.id, freightOf(lr).total);
  for (const inv of invoices) {
    if (inv.status === 'Cancelled' || !inv.lr_ids || inv.lr_ids.length < 2) continue;
    const on = inv.lr_ids.map((id) => byId.get(id)).filter((l): l is ConsignmentNote => !!l);
    const total = on.reduce((s, l) => s + weight(l), 0);
    if (!(total > 0)) continue;
    let left = round2(num(inv.taxable_value));
    on.forEach((l, i) => {
      const share = i === on.length - 1 ? left : round2((num(inv.taxable_value) * weight(l)) / total);
      left = round2(left - share);
      out.set(l.id, share);
    });
  }
  return out;
}

export interface PnlInput {
  trips: readonly Trip[];
  vehicles: readonly Vehicle[];
  lrs: readonly ConsignmentNote[];
  invoices: readonly Pick<InvoiceRecord, 'id' | 'status' | 'taxable_value' | 'lr_ids'>[];
  purchases: readonly unknown[];
}

export function tripPnl(input: PnlInput): TripPnl[] {
  const income = lrIncome(input.lrs, input.invoices);
  const cost = new Map<string, { exp: number; hire: number }>();
  for (const raw of input.purchases) {
    const tid = (raw as { trip_id?: string })?.trip_id;
    if (!tid) continue;
    const c = readPurchase(raw);
    if (!c) continue;
    const amt = c.itcEligible ? c.taxable : c.total;
    const e = cost.get(tid) ?? { exp: 0, hire: 0 };
    if (c.category === HIRE_CATEGORY) e.hire = round2(e.hire + amt);
    else e.exp = round2(e.exp + amt);
    cost.set(tid, e);
  }
  return input.trips.filter((t) => t.status !== 'cancelled').map((trip) => {
    const vehicle = input.vehicles.find((v) => v.id === trip.vehicle_id);
    const freight = round2(trip.lr_ids.reduce((s, id) => s + (income.get(id) ?? 0), 0));
    const c = cost.get(trip.id) ?? { exp: 0, hire: 0 };
    const km = trip.end_km !== undefined && trip.start_km !== undefined ? Math.max(num(trip.end_km) - num(trip.start_km), 0) : 0;
    const litres = num(trip.litres);
    const kmpl = km > 0 && litres > 0 ? round2(km / litres) : null;
    const range = vehicle?.km_per_litre;
    const mileageFlag = kmpl !== null && range ? (kmpl < range.min ? 'low' : kmpl > range.max ? 'high' : '') : '';
    return { trip, vehicle, freight, expenses: c.exp, hire: c.hire, margin: round2(freight - c.exp - c.hire), km, litres, kmpl, mileageFlag };
  });
}

export interface PnlRollup {
  key: string;
  trips: number;
  freight: number;
  expenses: number;
  hire: number;
  margin: number;
}

/** Per vehicle (registration) or per month (start date) totals. */
export function rollup(rows: readonly TripPnl[], by: 'vehicle' | 'month'): PnlRollup[] {
  const map = new Map<string, PnlRollup>();
  for (const r of rows) {
    const key = by === 'vehicle' ? r.vehicle?.reg_no ?? '—' : r.trip.start_date.slice(0, 7);
    const a = map.get(key) ?? { key, trips: 0, freight: 0, expenses: 0, hire: 0, margin: 0 };
    a.trips++;
    a.freight = round2(a.freight + r.freight);
    a.expenses = round2(a.expenses + r.expenses);
    a.hire = round2(a.hire + r.hire);
    a.margin = round2(a.margin + r.margin);
    map.set(key, a);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}
