/**
 * R7-A2 pricing (pure). One night of a rate plan for a room type:
 *  1. base: the 1- or 2-adult room rate (weekend nights: the plan's own weekend rate, else `weekend_pct` uplift);
 *  2. extras: adults above the covered two (or the type's base occupancy when lower), each child, each extra bed;
 *  3. season (the LAST matching row wins): `override` sets the room rate, `amount` adds to it, `pct` scales every
 *     charge (an override beats the weekend rate);
 *  4. a tax-inclusive plan is reverse-solved per night through the band in force (`bandForInclusive`, C1).
 * `meal` is the plan's meal share inside `total` (information for the folio / annexure, D5). A booking snapshots
 * these prices (`RoomLine.nightly`); editing a plan never reprices a booking unless the user asks ("Re-price").
 */
import type { NightPrice, RatePlan, RoomType } from '../../types/hotel-r7';
import { round2 } from '../invoice-calc';
import { bandForInclusive } from './hotel-rules';
import { nightsBetween } from './business-date';
import { parseDay } from '../dates';

export const DEFAULT_WEEKEND = [5, 6];

export interface Occupancy {
  adults: number;
  children: number;
  extraBeds: number;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const isWeekend = (plan: Pick<RatePlan, 'weekend_days'>, night: string): boolean =>
  (plan.weekend_days ?? DEFAULT_WEEKEND).includes(parseDay(night).getDay());

/** The season row in force on `night` (later rows win). */
export const seasonOn = (plan: Pick<RatePlan, 'seasons'>, night: string) =>
  [...(plan.seasons ?? [])].reverse().find((s) => s.from <= night && night <= s.to);

export function priceNight(plan: RatePlan, type: Pick<RoomType, 'id' | 'base_occupancy'>, occ: Occupancy & { night: string }): NightPrice {
  const r = plan.rates.find((x) => x.room_type_id === type.id);
  if (!r) throw new Error(`Plan ${plan.code} has no rate for this room type.`);
  const adults = Math.max(1, Math.floor(n(occ.adults)));
  const weekend = isWeekend(plan, occ.night);
  const up = weekend ? 1 + n(plan.weekend_pct) / 100 : 1;
  const pick = (own: number | undefined, base: number) => (weekend && own != null && own > 0 ? n(own) : n(base) * up);
  let room = adults >= 2 ? pick(r.weekend_double, r.double) : pick(r.weekend_single, r.single);
  const covered = Math.min(2, Math.max(1, n(type.base_occupancy) || 2));
  let extraAdult = Math.max(0, adults - covered) * n(r.extra_adult);
  let extraChild = Math.max(0, Math.floor(n(occ.children))) * n(r.extra_child);
  let extraBed = Math.max(0, Math.floor(n(occ.extraBeds))) * n(r.extra_bed);
  const s = seasonOn(plan, occ.night);
  if (s?.kind === 'override') room = n(s.value);
  else if (s?.kind === 'amount') room += n(s.value);
  else if (s?.kind === 'pct') {
    const f = 1 + n(s.value) / 100;
    room *= f;
    extraAdult *= f;
    extraChild *= f;
    extraBed *= f;
  }
  const meal = plan.meal_plan === 'EP' ? 0 : n(plan.meal_per_adult) * adults;
  const parts = { room: round2(room), extra_adult: round2(extraAdult), extra_child: round2(extraChild), extra_bed: round2(extraBed) };
  const gross = round2(parts.room + parts.extra_adult + parts.extra_child + parts.extra_bed);
  if (!plan.tax_inclusive || gross <= 0) return { night: occ.night, ...parts, meal: round2(meal), total: gross };
  // Tax-inclusive: the band of the pre-tax value decides the rate; every part is scaled by value ÷ gross.
  const { value } = bandForInclusive(gross, occ.night);
  const k = value / gross;
  const room2 = round2(value - round2(parts.extra_adult * k) - round2(parts.extra_child * k) - round2(parts.extra_bed * k));
  return {
    night: occ.night, room: room2, extra_adult: round2(parts.extra_adult * k), extra_child: round2(parts.extra_child * k), extra_bed: round2(parts.extra_bed * k),
    meal: round2(meal * k), total: value, gross,
  };
}

/** Every night of a stay (arrival inclusive, departure exclusive). */
export function priceStay(plan: RatePlan, type: Pick<RoomType, 'id' | 'base_occupancy'>, occ: Occupancy, arrival: string, departure: string): NightPrice[] {
  return nightsBetween(arrival, departure).map((night) => priceNight(plan, type, { ...occ, night }));
}

export const stayTotal = (nightly: readonly NightPrice[]): number => round2(nightly.reduce((s, x) => s + n(x.total), 0));

/** Min-stay check ('' when fine). */
export const minStayError = (plan: Pick<RatePlan, 'min_stay' | 'code'>, nights: number): string =>
  n(plan.min_stay) > nights ? `Plan ${plan.code} needs at least ${plan.min_stay} nights.` : '';
