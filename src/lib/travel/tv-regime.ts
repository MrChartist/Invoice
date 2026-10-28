/**
 * R15-B3 GST regimes for tours (pure): the rate, SAC, ITC rule and printed sentence of a regime on a document date
 * (`TRAVEL_REGIME_RULES`), the snapshot `tv` (trip, regime, sentence, itinerary) and the one-regime-per-invoice
 * warning (5 % package lines mixed with other taxed lines — a warning, never a block; TV9). Pass-through lines (pure
 * agent, `isRecovery`) are outside the value and never count. Working papers — verify with your CA (TV8–TV10).
 */
import type { InvoiceItem } from '../../types/invoice';
import type { TravelBooking, TvRegime, TvSnapshot } from '../../types/travel-r15';
import { ruleAt } from '../tax-rules';
import { TRAVEL_REGIME_RULES, type TvRegimeRule } from '../travel-rules';
import { isRecovery } from '../trade/pure-agent';
import type { Trip } from './tv-trips';

export const regimeRule = (regime: TvRegime, date?: string): TvRegimeRule => ruleAt(TRAVEL_REGIME_RULES, date)[regime];

/** True when the taxed lines (pure-agent recoveries left out) mix the 5 % tour-operator rate with another rate. */
export function regimeMix(items: readonly Pick<InvoiceItem, 'tax_rate' | 'charge_head_id' | 'description' | 'quantity' | 'rate'>[], regime?: TvRegime): boolean {
  const rates = new Set(items.filter((l) => !isRecovery(l) && Number(l.tax_rate) > 0).map((l) => Number(l.tax_rate)));
  return (regime === 'to5' && [...rates].some((r) => r !== 5)) || (rates.has(5) && rates.size > 1);
}

/** The `tv` snapshot of a trip on a document date: trip header, regime, the printed sentence, ≤ 6 itinerary rows. */
export function tvSnapshot(trip: Trip, regime: TvRegime, date: string, bookings: readonly TravelBooking[] = []): TvSnapshot {
  const t = trip.tv;
  const itin = bookings.filter((b) => b.status !== 'cancelled').sort((a, b) => a.start.localeCompare(b.start)).slice(0, 6)
    .map((b) => ({ date: b.start, component: b.component, text: [b.ref, b.notes].filter(Boolean).join(' · ') }));
  const decl = regimeRule(regime, date).decl;
  return {
    trip: { id: trip.id, code: t.code, kind: t.kind, pax: t.pax.length, ...(t.destination ? { destination: t.destination } : {}), ...(t.start ? { start: t.start } : {}), ...(t.end ? { end: t.end } : {}), ...(t.pax[0] ? { lead: t.pax[0].name } : {}) },
    regime,
    ...(decl ? { decl } : {}),
    ...(itin.length ? { itin } : {}),
  };
}
