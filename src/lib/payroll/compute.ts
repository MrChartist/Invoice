/**
 * Payroll computation (Phase 7) — Tally's "Payroll Auto Fill": for a month, every employee's
 * earnings, deductions and employer contributions from their salary structure + attendance, plus
 * the statutory heads (PF, ESI, PT, TDS u/s 192). Pure: callers pass every input.
 * Working papers — verify with your CA.
 */

import { A } from '../ledger/accounts';
import { STATUTORY_PAYABLE } from './postings';
import { round2 } from '../invoice-calc';
import { esiPeriodStart, esiRule, pfRule, tdsSalaryRule } from '../payroll-rules';
import type {
  AttendanceRow,
  Employee,
  PayHead,
  PayslipAmount,
  PayslipLine,
  SalaryStructure,
  StatutoryKind,
} from '../../types/payroll';
import {
  daysInMonth,
  esiContribution,
  fyStartOfMonth,
  incomeTax,
  lastDayOfMonth,
  monthsToFyEnd,
  pfContribution,
  professionalTax,
  salaryIncome,
} from './statutory';

/* ── Defaults ─────────────────────────────────────────────────── */

export const STATUTORY_NAMES: Record<StatutoryKind, string> = {
  pf: 'PF (employee)',
  esi: 'ESI (employee)',
  pt: 'Professional tax',
  tds: 'TDS on salary (192)',
  pf_er: 'PF (employer: EPF + EPS)',
  esi_er: 'ESI (employer)',
  pf_admin: 'PF admin & EDLI charges',
};

/** Default debit / credit account of a head when it names none. */
export function defaultAccount(h: Pick<PayHead, 'kind' | 'statutory'>): string {
  if (h.statutory === 'pf_er') return A.pfEmployer;
  if (h.statutory === 'esi_er') return A.esiEmployer;
  if (h.statutory === 'pf_admin') return A.pfAdmin;
  if (h.statutory) return STATUTORY_PAYABLE[h.statutory];
  if (h.kind === 'earning') return A.salaries;
  if (h.kind === 'deduction') return A.otherCl;
  return A.provisions;
}

const head = (id: string, name: string, kind: PayHead['kind'], calc: PayHead['calc'], order: number, extra: Partial<PayHead> = {}): PayHead => ({
  id,
  name,
  kind,
  calc,
  order,
  active: true,
  created_at: '',
  ...extra,
});

/** Tally-style starter pay heads (stored with these ids the first time any head is saved). */
export const DEFAULT_PAY_HEADS: readonly PayHead[] = [
  head('ph_basic', 'Basic', 'earning', 'attendance', 1, { pf_wage: true, account_id: A.salaries }),
  head('ph_da', 'Dearness allowance (DA)', 'earning', 'attendance', 2, { pf_wage: true, account_id: A.salaries }),
  head('ph_hra', 'House rent allowance (HRA)', 'earning', 'attendance', 3, { account_id: A.allowances }),
  head('ph_conv', 'Conveyance allowance', 'earning', 'attendance', 4, { account_id: A.allowances }),
  head('ph_special', 'Special allowance', 'earning', 'attendance', 5, { account_id: A.allowances }),
  head('ph_ot', 'Overtime', 'earning', 'production', 6, { unit_type: 'ot_hours', account_id: A.allowances }),
  head('ph_bonus', 'Bonus', 'earning', 'user', 7, { esi_wage: false, account_id: A.bonus }),
  head('ph_pf', STATUTORY_NAMES.pf, 'deduction', 'computed', 20, { statutory: 'pf' }),
  head('ph_esi', STATUTORY_NAMES.esi, 'deduction', 'computed', 21, { statutory: 'esi' }),
  head('ph_pt', STATUTORY_NAMES.pt, 'deduction', 'computed', 22, { statutory: 'pt' }),
  head('ph_tds', STATUTORY_NAMES.tds, 'deduction', 'computed', 23, { statutory: 'tds' }),
  head('ph_loan', 'Loan / advance recovery', 'deduction', 'user', 24, { account_id: A.staffAdvances }),
  head('ph_other_ded', 'Other deduction', 'deduction', 'user', 25, { account_id: A.otherCl }),
  head('ph_pf_er', STATUTORY_NAMES.pf_er, 'employer', 'computed', 40, { statutory: 'pf_er' }),
  head('ph_esi_er', STATUTORY_NAMES.esi_er, 'employer', 'computed', 41, { statutory: 'esi_er' }),
  head('ph_pf_admin', STATUTORY_NAMES.pf_admin, 'employer', 'computed', 42, { statutory: 'pf_admin' }),
];

