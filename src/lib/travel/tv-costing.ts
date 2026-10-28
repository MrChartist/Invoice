/**
 * R15-B2 costing (pure): per component and in total — cost (INR at the booking's `fx`; the supplier's actual bill
 * when one is tagged to the booking), sell, margin — and the trip margin report: sell − cost − cancellation losses +
 * commissions, per trip and per month, reading only the trips that start in the period. A bill is read through
 * `readPurchase` (purchase contract): its cost is the taxable value when ITC is claimed, else the total.
 * Working papers — verify with your CA (TV28–TV30).
 */
import type { TravelBooking, TvComponent } from '../../types/travel-r15';
import { isVoidStatus, readPurchase } from '../purchase-normalize';
import { round2 } from '../invoice-calc';
import { costInr, isBilled } from './tv-bookings';
import type { Trip } from './tv-trips';

type RawBill = { tv?: { trip_id?: string; booking_id?: string } };
export interface CostRow { component: TvComponent; cost: number; sell: number; margin: number }
export interface TripCosting {
  rows: CostRow[];
  cost: number;
  sell: number;
  margin: number;
  /** Margin ÷ sell, % (null without a sell). */
  pct: number | null;
  unconfirmed: number;
  unbilled: number;
  /** Supplier bills of the trip not yet paid (₹). */
  unpaid: number;
  loss: number;
  commission: number;
}

/** A live bill's core (void / draft rows left out). */
const live = (b: unknown) => { const c = readPurchase(b); return c && !isVoidStatus(c.status) ? c : null; };
const billCost = (b: unknown): number => {
  const c = live(b);
  return c ? round2(c.itcEligible ? c.taxable : c.total) : 0;
};

/** Costing of one trip from its bookings and the supplier bills tagged to it. */
export function tripCosting(bookings: readonly TravelBooking[], bills: readonly unknown[], lines: ReadonlySet<string>): TripCosting {
  const by = new Map<TvComponent, CostRow>();
  const add = (component: TvComponent, cost: number, sell: number) => {
    const r = by.get(component) ?? { component, cost: 0, sell: 0, margin: 0 };
    r.cost = round2(r.cost + cost);
    r.sell = round2(r.sell + sell);
    r.margin = round2(r.sell - r.cost);
    by.set(component, r);
  };
  const billed = new Set<string>();
  let unconfirmed = 0, unbilled = 0, loss = 0, commission = 0, unpaid = 0;
  for (const b of bookings) {
    commission += Number(b.commission) || 0;
    if (b.status === 'cancelled') {
      if (b.cancel) loss += Math.max((Number(b.cancel.supplier_charge) || 0) - (Number(b.cancel.fee) || 0), 0);
      continue;
    }
    const own = bills.filter((x) => (x as RawBill).tv?.booking_id === b.id && live(x));
    own.forEach((x) => billed.add(String((x as { id?: string }).id)));
    add(b.component, own.length ? own.reduce<number>((s, x) => s + billCost(x), 0) : costInr(b), Number(b.sell) || 0);
    if (b.status === 'held') unconfirmed++;
    if (!isBilled(b, lines)) unbilled++;
  }
  for (const x of bills) {
    const c = live(x);
    if (!c) continue;
    unpaid += Math.max(c.total - c.paid, 0);
    if (!billed.has(c.id)) add('other', billCost(x), 0);
  }
  const rows = [...by.values()];
  const cost = round2(rows.reduce((s, r) => s + r.cost, 0));
  const sell = round2(rows.reduce((s, r) => s + r.sell, 0));
  const margin = round2(sell - cost - loss + commission);
  return { rows, cost, sell, margin, pct: sell > 0 ? round2((margin / sell) * 100) : null, unconfirmed, unbilled, unpaid: round2(unpaid), loss: round2(loss), commission: round2(commission) };
}

export interface MarginRow { trip: Trip; month: string; c: TripCosting }

/** The trip margin report: trips starting in [from, to] only (volume), each with its costing, by start month. */
export function tripMargins(trips: readonly Trip[], bookings: readonly TravelBooking[], bills: readonly unknown[], lines: ReadonlySet<string>, from: string, to: string): MarginRow[] {
  const inPeriod = trips.filter((t) => (t.tv.start ?? '') >= from && (t.tv.start ?? '') <= to);
  const ids = new Set(inPeriod.map((t) => t.id));
  const bk = new Map<string, TravelBooking[]>();
  for (const b of bookings) if (ids.has(b.trip_id)) bk.set(b.trip_id, [...(bk.get(b.trip_id) ?? []), b]);
  const bl = new Map<string, unknown[]>();
  for (const x of bills) {
    const id = (x as RawBill).tv?.trip_id;
    if (id && ids.has(id)) bl.set(id, [...(bl.get(id) ?? []), x]);
  }
  return inPeriod.map((trip) => ({ trip, month: (trip.tv.start ?? '').slice(0, 7), c: tripCosting(bk.get(trip.id) ?? [], bl.get(trip.id) ?? [], lines) })).sort((a, b) => a.month.localeCompare(b.month));
}
