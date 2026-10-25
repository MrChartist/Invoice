/**
 * Payroll statutory engines (Phase 7): EPF/EPS/EDLI, ESI, Professional Tax and the income-tax
 * computation behind TDS on salary (s. 192). Pure — rates come from `payroll-rules.ts`.
 * Working papers — verify with your CA.
 */

import { round2 } from '../invoice-calc';
import {
  PT_ANNUAL_CAP,
  esiRule,
  pfRule,
  ptRule,
  type PtSlab,
  type RegimeRule,
} from '../payroll-rules';

/** Nearest rupee (EPFO rounds each contribution to the nearest rupee). */
export const rupee = (n: number): number => Math.round(round2(n));
/** Next higher rupee (ESI contributions are rounded up). */
export const rupeeUp = (n: number): number => Math.ceil(round2(n) - 1e-9);

/* ── EPF / EPS / EDLI ─────────────────────────────────────────── */

export interface PfResult {
  /** Wages the employee (and employer total) contribution is worked on. */
  epf_wages: number;
  eps_wages: number;
  edli_wages: number;
  /** Employee share (12%). */
  ee: number;
  /** Employer pension share (8.33% of wages up to the ceiling). */
  eps: number;
  /** Employer EPF share = employer total − EPS (3.67% at the ceiling). */
  epf_er: number;
  edli: number;
  admin: number;
}

export function pfContribution(
  pfWages: number,
  date: string,
  opts: { onActual?: boolean; epsExcluded?: boolean } = {},
): PfResult {
  const r = pfRule(date);
  const wages = Math.max(0, round2(pfWages));
  const capped = Math.min(wages, r.wage_ceiling);
  const epf_wages = opts.onActual ? wages : capped;
  const eps_wages = opts.epsExcluded ? 0 : capped;
  const ee = rupee((epf_wages * r.employee_pct) / 100);
  const erTotal = rupee((epf_wages * r.employer_pct) / 100);
  const eps = Math.min(erTotal, rupee((eps_wages * r.eps_pct) / 100));
  return {
    epf_wages,
    eps_wages,
    edli_wages: capped,
    ee,
    eps,
    epf_er: erTotal - eps,
    edli: rupee((capped * r.edli_pct) / 100),
    admin: rupee((epf_wages * r.admin_pct) / 100),
  };
}

/* ── ESI ──────────────────────────────────────────────────────── */

export interface EsiResult {
  covered: boolean;
  ee: number;
  er: number;
}

/**
 * ESI for a month. `rateWages` = the employee's monthly rate of wages (overtime excluded) that
 * decides coverage; `alreadyCovered` = covered earlier in the same contribution period (coverage
 * then continues to the period's end even if wages rise above the ceiling).
 */
export function esiContribution(esiWages: number, rateWages: number, date: string, alreadyCovered = false): EsiResult {
  const r = esiRule(date);
  const covered = alreadyCovered || round2(rateWages) <= r.wage_ceiling;
  if (!covered || esiWages <= 0) return { covered, ee: 0, er: 0 };
  return { covered, ee: rupeeUp((esiWages * r.employee_pct) / 100), er: rupeeUp((esiWages * r.employer_pct) / 100) };
}

/* ── Professional Tax ─────────────────────────────────────────── */

function slabAmount(slabs: readonly PtSlab[], base: number, feb: boolean): number {
  const s = slabs.find((x) => x.up_to === null || base <= x.up_to) ?? slabs[slabs.length - 1];
  if (!s) return 0;
  return feb && s.feb !== undefined ? s.feb : s.amount;
}

/**
 * Professional Tax for `month` (`YYYY-MM`) on the month's gross. Half-yearly states (Tamil Nadu)
 * charge on gross × 6 in their deduction months only. `paidBefore` = PT already deducted in the FY
 * (keeps the year within the ₹2,500 constitutional cap).
 */
export function professionalTax(state: string | undefined, gross: number, month: string, opts: { gender?: string; paidBefore?: number } = {}): number {
  const rule = ptRule(state, `${month}-01`);
  if (!rule || gross <= 0) return 0;
  const m = Number(month.slice(5, 7));
  const slabs = opts.gender === 'F' && rule.women ? rule.women : rule.slabs;
  let amount: number;
  if (rule.half_yearly) {
    if (!rule.half_yearly.months.includes(m)) return 0;
    amount = slabAmount(slabs, round2(gross * 6), false);
  } else {
    amount = slabAmount(slabs, round2(gross), m === 2);
  }
  return Math.max(0, Math.min(amount, PT_ANNUAL_CAP - (opts.paidBefore ?? 0)));
}

/* ── Income tax (s. 192 projection) ───────────────────────────── */

