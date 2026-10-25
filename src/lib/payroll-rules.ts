/**
 * Payroll statutory values (Phase 7) — EPF / EPS / EDLI, ESI, Professional Tax and TDS on salary
 * (section 192), each keyed by the date it takes effect, in the same `Versioned` shape as
 * `tax-rules.ts` (and read with its `ruleAt`). Add new values as new versions; never overwrite old
 * ones, so a past month recomputes with the values that applied then.
 *
 * Kept out of `tax-rules.ts` (like `gst-penalties.ts`) because tax-rules is in the first-paint
 * bundle and payroll is a lazy route: these tables load only with the payroll screens.
 *
 * WORKING-PAPER DEFAULTS — verify every value with your CA / the current notification before
 * relying on it. Dates are bare `YYYY-MM-DD` strings compared lexically (AGENTS.md rule 8).
 */

import { ruleAt, type Versioned } from './tax-rules';

/* ── EPF / EPS / EDLI (EPF & MP Act 1952) ───────────────────────────────── */

export interface PfRule {
  /** Employee contribution, % of PF wages. */
  employee_pct: number;
  /** Employer total, % of PF wages (EPS part + EPF part). */
  employer_pct: number;
  /** Pension (EPS) share of the employer contribution, % of wages capped at the ceiling. */
  eps_pct: number;
  /** Statutory wage ceiling per month. */
  wage_ceiling: number;
  /** EDLI premium, % of wages capped at the ceiling. */
  edli_pct: number;
  /** EPF administration charges, % of EPF wages, with a monthly minimum per establishment. */
  admin_pct: number;
  admin_min: number;
}

export const PF_RULES: readonly Versioned<PfRule>[] = [
  { from: '2001-01-01', value: { employee_pct: 12, employer_pct: 12, eps_pct: 8.33, wage_ceiling: 6500, edli_pct: 0.5, admin_pct: 1.1, admin_min: 500 }, source: 'EPF Scheme 1952 (₹6,500 ceiling)' },
  { from: '2014-09-01', value: { employee_pct: 12, employer_pct: 12, eps_pct: 8.33, wage_ceiling: 15000, edli_pct: 0.5, admin_pct: 1.1, admin_min: 500 }, source: 'GSR 609(E) 22 Aug 2014: ceiling ₹15,000' },
  { from: '2015-01-01', value: { employee_pct: 12, employer_pct: 12, eps_pct: 8.33, wage_ceiling: 15000, edli_pct: 0.5, admin_pct: 0.85, admin_min: 500 }, source: 'Admin charges 0.85%' },
  { from: '2017-04-01', value: { employee_pct: 12, employer_pct: 12, eps_pct: 8.33, wage_ceiling: 15000, edli_pct: 0.5, admin_pct: 0.65, admin_min: 500 }, source: 'Admin charges 0.65%; EDLI admin charges nil' },
  { from: '2018-06-01', value: { employee_pct: 12, employer_pct: 12, eps_pct: 8.33, wage_ceiling: 15000, edli_pct: 0.5, admin_pct: 0.5, admin_min: 500 }, source: 'Admin charges 0.5%, minimum ₹500 per month' },
];

export function pfRule(date?: string): PfRule {
  return ruleAt(PF_RULES, date);
}

/* ── ESI (ESI Act 1948) ─────────────────────────────────────────────────── */

export interface EsiRule {
  employee_pct: number;
  employer_pct: number;
  /** Gross monthly wages up to which an employee is covered (fixed for the contribution period). */
  wage_ceiling: number;
}

export const ESI_RULES: readonly Versioned<EsiRule>[] = [
  { from: '2010-05-01', value: { employee_pct: 1.75, employer_pct: 4.75, wage_ceiling: 15000 }, source: 'Ceiling ₹15,000' },
  { from: '2017-01-01', value: { employee_pct: 1.75, employer_pct: 4.75, wage_ceiling: 21000 }, source: 'Ceiling ₹21,000 from 1 Jan 2017' },
  { from: '2019-07-01', value: { employee_pct: 0.75, employer_pct: 3.25, wage_ceiling: 21000 }, source: 'GSR 423(E) 13 Jun 2019: 0.75% / 3.25%' },
];

