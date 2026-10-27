/**
 * Service-business statutory values and practice defaults (Round 10), keyed by the date they take effect — the same
 * `Versioned` / `ruleAt` shape as `tax-rules.ts`: add a new dated row, never edit an old one. Imported only by lazy
 * screens and engines — never by `tax-rules.ts`, `shop-mode.ts` or the shell (`tests/sv-rules.test.ts` checks the
 * import graph).
 *
 * One section per package (§6 of docs/prd/round-10.md): SV-A committed the headers and the types; each package fills
 * its own section. Every row carries a `source` and `verified` (false where the text was not read or sources conflict).
 * Working papers — verify with your CA (docs/CA_REVIEW.md §10, SV1–SV24).
 */
import { ruleAt, type Versioned } from './tax-rules';
import type { SvClass, SvExempt } from '../types/services-r10';

/** A dated service rule row: `source` (inherited) plus whether the value was confirmed from an official text. */
export type SvRule<T> = Versioned<T> & { verified: boolean };

/* ── SV-A: service tax classes, the composition note ─────────────────────────────────────────────────────────── */

/** What a class suggests: GST rate (%), SAC, the Table 8 column of a 0% line, and "without ITC" (5% classes). */
export interface ServiceClassRate {
  rate: number;
  sac: string;
  exempt?: SvExempt;
  noItc?: boolean;
}

type ClassTable = Readonly<Record<SvClass, ServiceClassRate>>;

const BASE_2017: ClassTable = {
  health_exempt: { rate: 0, sac: '9993', exempt: 'EXEMPT' },
  health_cosmetic: { rate: 18, sac: '9993' },
  hospital_room_low: { rate: 0, sac: '9993', exempt: 'EXEMPT' },
  hospital_room_high: { rate: 0, sac: '9993', exempt: 'EXEMPT' },
  beauty_9997: { rate: 18, sac: '999721' },
  fitness_9997: { rate: 18, sac: '999723' },
  education_exempt: { rate: 0, sac: '9992', exempt: 'EXEMPT' },
  coaching: { rate: 18, sac: '999293' },
  repair_9987: { rate: 18, sac: '9987' },
  charitable_yoga: { rate: 0, sac: '999723', exempt: 'EXEMPT' },
};
const ROOMS_2022: ClassTable = { ...BASE_2017, hospital_room_high: { rate: 5, sac: '9993', noItc: true } };

/** Class → rate / SAC by document date (SV1, SV2, SV3, SV11, SV17). */
export const SERVICE_CLASS_RULES: readonly SvRule<ClassTable>[] = [
  { from: '2017-07-01', value: BASE_2017, source: 'N 12/2017-CT(R) entries 74 (health care), 66 (education), 1 (12AB yoga); N 11/2017-CT(R) heading 9997 / 9992 / 9987 at 18% — as recalled', verified: false },
  { from: '2022-07-18', value: ROOMS_2022, source: 'N 03/2022 + 04/2022-CT(R): hospital room above ₹5,000 a day (non-ICU) 5% without ITC (SV3, secondary)', verified: false },
  {
    from: '2025-09-22',
    value: { ...ROOMS_2022, beauty_9997: { rate: 5, sac: '999721', noItc: true }, fitness_9997: { rate: 5, sac: '999723', noItc: true } },
    source: 'N 15/2025-CT(R) heading 9997 item (i): salons, beauty, health clubs, fitness, yoga 5% without ITC (SV11, secondary)',
    verified: false,
  },
];

export const serviceClassAt = (cls: SvClass, date?: string): ServiceClassRate => ruleAt(SERVICE_CLASS_RULES, date)[cls];

/** Classes that are "5% without ITC" on some date (the ITC caution and the Rule 42 exempt-like turnover). */
export const NO_ITC_CLASSES: readonly SvClass[] = ['hospital_room_high', 'beauty_9997', 'fitness_9997'];

/** SV13: composition 6% vs the regular 5%-no-ITC rate (null = no notice before the 5% rate began). */
export const COMPOSITION_SERVICE_NOTE_RULES: readonly SvRule<{ composition: number; regular: number } | null>[] = [
  { from: '2019-04-01', value: null, source: 'N 2/2019-CT(R): 6% composition for services (Sec 10(2A)); regular rate 18% — no notice', verified: false },
  { from: '2025-09-22', value: { composition: 6, regular: 5 }, source: 'N 15/2025-CT(R): beauty / fitness 5% without ITC; composition stays 6% (SV13)', verified: false },
];

/* ── SV-B: clinics, dentists and labs (filled by SV-B) ───────────────────────────────────────────────────────── */
// HOSPITAL_ROOM_RULES (room-charge threshold, ICU kinds), HEALTH_CLASS_RULES, REFERRAL_CAUTION_RULES — SV3, SV4, SV8.
export interface HospitalRoomRule { threshold: number; rate: number; sac: string; exemptKinds: readonly string[] }

/* ── SV-C: memberships, classes and coaching (filled by SV-C) ────────────────────────────────────────────────── */
// COACHING_REFUND_RULES (pro rata by days, refund due in N days) — SV18.
export interface CoachingRefundRule { basis: 'days' | 'months'; dueDays: number }

/* ── SV-D: repair and service centres (filled by SV-D) ───────────────────────────────────────────────────────── */
// MOTOR_DEPRECIATION_DEFAULTS ("insurer practice, not statute"), REPAIR_SAC_RULES — SV20, SV22.
export interface RepairSacRule { vehicle: string; appliance: string; computer: string; telecom: string; other: string }

/** SV20: repair SAC per asset kind (group 9987; labour 18% when priced separately from parts). */
export const REPAIR_SAC_RULES: readonly SvRule<RepairSacRule>[] = [
  { from: '2017-07-01', value: { vehicle: '998714', appliance: '998715', computer: '998713', telecom: '998716', other: '998729' }, source: 'SAC 9987: 998714 transport machinery, 998715 household appliances, 998713 computers, 998716 telecom, 998729 other goods — as recalled; AAR WB Alok Bhanuka 2018 / UP Premier Car Sales 2019 on separate supplies (SV20, secondary)', verified: false },
];

/** Depreciation % the owner pays on an approved part, by category; metal by vehicle age ([months up to, %]). */
export interface MotorDepreciation {
  pct: Readonly<Record<'rubber' | 'plastic' | 'fibre' | 'glass' | 'paint' | 'other', number>>;
  metal: readonly (readonly [number, number])[];
}

/** SV22: insurer practice, NOT statute (the motor tariff schedule carried in private-car policies) — the user edits it. */
export const MOTOR_DEPRECIATION_DEFAULTS: readonly SvRule<MotorDepreciation>[] = [
  {
    from: '2002-07-01',
    value: { pct: { rubber: 50, plastic: 50, fibre: 30, glass: 0, paint: 25, other: 0 }, metal: [[6, 0], [12, 5], [24, 10], [36, 15], [48, 25], [60, 35], [120, 40], [Infinity, 50]] },
    source: 'Insurer practice, not statute: India Motor Tariff GR 9 schedule as carried in private-car policies (rubber / nylon / plastic 50%, fibre glass 30%, glass nil, metal by vehicle age) — verify with the insurer (SV22)',
    verified: false,
  },
];
