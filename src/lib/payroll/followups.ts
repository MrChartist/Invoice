/**
 * Payroll follow-ups (7T) — pure engines: the EPFO arrear ECR, relief u/s 89(1) with the Form 10E
 * working, Rule 3 perquisite valuation (motor car, accommodation, free meals, gifts), the
 * s. 17(2)(vii) working, the 17(2)(viia) accretion (Rule 3B), the statement of perquisites (Form 12BA
 * working), interest u/s 201(1A) on TDS from salary (late deposit and late deduction), arrear ECR checks, and the journal behind an
 * actuary's gratuity / leave valuation (AS-15 / Ind AS 19).
 *
 * Pure: callers pass the data (`followups-store.ts` reads / writes storage). Statutory values come
 * from `payroll-rules.ts`, date-keyed. Working papers — verify with your CA.
 */

import { round2 } from '../invoice-calc';
import { A } from '../ledger/accounts';
import { ruleAt } from '../tax-rules';
import { formatDate } from '../utils';
import {
  ACCOMMODATION_PERQ_RULES,
  CAR_PERQ_RULES,
  HOTEL_PERQ_RULES,
  MEAL_GIFT_PERQ_RULES,
  S17_2_VIIA_RULES,
  accommodationPerqRule,
  carPerqRule,
  mealGiftRule,
  pfRule,
  ruleSource,
  s17viiLimit,
  tds201Rule,
  tdsSalaryRuleAnyYear,
} from '../payroll-rules';
import type {
  ActuarialValuation,
  ArrearsMonth,
  ArrearsRecord,
  Employee,
  PayrollPayment,
  PayrollRun,
  PayslipLine,
  Perquisite,
  PerquisiteKind,
  Relief89Year,
  TaxRegime,
} from '../../types/payroll';
import { addMonths } from './depth';
import { fyStartOfMonth, incomeTax, lastDayOfMonth } from './statutory';

type Row = (string | number)[];
const fyLabel = (fy: number) => `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
const finals = (runs: readonly PayrollRun[]) => runs.filter((r) => r.status === 'final');

/* ── EPFO arrear ECR ──────────────────────────────────────────── */

export interface ArrearEcrLine {
  employee_id: string;
  uan: string;
  name: string;
  months: string[];
  epf_wages: number;
  eps_wages: number;
  edli_wages: number;
  ee: number;
  eps: number;
  /** Employer EPF share (EPF − EPS difference). */
  er: number;
}

/** EPS / EDLI wage difference of an arrear month (older records did not keep them: derived). */
function arrearWages(m: ArrearsMonth): { eps: number; edli: number } {
  const r = pfRule(lastDayOfMonth(m.month));
  const derive = (amount: number, pct: number) => (amount > 0 && pct > 0 ? Math.min(Math.max(0, m.pf_wages), Math.round((amount * 100) / pct)) : 0);
  const eps = m.eps_wages ?? derive(m.eps, r.eps_pct);
  const edli = m.edli_wages ?? (m.edli > 0 ? derive(m.edli, r.edli_pct) : eps);
  return { eps, edli };
}

/** One line per member for the arrears paid with `payMonth` (PF members with a PF difference only). */
export function arrearEcrLines(records: readonly ArrearsRecord[], employees: readonly Employee[], payMonth: string): ArrearEcrLine[] {
  const byEmp = new Map<string, ArrearEcrLine>();
  for (const r of records.filter((x) => x.pay_month === payMonth)) {
    const e = employees.find((x) => x.id === r.employee_id);
    for (const m of r.months) {
      if (!(m.pf_wages || m.pf_ee || m.eps || m.epf_er)) continue;
      const w = arrearWages(m);
      const cur = byEmp.get(r.employee_id) ?? { employee_id: r.employee_id, uan: e?.uan ?? '', name: e?.name ?? r.employee_id, months: [], epf_wages: 0, eps_wages: 0, edli_wages: 0, ee: 0, eps: 0, er: 0 };
      cur.months.push(m.month);
      cur.epf_wages = round2(cur.epf_wages + m.pf_wages);
      cur.eps_wages = round2(cur.eps_wages + w.eps);
      cur.edli_wages = round2(cur.edli_wages + w.edli);
      cur.ee = round2(cur.ee + m.pf_ee);
      cur.eps = round2(cur.eps + m.eps);
      cur.er = round2(cur.er + m.epf_er);
      byEmp.set(r.employee_id, cur);
    }
  }
  return [...byEmp.values()].filter((l) => l.ee || l.eps || l.er);
}

/**
 * Arrear ECR text, one member a line, `#~#`-separated: UAN, name, arrear EPF wages, arrear EPS
 * wages, arrear EDLI wages, arrear EE share, arrear EPS share, arrear ER (EPF − EPS) share.
 * UNVERIFIED LAYOUT — check against the EPFO arrear ECR format on the portal before uploading.
 */