export function esiRule(date?: string): EsiRule {
  return ruleAt(ESI_RULES, date);
}

/** ESI contribution periods: April–September and October–March. First month of the period holding `month` (YYYY-MM). */
export function esiPeriodStart(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (m >= 4 && m <= 9) return `${y}-04`;
  return m >= 10 ? `${y}-10` : `${y - 1}-10`;
}

/* ── Professional Tax (state laws; Article 276 cap ₹2,500 a year) ──────── */

export interface PtSlab {
  /** Monthly (or half-yearly) gross up to this amount, inclusive; null = no limit. */
  up_to: number | null;
  amount: number;
  /** Amount in February instead (Maharashtra / Karnataka: ₹300 to reach ₹2,500 a year). */
  feb?: number;
}

export interface PtStateRule {
  /** Slabs for men / everyone. */
  slabs: PtSlab[];
  /** Separate slabs for women, where the state has them (Maharashtra). */
  women?: PtSlab[];
  /** Half-yearly levy (Tamil Nadu): slabs apply to half-year salary = monthly gross × 6, deducted in these months. */
  half_yearly?: { months: number[] };
}

/** GST state code → state name for the PT states covered. */
export const PT_STATES: Readonly<Record<string, string>> = {
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '19': 'West Bengal',
  '33': 'Tamil Nadu',
  '24': 'Gujarat',
  '37': 'Andhra Pradesh',
  '36': 'Telangana',
};

const AP_TS: PtStateRule = {
  slabs: [
    { up_to: 15000, amount: 0 },
    { up_to: 20000, amount: 150 },
    { up_to: null, amount: 200 },
  ],
};

export const PT_RULES: Readonly<Record<string, readonly Versioned<PtStateRule>[]>> = {
  '27': [
    {
      from: '2015-04-01',
      value: {
        slabs: [{ up_to: 7500, amount: 0 }, { up_to: 10000, amount: 175 }, { up_to: null, amount: 200, feb: 300 }],
        women: [{ up_to: 10000, amount: 0 }, { up_to: null, amount: 200, feb: 300 }],
      },
      source: 'Maharashtra State Tax on Professions Act 1975, Schedule entry 1',
    },
    {
      from: '2023-07-01',
      value: {
        slabs: [{ up_to: 7500, amount: 0 }, { up_to: 10000, amount: 175 }, { up_to: null, amount: 200, feb: 300 }],
        women: [{ up_to: 25000, amount: 0 }, { up_to: null, amount: 200, feb: 300 }],
      },
      source: 'Maharashtra amendment 2023: women up to ₹25,000 exempt',
    },
  ],
  '29': [
    { from: '2018-04-01', value: { slabs: [{ up_to: 15000, amount: 0 }, { up_to: null, amount: 200 }] }, source: 'Karnataka Tax on Professions Act 1976' },
    { from: '2023-04-01', value: { slabs: [{ up_to: 24999, amount: 0 }, { up_to: null, amount: 200 }] }, source: 'Karnataka Finance Act 2023: ₹25,000 and above' },
    { from: '2025-04-01', value: { slabs: [{ up_to: 24999, amount: 0 }, { up_to: null, amount: 200, feb: 300 }] }, source: 'Karnataka amendment 2025: ₹300 in February' },
  ],
  '19': [
    {
      from: '2014-04-01',
      value: {
        slabs: [
          { up_to: 10000, amount: 0 },
          { up_to: 15000, amount: 110 },
          { up_to: 25000, amount: 130 },
          { up_to: 40000, amount: 150 },
          { up_to: null, amount: 200 },
        ],
      },
      source: 'West Bengal State Tax on Professions Act 1979',
    },
  ],
  '33': [
    {
      from: '2018-04-01',
      value: {
        slabs: [
          { up_to: 21000, amount: 0 },
          { up_to: 30000, amount: 135 },
          { up_to: 45000, amount: 315 },
          { up_to: 60000, amount: 690 },
          { up_to: 75000, amount: 1025 },
          { up_to: null, amount: 1250 },
        ],
        half_yearly: { months: [4, 10] },
      },
      source: 'Tamil Nadu Urban Local Bodies Act (half-yearly)',
    },
    {
      from: '2024-10-01',
      value: {
        slabs: [
          { up_to: 21000, amount: 0 },
          { up_to: 30000, amount: 180 },
          { up_to: 45000, amount: 425 },
          { up_to: 60000, amount: 930 },
          { up_to: 75000, amount: 1025 },
          { up_to: null, amount: 1250 },
        ],
        half_yearly: { months: [4, 10] },
      },
      source: 'Tamil Nadu revision 2024 (half-yearly)',
    },
  ],
  '24': [
    {
      from: '2008-04-01',
      value: { slabs: [{ up_to: 5999, amount: 0 }, { up_to: 8999, amount: 80 }, { up_to: 11999, amount: 150 }, { up_to: null, amount: 200 }] },
      source: 'Gujarat Panchayats, Municipalities … Tax on Professions Act 1976',
    },
    { from: '2022-04-01', value: { slabs: [{ up_to: 11999, amount: 0 }, { up_to: null, amount: 200 }] }, source: 'Gujarat: up to ₹12,000 exempt' },
  ],
  '37': [{ from: '2013-04-01', value: AP_TS, source: 'Andhra Pradesh Tax on Professions Act 1987' }],
  '36': [{ from: '2014-06-02', value: AP_TS, source: 'Telangana Tax on Professions Act 1987' }],
};

