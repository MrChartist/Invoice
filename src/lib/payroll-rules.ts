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
