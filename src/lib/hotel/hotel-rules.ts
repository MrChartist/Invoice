/**
 * R7 hotel statutory values, date-keyed like `tax-rules.ts` (`Versioned` / `ruleAt`): append a new dated row, never
 * edit an old one. Kept out of `tax-rules.ts` (first paint) and imported only by the lazy hotel modules. Every value is
 * a working-paper reading of the law as understood — each `source` ends in "verify": confirm with your CA
 * (docs/CA_REVIEW.md §7, HT1–HT17). Rows exactly as PRD round 7 §4 C1; R7-A lands the file, R7-C appends.
 */
import { ruleAt, type Versioned } from '../tax-rules';

export { ruleAt };

export interface AccommodationBand { upTo: number | null; rate: number; itc: boolean; exempt?: boolean }
export interface AccommodationRule { bands: AccommodationBand[]; basis: 'declared_tariff' | 'value_of_supply' }
export const ACCOMMODATION_RATE_RULES: readonly Versioned<AccommodationRule>[] = [
  { from: '2017-07-01', value: { basis: 'declared_tariff', bands: [
      { upTo: 999.99, rate: 0, itc: false, exempt: true }, { upTo: 2499.99, rate: 12, itc: true },
      { upTo: 7499.99, rate: 18, itc: true }, { upTo: null, rate: 28, itc: true }] },
    source: 'N 11/2017 & 12/2017-CT(R) (bands as understood): verify' },
  { from: '2019-10-01', value: { basis: 'value_of_supply', bands: [
      { upTo: 1000, rate: 0, itc: false, exempt: true }, { upTo: 7500, rate: 12, itc: true }, { upTo: null, rate: 18, itc: true }] },
    source: 'N 20/2019-CT(R): verify' },
  { from: '2022-07-18', value: { basis: 'value_of_supply', bands: [
      { upTo: 7500, rate: 12, itc: true }, { upTo: null, rate: 18, itc: true }] },
    source: 'N 03/2022 & 04/2022-CT(R): verify' },
  { from: '2025-09-22', value: { basis: 'value_of_supply', bands: [
      { upTo: 7500, rate: 5, itc: false }, { upTo: null, rate: 18, itc: true }] },
    source: 'N 15/2025-CT(R) Sl 7(i) (17 Sep 2025, w.e.f. 22 Sep 2025); PIB FAQ 56th Council Q71: verify' },
];
export interface RestaurantRule { specified: { rate: number; itc: boolean }; other: { rate: number; itc: boolean } }
export const HOTEL_RESTAURANT_RATE_RULES: readonly Versioned<RestaurantRule>[] = [
  { from: '2017-11-15', value: { specified: { rate: 18, itc: true }, other: { rate: 5, itc: false } },
    source: 'N 46/2017-CT(R) (declared tariff ≥ ₹7,500): verify' },
  { from: '2025-04-01', value: { specified: { rate: 18, itc: true }, other: { rate: 5, itc: false } },
    source: 'N 05/2025-CT(R) cl. (xxxvi) (value of supply, previous FY): verify' },
];
export interface PremisesRule { threshold: number; window: { fromMonth: 1; fromDay: 1; toMonth: 3; toDay: 31 }; newRegDays: 15; testPreviousFy: boolean }
export const SPECIFIED_PREMISES_RULES: readonly Versioned<PremisesRule | null>[] = [
  { from: '2017-07-01', value: null, source: 'declared-tariff test (no declarations): verify' },
  { from: '2025-04-01', value: { threshold: 7500, window: { fromMonth: 1, fromDay: 1, toMonth: 3, toDay: 31 }, newRegDays: 15, testPreviousFy: true },
    source: 'N 05/2025-CT(R) cl. (xxxvi), Annexures VII–IX: verify' },
];
export const FORM_C_HOURS_RULES: readonly Versioned<{ hours: number; penalty?: number; law: string }>[] = [
  { from: '1946-01-01', value: { hours: 24, law: 'Foreigners Act 1946; Registration of Foreigners Rules 1992 (Form C)' }, source: 'as understood: verify' },
  { from: '2025-09-01', value: { hours: 24, penalty: 50000, law: 'Immigration and Foreigners Act 2025 s.8; Rules 2025 r.17' }, source: 'Govt of Goa DIP release 10 Dec 2025: verify' },
];

/* ── Readers (pure). C1 `hotel-gst.ts` builds on these; R7-A needs them for tax-inclusive plans and advances. ── */

export interface BandResult {
  rate: number;
  itc: boolean;
  exempt: boolean;
  /** 'high' = the top band (no upper limit); everything below it is 'low'. */
  band: 'low' | 'high';
}

const paise = (n: number) => Math.round(n * 100) / 100;

/**
 * Band of one unit-night of value `value` (before GST, after discount — F3 / D2) on `date`. Inclusive at `upTo`
 * (D1: exactly ₹7,500.00 is low; ₹7,500.01 is high).
 */
export function accommodationBand(value: number, date: string): BandResult {
  const { bands } = ruleAt(ACCOMMODATION_RATE_RULES, date);
  const v = paise(Number(value) || 0);
  const i = bands.findIndex((b) => b.upTo === null || v <= b.upTo);
  const b = bands[i < 0 ? bands.length - 1 : i];
  return { rate: b.rate, itc: b.itc, exempt: !!b.exempt, band: b.upTo === null ? 'high' : 'low' };
}

/**
 * Reverse-solve a tax-inclusive night: the pre-tax value whose own band's rate grosses up to `gross`. The lowest band
 * that fits wins; a gross in the gap between bands (e.g. ₹7,875.01 … ₹8,850 from 22 Sep 2025, where no band is
 * self-consistent) takes the higher band and is flagged `gap` — verify with your CA.
 */
export function bandForInclusive(gross: number, date: string): BandResult & { value: number; gap?: boolean } {
  const { bands } = ruleAt(ACCOMMODATION_RATE_RULES, date);
  const g = paise(Number(gross) || 0);
  let lower = -Infinity;
  for (const b of bands) {
    const value = paise(g / (1 + b.rate / 100));
    if (value > lower && (b.upTo === null || value <= b.upTo)) return { ...accommodationBand(value, date), value };
    lower = b.upTo ?? Infinity;
  }
  const top = bands[bands.length - 1];
  const value = paise(g / (1 + top.rate / 100));
  return { rate: top.rate, itc: top.itc, exempt: !!top.exempt, band: 'high', value, gap: true };
}

/** Form C deadline rule in force on `date` (D15). */
export const formCRule = (date: string) => ruleAt(FORM_C_HOURS_RULES, date);