/* ── Structure resolution ─────────────────────────────────────── */

/** The structure in force for `employee` on the month's last day: own structure first, then the group's. */
export function structureFor(employee: Employee, month: string, structures: readonly SalaryStructure[]): SalaryStructure | null {
  const end = lastDayOfMonth(month);
  const pick = (list: SalaryStructure[]) => list.filter((s) => s.effective_from <= end).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
  return pick(structures.filter((s) => s.employee_id === employee.id)) ?? (employee.group_id ? pick(structures.filter((s) => s.group_id === employee.group_id)) : null);
}

/** Days in `month` the employee was on the rolls (DOJ / DOL inclusive). */
export function daysEmployed(employee: Pick<Employee, 'doj' | 'dol'>, month: string): number {
  const first = `${month}-01`;
  const last = lastDayOfMonth(month);
  const from = employee.doj && employee.doj > first ? employee.doj : first;
  const to = employee.dol && employee.dol < last ? employee.dol : last;
  if (from > to) return 0;
  return Number(to.slice(8, 10)) - Number(from.slice(8, 10)) + 1;
}

/* ── Computation ──────────────────────────────────────────────── */

export interface HistoryEntry {
  month: string;
  line: PayslipLine;
}

export interface ComputeInput {
  month: string;
  employee: Employee;
  structure: SalaryStructure | null;
  heads: readonly PayHead[];
  attendance?: AttendanceRow | null;
  /** This employee's FINAL payslips earlier in the same FY (TDS / PT / ESI continuity). */
  history?: readonly HistoryEntry[];
  overrides?: Record<string, number>;
}

export class PayrollComputeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayrollComputeError';
  }
}

interface Ctx {
  payable: number;
  days: number;
  units: Record<string, number>;
  /** Full-month rate: no LOP, no production units. */
  full: boolean;
}

/** Earnings and non-statutory deductions/employer heads in dependency order (percent / computed after their base). */
export function orderHeads(heads: readonly PayHead[]): PayHead[] {
  const byId = new Map(heads.map((h) => [h.id, h]));
  const out: PayHead[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (h: PayHead, path: string[]) => {
    const s = state.get(h.id);
    if (s === 2) return;
    if (s === 1) throw new PayrollComputeError(`Pay heads refer to each other in a loop: ${[...path, h.name].join(' → ')}.`);
    state.set(h.id, 1);
    if (h.calc === 'percent' || h.calc === 'computed') for (const b of h.base_heads ?? []) {
      const dep = byId.get(b);
      if (dep) visit(dep, [...path, h.name]);
    }
    state.set(h.id, 2);
    out.push(h);
  };
  for (const h of [...heads].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))) visit(h, []);
  return out;
}

function headValue(h: PayHead, amount: number, values: Map<string, number>, c: Ctx): number {
  const base = () => round2((h.base_heads ?? []).reduce((s, id) => s + (values.get(id) ?? 0), 0));
  switch (h.calc) {
    case 'flat':
    case 'user':
      return round2(amount);
    case 'attendance':
      return c.days > 0 ? round2((amount * c.payable) / c.days) : 0;
    case 'production':
      return c.full ? 0 : round2(amount * (c.units[h.unit_type ?? ''] ?? 0));
    case 'percent':
      return round2((base() * (h.percent ?? 0)) / 100);
    case 'computed': {
      const b = base();
      const slab = (h.slabs ?? []).find((s) => s.up_to === null || b <= s.up_to);
      if (!slab) return 0;
      return round2(slab.percent ? (b * slab.value) / 100 : slab.value);
    }
  }
}