export const PT_ANNUAL_CAP = 2500;

export function ptRule(state: string | undefined, date?: string): PtStateRule | null {
  const versions = state ? PT_RULES[state] : undefined;
  return versions?.length ? ruleAt(versions, date) : null;
}

/* ── TDS on salary, section 192 (rates in force for the FY) ─────────────── */

export interface TaxSlab {
  /** Income up to this amount (inclusive); null = above. */
  up_to: number | null;
  rate: number;
}

export interface RegimeRule {
  slabs: TaxSlab[];
  standard_deduction: number;
  /** Section 87A: rebate when total income ≤ limit, up to `rebate_max`. */
  rebate_limit: number;
  rebate_max: number;
  /** Marginal relief just above the 87A limit (new regime from FY 2023-24). */
  rebate_marginal: boolean;
  /** Surcharge by income above (with marginal relief at each threshold). */
  surcharge: { above: number; rate: number }[];
  cess_pct: number;
  /** Professional tax deductible u/s 16(iii) and Chapter VI-A deductions allowed (old regime only). */
  allows_deductions: boolean;
}

const OLD_REGIME: RegimeRule = {
  slabs: [{ up_to: 250000, rate: 0 }, { up_to: 500000, rate: 5 }, { up_to: 1000000, rate: 20 }, { up_to: null, rate: 30 }],
  standard_deduction: 50000,
  rebate_limit: 500000,
  rebate_max: 12500,
  rebate_marginal: false,
  surcharge: [{ above: 5000000, rate: 10 }, { above: 10000000, rate: 15 }, { above: 20000000, rate: 25 }, { above: 50000000, rate: 37 }],
  cess_pct: 4,
  allows_deductions: true,
};

const NEW_SURCHARGE = [{ above: 5000000, rate: 10 }, { above: 10000000, rate: 15 }, { above: 20000000, rate: 25 }];