export function arrearEcrText(lines: readonly ArrearEcrLine[]): string {
  return lines
    .map((l) => [l.uan, l.name.toUpperCase().replace(/#~#/g, ' '), Math.round(l.epf_wages), Math.round(l.eps_wages), Math.round(l.edli_wages), Math.round(l.ee), Math.round(l.eps), Math.round(l.er)].join('#~#'))
    .join('\n');
}

export function arrearEcrRows(lines: readonly ArrearEcrLine[], payMonth: string): Row[] {
  const out: Row[] = [['UAN', 'Member name', 'Arrear months', 'Arrear EPF wages', 'Arrear EPS wages', 'Arrear EDLI wages', 'Arrear EE share', 'Arrear EPS share', 'Arrear ER share (EPF − EPS)']];
  for (const l of lines) out.push([l.uan, l.name, l.months.join(' '), l.epf_wages, l.eps_wages, l.edli_wages, l.ee, l.eps, l.er]);
  for (const c of arrearEcrChecks(lines, payMonth)) out.push([`Check: ${c}`]);
  out.push([`Arrears paid with ${payMonth}. Layout not validated against the EPFO portal — verify with your CA.`]);
  return out;
}

/**
 * Checks on the arrear ECR before upload (7.149): our own arithmetic and identifiers, NOT the EPFO
 * validator — UAN of 12 digits and once only, a name, no negative amounts, EPS / EDLI wages within EPF
 * wages, and the shares against the PF rates of the pay month (₹1 a month for rounding).
 */
export function arrearEcrChecks(lines: readonly ArrearEcrLine[], payMonth: string): string[] {
  const r = pfRule(lastDayOfMonth(payMonth));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const who = `${l.uan || '—'} ${l.name}`;
    const off = (got: number, want: number) => Math.abs(got - want) > Math.max(1, l.months.length);
    if (!/^\d{12}$/.test(l.uan)) out.push(`${who}: UAN must be 12 digits.`);
    else if (seen.has(l.uan)) out.push(`${who}: UAN appears twice.`);
    seen.add(l.uan);
    if (!l.name.trim()) out.push(`${who}: no member name.`);
    if ([l.epf_wages, l.eps_wages, l.edli_wages, l.ee, l.eps, l.er].some((v) => v < 0)) out.push(`${who}: a negative arrear (downward revision) — check how EPFO takes it before uploading.`);
    if (l.eps_wages > l.epf_wages || l.edli_wages > l.epf_wages) out.push(`${who}: EPS / EDLI wages exceed EPF wages.`);
    if (off(l.ee, (l.epf_wages * r.employee_pct) / 100)) out.push(`${who}: EE share ${l.ee} is not ${r.employee_pct}% of EPF wages.`);
    if (off(l.eps, (l.eps_wages * r.eps_pct) / 100)) out.push(`${who}: EPS share ${l.eps} is not ${r.eps_pct}% of EPS wages.`);
    if (off(l.eps + l.er, (l.epf_wages * r.employer_pct) / 100)) out.push(`${who}: EPS + ER ${round2(l.eps + l.er)} is not ${r.employer_pct}% of EPF wages.`);
  }
  return out;
}

/* ── Relief u/s 89(1) — Form 10E ──────────────────────────────── */

export interface Relief89Row {
  fy: number;
  label: string;
  regime: TaxRegime;
  income: number;
  arrears: number;
  tax_without: number;
  tax_with: number;
  difference: number;
}

export interface Relief89Result {
  receipt: Relief89Row;
  earlier: Relief89Row[];
  arrears_total: number;
  /** Tax on the arrears in the year of receipt (Table A items 1–6). */
  difference_receipt: number;
  /** Tax on the arrears spread back over their years (Annexure I Table A col. 7 total). */
  difference_earlier: number;
  relief: number;
  notes: string[];
}

export interface Relief89Input {
  fy: number;
  regime: TaxRegime;
  income_with: number;
  years: readonly Relief89Year[];
  dob?: string;
}

const taxOn = (income: number, regime: TaxRegime, fy: number, dob?: string) => incomeTax(Math.max(0, income), tdsSalaryRuleAnyYear(regime, `${fy}-04-01`, dob)).total;

/**
 * Relief u/s 89(1) for arrears of salary (Rule 21A(2), Form 10E Annexure I Table A): the extra tax
 * the arrears cause in the year of receipt, less the extra tax they would have caused in the years
 * they relate to; nil when spreading back costs more. Tax includes surcharge and cess of each year.
 */
export function relief89(input: Relief89Input): Relief89Result {
  const notes: string[] = [];
  const years = input.years.filter((y) => y.fy < input.fy && (y.arrears || y.income));
  const arrearsTotal = round2(years.reduce((s, y) => s + Math.max(0, y.arrears), 0));
  const withoutReceipt = round2(input.income_with - arrearsTotal);
  const rTaxWith = taxOn(input.income_with, input.regime, input.fy, input.dob);
  const rTaxWithout = taxOn(withoutReceipt, input.regime, input.fy, input.dob);
  const receipt: Relief89Row = { fy: input.fy, label: fyLabel(input.fy), regime: input.regime, income: withoutReceipt, arrears: arrearsTotal, tax_without: rTaxWithout, tax_with: rTaxWith, difference: round2(rTaxWith - rTaxWithout) };
  const earlier = [...years].sort((a, b) => a.fy - b.fy).map((y): Relief89Row => {
    const without = taxOn(y.income, y.regime, y.fy, input.dob);
    const withA = taxOn(y.income + Math.max(0, y.arrears), y.regime, y.fy, input.dob);
    if (y.fy < 2017) notes.push(`FY ${fyLabel(y.fy)}: slabs before FY 2017-18 are not kept — the FY 2017-18 table was used; type the tax from that year's return instead.`);
    return { fy: y.fy, label: fyLabel(y.fy), regime: y.regime, income: round2(y.income), arrears: round2(Math.max(0, y.arrears)), tax_without: without, tax_with: withA, difference: round2(withA - without) };
  });
  const diffEarlier = round2(earlier.reduce((s, r) => s + r.difference, 0));
  const relief = Math.max(0, round2(receipt.difference - diffEarlier));
  if (!arrearsTotal) notes.push('No arrears of earlier years entered.');
  else if (diffEarlier >= receipt.difference) notes.push('No relief: the arrears cost as much or more tax when spread back over their years.');
  notes.push('Form 10E must be filed online by the employee before the relief is claimed in the return — verify with your CA.');
  return { receipt, earlier, arrears_total: arrearsTotal, difference_receipt: receipt.difference, difference_earlier: diffEarlier, relief, notes };
}

export function relief89Rows(r: Relief89Result, employee: Pick<Employee, 'code' | 'name' | 'pan'>): Row[] {
  const out: Row[] = [[`Relief u/s 89(1) — Form 10E working: ${employee.code} ${employee.name}${employee.pan ? ` (PAN ${employee.pan})` : ''}`]];
  out.push(['Year of receipt', r.receipt.label, `regime ${r.receipt.regime}`]);
  out.push(['1. Total income excluding arrears', r.receipt.income]);
  out.push(['2. Arrears of earlier years received', r.arrears_total]);
  out.push(['3. Total income including arrears', round2(r.receipt.income + r.arrears_total)]);
  out.push(['4. Tax on total income including arrears', r.receipt.tax_with]);
  out.push(['5. Tax on total income excluding arrears', r.receipt.tax_without]);
  out.push(['6. Difference (4 − 5)', r.difference_receipt]);
  out.push(['7. Tax on arrears spread over their years (Annexure I, Table A)', r.difference_earlier]);
  out.push(['8. Relief u/s 89(1) (6 − 7, nil if negative)', r.relief]);
  out.push([]);
  out.push(['Annexure I, Table A — FY', 'Regime', 'Total income of that year', 'Arrears relating to it', 'Tax without arrears', 'Tax with arrears', 'Difference']);
  for (const y of r.earlier) out.push([y.label, y.regime, y.income, y.arrears, y.tax_without, y.tax_with, y.difference]);
  for (const n of r.notes) out.push([n]);
  return out;
}

/** Latest TDS working of an employee in an FY, from final runs (else drafts). */
function lastWorking(employeeId: string, fy: number, runs: readonly PayrollRun[]): PayslipLine['tds_working'] {
  const inFy = (r: PayrollRun) => fyStartOfMonth(r.month) === `${fy}-04-01`;
  const pick = (list: PayrollRun[]) => list.sort((a, b) => b.month.localeCompare(a.month)).map((r) => r.lines.find((l) => l.employee_id === employeeId)).find((l): l is PayslipLine => !!l?.tds_working);
  return (pick(finals(runs).filter(inFy)) ?? pick(runs.filter(inFy)))?.tds_working;
}

/** Latest projection (`tds_working.annual_income`) of an employee in an FY. */
function projectedIncome(employeeId: string, fy: number, runs: readonly PayrollRun[]): number {
  return round2(lastWorking(employeeId, fy, runs)?.annual_income ?? 0);
}

/**
 * Starting figures for Form 10E: earlier-FY arrears paid in FY `fy` (taxable part, by the year
 * they relate to), each year's income from that year's last payslip projection, and the year of
 * receipt's projected income (which already includes the arrears paid). The user corrects them
 * from the employee's returns — other income and deductions are not known to payroll.
 */
export function relief89Suggest(employee: Employee, fy: number, runs: readonly PayrollRun[], arrears: readonly ArrearsRecord[]): { income_with: number; years: Relief89Year[] } {
  const byFy = new Map<number, number>();
  for (const r of arrears.filter((x) => x.employee_id === employee.id && fyStartOfMonth(x.pay_month) === `${fy}-04-01`)) {
    for (const m of r.months) {
      const y = Number(fyStartOfMonth(m.month).slice(0, 4));
      if (y < fy) byFy.set(y, round2((byFy.get(y) ?? 0) + m.taxable));
    }
  }
  const regime: TaxRegime = employee.tax_regime === 'old' ? 'old' : 'new';
  const years = [...byFy.entries()].sort((a, b) => a[0] - b[0]).map(([y, amount]) => ({ fy: y, regime, income: projectedIncome(employee.id, y, runs), arrears: amount }));
  return { income_with: projectedIncome(employee.id, fy, runs), years };
}

/* ── Rule 3 perquisite valuation ──────────────────────────────── */

export interface PerqValuation {
  /** Taxable value per month (the whole value in its month for a one-off gift). */
  monthly: number;
  basis: string;
  source: string;
}

const money = (n: number) => `₹${round2(n).toLocaleString('en-IN')}`;

export interface CarPerqInput {
  date: string;
  cc: number;
  use: 'official' | 'private' | 'mixed';
  /** Mixed use: who meets the running / maintenance costs of private use. */
  running_by: 'employer' | 'employee';
  chauffeur: boolean;
  /** Private use only: the employer's actual monthly cost (running, chauffeur, 10% a year of the car's cost or hire charges). */
  private_cost?: number;
  /** Private use only: amount recovered from the employee a month. */
  recovered?: number;
}

/** Rule 3(2): motor car owned or hired by the employer. */
export function carPerquisite(i: CarPerqInput): PerqValuation {
  const r = carPerqRule(i.date);
  const source = ruleSource(CAR_PERQ_RULES, i.date);
  if (i.use === 'official') return { monthly: 0, basis: 'Car used wholly for official duties — not a perquisite (keep the log book / employer certificate).', source };
  if (i.use === 'private') {
    const v = Math.max(0, round2((i.private_cost ?? 0) - (i.recovered ?? 0)));
    return { monthly: v, basis: `Car used wholly for private purposes: actual cost ${money(i.private_cost ?? 0)} less recovered ${money(i.recovered ?? 0)} a month.`, source };
  }
  const small = i.cc > 0 && i.cc <= r.small_cc;
  const base = i.running_by === 'employer' ? (small ? r.employer_small : r.employer_large) : small ? r.employee_small : r.employee_large;
  const chauffeur = i.chauffeur ? r.chauffeur : 0;
  return {
    monthly: base + chauffeur,
    basis: `Car partly for private use, ${small ? `up to ${r.small_cc} cc` : `above ${r.small_cc} cc`}, running costs met by the ${i.running_by}: ${money(base)}${chauffeur ? ` + chauffeur ${money(chauffeur)}` : ''} a month (Rule 3(2) Table II; recoveries are not deducted).`,
    source,
  };
}

export interface AccommodationPerqInput {
  date: string;
  /** Salary for the month (Basic, DA if in terms, bonus, commission, taxable allowances). */
  salary: number;
  ownership: 'owned' | 'leased';
  /** Population of the city (census named in the rule). */
  population: number;
  /** Leased: rent paid by the employer a month. */
  rent?: number;
  /** Furniture owned by the employer: its cost (10% a year). */
  furniture_cost?: number;
  /** Furniture hired by the employer: hire charges a month. */
  furniture_hire?: number;
  /** Rent recovered from the employee a month. */
  recovered?: number;
}

/** Rule 3(1) Table I: accommodation from a private-sector employer (unfurnished value + furniture − recovery). */
export function accommodationPerquisite(i: AccommodationPerqInput): PerqValuation {
  const r = accommodationPerqRule(i.date);
  const source = ruleSource(ACCOMMODATION_PERQ_RULES, i.date);
  const salary = Math.max(0, i.salary);
  let base: number;
  let how: string;
  if (i.ownership === 'leased') {
    const cap = round2((salary * r.leased_pct) / 100);
    base = Math.min(Math.max(0, i.rent ?? 0), cap);
    how = `leased: lower of rent ${money(i.rent ?? 0)} and ${r.leased_pct}% of salary ${money(cap)}`;
  } else {
    const band = r.owned.find((b) => i.population > b.min_population) ?? r.owned[r.owned.length - 1];
    base = round2((salary * band.pct) / 100);
    how = `employer-owned: ${band.pct}% of salary ${money(salary)} (population ${band.min_population > 0 ? `above ${(band.min_population / 100000).toLocaleString('en-IN')} lakh` : 'band lowest'}, ${r.census} census)`;
  }
  const furniture = i.furniture_hire ? round2(i.furniture_hire) : round2(((i.furniture_cost ?? 0) * r.furniture_pct) / 100 / 12);
  const v = Math.max(0, round2(base + furniture - (i.recovered ?? 0)));
  return { monthly: v, basis: `Accommodation ${how}${furniture ? ` + furniture ${money(furniture)}` : ''}${i.recovered ? ` − recovered ${money(i.recovered)}` : ''} a month.`, source };
}

/** Rule 3(1) Table I: hotel accommodation — the lower of the rule's % of salary and the charges, nil on transfer within the free days. */
export function hotelPerquisite(i: { date: string; salary: number; charges: number; days: number; on_transfer: boolean; recovered?: number }): PerqValuation {
  const r = ruleAt(HOTEL_PERQ_RULES, i.date);
  const source = ruleSource(HOTEL_PERQ_RULES, i.date);
  if (i.on_transfer && i.days <= r.free_days) return { monthly: 0, basis: `Hotel on transfer for ${i.days} days (${r.free_days} or less in all) — not a perquisite.`, source };
  const cap = round2((Math.max(0, i.salary) * r.pct) / 100);
  const v = Math.max(0, round2(Math.min(Math.max(0, i.charges), cap) - (i.recovered ?? 0)));
  return { monthly: v, basis: `Hotel: lower of charges ${money(i.charges)} and ${r.pct}% of salary ${money(cap)}${i.recovered ? ` − recovered ${money(i.recovered)}` : ''} a month.`, source };
}

/** Rule 3(7)(iii): free meals in working hours — the cost above the exempt amount a meal. */
export function mealsPerquisite(i: { date: string; meals: number; cost_per_meal: number; recovered_per_meal?: number }): PerqValuation {
  const r = mealGiftRule(i.date);
  const per = Math.max(0, round2(i.cost_per_meal - (i.recovered_per_meal ?? 0) - r.meal_exempt));
  return { monthly: round2(per * Math.max(0, i.meals)), basis: `Free meals: ${i.meals} a month × (${money(i.cost_per_meal)} − recovered ${money(i.recovered_per_meal ?? 0)} − exempt ${money(r.meal_exempt)}).`, source: ruleSource(MEAL_GIFT_PERQ_RULES, i.date) };
}

/**
 * Rule 3(7)(iv): gifts / vouchers in kind. Below the limit in aggregate for the year nothing is
 * taxable; once the year's total reaches it, the whole value is (earlier gifts of the year too,
 * charged now). UNVERIFIED reading — some treat only the excess as taxable.
 */
export function giftPerquisite(i: { date: string; value: number; earlier_this_year: number }): PerqValuation {
  const r = mealGiftRule(i.date);
  const total = round2(i.earlier_this_year + i.value);
  const source = ruleSource(MEAL_GIFT_PERQ_RULES, i.date);
  if (total < r.gift_exempt_below) return { monthly: 0, basis: `Gifts this year ${money(total)} — below ${money(r.gift_exempt_below)}, exempt.`, source };
  const crossing = i.earlier_this_year < r.gift_exempt_below;
  const v = crossing ? total : round2(i.value);
  return { monthly: v, basis: `Gifts this year ${money(total)} reach ${money(r.gift_exempt_below)}: ${crossing ? `the year's gifts (${money(total)}) become taxable now` : `this gift ${money(i.value)} is taxable`}.`, source };
}

/* ── s. 17(2)(vii) / (viia) working ───────────────────────────── */

/** Employer's contribution of a payslip to PF (EPF + EPS), NPS and superannuation. */
export function employerRetirementContrib(l: Pick<PayslipLine, 'eps' | 'epf_er' | 'nps_er' | 'super_er'>): { pf: number; nps: number; superannuation: number; total: number } {
  const pf = round2(l.eps + l.epf_er);
  const nps = round2(l.nps_er ?? 0);
  const sup = round2(l.super_er ?? 0);
  return { pf, nps, superannuation: sup, total: round2(pf + nps + sup) };
}

/** Per employee for FY `fy` from FINAL runs: contributions, the limit and the excess taxed u/s 17(2)(vii). */
export function s17viiRows(runs: readonly PayrollRun[], employees: readonly Employee[], fy: number): Row[] {
  const limit = s17viiLimit(`${fy}-04-01`);
  const out: Row[] = [['Code', 'Employee', 'Employer PF (EPF + EPS)', 'Employer NPS', 'Superannuation', 'Total', 'Limit', 'Excess — perquisite u/s 17(2)(vii)']];
  for (const e of employees) {
    const t = { pf: 0, nps: 0, superannuation: 0, total: 0 };
    let any = false;
    for (const r of finals(runs).filter((x) => fyStartOfMonth(x.month) === `${fy}-04-01`)) {
      const l = r.lines.find((x) => x.employee_id === e.id);
      if (!l) continue;
      any = true;
      const c = employerRetirementContrib(l);
      t.pf += c.pf;
      t.nps += c.nps;
      t.superannuation += c.superannuation;
      t.total += c.total;
    }
    if (!any) continue;
    out.push([e.code, e.name, round2(t.pf), round2(t.nps), round2(t.superannuation), round2(t.total), limit ?? 'n/a', limit === null ? 0 : Math.max(0, round2(t.total - limit))]);
  }
  out.push(['EPS share included in employer PF (UNVERIFIED — some exclude the pension share). s. 17(2)(viia): the annual accretion on the excess (Rule 3B) is worked on the "Form 10E · Rule 3" tab from the fund statements and saved as a perquisite. Verify with your CA.']);
  return out;
}

export interface Rule3bInput {
  date: string;
  /** PC: this year's employer contribution above the limit. */
  pc: number;
  /** PC1: the same for earlier years from FY 2020-21. */
  pc1: number;
  /** TP1: accretion already taxed in those earlier years. */
  tp1: number;
  /** I: income accrued in the fund account this year. */
  income: number;
  /** Fund balance on the first and the last day of the year. */
  opening: number;
  closing: number;
}

/** s. 17(2)(viia), Rule 3B: TP = (PC / 2) × R + (PC1 + TP1) × R, R = I ÷ Favg; PC1 + TP1 above the opening balance ignored. */
export function rule3bAccretion(i: Rule3bInput): PerqValuation & { r: number; favg: number } {
  const favg = round2((Math.max(0, i.opening) + Math.max(0, i.closing)) / 2);
  const r = favg > 0 ? Math.max(0, i.income) / favg : 0;
  const earlier = Math.min(Math.max(0, i.pc1) + Math.max(0, i.tp1), Math.max(0, i.opening));
  const pc = Math.max(0, i.pc);
  const monthly = round2((pc / 2) * r + earlier * r);
  return {
    monthly,
    r,
    favg,
    basis: `Accretion u/s 17(2)(viia): (PC ${money(pc)} ÷ 2 + PC1 + TP1 ${money(earlier)}) × R ${(r * 100).toFixed(4)}% (I ${money(i.income)} ÷ Favg ${money(favg)}).`,
    source: ruleSource(S17_2_VIIA_RULES, i.date),
  };
}

/**
 * Starting figures for Rule 3B from payroll: PC from the year's latest TDS working, PC1 from each
 * earlier year's (from FY 2020-21), TP1 from accretion perquisites saved for those years. Fund income
 * and balances come from the fund statement.
 */
export function rule3bSuggest(employeeId: string, fy: number, runs: readonly PayrollRun[], perqs: readonly Perquisite[]): { pc: number; pc1: number; tp1: number } {
  const first = Number(ruleAt(S17_2_VIIA_RULES, `${fy}-04-01`).first_fy.slice(0, 4));
  let pc1 = 0;
  for (let y = first; y < fy; y++) pc1 += lastWorking(employeeId, y, runs)?.s17_vii ?? 0;
  const tp1 = perqs
    .filter((p) => p.employee_id === employeeId && p.kind === 'accretion')
    .filter((p) => {
      const y = Number(fyStartOfMonth(p.from_month).slice(0, 4));
      return y >= first && y < fy;
    })
    .reduce((s, p) => s + p.monthly_value, 0);
  return { pc: round2(lastWorking(employeeId, fy, runs)?.s17_vii ?? 0), pc1: round2(pc1), tp1: round2(tp1) };
}

/* ── Statement of perquisites (Form 12BA working) ─────────────── */

const PERQ_NATURE: [PerquisiteKind | 'loan' | 's17vii', string][] = [
  ['accommodation', 'Accommodation'],
  ['car', 'Cars / other automotive'],
  ['loan', 'Interest-free or concessional loans'],
  ['meals', 'Free meals'],
  ['gift', 'Gifts, vouchers, etc.'],
  ['s17vii', 'Contribution by employer to fund and scheme taxable u/s 17(2)(vii)'],
  ['accretion', 'Annual accretion on that fund and scheme taxable u/s 17(2)(viia)'],
  ['other', 'Other benefits or amenities'],
];

/**
 * Perquisites of an employee for FY `fy` by nature, from FINAL payslips: each month's typed perquisites by
 * kind, the loan perquisite (the rest of the payslip's perquisites) and the year's 17(2)(vii) excess.
 * Grouped as Form 12BA groups them; its row numbers and layout are not reproduced (not verified).
 */
export function perqStatementRows(runs: readonly PayrollRun[], perqs: readonly Perquisite[], employee: Pick<Employee, 'id' | 'code' | 'name' | 'pan'>, fy: number, formLabel = 'Form 12BA'): Row[] {
  const by = new Map<string, number>();
  const add = (k: string, v: number) => by.set(k, round2((by.get(k) ?? 0) + v));
  let contrib = 0;
  for (const r of finals(runs).filter((x) => fyStartOfMonth(x.month) === `${fy}-04-01`)) {
    const l = r.lines.find((x) => x.employee_id === employee.id);
    if (!l) continue;
    contrib += employerRetirementContrib(l).total;
    let typed = 0;
    for (const p of perqs) {
      if (p.employee_id !== employee.id || p.from_month > r.month || (p.to_month && p.to_month < r.month)) continue;
      add(p.kind, p.monthly_value);
      typed += p.monthly_value;
    }
    add('loan', round2((l.perquisites ?? 0) - typed));
  }
  const limit = s17viiLimit(`${fy}-04-01`);
  add('s17vii', limit === null ? 0 : Math.max(0, round2(contrib - limit)));
  if ((by.get('loan') ?? 0) < 0) {
    add('other', by.get('loan') ?? 0);
    by.set('loan', 0);
  }
  const out: Row[] = [[`Statement of perquisites (${formLabel} working): ${employee.code} ${employee.name}${employee.pan ? `, PAN ${employee.pan}` : ''}, FY ${fyLabel(fy)}`], ['Nature of perquisite', 'Amount chargeable to tax (net of recoveries)']];
  let total = 0;
  for (const [k, label] of PERQ_NATURE) {
    const v = by.get(k) ?? 0;
    total += v;
    if (v) out.push([label, v]);
  }
  out.push(['Total value of perquisites (Form 16 Part B 1(b))', round2(total)]);
  out.push([`Grouped as ${formLabel} groups perquisites; its row numbers and layout are not reproduced — copy the amounts into the notified form. Perquisites typed after a month was finalized show in "Other" as a correction. Verify with your CA.`]);
  return out;
}

/* ── Interest u/s 201(1A) on TDS from salary ──────────────────── */

/** Months or part of a month from `from` to `to`, counted by calendar month as TRACES does (0 when `to` ≤ `from`). */
export function monthsOrPart(from: string, to: string): number {
  if (!(to > from)) return 0;
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 * 12 + m2) - (y1 * 12 + m1) + 1;
}

/** Deposit due date for tax deducted on `deductedOn` (Rule 30(2): 7th of next month; March → 30 April). */
export function tdsDepositDue(deductedOn: string): string {
  const rule = tds201Rule(deductedOn);
  const month = deductedOn.slice(0, 7);
  const next = addMonths(month, 1);
  const day = month.endsWith('-03') ? rule.march_due_day : rule.due_day;
  return `${next}-${String(day).padStart(2, '0')}`;
}

export interface Tds201Interest {
  due_date: string;
  deduction_months: number;
  deduction_interest: number;
  deposit_months: number;
  deposit_interest: number;
}

/**
 * Interest u/s 201(1A): 1% a month (or part) from the date tax was deductible to the date it was
 * deducted, and 1.5% a month (or part) from the date of deduction to the date of deposit when the
 * deposit is after the due date. Interest is on the tax rounded down to ₹100 (Rule 119A).
 */
export function tds201Interest(i: { amount: number; deductedOn: string; paidOn: string; deductibleOn?: string }): Tds201Interest {
  const rule = tds201Rule(i.deductedOn);
  const base = Math.floor(Math.max(0, i.amount) / 100) * 100;
  const due = tdsDepositDue(i.deductedOn);
  const dedMonths = i.deductibleOn ? monthsOrPart(i.deductibleOn, i.deductedOn) : 0;
  const depMonths = i.paidOn > due ? monthsOrPart(i.deductedOn, i.paidOn) : 0;
  return {
    due_date: due,
    deduction_months: dedMonths,
    deduction_interest: Math.round((base * rule.late_deduction_pct * dedMonths) / 100),
    deposit_months: depMonths,
    deposit_interest: Math.round((base * rule.late_deposit_pct * depMonths) / 100),
  };
}

/**
 * Per FINAL month of FY `fy`: TDS deducted on the payroll voucher date, TDS-on-salary payments for
 * that challan period, and the 201(1A) interest on each late part (unpaid parts run to `today`).
 */
export function tds201Rows(runs: readonly PayrollRun[], payments: readonly PayrollPayment[], fy: number, today: string): Row[] {
  const out: Row[] = [['Month', 'TDS deducted', 'Deducted on', 'Due date', 'Paid', 'Paid on', 'Months late', 'Interest 201(1A) (est.)']];
  let total = 0;
  for (const r of finals(runs).filter((x) => fyStartOfMonth(x.month) === `${fy}-04-01`).sort((a, b) => a.month.localeCompare(b.month))) {
    const due = round2(r.lines.reduce((s, l) => s + l.tds, 0));
    if (!due) continue;
    const pays = payments.filter((p) => p.kind === 'tds' && p.period === r.month).sort((a, b) => a.date.localeCompare(b.date));
    let left = due;
    let interest = 0;
    let months = 0;
    for (const p of pays) {
      const part = Math.min(left, p.amount);
      if (part <= 0) break;
      const x = tds201Interest({ amount: part, deductedOn: r.date, paidOn: p.date });
      interest += x.deposit_interest;
      months = Math.max(months, x.deposit_months);
      left = round2(left - part);
    }
    if (left > 0.5) {
      const x = tds201Interest({ amount: left, deductedOn: r.date, paidOn: today });
      interest += x.deposit_interest;
      months = Math.max(months, x.deposit_months);
    }
    total += interest;
    const paid = round2(due - Math.max(0, left));
    out.push([r.month, due, formatDate(r.date), formatDate(tdsDepositDue(r.date)), paid, left > 0.5 ? `not fully paid (to ${formatDate(today)})` : pays.length ? formatDate(pays[pays.length - 1].date) : '', months, interest]);
  }
  out.push(['Total', '', '', '', '', '', '', total]);
  out.push(['Estimate only: payments are matched by their challan period. Verify with your CA.']);
  out.push([]);
  out.push(['Late deduction (1% a month or part)', 'Employee', 'Short in month', 'Amount short', 'Made good on', 'Months or part', 'Interest 201(1A) (est.)']);
  let lateTotal = 0;
  for (const x of tdsLateDeductions(runs, fy, today)) {
    lateTotal += x.interest;
    out.push(['', `${x.code} ${x.name}`, x.month, x.amount, x.made_good_on ? formatDate(x.made_good_on) : `not deducted (to ${formatDate(today)})`, x.months, x.interest]);
  }
  out.push(['Total', '', '', '', '', '', lateTotal]);
  out.push(['A month is short when its TDS is below the even share of that month\'s own projection (a typed-over figure); later TDS above its own share makes it good, first in first out. Whether a lower deduction is a default u/s 201 is for your CA.']);
  return out;
}

export interface TdsLateDeduction {
  employee_id: string;
  code: string;
  name: string;
  month: string;
  amount: number;
  /** '' while not made good (interest runs to `today`). */
  made_good_on: string;
  months: number;
  interest: number;
}

/**
 * 201(1A)(i) late deduction from FINAL payslips of FY `fy` (7.149). Each payslip's even share is what
 * its own projection asked for: (annual tax − deducted before) ÷ months left (the last month the
 * balance), less the part of earlier shortfalls that projection re-spread. TDS below it is short from
 * that run's date; TDS above it makes good earlier shortfalls first in first out, each part bearing
 * 1% a month or part on the part rounded down to ₹100 (Rule 119A). Unmade shortfalls run to `today`.
 */
export function tdsLateDeductions(runs: readonly PayrollRun[], fy: number, today: string): TdsLateDeduction[] {
  const rule = tds201Rule(`${fy}-04-01`);
  const list = finals(runs).filter((x) => fyStartOfMonth(x.month) === `${fy}-04-01`).sort((a, b) => a.month.localeCompare(b.month));
  const pending = new Map<string, { month: string; date: string; amount: number }[]>();
  const last = new Map<string, PayslipLine>();
  const out: TdsLateDeduction[] = [];
  const settle = (l: PayslipLine, p: { month: string; date: string }, amount: number, on: string, made = true) => {
    const months = monthsOrPart(p.date, on);
    out.push({ employee_id: l.employee_id, code: l.code, name: l.name, month: p.month, amount: round2(amount), made_good_on: made ? on : '', months, interest: Math.round((Math.floor(amount / 100) * 100 * rule.late_deduction_pct * months) / 100) });
  };
  for (const r of list) {
    for (const l of r.lines) {
      const w = l.tds_working;
      if (!w) continue;
      last.set(l.employee_id, l);
      const queue = pending.get(l.employee_id) ?? [];
      const owed = queue.reduce((s, p) => s + p.amount, 0);
      const due = Math.max(0, round2(w.annual_tax - w.deducted_before));
      const left = Math.max(1, w.months_left);
      const share = round2((left === 1 ? Math.round(due) : Math.round(due / left)) - owed / left);
      let extra = round2(l.tds - share);
      if (extra < -1) queue.push({ month: r.month, date: r.date, amount: -extra });
      while (extra > 1 && queue.length) {
        const p = queue[0];
        const part = Math.min(p.amount, extra);
        settle(l, p, part, r.date);
        extra = round2(extra - part);
        p.amount = round2(p.amount - part);
        if (p.amount <= 1) queue.shift();
      }
      pending.set(l.employee_id, queue);
    }
  }
  for (const [id, queue] of pending) for (const p of queue) settle(last.get(id)!, p, p.amount, today, false);
  return out.sort((a, b) => a.code.localeCompare(b.code) || a.month.localeCompare(b.month));
}

/* ── Actuarial valuation (AS-15 / Ind AS 19) ──────────────────── */

type ValuationFigures = Pick<ActuarialValuation, 'opening' | 'current_service_cost' | 'interest_cost' | 'past_service_cost' | 'benefits_paid' | 'actuarial_loss' | 'closing'>;

/** Obligation roll-forward: opening + service cost + interest + past service − benefits paid ± actuarial loss / gain = closing. */
export function actuarialCheck(v: ValuationFigures): { expected_closing: number; difference: number; ok: boolean } {
  const expected = round2(v.opening + v.current_service_cost + v.interest_cost + v.past_service_cost - v.benefits_paid + v.actuarial_loss);
  const difference = round2(v.closing - expected);
  return { expected_closing: expected, difference, ok: Math.abs(difference) <= 1 };
}

export interface ActuarialJournal {
  /** Net liability to carry: closing obligation − plan assets. */
  target: number;
  /** Journal amount: target − provision already in the books. */
  movement: number;
  /** Part recognised in OCI (Ind AS 19 remeasurement of a post-employment plan — gratuity). */
  oci: number;
  /** Part charged to profit and loss. */
  pnl: number;
  /** Signed lines in rupees: + debit, − credit. */
  lines: { account_id: string; amount: number }[];
}

/**
 * The provision journal from the actuary's figures. Benefits paid during the year were already
 * expensed when paid through payroll (Dr Gratuity / Leave encashment), so the journal moves the
 * provision from what is in the books to the net liability: Dr expense (P&L part) [+ Dr / Cr
 * Reserves — OCI remeasurement under Ind AS 19 for gratuity] | Cr Provisions 2500.
 * Leave is an "other long-term benefit": its remeasurement stays in P&L under Ind AS 19 too.
 */
export function actuarialJournal(v: Pick<ActuarialValuation, 'kind' | 'standard' | 'closing' | 'plan_assets' | 'book_balance' | 'actuarial_loss'>): ActuarialJournal {
  const target = round2(v.closing - (v.plan_assets ?? 0));
  const movement = round2(target - v.book_balance);
  const oci = v.kind === 'gratuity' && v.standard === 'indas19' ? round2(v.actuarial_loss) : 0;
  const pnl = round2(movement - oci);
  const expense = v.kind === 'gratuity' ? A.gratuity : A.leaveEncashment;
  const lines = [
    { account_id: expense, amount: pnl },
    { account_id: A.reserves, amount: oci },
    { account_id: A.provisions, amount: -movement },
  ].filter((l) => Math.abs(l.amount) >= 0.005);
  return { target, movement, oci, pnl, lines };
}
