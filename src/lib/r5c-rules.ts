/**
 * R5-C statutory values (fees, non-profits, property), date-keyed like `tax-rules.ts` (`Versioned` / `ruleAt`):
 * append a new dated entry, never edit an old one. Kept in their own file (not `tax-rules.ts`, which is in the
 * first-paint bundle) and imported only by the lazy R5-C modules. Every value is a working-paper reading of the
 * law as understood — `source` ends in "verify": confirm with your CA (PRD round 5 §7 Q8–Q12).
 */
import { ruleAt, type Versioned } from './tax-rules';

export { ruleAt };

/* ── C2 Rule 42 / 43 ─────────────────────────────────────────── */

export interface CommonCreditRule {
  /** D2: share of common credit deemed for non-business use when such use exists (Rule 42(1)(i)). */
  nonBusinessPct: number;
  /** Rule 43: useful life of capital goods in months (Tc ÷ 60 per month). */
  capitalMonths: number;
  /** Annual true-up: due with the return for this month after the FY ends (Rule 42(2)). */
  trueUpByMonth: number;
  /** Interest on a short reversal (Sec 50), % a year. */
  interestPct: number;
}
export const COMMON_CREDIT_TRUE_UP_RULES: readonly Versioned<CommonCreditRule>[] = [
  { from: '2017-07-01', value: { nonBusinessPct: 5, capitalMonths: 60, trueUpByMonth: 9, interestPct: 18 }, source: 'CGST Rules 42 / 43; Sec 50: verify' },
  { from: '2022-07-05', value: { nonBusinessPct: 5, capitalMonths: 60, trueUpByMonth: 9, interestPct: 18 }, source: 'Notification 14/2022-CT: verify' },
];

/* ── C5 rent ─────────────────────────────────────────────────── */

export interface LeaseGstRule {
  /** GST on renting of commercial property (SAC 997212), %. */
  commercialRate: number;
  sac: string;
  /** Dwelling let to a registered person: RCM on the tenant (12/2017-CT(R) entry 12 amended). */
  dwellingRcm: boolean;
  /** Commercial property of an UNREGISTERED landlord to a registered tenant: RCM (entry 5AB). */
  unregCommercialRcm: boolean;
  /** A composition-registered tenant is outside entry 5AB. */
  compositionTenantExcluded: boolean;
}
export const LEASE_GST_RULES: readonly Versioned<LeaseGstRule>[] = [
  { from: '2017-07-01', value: { commercialRate: 18, sac: '997212', dwellingRcm: false, unregCommercialRcm: false, compositionTenantExcluded: false }, source: '11/2017-CT(R) entry 16: verify' },
  { from: '2022-07-18', value: { commercialRate: 18, sac: '997212', dwellingRcm: true, unregCommercialRcm: false, compositionTenantExcluded: false }, source: 'Notifications 04/2022 & 05/2022-CT(R): verify' },
  { from: '2024-10-10', value: { commercialRate: 18, sac: '997212', dwellingRcm: true, unregCommercialRcm: true, compositionTenantExcluded: false }, source: 'Notification 09/2024-CT(R), entry 5AB: verify' },
  { from: '2025-01-16', value: { commercialRate: 18, sac: '997212', dwellingRcm: true, unregCommercialRcm: true, compositionTenantExcluded: true }, source: 'Notification 07/2025-CT(R): verify' },
];

/* ── C3 donations ────────────────────────────────────────────── */

/** Cash donations above this are not deductible under 80G (₹10,000 before FY 2017-18). */
export const DONATION_CASH_LIMIT_RULES: readonly Versioned<number>[] = [
  { from: '2012-04-01', value: 10000, source: 'Sec 80G(5D): verify' },
  { from: '2017-04-01', value: 2000, source: 'Finance Act 2017, Sec 80G(5D): verify' },
];

/** Sec 115BBC: anonymous donations above the higher of `pct` % of total donations and `floor` are taxed at 30%. */
export const ANON_DONATION_RULES: readonly Versioned<{ pct: number; floor: number }>[] = [
  { from: '2007-04-01', value: { pct: 5, floor: 100000 }, source: 'Sec 115BBC(1): verify' },
];

/** Form 10BD (Form 113 from FY 2026-27) due by this month-day after the FY; 10BE certificates by the same day. */
export const FORM_10BD_DUE_RULES: readonly Versioned<{ monthDay: string; beBy: string; lateFeePerDay: number }>[] = [
  { from: '2021-04-01', value: { monthDay: '05-31', beBy: '05-31', lateFeePerDay: 200 }, source: 'Rule 18AB; Sec 234G late fee: verify' },
];

export interface Form10bdTemplate {
  columns: string[];
  idCodes: Record<string, string>;
  sections: Record<string, string>;
  types: Record<string, string>;
  modes: Record<string, string>;
}
/** Column order and code words of the portal's 10BD bulk-upload CSV (the portal template may change). */
export const FORM_10BD_COLUMNS: readonly Versioned<Form10bdTemplate>[] = [
  {
    from: '2021-04-01',
    source: 'Income-tax portal Form 10BD CSV template: verify',
    value: {
      columns: ['Sr. No.', 'Pre Acknowledgement Number', 'ID Code', 'Unique Identification Number', 'Section Code', 'Unique Registration Number (URN)', 'Date of Issuance of Unique Registration Number', 'Name of donor', 'Address of donor', 'Donation Type', 'Mode of receipt', 'Amount of donation (Indian rupees)'],
      idCodes: { pan: 'Permanent Account Number', aadhaar: 'Aadhaar Number', tan: 'Tax Deduction and Collection Account Number', passport: 'Passport number', voter_id: "Elector's photo identity number", driving_licence: 'Driving License number', ration_card: 'Ration card number', foreign_tax_id: 'Tax Identification Number of the country where the person resides' },
      sections: { '80G': 'Section 80G', '35(1)(ii)': 'Section 35(1)(ii)', '35(1)(iia)': 'Section 35(1)(iia)', '35(1)(iii)': 'Section 35(1)(iii)' },
      types: { corpus: 'Corpus', specific_grant: 'Specific grant', others: 'Others' },
      modes: { cash: 'Cash', kind: 'Kind', electronic: 'Electronic modes including account payee cheque/draft', others: 'Others' },
    },
  },
];

/* ── C4 funds / FCRA / Sec 11 ────────────────────────────────── */

/** Sec 11(1)(a): share of income to apply in India in the year (estimate). */
export const NPO_APPLICATION_RULES: readonly Versioned<{ pct: number }>[] = [
  { from: '1961-04-01', value: { pct: 85 }, source: 'Sec 11(1)(a): verify' },
];

/** FCRA administrative expenses cap, % of foreign contribution received in the FY. */
export const FCRA_ADMIN_CAP_RULES: readonly Versioned<number>[] = [
  { from: '2011-05-01', value: 50, source: 'FCRA 2010 Sec 8(1)(b): verify' },
  { from: '2020-09-29', value: 20, source: 'FCRA: verify' },
];

/** FC-4 annual return due by this month-day after the FY. */
export const FC4_DUE_RULES: readonly Versioned<string>[] = [
  { from: '2015-04-01', value: '12-31', source: 'FCRA Rule 17: verify' },
];

/** First day of the FY that starts in `fy`. */
export const fyFrom = (fy: number) => `${fy}-04-01`;
/** `MM-DD` after the FY that starts in `fy`. */
export const afterFy = (fy: number, monthDay: string) => `${fy + 1}-${monthDay}`;