export const TDS_SALARY_RULES: readonly Versioned<{ new: RegimeRule; old: RegimeRule }>[] = [
  {
    from: '2023-04-01',
    value: {
      old: OLD_REGIME,
      new: {
        slabs: [
          { up_to: 300000, rate: 0 }, { up_to: 600000, rate: 5 }, { up_to: 900000, rate: 10 },
          { up_to: 1200000, rate: 15 }, { up_to: 1500000, rate: 20 }, { up_to: null, rate: 30 },
        ],
        standard_deduction: 50000,
        rebate_limit: 700000,
        rebate_max: 25000,
        rebate_marginal: true,
        surcharge: NEW_SURCHARGE,
        cess_pct: 4,
        allows_deductions: false,
      },
    },
    source: 'Finance Act 2023 (s. 115BAC default regime)',
  },
  {
    from: '2024-04-01',
    value: {
      old: OLD_REGIME,
      new: {
        slabs: [
          { up_to: 300000, rate: 0 }, { up_to: 700000, rate: 5 }, { up_to: 1000000, rate: 10 },
          { up_to: 1200000, rate: 15 }, { up_to: 1500000, rate: 20 }, { up_to: null, rate: 30 },
        ],
        standard_deduction: 75000,
        rebate_limit: 700000,
        rebate_max: 25000,
        rebate_marginal: true,
        surcharge: NEW_SURCHARGE,
        cess_pct: 4,
        allows_deductions: false,
      },
    },
    source: 'Finance (No. 2) Act 2024',
  },
  {
    from: '2025-04-01',
    value: {
      old: OLD_REGIME,
      new: {
        slabs: [
          { up_to: 400000, rate: 0 }, { up_to: 800000, rate: 5 }, { up_to: 1200000, rate: 10 }, { up_to: 1600000, rate: 15 },
          { up_to: 2000000, rate: 20 }, { up_to: 2400000, rate: 25 }, { up_to: null, rate: 30 },
        ],
        standard_deduction: 75000,
        rebate_limit: 1200000,
        rebate_max: 60000,
        rebate_marginal: true,
        surcharge: NEW_SURCHARGE,
        cess_pct: 4,
        allows_deductions: false,
      },
    },
    source: 'Finance Act 2025 (FY 2025-26)',
  },
];

/** Rates for the FY that starts on `fyStart` (`YYYY-04-01`). */
export function tdsSalaryRule(regime: 'new' | 'old', fyStart: string): RegimeRule {
  return ruleAt(TDS_SALARY_RULES, fyStart)[regime];
}

/** Section 80C cap applied to the employee's own PF (old regime). */
export const SEC_80C_CAP = 150000;

/* ════════════════════════════════════════════════════════════════
   7P — payroll depth (arrears, loans, leave, gratuity, bonus, F&F, perquisites).
   Appended: every table below is date-keyed; add versions, never overwrite.
   Values marked UNVERIFIED are working assumptions for your CA to confirm.
   ════════════════════════════════════════════════════════════════ */

/* ── Senior / super-senior citizen slabs (old regime only) ──────────── */

/**
 * Old-regime slabs by age (resident individuals): 60–79 at any time in the FY = senior, 80+ = super
 * senior. The new regime (s. 115BAC) has one slab table for every age. Rebate u/s 87A, surcharge
 * and cess as for the ordinary old regime.
 */
export const TDS_OLD_REGIME_AGE_RULES: readonly Versioned<{ senior: TaxSlab[]; super_senior: TaxSlab[] }>[] = [
  {
    from: '2012-04-01',
    value: {
      senior: [{ up_to: 300000, rate: 0 }, { up_to: 500000, rate: 5 }, { up_to: 1000000, rate: 20 }, { up_to: null, rate: 30 }],
      super_senior: [{ up_to: 500000, rate: 0 }, { up_to: 1000000, rate: 20 }, { up_to: null, rate: 30 }],
    },
    source: 'First Schedule, Finance Acts (old regime): senior ₹3 lakh, super senior ₹5 lakh basic exemption',
  },
];

export type AgeBand = 'normal' | 'senior' | 'super_senior';

