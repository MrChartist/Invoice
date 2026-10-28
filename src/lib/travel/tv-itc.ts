/**
 * R15-B3 ITC block on 5 % trips (TV8, TV28): a supplier bill tagged to a `to5` trip is suggested "ITC not eligible"
 * (the bill form prefills it; the user may claim it with a reason, audited) — except a booking of component
 * `package` bought from another tour operator. GSTR-3B Table 4 and the purchase register read the bill's existing
 * `itc_eligible`, so no GST reader changes. The month-end check lists the bills of 5 % trips that still claim ITC, and
 * a GST-guard check (lazy) flags a 5 % invoice whose trip has such a bill or whose lines mix rates (TV9).
 * Bills are read through `readPurchase` (purchase contract). Working papers — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { TravelBooking, TvComponent } from '../../types/travel-r15';
import { peekTable } from '../storage';
import { isVoidStatus, readPurchase } from '../purchase-normalize';
import { audit } from '../audit';
import { regimeMix } from './tv-regime';
import type { Trip } from './tv-trips';

type RawBill = { id?: string; tv?: { trip_id?: string; regime?: string; itc_reason?: string } };

/** The `PurchaseRecord.tv` of a bill tagged to `trip` (and booking): `regime: 'to5'` marks the ITC block. */
export function tripTag(trip: Pick<Trip, 'id' | 'tv'>, booking?: Pick<TravelBooking, 'id' | 'component'>): { trip_id: string; booking_id?: string; regime?: 'to5' } {
  const block = trip.tv.regime === 'to5' && (booking?.component as TvComponent | undefined) !== 'package';
  return { trip_id: trip.id, ...(booking ? { booking_id: booking.id } : {}), ...(block ? { regime: 'to5' as const } : {}) };
}

export interface ItcOverride { id: string; number: string; date: string; trip_id: string; tax: number; reason: string }

/** Bills of 5 % trips that claim ITC (overrides), dated in [from, to]. */
export function itcOverrides(bills: readonly unknown[], from = '', to = '9999'): ItcOverride[] {
  const out: ItcOverride[] = [];
  for (const b of bills) {
    const tv = (b as RawBill).tv;
    if (tv?.regime !== 'to5') continue;
    const c = readPurchase(b);
    if (!c || isVoidStatus(c.status) || !c.itcEligible || !(c.tax > 0) || c.date < from || c.date > to) continue;
    out.push({ id: c.id, number: c.number, date: c.date, trip_id: tv.trip_id ?? '', tax: c.tax, reason: tv.itc_reason ?? '' });
  }
  return out;
}

/** Audit line when ITC is claimed on a 5 % trip's bill (the reason the user gave). */
export const auditItcOverride = (billId: string, number: string, reason: string): void => void audit.record({ entity: 'purchase', entity_id: billId, action: 'override', doc_number: number, summary: `ITC claimed on a 5 % trip's bill ${number}: ${reason}` });

let cache: { rows: readonly unknown[]; trips: Set<string> } | null = null;
/** GST guards (lazy, travel companies): rate mix on a travel invoice; ITC claimed on the trip of a 5 % invoice. */
export function tvExceptions(inv: InvoiceRecord): { code: 'TV_MIX' | 'TV_ITC_5'; vars: Record<string, string | number> }[] {
  const tv = inv.tv;
  if (!tv?.regime) return [];
  const out: { code: 'TV_MIX' | 'TV_ITC_5'; vars: Record<string, string | number> }[] = [];
  if (regimeMix(inv.items ?? [], tv.regime)) out.push({ code: 'TV_MIX', vars: {} });
  const rows = peekTable<RawBill>('purchases');
  if (cache?.rows !== rows) cache = { rows, trips: new Set(itcOverrides(rows).map((o) => o.trip_id)) };
  if (tv.regime === 'to5' && tv.trip?.id && cache.trips.has(tv.trip.id)) out.push({ code: 'TV_ITC_5', vars: { trip: tv.trip.code } });
  return out;
}
