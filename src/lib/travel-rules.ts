/**
 * Travel, tour and event statutory values (Round 15), keyed by the date they take effect — the same `Versioned` /
 * `ruleAt` shape as `tax-rules.ts`: add a new dated row, never edit an old one. Imported only by lazy Round 15 screens
 * and engines (`src/lib/travel/*`) — never by `tax-rules.ts`, `shop-mode.ts` or the shell (`tests/tv-rules.test.ts`
 * checks the import graph). Values that already live elsewhere stay there: TDS / 194H (`tax-rules.ts`, `tds-rules.ts`),
 * hotel tariff bands (`hotel/hotel-rules.ts`), 2025-Act labels (`ita2025.ts`), FEMA realisation (`trade/trade-rules.ts`).
 *
 * A row is `verified: true` only when its value was read in a primary text in Round 15 (PRD §2.4). One section per
 * package (§6 of docs/prd/round-15.md). Working papers — verify with your CA (docs/CA_REVIEW.md §15).
 */
import type { Versioned } from './tax-rules';
import type { TvRegime } from '../types/travel-r15';

/** A dated travel rule row: `source` plus whether the value was read in a primary text this round. */
export type TvRule<T> = Versioned<T> & { verified: boolean };

/* ── R15-B: GST regimes for tours (B3; TV8–TV10) ─────────────────────────────────────────────────────────────── */

export interface TvRegimeRule {
  /** GST rate on the package / fee line (0 = exempt). */
  rate: number;
  sac: string;
  /** Input tax credit on the trip's inputs: `blocked` (5 % regime, except another tour operator's package). */
  itc: 'blocked' | 'allowed';
  /** The sentence printed on the invoice ('' = none). */
  decl: string;
}

const TO5_DECL = 'Tour operator service — the amount is the gross amount charged including accommodation and transportation; GST 5 % without ITC (N 11/2017-CT(R) Sl. 23(ii)). Verify with your CA.';
const AGENT_DECL = 'Fares / hotel / visa fees recovered at actual as a pure agent (Rule 33). Verify with your CA.';
const EXEMPT_DECL = 'Exempt — tour operator service to a foreign tourist for a tour wholly outside India (entry to confirm). Verify with your CA.';
const REGIMES: Readonly<Record<TvRegime, TvRegimeRule>> = {
  to5: { rate: 5, sac: '998555', itc: 'blocked', decl: TO5_DECL },
  to18: { rate: 18, sac: '998555', itc: 'allowed', decl: '' },
  agent: { rate: 18, sac: '998552', itc: 'allowed', decl: AGENT_DECL },
  exempt_outside: { rate: 0, sac: '998555', itc: 'allowed', decl: EXEMPT_DECL },
};

export const TRAVEL_REGIME_RULES: readonly TvRule<Readonly<Record<TvRegime, TvRegimeRule>>>[] = [
  { from: '2017-07-01', value: REGIMES, source: 'N 11/2017-CT(R) Sl. 23(ii) (5 % no ITC) and the heading 9985 residual entry (18 %); exemption for foreign tourists, tour wholly outside India (as reported; TV8–TV10)', verified: false },
  { from: '2025-09-22', value: REGIMES, source: 'N 15/2025-CT(R) (17 Sep 2025): tour-operator 5 % no-ITC entry kept, as reported (CBIC text not reachable; TV8)', verified: false },
];

/* ── R15-C: air tickets, cancellations (AIR_AGENT_VALUE_RULES, AIR_SAC_RULES, CANCEL_FEE_RATE_RULES) ─────────── */

/** Rule 32(3) CGST Rules: the air travel agent's service valued at a % of the basic fare, at the agent's option (TV11). */
export const AIR_AGENT_VALUE_RULES: readonly TvRule<{ domestic: number; intl: number }>[] = [
  { from: '2017-07-01', value: { domestic: 5, intl: 10 }, source: 'Rule 32(3) CGST Rules 2017: 5 % of the basic fare (domestic), 10 % (international), at the agent\'s option (as reported; TV11)', verified: false },
];

/** SAC and GST rate of the agent's own services: air-ticket booking, other travel / hotel bookings, insurance agency (TV11, TV16, TV17). */
export const AIR_SAC_RULES: readonly TvRule<{ air: string; other: string; insurance: string; rate: number }>[] = [
  { from: '2017-07-01', value: { air: '998551', other: '998552', insurance: '997161', rate: 18 }, source: 'SAC 998551 / 998552 (reservation services), 997161 (insurance agents) at 18 % (as reported; TV11, TV16, TV17)', verified: false },
];

/** Airline GST passed through on a ticket (shown, never our output tax): economy / other classes (TV12). */
export const AIR_FARE_GST_RULES: readonly TvRule<{ economy: number; other: number }>[] = [
  { from: '2017-07-01', value: { economy: 5, other: 12 }, source: 'N 11/2017-CT(R) heading 9964: air passenger transport, economy 5 %, other 12 % (as reported; TV12)', verified: false },
  { from: '2025-09-22', value: { economy: 5, other: 18 }, source: 'N 15/2025-CT(R): other than economy 18 % from 22 Sep 2025 (as reported; cut-over by booking date to confirm; TV12)', verified: false },
];

/** Our cancellation fee takes the rate of the principal supply (Circular 178/10/2022-GST; TV15), by regime. */
export const CANCEL_FEE_RATE_RULES: readonly TvRule<Readonly<Record<TvRegime, number>>>[] = [
  { from: '2017-07-01', value: { to5: 5, to18: 18, agent: 18, exempt_outside: 0 }, source: 'Circular 178/10/2022-GST (3 Aug 2022): cancellation charges are consideration for the principal supply, at its rate (as reported; TV15)', verified: false },
];

/* ── R15-D: TCS on overseas tour packages, events (TOUR_PACKAGE_TCS_RULES, TCS_NO_PAN_RULES, EVENT_RULES) ─────── */