/**
 * Age band for the FY starting `fyStart` (`YYYY-04-01`) from the date of birth. A person attains an
 * age on the day before the birthday, so someone born on 1 April turns 60 on 31 March. UNVERIFIED
 * convention — confirm with your CA.
 */
export function ageBand(dob: string | undefined, fyStart: string): AgeBand {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return 'normal';
  const endYear = Number(fyStart.slice(0, 4)) + 1;
  if (dob <= `${endYear - 80}-04-01`) return 'super_senior';
  if (dob <= `${endYear - 60}-04-01`) return 'senior';
  return 'normal';
}

/** Regime rule for an employee: old-regime seniors get their own slabs (rebate, surcharge, cess as the old regime). */
export function tdsSalaryRuleFor(regime: 'new' | 'old', fyStart: string, dob?: string): RegimeRule {
  const band = regime === 'old' ? ageBand(dob, fyStart) : 'normal';
  const base = tdsSalaryRule(regime, fyStart);
  if (band === 'normal') return base;
  return { ...base, slabs: ruleAt(TDS_OLD_REGIME_AGE_RULES, fyStart)[band] };
}

/* ── 80CCD(2) employer NPS, 206AA (no PAN) ──────────────────────────── */

export interface Ccd2Rule {
  /** Deduction cap, % of salary (Basic + DA), by regime. */
  new_pct: number;
  old_pct: number;
}

export const CCD2_RULES: readonly Versioned<Ccd2Rule>[] = [
  { from: '2020-04-01', value: { new_pct: 10, old_pct: 10 }, source: 's. 80CCD(2): 10% of salary (non-government employers)' },
  { from: '2024-04-01', value: { new_pct: 14, old_pct: 10 }, source: 'Finance (No. 2) Act 2024: 14% in the new regime' },
];

export function ccd2Pct(regime: 'new' | 'old', fyStart: string): number {
  const r = ruleAt(CCD2_RULES, fyStart);
  return regime === 'old' ? r.old_pct : r.new_pct;
}

/**
 * s. 206AA for salary: without a PAN, tax is deducted at the average rate or 20%, whichever is
 * higher (only when the income is taxable). Cess is not added on top of the 20% — UNVERIFIED,
 * confirm with your CA.
 */
export const NO_PAN_SALARY_RULES: readonly Versioned<{ rate: number }>[] = [
  { from: '2010-04-01', value: { rate: 20 }, source: 's. 206AA (Finance (No. 2) Act 2009)' },
];

export function noPanRate(fyStart: string): number {
  return ruleAt(NO_PAN_SALARY_RULES, fyStart).rate;
}

/* ── Payment of Gratuity Act 1972 / s. 10(10) ───────────────────────── */

export interface GratuityRule {
  /** 15 days' wages for every completed year (or part above six months). */
  days: number;
  /** Month of 26 working days. */
  divisor: number;
  /** Continuous service needed (years), except on death or disablement. */
  min_years: number;
  /** Ceiling on gratuity under the Act (and the s. 10(10)(ii) exemption cap for private employees). */
  ceiling: number;
}

export const GRATUITY_RULES: readonly Versioned<GratuityRule>[] = [
  { from: '2010-05-24', value: { days: 15, divisor: 26, min_years: 5, ceiling: 1000000 }, source: 'Payment of Gratuity (Amendment) Act 2010: ₹10 lakh' },
  { from: '2018-03-29', value: { days: 15, divisor: 26, min_years: 5, ceiling: 2000000 }, source: 'Payment of Gratuity (Amendment) Act 2018 / S.O. 1420(E): ₹20 lakh' },
];

export function gratuityRule(date: string): GratuityRule {
  return ruleAt(GRATUITY_RULES, date);
}

/* ── Leave encashment on leaving, s. 10(10AA)(ii) ───────────────────── */

