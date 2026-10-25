/**
 * Payroll computation (Phase 7) — Tally's "Payroll Auto Fill": for a month, every employee's
 * earnings, deductions and employer contributions from their salary structure + attendance, plus
 * the statutory heads (PF, ESI, PT, TDS u/s 192). Pure: callers pass every input.
 * Working papers — verify with your CA.
 */

import { A } from '../ledger/accounts';
import { STATUTORY_PAYABLE } from './postings';
import { round2 } from '../invoice-calc';
import { EPS_EXIT_AGE, ageBand, ccd2Pct, esiLowWageLimit, esiPeriodStart, esiRule, noPanRate, pfRule, s17viiLimit, tdsSalaryRuleFor } from '../payroll-rules';
import type {
  ArrearsRecord,
  ArrearsSummary,
  AttendanceRow,
  Employee,
  PayHead,
  PayslipAmount,
  PayslipLine,
  PayslipTag,
  PayrollRun,
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
  noPanTax,
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

/** Final payslips of `employeeId` earlier in the FY of `month`. */
export function historyFor(employeeId: string, month: string, runs: readonly PayrollRun[]): HistoryEntry[] {
  const fy = fyStartOfMonth(month).slice(0, 7);
  return runs
    .filter((r) => r.status === 'final' && r.month >= fy && r.month < month)
    .sort((a, b) => a.month.localeCompare(b.month))
    .flatMap((r) => r.lines.filter((l) => l.employee_id === employeeId).map((line) => ({ month: r.month, line })));
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
  /** Additive (7P): arrears, loan EMIs, leave encashment, reimbursements, F&F items, perquisites. */
  extras?: PayslipExtras;
  /**
   * Additive (7P): ESI coverage decided for the whole contribution period (by the wages in its first
   * month, or the month of joining). Undefined = decide on this month (the period's first month).
   */
  esiPeriodCovered?: boolean;
  /**
   * Additive (7T): add arrears and one-off salary items (bonus, leave encashment, other earnings)
   * to the month's gross for the Professional Tax slab — the state's rule, chosen in Reports.
   */
  ptOnExtras?: boolean;
}

/** One-off item tags counted as salary for PT when `ptOnExtras` is on (reimbursements, gratuity and notice pay are not). */
export const PT_EXTRA_TAGS: readonly PayslipTag[] = ['arrear', 'bonus', 'leave', 'adjust'];

/** Additive (7P): a one-off payslip item (`key` is its pay-head id on the payslip, unique per line). */
export interface ExtraItem {
  key: string;
  name: string;
  kind: 'earning' | 'deduction';
  amount: number;
  account_id: string;
  tag: PayslipTag;
  ref_id?: string;
  /** Earnings: taxable part u/s 17 (default: the whole amount). */
  taxable?: number;
  /** Loan EMI: interest part. */
  interest?: number;
}

export interface PayslipExtras {
  arrears?: readonly ArrearsRecord[];
  items?: readonly ExtraItem[];
  /** Taxable value of perquisites this month (s. 17(2)). */
  perquisites?: number;
  /** Perquisite value expected in each later month of the FY (TDS projection). */
  perquisitesLater?: number;
  /** A full & final settlement is paid in this payslip. */
  fnfId?: string;
  /** Additive (7T): relief u/s 89(1) allowed in the year's TDS (Form 10E furnished, s. 192(2A)). */
  relief89?: number;
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
 * Full-month rates of a structure for `month` (no LOP, no production): every head's value plus the
 * totals the statutory engines need. Used for ESI period coverage, gratuity / leave rates and F&F.
 */
export function structureRates(structure: SalaryStructure | null, heads: readonly PayHead[], month: string): { values: Map<string, number>; gross: number; pfWages: number; esiRateWages: number } {
  if (!structure) return { values: new Map(), gross: 0, pfWages: 0, esiRateWages: 0 };
  const active = heads.filter((h) => h.active !== false);
  const amounts = new Map(structure.lines.map((l) => [l.pay_head_id, l.amount]));
  const ordered = orderHeads(active.filter((h) => !h.statutory && amounts.has(h.id)));
  const days = daysInMonth(month);
  const values = evaluate(ordered, amounts, { payable: days, days, units: {}, full: true }, {});
  const earn = ordered.filter((h) => h.kind === 'earning');
  const sum = (f: (h: PayHead) => boolean) => round2(earn.filter(f).reduce((s, h) => s + (values.get(h.id) ?? 0), 0));
  return { values, gross: sum(() => true), pfWages: sum((h) => !!h.pf_wage), esiRateWages: sum((h) => h.esi_wage !== false && h.calc !== 'production') };
}

/** Last month (`YYYY-MM`) the employee is an EPS member: the month they attain 58 (the day before the 58th birthday). */
export function epsLastMonth(dob: string | undefined): string | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split('-').map(Number);
  const attain = new Date(y + EPS_EXIT_AGE, m - 1, d - 1);
  return `${attain.getFullYear()}-${String(attain.getMonth() + 1).padStart(2, '0')}`;
}

/** Arrears records → payslip items (per pay head) + statutory totals. */
export function arrearsItems(records: readonly ArrearsRecord[], heads: readonly PayHead[]): { earnings: ExtraItem[]; summary: ArrearsSummary | null } {
  if (!records.length) return { earnings: [], summary: null };
  const byHead = new Map<string, ExtraItem>();
  const s: ArrearsSummary = { ids: [], from: '', to: '', months: 0, gross: 0, taxable: 0, pf_ee: 0, eps: 0, epf_er: 0, edli: 0, pf_admin: 0, esi_ee: 0, esi_er: 0, earlier_fy: false };
  const months = new Set<string>();
  for (const r of records) {
    s.ids.push(r.id);
    const fy = fyStartOfMonth(r.pay_month).slice(0, 7);
    for (const m of r.months) {
      months.add(m.month);
      if (m.month < fy) s.earlier_fy = true;
      for (const e of m.earnings) {
        const key = `arr:${e.pay_head_id}`;
        const cur = byHead.get(key) ?? { key, name: `${heads.find((h) => h.id === e.pay_head_id)?.name ?? e.name} (arrears)`, kind: 'earning' as const, amount: 0, account_id: e.account_id, tag: 'arrear' as const, ref_id: r.id, taxable: 0 };
        cur.amount = round2(cur.amount + e.amount);
        cur.taxable = round2((cur.taxable ?? 0) + (e.taxable ? e.amount : 0));
        byHead.set(key, cur);
      }
      s.gross += m.gross;
      s.taxable += m.taxable;
      s.pf_ee += m.pf_ee;
      s.eps += m.eps;
      s.epf_er += m.epf_er;
      s.edli += m.edli;
      s.pf_admin += m.pf_admin;
      s.esi_ee += m.esi_ee;
      s.esi_er += m.esi_er;
    }
  }
  const sorted = [...months].sort();
  s.from = sorted[0] ?? '';
  s.to = sorted[sorted.length - 1] ?? '';
  s.months = sorted.length;
  for (const k of ['gross', 'taxable', 'pf_ee', 'eps', 'epf_er', 'edli', 'pf_admin', 'esi_ee', 'esi_er'] as const) s[k] = round2(s[k]);
  return { earnings: [...byHead.values()].filter((x) => x.amount !== 0), summary: s };
}

/**
 * One employee's payslip for `month`, or null when the employee was not on the rolls that month
 * (and nothing else — arrears, F&F — is paid to them in it).
 * Throws PayrollComputeError when there is no structure or the heads loop.
 */
export function computePayslip(input: ComputeInput): PayslipLine | null {
  const { month, employee: e } = input;
  const extras = input.extras ?? {};
  const days = daysInMonth(month);
  const employed = daysEmployed(e, month);
  const hasExtras = !!(extras.items?.length || extras.arrears?.length || extras.fnfId);
  if (employed <= 0 && !hasExtras) return null;
  if (employed > 0 && !input.structure) throw new PayrollComputeError(`${e.name} (${e.code}) has no salary structure for ${month}.`);
  const warnings: string[] = [];
  const notes: string[] = [];
  const overrides = input.overrides ?? {};
  const lop = Math.min(employed, Math.max(0, round2(input.attendance?.lop ?? 0)));
  const payable = round2(employed - lop);
  const units = { ...(input.attendance?.units ?? {}) };
  const history = input.history ?? [];
  const date = lastDayOfMonth(month);
  const onRolls = employed > 0;

  const active = input.heads.filter((h) => h.active !== false);
  const amounts = new Map((onRolls ? input.structure?.lines ?? [] : []).map((l) => [l.pay_head_id, l.amount]));
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
  const regularEarnings = earnHeads.map((h) => amt(h, values.get(h.id) ?? 0)).filter((x) => x.amount !== 0);
  const regularGross = sumIf(regularEarnings);
  const regularTaxable = round2(earnHeads.filter((h) => h.taxable !== false).reduce((s, h) => s + (values.get(h.id) ?? 0), 0));
  const pfWages = round2(earnHeads.filter((h) => h.pf_wage).reduce((s, h) => s + (values.get(h.id) ?? 0), 0));
  const esiWages = round2(earnHeads.filter((h) => h.esi_wage !== false).reduce((s, h) => s + (values.get(h.id) ?? 0), 0));
  const esiRateWages = round2(earnHeads.filter((h) => h.esi_wage !== false && h.calc !== 'production').reduce((s, h) => s + (rate.get(h.id) ?? 0), 0));
  const rateGross = round2(earnHeads.reduce((s, h) => s + (rate.get(h.id) ?? 0), 0));
  const rateTaxable = round2(earnHeads.filter((h) => h.taxable !== false).reduce((s, h) => s + (rate.get(h.id) ?? 0), 0));
  const ratePfWages = round2(earnHeads.filter((h) => h.pf_wage).reduce((s, h) => s + (rate.get(h.id) ?? 0), 0));

  const stat = (k: StatutoryKind) => active.find((h) => h.statutory === k);
  const pick = (k: StatutoryKind, computed: number) => {
    const h = stat(k);
    if (!h) return 0;
    return overrides[h.id] !== undefined ? round2(overrides[h.id]) : computed;
  };
  const ov = (key: string, computed: number) => (overrides[key] !== undefined ? round2(overrides[key]) : round2(computed));

  // PF (EPS stops after the month the employee attains 58)
  const epsEnd = epsLastMonth(e.dob);
  const epsOver = !!epsEnd && month > epsEnd;
  if (epsOver && e.pf && !e.eps_excluded && pfWages > 0) notes.push(`EPS stopped after ${epsEnd} (age ${EPS_EXIT_AGE}); the whole employer share goes to EPF.`);
  const pfOn = onRolls && e.pf && !!stat('pf');
  const pf = pfContribution(pfOn ? pfWages : 0, date, { onActual: e.pf_on_actual, epsExcluded: e.eps_excluded || epsOver });
  const pf_ee = pfOn ? pick('pf', pf.ee) : 0;
  const pfErOn = pfOn && !!stat('pf_er');
  const pfEr = pfErOn ? pick('pf_er', pf.eps + pf.epf_er) : 0;
  const eps = pfErOn ? Math.min(pf.eps, pfEr) : 0;
  const epf_er = round2(pfEr - eps);
  const adminOn = pfOn && !!stat('pf_admin');
  const pf_admin_total = adminOn ? pick('pf_admin', pf.edli + pf.admin) : 0;

  // ESI: coverage is decided for the contribution period (its first month, or the month of joining)
  // and continues to the period's end once it applied.
  const period = esiPeriodStart(month);
  const coveredBefore = history.some((h) => h.month >= period && h.month < month && h.line.esi_covered);
  const esiOn = onRolls && e.esi && !!stat('esi');
  const decidedRate = input.esiPeriodCovered === undefined ? esiRateWages : input.esiPeriodCovered ? 0 : Number.MAX_SAFE_INTEGER;
  const esi = esiOn ? esiContribution(esiWages, decidedRate, date, coveredBefore) : { covered: false, ee: 0, er: 0 };
  // 7T: no employee share when the average daily wage is within the low-wage limit (employer still pays).
  const lowWage = esiOn && esi.covered && esi.ee > 0 && payable > 0 && esiWages / payable <= esiLowWageLimit(date);
  if (lowWage) notes.push(`ESI: average daily wage ₹${round2(esiWages / payable)} is within ₹${esiLowWageLimit(date)} — no employee share; the employer pays its share.`);
  const esi_ee = esiOn ? pick('esi', lowWage ? 0 : esi.ee) : 0;
  const esi_er = esiOn && stat('esi_er') ? pick('esi_er', esi.er) : 0;

  // One-off items: arrears, leave encashment, gratuity, notice pay, reimbursements, bonus, loan EMIs.
  const arr = arrearsItems(extras.arrears ?? [], input.heads);
  const extraItems = [...arr.earnings, ...(extras.items ?? [])];
  const extraAmt = (x: ExtraItem): PayslipAmount => {
    const amount = ov(x.key, x.amount);
    const scale = x.amount ? amount / x.amount : 1;
    return {
      pay_head_id: x.key,
      name: x.name,
      amount,
      account_id: x.account_id,
      tag: x.tag,
      ...(x.ref_id ? { ref_id: x.ref_id } : {}),
      ...(x.kind === 'earning' && x.taxable !== undefined && Math.abs((x.taxable ?? 0) - x.amount) > 0.004 ? { taxable: round2(Math.min(amount, (x.taxable ?? 0) * scale)) } : {}),
      ...(x.interest ? { interest: round2(Math.min(Math.max(amount, 0), x.interest)) } : {}),
    };
  };
  const extraEarnings = extraItems.filter((x) => x.kind === 'earning').map(extraAmt).filter((x) => x.amount !== 0);
  const extraDeductions = extraItems.filter((x) => x.kind === 'deduction').map(extraAmt).filter((x) => x.amount !== 0);
  const extraTaxable = round2(extraEarnings.reduce((s, x) => s + (x.taxable ?? x.amount), 0));
  const earnings = [...regularEarnings, ...extraEarnings];
  const gross = sumIf(earnings);

  // PT on the month's regular gross; arrears / one-off salary items only when the state's rule is
  // chosen (7T option `ptOnExtras`) — verify with your CA.
  const ptBefore = round2(history.reduce((s, h) => s + h.line.pt, 0));
  const ptOn = onRolls && e.pt && !!stat('pt');
  const ptExtra = input.ptOnExtras ? round2(extraEarnings.filter((x) => x.tag && PT_EXTRA_TAGS.includes(x.tag)).reduce((s, x) => s + x.amount, 0)) : 0;
  if (ptOn && ptExtra) notes.push(`Professional tax worked on gross incl. arrears / one-off items ₹${round2(regularGross + ptExtra)} (state rule chosen).`);
  const pt = ptOn ? pick('pt', professionalTax(e.state, round2(regularGross + ptExtra), month, { gender: e.gender, paidBefore: ptBefore })) : 0;

  // Statutory contributions on arrears (worked per month when the arrears were computed).
  const pfHead = stat('pf');
  const arrPf: PayslipAmount[] = [];
  const arrEmployer: PayslipAmount[] = [];
  if (arr.summary) {
    const s = arr.summary;
    const pushIf = (list: PayslipAmount[], key: string, name: string, k: StatutoryKind | undefined, amount: number, account: string) => {
      const a = ov(key, amount);
      if (a) list.push({ pay_head_id: key, name, amount: a, account_id: account, tag: 'arrear', ...(k ? { statutory: k } : {}) });
    };
    if (pfHead) pushIf(arrPf, 'arr:pf', 'PF on arrears (employee)', 'pf', s.pf_ee, STATUTORY_PAYABLE.pf);
    if (stat('esi')) pushIf(arrPf, 'arr:esi', 'ESI on arrears (employee)', 'esi', s.esi_ee, STATUTORY_PAYABLE.esi);
    if (stat('pf_er')) pushIf(arrEmployer, 'arr:pf_er', 'PF on arrears (employer)', 'pf_er', round2(s.eps + s.epf_er), A.pfEmployer);
    if (stat('pf_admin')) pushIf(arrEmployer, 'arr:pf_admin', 'PF admin & EDLI on arrears', 'pf_admin', round2(s.edli + s.pf_admin), A.pfAdmin);
    if (stat('esi_er')) pushIf(arrEmployer, 'arr:esi_er', 'ESI on arrears (employer)', 'esi_er', s.esi_er, A.esiEmployer);
    if (s.earlier_fy) notes.push('Arrears include salary of an earlier financial year: relief u/s 89 (Form 10E) may be available to the employee — verify with your CA.');
  }

  // Non-statutory deductions / employer heads (after gross)
  const dedHeads = ordered.filter((h) => h.kind === 'deduction');
  const otherDeductions = dedHeads.map((h) => amt(h, values.get(h.id) ?? 0)).filter((x) => x.amount !== 0);
  const empHeads = ordered.filter((h) => h.kind === 'employer');
  const npsHeads = empHeads.filter((h) => h.nps);
  const nps_er = round2(npsHeads.reduce((s, h) => s + (values.get(h.id) ?? 0), 0));
  const npsRate = round2(npsHeads.reduce((s, h) => s + (rate.get(h.id) ?? 0), 0));
  const superHeads = empHeads.filter((h) => h.superannuation);
  const super_er = round2(superHeads.reduce((s, h) => s + (values.get(h.id) ?? 0), 0));
  const superRate = round2(superHeads.reduce((s, h) => s + (rate.get(h.id) ?? 0), 0));
  const perqs = round2(Math.max(0, extras.perquisites ?? 0));
  const taxable_gross = round2(regularTaxable + extraTaxable + perqs + nps_er);

  // TDS u/s 192: annual projection
  let tds = 0;
  let tds_working: PayslipLine['tds_working'];
  let age: PayslipLine['age_band'];
  const tdsHead = stat('tds');
  if (tdsHead) {
    const fyStart = fyStartOfMonth(month);
    const regime = e.tax_regime === 'old' ? 'old' : 'new';
    const band = regime === 'old' ? ageBand(e.dob, fyStart) : 'normal';
    if (band !== 'normal') age = band;
    const rule = tdsSalaryRuleFor(regime, fyStart, e.dob);
    const remainingMonths = monthsToFyEnd(month).filter((m) => !e.dol || `${m}-01` <= e.dol);
    const later = extras.fnfId ? [] : remainingMonths.slice(1);
    const ytdTaxable = round2(history.reduce((s, h) => s + h.line.taxable_gross, 0));
    const ytdTds = round2(history.reduce((s, h) => s + h.line.tds, 0));
    const ytdNps = round2(history.reduce((s, h) => s + (h.line.nps_er ?? 0), 0));
    const ytdPfWages = round2(history.reduce((s, h) => s + h.line.pf_wages, 0));
    let projPt = 0;
    let paid = ptBefore + pt;
    for (const m of later) {
      const p = ptOn ? professionalTax(e.state, rateGross, m, { gender: e.gender, paidBefore: paid }) : 0;
      projPt += p;
      paid += p;
    }
    const laterPerq = round2(Math.max(0, extras.perquisitesLater ?? 0));
    // 7T s. 17(2)(vii): employer PF (EPF + EPS) + NPS + superannuation for the year above the limit
    // is a perquisite (projected; not part of the month's taxable_gross, so never counted twice).
    const contribLimit = s17viiLimit(fyStart);
    const ytdContrib = round2(history.reduce((s, h) => s + h.line.eps + h.line.epf_er + (h.line.nps_er ?? 0) + (h.line.super_er ?? 0), 0));
    const pfAtRate = pfErOn && later.length ? pfContribution(ratePfWages, date, { onActual: e.pf_on_actual, epsExcluded: e.eps_excluded || epsOver }) : null;
    const erContribYear = round2(ytdContrib + pfEr + nps_er + super_er + ((pfAtRate ? pfAtRate.eps + pfAtRate.epf_er : 0) + npsRate + superRate) * later.length);
    const s17vii = contribLimit === null ? 0 : Math.max(0, round2(erContribYear - contribLimit));
    if (s17vii > 0) notes.push(`Employer PF + NPS + superannuation for the year ₹${erContribYear} exceeds ₹${contribLimit}: ₹${s17vii} taxed as a perquisite u/s 17(2)(vii) (accretion u/s 17(2)(viia) not computed).`);
    const annualGross = round2((e.prev_salary ?? 0) + ytdTaxable + taxable_gross + (rateTaxable + npsRate + laterPerq) * later.length + s17vii);
    const annualNps = round2(ytdNps + nps_er + npsRate * later.length);
    // 80CCD(2) cap on salary = Basic + DA (approximated by the PF-wage heads).
    const salaryForCap = round2(ytdPfWages + pfWages + ratePfWages * later.length);
    const inc = salaryIncome(
      {
        gross: annualGross,
        pt: ptBefore + pt + projPt,
        hra_exemption: e.hra_exemption,
        deductions: e.tax_deductions,
        other_income: e.other_income,
        nps_er: annualNps,
        nps_cap: round2((salaryForCap * ccd2Pct(regime, fyStart)) / 100),
      },
      rule,
    );
    const tax = incomeTax(inc.total_income, rule);
    const noPan = !e.pan;
    const taxBeforeRelief = noPan ? noPanTax(tax, noPanRate(fyStart)) : tax.total;
    if (noPan && taxBeforeRelief > tax.total) notes.push(`No PAN: TDS at ${noPanRate(fyStart)}% of income (s. 206AA) instead of the average rate.`);
    // 7T relief u/s 89(1) allowed by the employer (s. 192(2A), Form 10E furnished).
    const relief = Math.min(taxBeforeRelief, round2(Math.max(0, extras.relief89 ?? 0)));
    if (relief > 0) notes.push(`Relief u/s 89(1) of ₹${relief} allowed in the year's TDS (Form 10E working) — verify with your CA.`);
    const annualTax = round2(taxBeforeRelief - relief);
    const due = Math.max(0, round2(annualTax - ytdTds - (e.prev_tds ?? 0)));
    const computed = remainingMonths.length <= 1 || extras.fnfId ? Math.round(due) : Math.round(due / remainingMonths.length);
    tds = overrides[tdsHead.id] !== undefined ? round2(overrides[tdsHead.id]) : computed;
    tds_working = {
      annual_income: inc.total_income,
      annual_tax: annualTax,
      deducted_before: round2(ytdTds + (e.prev_tds ?? 0)),
      months_left: extras.fnfId ? 1 : remainingMonths.length,
      ...(relief > 0 ? { relief89: relief } : {}),
      ...(erContribYear > 0 ? { er_contrib_year: erContribYear } : {}),
      ...(s17vii > 0 ? { s17_vii: s17vii } : {}),
    };
  }

  const statDed: [StatutoryKind, number][] = [['pf', pf_ee], ['esi', esi_ee], ['pt', pt], ['tds', tds]];
  const deductions = [
    ...statDed.filter(([, v]) => v !== 0).map(([k, v]) => amt(stat(k)!, v)),
    ...arrPf,
    ...otherDeductions,
    ...extraDeductions,
  ];
  const employer = [
    ...([['pf_er', pfEr], ['esi_er', esi_er], ['pf_admin', pf_admin_total]] as [StatutoryKind, number][])
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => amt(stat(k)!, v)),
    ...arrEmployer,
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
    days_employed: Math.max(0, employed),
    lop,
    payable_days: Math.max(0, payable),
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
    ...(arr.summary ? { arrears: arr.summary } : {}),
    ...(perqs ? { perquisites: perqs } : {}),
    ...(nps_er ? { nps_er } : {}),
    ...(extras.fnfId ? { fnf_id: extras.fnfId } : {}),
    ...(age ? { age_band: age } : {}),
    ...(notes.length ? { notes } : {}),
    ...(super_er ? { super_er } : {}),
    ...(lowWage ? { esi_low_wage: true } : {}),
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