function evaluate(heads: PayHead[], amounts: Map<string, number>, c: Ctx, overrides: Record<string, number>): Map<string, number> {
  const values = new Map<string, number>();
  for (const h of heads) {
    const ov = c.full ? undefined : overrides[h.id];
    values.set(h.id, ov !== undefined ? round2(ov) : headValue(h, amounts.get(h.id) ?? 0, values, c));
  }
  return values;
}

const sumIf = (lines: readonly { amount: number }[]) => round2(lines.reduce((s, l) => s + l.amount, 0));

/**
 * One employee's payslip for `month`, or null when the employee was not on the rolls that month.
 * Throws PayrollComputeError when there is no structure or the heads loop.
 */
export function computePayslip(input: ComputeInput): PayslipLine | null {
  const { month, employee: e } = input;
  const days = daysInMonth(month);
  const employed = daysEmployed(e, month);
  if (employed <= 0) return null;
  if (!input.structure) throw new PayrollComputeError(`${e.name} (${e.code}) has no salary structure for ${month}.`);
  const warnings: string[] = [];
  const overrides = input.overrides ?? {};
  const lop = Math.min(employed, Math.max(0, round2(input.attendance?.lop ?? 0)));
  const payable = round2(employed - lop);
  const units = { ...(input.attendance?.units ?? {}) };
  const history = input.history ?? [];
  const date = lastDayOfMonth(month);

  const active = input.heads.filter((h) => h.active !== false);
  const amounts = new Map(input.structure.lines.map((l) => [l.pay_head_id, l.amount]));
  // Non-statutory heads apply when they are in the structure (percent / computed heads too: their amount is ignored).
  const inStructure = active.filter((h) => !h.statutory && amounts.has(h.id));
  const ordered = orderHeads(inStructure);

  const ctx: Ctx = { payable, days, units, full: false };
  const values = evaluate(ordered, amounts, ctx, overrides);
  const rate = evaluate(ordered, amounts, { payable: days, days, units: {}, full: true }, {});

  const amt = (h: PayHead, amount: number): PayslipAmount => ({
    pay_head_id: h.id,
    name: h.name,
    amount: round2(amount),
    account_id: h.account_id || defaultAccount(h),
    ...(h.statutory ? { statutory: h.statutory } : {}),
  });
  const earnHeads = ordered.filter((h) => h.kind === 'earning');
  const earnings = earnHeads.map((h) => amt(h, values.get(h.id) ?? 0)).filter((x) => x.amount !== 0);
  const gross = sumIf(earnings);
  const taxable_gross = round2(earnHeads.filter((h) => h.taxable !== false).reduce((s, h) => s + (values.get(h.id) ?? 0), 0));
  const pfWages = round2(earnHeads.filter((h) => h.pf_wage).reduce((s, h) => s + (values.get(h.id) ?? 0), 0));
  const esiWages = round2(earnHeads.filter((h) => h.esi_wage !== false).reduce((s, h) => s + (values.get(h.id) ?? 0), 0));
  const esiRateWages = round2(earnHeads.filter((h) => h.esi_wage !== false && h.calc !== 'production').reduce((s, h) => s + (rate.get(h.id) ?? 0), 0));
  const rateGross = round2(earnHeads.reduce((s, h) => s + (rate.get(h.id) ?? 0), 0));
  const rateTaxable = round2(earnHeads.filter((h) => h.taxable !== false).reduce((s, h) => s + (rate.get(h.id) ?? 0), 0));

  const stat = (k: StatutoryKind) => active.find((h) => h.statutory === k);
  const pick = (k: StatutoryKind, computed: number) => {
    const h = stat(k);
    if (!h) return 0;
    return overrides[h.id] !== undefined ? round2(overrides[h.id]) : computed;
  };

  // PF
  const pfOn = e.pf && !!stat('pf');
  const pf = pfContribution(pfOn ? pfWages : 0, date, { onActual: e.pf_on_actual, epsExcluded: e.eps_excluded });
  const pf_ee = pfOn ? pick('pf', pf.ee) : 0;
  const pfErOn = pfOn && !!stat('pf_er');
  const pfEr = pfErOn ? pick('pf_er', pf.eps + pf.epf_er) : 0;
  const eps = pfErOn ? Math.min(pf.eps, pfEr) : 0;
  const epf_er = round2(pfEr - eps);
  const adminOn = pfOn && !!stat('pf_admin');
  const pf_admin_total = adminOn ? pick('pf_admin', pf.edli + pf.admin) : 0;

  // ESI (coverage continues for the contribution period once it applied)
  const period = esiPeriodStart(month);
  const coveredBefore = history.some((h) => h.month >= period && h.month < month && h.line.esi_covered);
  const esiOn = e.esi && !!stat('esi');
  const esi = esiOn ? esiContribution(esiWages, esiRateWages, date, coveredBefore) : { covered: false, ee: 0, er: 0 };
  const esi_ee = esiOn ? pick('esi', esi.ee) : 0;
  const esi_er = esiOn && stat('esi_er') ? pick('esi_er', esi.er) : 0;

  // PT
  const ptBefore = round2(history.reduce((s, h) => s + h.line.pt, 0));
  const ptOn = e.pt && !!stat('pt');
  const pt = ptOn ? pick('pt', professionalTax(e.state, gross, month, { gender: e.gender, paidBefore: ptBefore })) : 0;

  // Non-statutory deductions / employer heads (after gross)
  const dedHeads = ordered.filter((h) => h.kind === 'deduction');
  const otherDeductions = dedHeads.map((h) => amt(h, values.get(h.id) ?? 0)).filter((x) => x.amount !== 0);

  // TDS u/s 192: annual projection
  let tds = 0;
  let tds_working: PayslipLine['tds_working'];
  const tdsHead = stat('tds');
  if (tdsHead) {
    const fyStart = fyStartOfMonth(month);
    const rule = tdsSalaryRule(e.tax_regime === 'old' ? 'old' : 'new', fyStart);
    const remainingMonths = monthsToFyEnd(month).filter((m) => !e.dol || `${m}-01` <= e.dol);
    const later = remainingMonths.slice(1);
    const ytdTaxable = round2(history.reduce((s, h) => s + h.line.taxable_gross, 0));
    const ytdTds = round2(history.reduce((s, h) => s + h.line.tds, 0));
    let projPt = 0;
    let paid = ptBefore + pt;
    for (const m of later) {
      const p = ptOn ? professionalTax(e.state, rateGross, m, { gender: e.gender, paidBefore: paid }) : 0;
      projPt += p;
      paid += p;
    }
    const annualGross = round2((e.prev_salary ?? 0) + ytdTaxable + taxable_gross + rateTaxable * later.length);
    const inc = salaryIncome(
      { gross: annualGross, pt: ptBefore + pt + projPt, hra_exemption: e.hra_exemption, deductions: e.tax_deductions, other_income: e.other_income },
      rule,
    );
    const tax = incomeTax(inc.total_income, rule);
    const due = Math.max(0, round2(tax.total - ytdTds - (e.prev_tds ?? 0)));
    const computed = remainingMonths.length <= 1 ? Math.round(due) : Math.round(due / remainingMonths.length);
    tds = overrides[tdsHead.id] !== undefined ? round2(overrides[tdsHead.id]) : computed;
    tds_working = { annual_income: inc.total_income, annual_tax: tax.total, deducted_before: round2(ytdTds + (e.prev_tds ?? 0)), months_left: remainingMonths.length };
  }

  const statDed: [StatutoryKind, number][] = [['pf', pf_ee], ['esi', esi_ee], ['pt', pt], ['tds', tds]];
  const deductions = [
    ...statDed.filter(([, v]) => v !== 0).map(([k, v]) => amt(stat(k)!, v)),
    ...otherDeductions,
  ];
  const empHeads = ordered.filter((h) => h.kind === 'employer');
  const employer = [
    ...([['pf_er', pfEr], ['esi_er', esi_er], ['pf_admin', pf_admin_total]] as [StatutoryKind, number][])
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => amt(stat(k)!, v)),
    ...empHeads.map((h) => amt(h, values.get(h.id) ?? 0)).filter((x) => x.amount !== 0),
  ];
  const total_deductions = sumIf(deductions);
  const net = round2(gross - total_deductions);
  if (net < 0) warnings.push(`${e.name}: deductions exceed earnings (net ${net.toFixed(2)}).`);
  if (pfOn && !e.uan) warnings.push(`${e.name}: no UAN for the PF return.`);
  if (esiOn && esi.covered && !e.esi_no) warnings.push(`${e.name}: covered by ESI but has no IP number.`);
  if (ptOn && e.state && !['27', '29', '19', '33', '24', '37', '36'].includes(e.state)) warnings.push(`${e.name}: no Professional Tax slabs for this state; enter PT by hand.`);
  if (tdsHead && !e.pan && tds > 0) warnings.push(`${e.name}: no PAN — TDS at 20% may apply (s. 206AA).`);

  return {
    employee_id: e.id,
    code: e.code,
    name: e.name,
    ...(e.designation ? { designation: e.designation } : {}),
    ...(e.cost_centre_id ? { cost_centre_id: e.cost_centre_id } : {}),
    ...(e.pan ? { pan: e.pan } : {}),
    ...(e.uan ? { uan: e.uan } : {}),
    ...(e.esi_no ? { esi_no: e.esi_no } : {}),
    ...(e.state ? { state: e.state } : {}),
    ...(e.bank_name ? { bank_name: e.bank_name } : {}),
    ...(e.bank_account ? { bank_account: e.bank_account } : {}),
    ...(e.bank_ifsc ? { bank_ifsc: e.bank_ifsc } : {}),
    ...(e.doj ? { doj: e.doj } : {}),
    ...(e.dol ? { dol: e.dol } : {}),
    tax_regime: e.tax_regime === 'old' ? 'old' : 'new',
    days_in_month: days,
    days_employed: employed,
    lop,
    payable_days: payable,
    units,
    earnings,
    deductions,
    employer,
    gross,
    total_deductions,
    net,
    taxable_gross,
    pf_wages: pfOn ? pf.epf_wages : 0,
    eps_wages: pfErOn ? pf.eps_wages : 0,
    edli_wages: pfOn ? pf.edli_wages : 0,
    pf_ee,
    eps,
    epf_er,
    edli: adminOn ? Math.min(pf.edli, pf_admin_total) : 0,
    pf_admin: adminOn ? round2(pf_admin_total - Math.min(pf.edli, pf_admin_total)) : 0,
    esi_wages: esiOn && esi.covered ? esiWages : 0,
    esi_covered: esiOn && esi.covered,
    esi_ee,
    esi_er,
    pt,
    tds,
    ...(tds_working ? { tds_working } : {}),
    ...(Object.keys(overrides).length ? { overrides: { ...overrides } } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}

/**
 * EPF administration charges carry a monthly minimum per establishment: when the run's total is
 * below it, the shortfall is added to the first PF member's admin charge (and the employer head).
 */
export function applyPfAdminMinimum(lines: PayslipLine[], month: string): PayslipLine[] {
  const members = lines.filter((l) => l.pf_wages > 0 && l.employer.some((x) => x.statutory === 'pf_admin'));
  if (!members.length) return lines;
  const min = pfRule(lastDayOfMonth(month)).admin_min;
  const total = round2(members.reduce((s, l) => s + l.pf_admin, 0));
  if (total >= min) return lines;
  const top = round2(min - total);
  const first = members[0];
  return lines.map((l) =>
    l !== first
      ? l
      : {
          ...l,
          pf_admin: round2(l.pf_admin + top),
          employer: l.employer.map((x) => (x.statutory === 'pf_admin' ? { ...x, amount: round2(x.amount + top) } : x)),
        },
  );
}

/** ESI ceiling for a month, for screens that explain coverage. */
export function esiCeiling(month: string): number {
  return esiRule(lastDayOfMonth(month)).wage_ceiling;
}