export const LEAVE_ENCASH_RULES: readonly Versioned<{ exempt_cap: number }>[] = [
  { from: '1998-04-01', value: { exempt_cap: 300000 }, source: 's. 10(10AA)(ii) notification: ₹3 lakh' },
  { from: '2023-04-01', value: { exempt_cap: 2500000 }, source: 'Notification 31/2023: ₹25 lakh' },
];

export function leaveEncashCap(date: string): number {
  return ruleAt(LEAVE_ENCASH_RULES, date).exempt_cap;
}

/* ── Payment of Bonus Act 1965 ───────────────────────────────────────── */

export interface BonusRule {
  min_pct: number;
  max_pct: number;
  /** Employees drawing salary (Basic + DA) up to this per month are eligible. */
  eligibility_ceiling: number;
  /** Bonus is calculated on salary up to this per month (or the minimum wage, if higher). */
  calc_ceiling: number;
  /** Minimum working days in the accounting year. */
  min_days: number;
  /** Minimum bonus amount (₹). */
  min_amount: number;
}

export const BONUS_RULES: readonly Versioned<BonusRule>[] = [
  { from: '2007-04-01', value: { min_pct: 8.33, max_pct: 20, eligibility_ceiling: 10000, calc_ceiling: 3500, min_days: 30, min_amount: 100 }, source: 'Payment of Bonus (Amendment) Act 2007' },
  { from: '2014-04-01', value: { min_pct: 8.33, max_pct: 20, eligibility_ceiling: 21000, calc_ceiling: 7000, min_days: 30, min_amount: 100 }, source: 'Payment of Bonus (Amendment) Act 2015 (retrospective from 1 Apr 2014)' },
];

export function bonusRule(date: string): BonusRule {
  return ruleAt(BONUS_RULES, date);
}

/* ── Loans to employees: perquisite u/s 17(2), Rule 3(7)(i) ─────────── */

export interface LoanPerqRule {
  /** Loans whose aggregate outstanding stays within this are not a perquisite. */
  exempt_up_to: number;
  /**
   * SBI lending rate as on 1 April of the FY for a comparable loan, % p.a. UNVERIFIED placeholder —
   * look up the SBI rate for the loan's purpose and type it on the loan (it overrides this).
   */
  sbi_rate: number;
}

export const LOAN_PERQ_RULES: readonly Versioned<LoanPerqRule>[] = [
  // A later change of the small-loan limit must be added as a new version once confirmed (UNVERIFIED).
  { from: '2001-04-01', value: { exempt_up_to: 20000, sbi_rate: 12 }, source: 'Rule 3(7)(i): ₹20,000 small-loan limit; SBI rate UNVERIFIED placeholder' },
];

export function loanPerqRule(fyStart: string): LoanPerqRule {
  return ruleAt(LOAN_PERQ_RULES, fyStart);
}

/* ── PF late payment: interest u/s 7Q, damages u/s 14B ──────────────── */

export interface PfLateRule {
  /** Day of the next month the PF challan is due. */
  due_day: number;
  /** Simple interest, % p.a. (s. 7Q). */
  interest_pct: number;
  /** Damages (para 32A), % p.a. by months of delay (upper bound, inclusive; null = above). */
  damages: { up_to_months: number | null; pct: number }[];
}

export const PF_LATE_RULES: readonly Versioned<PfLateRule>[] = [
  {
    from: '2008-09-26',
    value: { due_day: 15, interest_pct: 12, damages: [{ up_to_months: 2, pct: 5 }, { up_to_months: 4, pct: 10 }, { up_to_months: 6, pct: 15 }, { up_to_months: null, pct: 25 }] },
    source: 'EPF Scheme para 32A — estimate only; UNVERIFIED, EPFO levies damages by order',
  },
];

export function pfLateRule(date: string): PfLateRule {
  return ruleAt(PF_LATE_RULES, date);
}

/** Age at which EPS membership ends (EPS 1995, para 6): no EPS share after the month of the 58th birthday. */
export const EPS_EXIT_AGE = 58;