function slabTax(income: number, rule: RegimeRule): number {
  let tax = 0;
  let lower = 0;
  for (const s of rule.slabs) {
    const upper = s.up_to ?? Infinity;
    if (income > lower) tax += ((Math.min(income, upper) - lower) * s.rate) / 100;
    lower = upper;
    if (income <= upper) break;
  }
  return round2(tax);
}

function afterRebate(income: number, tax: number, rule: RegimeRule): { tax: number; rebate: number } {
  if (income <= rule.rebate_limit) {
    const rebate = Math.min(tax, rule.rebate_max);
    return { tax: round2(tax - rebate), rebate };
  }
  if (rule.rebate_marginal) {
    const excess = income - rule.rebate_limit;
    if (tax > excess) return { tax: round2(excess), rebate: round2(tax - excess) };
  }
  return { tax, rebate: 0 };
}

/** Tax + surcharge (before cess), with marginal relief at each surcharge threshold. */
function taxWithSurcharge(income: number, rule: RegimeRule): { tax: number; rebate: number; surcharge: number } {
  const base = afterRebate(income, slabTax(income, rule), rule);
  const tiers = rule.surcharge.filter((t) => income > t.above);
  if (!tiers.length) return { ...base, surcharge: 0 };
  const top = tiers[tiers.length - 1];
  let surcharge = round2((base.tax * top.rate) / 100);
  const atThreshold = taxWithSurcharge(top.above, rule);
  const cap = atThreshold.tax + atThreshold.surcharge + (income - top.above);
  if (base.tax + surcharge > cap) surcharge = Math.max(0, round2(cap - base.tax));
  return { ...base, surcharge };
}

export interface IncomeTax {
  income: number;
  tax_on_income: number;
  rebate: number;
  surcharge: number;
  cess: number;
  /** Total tax payable, rounded to the nearest ₹10 (s. 288B). */
  total: number;
}

export function incomeTax(totalIncome: number, rule: RegimeRule): IncomeTax {
  const income = Math.max(0, Math.round(totalIncome / 10) * 10); // s. 288A: income rounded to ₹10
  const gross = slabTax(income, rule);
  const t = taxWithSurcharge(income, rule);
  const cess = round2(((t.tax + t.surcharge) * rule.cess_pct) / 100);
  return {
    income,
    tax_on_income: gross,
    rebate: t.rebate,
    surcharge: t.surcharge,
    cess,
    total: Math.round((t.tax + t.surcharge + cess) / 10) * 10,
  };
}

export interface SalaryIncomeInput {
  /** Gross taxable salary for the year u/s 17(1) (incl. previous employer). */
  gross: number;
  /** Professional tax for the year (deductible u/s 16(iii), old regime). */
  pt: number;
  hra_exemption?: number;
  /** Chapter VI-A deductions (old regime). */
  deductions?: number;
  other_income?: number;
}

export interface SalaryIncome {
  gross: number;
  exemptions: number;
  standard_deduction: number;
  pt: number;
  income_from_salary: number;
  other_income: number;
  gross_total_income: number;
  deductions: number;
  total_income: number;
}

/** Form 16 Part B arithmetic: gross → income chargeable under "Salaries" → total income. */
export function salaryIncome(input: SalaryIncomeInput, rule: RegimeRule): SalaryIncome {
  const gross = round2(Math.max(0, input.gross));
  const exemptions = rule.allows_deductions ? Math.min(gross, round2(Math.max(0, input.hra_exemption ?? 0))) : 0;
  const standard_deduction = Math.min(rule.standard_deduction, round2(gross - exemptions));
  const pt = rule.allows_deductions ? Math.min(5000, round2(Math.max(0, input.pt))) : 0;
  const income_from_salary = Math.max(0, round2(gross - exemptions - standard_deduction - pt));
  const other_income = round2(Math.max(0, input.other_income ?? 0));
  const gross_total_income = round2(income_from_salary + other_income);
  const deductions = rule.allows_deductions ? Math.min(gross_total_income, round2(Math.max(0, input.deductions ?? 0))) : 0;
  return {
    gross,
    exemptions,
    standard_deduction,
    pt,
    income_from_salary,
    other_income,
    gross_total_income,
    deductions,
    total_income: round2(gross_total_income - deductions),
  };
}

/** FY start (`YYYY-04-01`) for a `YYYY-MM` month. */
export function fyStartOfMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** `YYYY-MM` months from `month` to March of its FY, inclusive. */
export function monthsToFyEnd(month: string): string[] {
  const out: string[] = [];
  let y = Number(month.slice(0, 4));
  let m = Number(month.slice(5, 7));
  for (;;) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (m === 3) break;
    m++;
    if (m === 13) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function daysInMonth(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(y, m, 0).getDate();
}

export function lastDayOfMonth(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}
