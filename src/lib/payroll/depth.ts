/**
 * Payroll depth (7P) — pure engines: arrears of back-dated revisions, employee loans with EMI
 * schedules and the s. 17(2) loan perquisite, leave balances / encashment, gratuity (Payment of
 * Gratuity Act + s. 10(10)), bonus (Payment of Bonus Act), full & final settlement items,
 * reimbursements and perquisites, and the PF 7Q / 14B late-payment estimate.
 *
 * Everything here is pure (callers pass the data); `store.ts` / `depth-store.ts` read storage.
 * Statutory values come from `payroll-rules.ts` (date-keyed). Working papers — verify with your CA.
 */

import { round2 } from '../invoice-calc';
import { A } from '../ledger/accounts';
import { bonusRule, esiRule, gratuityRule, leaveEncashCap, loanPerqRule, pfLateRule } from '../payroll-rules';
import type {
  ArrearsMonth,
  ArrearsRecord,
  AttendanceRow,
  Employee,
  EmployeeLoan,
  FnfSettlement,
  LeaveEntry,
  LeaveType,
  PayHead,
  PayrollAdjustment,
  PayrollRun,
  PayslipLine,
  Perquisite,
  SalaryStructure,
  TaxRegime,
} from '../../types/payroll';
import { computePayslip, historyFor, structureFor, structureRates, type ExtraItem, type PayslipExtras } from './compute';
import { daysInMonth, fyStartOfMonth, lastDayOfMonth, rupeeUp } from './statutory';

/* ── Month helpers ────────────────────────────────────────────── */

export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}

/** Months from `from` to `to` inclusive (empty when `to < from`). */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 1200; m = addMonths(m, 1)) out.push(m);
  return out;
}

const finals = (runs: readonly PayrollRun[]) => runs.filter((r) => r.status === 'final');
const lineOf = (run: PayrollRun, employeeId: string): PayslipLine | undefined => run.lines.find((l) => l.employee_id === employeeId);

/* ── Arrears (back-dated revision) ────────────────────────────── */

export interface ArrearsComputeInput {
  employee: Employee;
  /** First month the revision applies to. */
  fromMonth: string;
  /** Month the arrears are paid in (months before it are recomputed). */
  payMonth: string;
  heads: readonly PayHead[];
  structures: readonly SalaryStructure[];
  attendance: readonly AttendanceRow[];
  runs: readonly PayrollRun[];
}

/**
 * Arrears per FINAL month in [fromMonth, payMonth): the payslip recomputed with today's structures
 * (same attendance, same grid overrides, same history) minus what was paid, per regular earning head.
 * PF follows the recomputed month (ceiling and EPS rules of that month); ESI is worked on the arrear
 * ESI wages at that month's rate when the employee was covered then (arrears never change coverage).
 * TDS is not split by month: the arrears are taxable in the year paid (relief u/s 89 noted).
 */
export function computeArrears(input: ArrearsComputeInput): ArrearsMonth[] {
  const { employee: e, heads } = input;
  const out: ArrearsMonth[] = [];
  const headOf = new Map(heads.map((h) => [h.id, h]));
  for (const run of finals(input.runs).filter((r) => r.month >= input.fromMonth && r.month < input.payMonth).sort((a, b) => a.month.localeCompare(b.month))) {
    const old = lineOf(run, e.id);
    if (!old || old.days_employed <= 0) continue;
    const m = run.month;
    let fresh: PayslipLine | null;
    try {
      fresh = computePayslip({
        month: m,
        employee: e,
        structure: structureFor(e, m, input.structures),
        heads,
        attendance: input.attendance.find((a) => a.employee_id === e.id && a.month === m) ?? null,
        history: historyFor(e.id, m, input.runs),
        overrides: old.overrides,
      });
    } catch {
      continue;
    }
    if (!fresh) continue;
    const regular = (l: PayslipLine) => new Map(l.earnings.filter((x) => !x.tag).map((x) => [x.pay_head_id, x]));
    const before = regular(old);
    const after = regular(fresh);
    const ids = [...new Set([...before.keys(), ...after.keys()])];
    const earnings: ArrearsMonth['earnings'] = [];
    let esiBase = 0;
    for (const id of ids) {
      const diff = round2((after.get(id)?.amount ?? 0) - (before.get(id)?.amount ?? 0));
      if (!diff) continue;
      const h = headOf.get(id);
      const x = after.get(id) ?? before.get(id)!;
      earnings.push({ pay_head_id: id, name: x.name, amount: diff, account_id: x.account_id, taxable: h?.taxable !== false });
      if (h?.esi_wage !== false) esiBase += diff;
    }
    if (!earnings.length) continue;
    const esiR = esiRule(lastDayOfMonth(m));
    const esiWages = old.esi_covered ? round2(esiBase) : 0;
    const gross = round2(earnings.reduce((s, x) => s + x.amount, 0));
    out.push({
      month: m,
      earnings,
      gross,
      taxable: round2(earnings.filter((x) => x.taxable).reduce((s, x) => s + x.amount, 0)),
      pf_wages: round2(fresh.pf_wages - old.pf_wages),
      pf_ee: round2(fresh.pf_ee - old.pf_ee),
      eps: round2(fresh.eps - old.eps),
      epf_er: round2(fresh.epf_er - old.epf_er),
      edli: round2(fresh.edli - old.edli),
      pf_admin: round2(fresh.pf_admin - old.pf_admin),
      esi_wages: esiWages,
      esi_ee: esiWages > 0 ? rupeeUp((esiWages * esiR.employee_pct) / 100) : 0,
      esi_er: esiWages > 0 ? rupeeUp((esiWages * esiR.employer_pct) / 100) : 0,
    });
  }
  return out;
}

/** True when any month of the arrears falls in an FY before the pay month's FY (relief u/s 89). */
export function arrearsEarlierFy(record: Pick<ArrearsRecord, 'months' | 'pay_month'>): boolean {
  const fy = fyStartOfMonth(record.pay_month).slice(0, 7);
  return record.months.some((m) => m.month < fy);
}

/* ── Loans & advances ─────────────────────────────────────────── */

export interface LoanRecovery {
  month: string;
  principal: number;
  interest: number;
}

/** EMIs recovered in FINAL runs (incl. a full & final settlement), oldest first. */
export function loanRecoveries(loan: Pick<EmployeeLoan, 'id' | 'employee_id'>, runs: readonly PayrollRun[]): LoanRecovery[] {
  const out: LoanRecovery[] = [];
  for (const r of finals(runs)) {
    const l = lineOf(r, loan.employee_id);
    for (const d of l?.deductions ?? []) {
      if (d.tag !== 'loan' || d.ref_id !== loan.id) continue;
      const interest = round2(Math.min(d.amount, d.interest ?? 0));
      out.push({ month: r.month, principal: round2(d.amount - interest), interest });
    }
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/** Principal outstanding before `month` (all recoveries when omitted). */
export function loanOutstanding(loan: EmployeeLoan, runs: readonly PayrollRun[], month?: string): number {
  const rec = loanRecoveries(loan, runs).filter((r) => !month || r.month < month);
  return Math.max(0, round2(loan.amount - rec.reduce((s, r) => s + r.principal, 0)));
}

const monthlyInterest = (outstanding: number, ratePct: number) => round2((outstanding * Math.max(0, ratePct)) / 1200);

/** The instalment due in `month`: interest on the outstanding first, then principal (null when nothing is due). */
export function loanEmiFor(loan: EmployeeLoan, month: string, runs: readonly PayrollRun[]): LoanRecovery | null {
  if (month < loan.start_month || month < loan.date.slice(0, 7)) return null;
  const outstanding = loanOutstanding(loan, runs, month);
  if (outstanding <= 0) return null;
  const interest = monthlyInterest(outstanding, loan.interest_rate);
  const principal = round2(Math.min(outstanding, Math.max(0, loan.emi - interest)));
  if (principal <= 0 && interest <= 0) return null;
  return { month, principal, interest };
}

export interface ScheduleRow {
  month: string;
  opening: number;
  interest: number;
  principal: number;
  emi: number;
  closing: number;
  /** Recovered in a final run (vs projected). */
  actual: boolean;
}

/** EMI schedule: recovered months as they happened, then the projection until the loan is repaid. */
export function loanSchedule(loan: EmployeeLoan, runs: readonly PayrollRun[]): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  const rec = loanRecoveries(loan, runs);
  let bal = round2(loan.amount);
  for (const r of rec) {
    const emi = round2(r.principal + r.interest);
    rows.push({ month: r.month, opening: bal, interest: r.interest, principal: r.principal, emi, closing: round2(bal - r.principal), actual: true });
    bal = round2(bal - r.principal);
  }
  const last = rec.length ? addMonths(rec[rec.length - 1].month, 1) : loan.start_month;
  let m = last < loan.start_month ? loan.start_month : last;
  for (let i = 0; bal > 0.004 && i < 600; i++, m = addMonths(m, 1)) {
    const interest = monthlyInterest(bal, loan.interest_rate);
    const principal = round2(Math.min(bal, Math.max(0, loan.emi - interest)));
    if (principal <= 0) break; // EMI does not cover the interest: the loan never closes
    rows.push({ month: m, opening: bal, interest, principal, emi: round2(principal + interest), closing: round2(bal - principal), actual: false });
    bal = round2(bal - principal);
  }
  return rows;
}

/**
 * Taxable value of the interest-free / concessional loan perquisite for `month` (Rule 3(7)(i)):
 * (SBI rate − rate charged) on the outstanding at the start of the month, for loans other than
 * medical-treatment loans, unless the employee's aggregate loans stay within the small-loan limit.
 */
export function loanPerquisite(loans: readonly EmployeeLoan[], month: string, runs: readonly PayrollRun[]): number {
  const fy = fyStartOfMonth(month);
  const rule = loanPerqRule(fy);
  const open = loans.filter((l) => l.date.slice(0, 7) <= month).map((l) => ({ l, out: loanOutstanding(l, runs, month) })).filter((x) => x.out > 0);
  const aggregate = round2(open.reduce((s, x) => s + x.out, 0));
  if (aggregate <= rule.exempt_up_to) return 0;
  let v = 0;
  for (const { l, out } of open) {
    if (l.purpose === 'medical') continue;
    const gap = Math.max(0, (l.sbi_rate ?? rule.sbi_rate) - l.interest_rate);
    v += (out * gap) / 1200;
  }
  return round2(v);
}

/* ── Leave ────────────────────────────────────────────────────── */

export interface LeaveBalance {
  type_id: string;
  opening: number;
  accrued: number;
  taken: number;
  encashed: number;
  adjusted: number;
  lapsed: number;
  balance: number;
}

const entryMonth = (x: LeaveEntry) => (x.kind === 'encash' && x.month ? x.month : x.date.slice(0, 7));

/**
 * Leave balance of one type up to the end of `asOfMonth`: opening entries, monthly accrual for every
 * month on the rolls (from the month after the latest opening, else the month of joining), less days
 * taken / encashed, ± adjustments; the carry-forward cap applies at each 1 April.
 */
export function leaveBalance(type: LeaveType, employee: Pick<Employee, 'doj' | 'dol'>, entries: readonly LeaveEntry[], asOfMonth: string): LeaveBalance {
  const mine = entries.filter((x) => x.type_id === type.id);
  const openings = mine.filter((x) => x.kind === 'opening').sort((a, b) => a.date.localeCompare(b.date));
  const lastOpening = openings[openings.length - 1];
  const out: LeaveBalance = { type_id: type.id, opening: 0, accrued: 0, taken: 0, encashed: 0, adjusted: 0, lapsed: 0, balance: 0 };
  const startAccrual = lastOpening ? addMonths(lastOpening.date.slice(0, 7), 1) : employee.doj?.slice(0, 7) ?? type.created_at.slice(0, 7);
  const first = [lastOpening?.date.slice(0, 7), startAccrual, ...mine.map(entryMonth)].filter((m): m is string => !!m && /^\d{4}-\d{2}$/.test(m)).sort()[0];
  if (!first) return out;
  let bal = 0;
  for (const m of monthRange(first, asOfMonth)) {
    if (m.endsWith('-04') && type.carry_cap && type.carry_cap > 0 && bal > type.carry_cap && m > first) {
      out.lapsed = round2(out.lapsed + bal - type.carry_cap);
      bal = type.carry_cap;
    }
    // Only the latest opening counts (it restates the balance).
    if (lastOpening && lastOpening.date.slice(0, 7) === m) {
      out.opening = round2(lastOpening.days);
      bal = lastOpening.days;
    }
    if (m >= startAccrual && type.accrual > 0) {
      const onRolls = (!employee.doj || employee.doj <= lastDayOfMonth(m)) && (!employee.dol || employee.dol >= `${m}-01`);
      if (onRolls) {
        out.accrued = round2(out.accrued + type.accrual);
        bal += type.accrual;
      }
    }
    for (const x of mine) {
      if (x.kind === 'opening' || entryMonth(x) !== m) continue;
      if (lastOpening && entryMonth(x) < lastOpening.date.slice(0, 7)) continue;
      if (x.kind === 'taken') {
        out.taken = round2(out.taken + x.days);
        bal -= x.days;
      } else if (x.kind === 'encash') {
        out.encashed = round2(out.encashed + x.days);
        bal -= x.days;
      } else {
        out.adjusted = round2(out.adjusted + x.days);
        bal += x.days;
      }
    }
  }
  out.balance = round2(bal);
  return out;
}

/** Unpaid leave taken in `month` (adds to loss of pay). */
export function unpaidLeaveDays(employeeId: string, month: string, types: readonly LeaveType[], entries: readonly LeaveEntry[]): number {
  const unpaid = new Set(types.filter((t) => !t.paid).map((t) => t.id));
  return round2(entries.filter((x) => x.employee_id === employeeId && x.kind === 'taken' && unpaid.has(x.type_id) && x.date.slice(0, 7) === month).reduce((s, x) => s + x.days, 0));
}

/** Basic + DA for a month (full-month rate of the PF-wage heads in the structure). */
export function lastDrawn(employee: Employee, month: string, structures: readonly SalaryStructure[], heads: readonly PayHead[]): { basicDa: number; gross: number } {
  const r = structureRates(structureFor(employee, month, structures), heads, month);
  return { basicDa: r.pfWages, gross: r.gross };
}

/** Leave encashment per day: (Basic + DA) ÷ 30 (a common basis — check your leave rules / standing orders). */
export const LEAVE_DAY_DIVISOR = 30;

/* ── Gratuity ─────────────────────────────────────────────────── */

export interface ServiceLength {
  years: number;
  months: number;
  days: number;
  /** Completed years, plus one when the remainder is more than six months (s. 4(2)). */
  gratuity_years: number;
}

export function serviceLength(doj: string | undefined, asOf: string): ServiceLength {
  if (!doj || doj > asOf) return { years: 0, months: 0, days: 0, gratuity_years: 0 };
  const [y1, m1, d1] = doj.split('-').map(Number);
  const [y2, m2, d2] = asOf.split('-').map(Number);
  let years = y2 - y1;
  let months = m2 - m1;
  let days = d2 - d1 + 1; // both days counted
  if (days < 0) {
    months -= 1;
    days += new Date(y2, m2 - 1, 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const dim = new Date(y2, m2, 0).getDate();
  if (days >= dim) {
    days -= dim;
    months += 1;
    if (months === 12) {
      months = 0;
      years += 1;
    }
  }
  const beyondSix = months > 6 || (months === 6 && days > 0);
  return { years, months, days, gratuity_years: years + (beyondSix ? 1 : 0) };
}

export interface GratuityResult {
  service: ServiceLength;
  last_drawn: number;
  /** 15/26 × last drawn × years, before the ceiling. */
  formula: number;
  ceiling: number;
  /** Payable under the Act (0 when not yet eligible). */
  amount: number;
  /** Accrued liability whether or not eligible yet (provision working). */
  accrued: number;
  eligible: boolean;
  /** Within 4 years 240 days of the 5-year rule — courts differ; ask your CA. */
  borderline: boolean;
}

export function gratuityFor(input: { doj?: string; asOf: string; lastDrawn: number; reason?: FnfSettlement['reason'] | 'disablement' }): GratuityResult {
  const r = gratuityRule(input.asOf);
  const service = serviceLength(input.doj, input.asOf);
  const formula = Math.round((r.days / r.divisor) * input.lastDrawn * service.gratuity_years);
  const capped = Math.min(formula, r.ceiling);
  const exception = input.reason === 'death' || input.reason === 'disablement';
  const eligible = exception || service.years >= r.min_years;
  const borderline = !eligible && service.years === r.min_years - 1 && (service.months > 7 || (service.months === 7 && service.days >= 27));
  return { service, last_drawn: round2(input.lastDrawn), formula, ceiling: r.ceiling, amount: eligible ? capped : 0, accrued: capped, eligible, borderline };
}

/** Exempt part of gratuity paid to a private-sector employee covered by the Act (s. 10(10)(ii)). */
export function gratuityExempt(paid: number, g: Pick<GratuityResult, 'formula' | 'ceiling' | 'eligible'>, reason?: FnfSettlement['reason']): number {
  if (reason === 'death') return round2(paid); // paid to the legal heirs — not salary income
  if (!g.eligible) return 0;
  return round2(Math.max(0, Math.min(paid, g.formula, g.ceiling)));
}

/** Exempt part of leave encashment on leaving (s. 10(10AA)(ii)): least of paid, the cap and 10 months' Basic + DA. */
export function leaveEncashExempt(paid: number, basicDa: number, date: string, reason?: FnfSettlement['reason']): number {
  if (reason === 'death') return round2(paid);
  return round2(Math.max(0, Math.min(paid, leaveEncashCap(date), 10 * basicDa)));
}

/* ── Bonus (Payment of Bonus Act 1965) ────────────────────────── */

export interface BonusRow {
  employee_id: string;
  code: string;
  name: string;
  months: number;
  days_worked: number;
  salary: number;
  bonus_wages: number;
  eligible: boolean;
  bonus: number;
  reason?: string;
}

/**
 * Statutory bonus for the FY from FINAL runs: months whose salary (Basic + DA) is within the
 * eligibility ceiling count; bonus = rate × salary capped at the calculation ceiling (or the minimum
 * wage when higher); at least 8.33% / ₹100 for an eligible employee with 30 working days.
 */
export function bonusWorking(runs: readonly PayrollRun[], employees: readonly Employee[], heads: readonly PayHead[], fyStartYear: number, ratePct: number, minWage = 0): BonusRow[] {
  const rule = bonusRule(`${fyStartYear + 1}-03-31`);
  const rate = Math.min(rule.max_pct, Math.max(rule.min_pct, ratePct));
  const pfHeads = new Set(heads.filter((h) => h.pf_wage).map((h) => h.id));
  const out: BonusRow[] = [];
  for (const e of employees) {
    let months = 0;
    let days = 0;
    let salary = 0;
    let wages = 0;
    let any = false;
    for (const r of finals(runs).filter((x) => x.month >= `${fyStartYear}-04` && x.month <= `${fyStartYear + 1}-03`)) {
      const l = lineOf(r, e.id);
      if (!l || l.days_employed <= 0) continue;
      any = true;
      const s = round2(l.earnings.filter((x) => !x.tag && pfHeads.has(x.pay_head_id)).reduce((t, x) => t + x.amount, 0));
      days += l.payable_days;
      // Eligibility on the monthly rate (salary ÷ paid share of the month).
      const monthRate = l.payable_days > 0 ? (s * l.days_in_month) / l.payable_days : s;
      if (monthRate > rule.eligibility_ceiling) continue;
      months++;
      salary += s;
      const cap = Math.max(rule.calc_ceiling, minWage);
      wages += l.payable_days > 0 ? Math.min(s, (cap * l.payable_days) / l.days_in_month) : 0;
    }
    if (!any) continue;
    const eligible = months > 0 && days >= rule.min_days;
    const computed = Math.round((wages * rate) / 100);
    const minimum = eligible ? Math.max(Math.round((wages * rule.min_pct) / 100), rule.min_amount) : 0;
    out.push({
      employee_id: e.id,
      code: e.code,
      name: e.name,
      months,
      days_worked: round2(days),
      salary: round2(salary),
      bonus_wages: round2(wages),
      eligible,
      bonus: eligible ? Math.max(computed, minimum) : 0,
      ...(!eligible ? { reason: months === 0 ? `Salary above ₹${rule.eligibility_ceiling} a month` : `Fewer than ${rule.min_days} working days` } : {}),
    });
  }
  return out;
}

/* ── Reimbursements & perquisites ─────────────────────────────── */

export interface ReimbursementHead {
  key: string;
  name: string;
  /** Exempt in both regimes, in the old regime only, or never (taxable). Against bills — verify with your CA. */
  exempt: 'both' | 'old' | 'none';
}

export const REIMBURSEMENT_HEADS: readonly ReimbursementHead[] = [
  { key: 'conveyance', name: 'Conveyance / fuel (official duty)', exempt: 'both' },
  { key: 'travel', name: 'Travel on tour / transfer', exempt: 'both' },
  { key: 'telephone', name: 'Telephone / internet', exempt: 'both' },
  { key: 'lta', name: 'Leave travel (LTA)', exempt: 'old' },
  { key: 'medical', name: 'Medical', exempt: 'none' },
  { key: 'other', name: 'Other reimbursement', exempt: 'none' },
];

export function reimbursementTaxable(a: Pick<PayrollAdjustment, 'amount' | 'head' | 'taxable_amount'>, regime: TaxRegime): number {
  if (a.taxable_amount !== undefined) return round2(Math.max(0, Math.min(a.amount, a.taxable_amount)));
  const h = REIMBURSEMENT_HEADS.find((x) => x.key === a.head);
  if (!h || h.exempt === 'none' || (h.exempt === 'old' && regime !== 'old')) return round2(a.amount);
  return 0;
}

export function perquisiteFor(perqs: readonly Perquisite[], employeeId: string, month: string): number {
  return round2(perqs.filter((p) => p.employee_id === employeeId && p.from_month <= month && (!p.to_month || p.to_month >= month)).reduce((s, p) => s + p.monthly_value, 0));
}

/* ── PF late payment (7Q interest, 14B damages) estimate ──────── */

export interface PfLateEstimate {
  month: string;
  due_date: string;
  amount: number;
  paid_on: string;
  days_late: number;
  interest: number;
  damages: number;
}

/** Estimate for PF of `month` (`amount`) paid on `paidOn`. EPFO decides by order — a working figure only. */
export function pfLateEstimate(month: string, amount: number, paidOn: string): PfLateEstimate {
  const next = addMonths(month, 1);
  const rule = pfLateRule(`${next}-01`);
  const due = `${next}-${String(rule.due_day).padStart(2, '0')}`;
  const [y1, m1, d1] = due.split('-').map(Number);
  const [y2, m2, d2] = paidOn.split('-').map(Number);
  const days = Math.max(0, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000));
  const monthsLate = days / 30;
  const slab = rule.damages.find((s) => s.up_to_months === null || monthsLate <= s.up_to_months) ?? rule.damages[rule.damages.length - 1];
  return {
    month,
    due_date: due,
    amount: round2(amount),
    paid_on: paidOn,
    days_late: days,
    interest: days > 0 ? Math.round((amount * rule.interest_pct * days) / 36500) : 0,
    damages: days > 0 ? Math.round((amount * slab.pct * days) / 36500) : 0,
  };
}

/* ── Full & final settlement ──────────────────────────────────── */

export interface FnfContext {
  structures: readonly SalaryStructure[];
  heads: readonly PayHead[];
  runs: readonly PayrollRun[];
  loans: readonly EmployeeLoan[];
  leaveTypes: readonly LeaveType[];
  leaveEntries: readonly LeaveEntry[];
}

export interface FnfWorking {
  dol: string;
  basic_da: number;
  monthly_gross: number;
  notice: { mode: FnfSettlement['notice_mode']; days: number; amount: number };
  leave: { balance: number; days: number; rate: number; amount: number; exempt: number };
  gratuity: GratuityResult & { paid: number; exempt: number };
  loans: { loan_id: string; number: string; outstanding: number; interest: number }[];
  items: ExtraItem[];
}

/** Encashable leave balance at the date of leaving (all encashable types). */
export function encashableBalance(employee: Employee, month: string, types: readonly LeaveType[], entries: readonly LeaveEntry[]): number {
  const mine = entries.filter((x) => x.employee_id === employee.id);
  return round2(types.filter((t) => t.encashable).reduce((s, t) => s + Math.max(0, leaveBalance(t, employee, mine, month).balance), 0));
}

/** Items of a full & final settlement (paid with the run of `fnf.pay_month`) and the working behind them. */
export function fnfWorking(fnf: FnfSettlement, employee: Employee, ctx: FnfContext): FnfWorking {
  const dol = employee.dol ?? lastDayOfMonth(fnf.pay_month);
  const dolMonth = dol.slice(0, 7);
  const { basicDa, gross } = lastDrawn(employee, dolMonth, ctx.structures, ctx.heads);
  const items: ExtraItem[] = [];
  const ref = fnf.id;

  // Notice pay: recovered from the employee (other income) or paid in lieu (taxable salary).
  const noticeAmount = fnf.notice_mode === 'none' ? 0 : round2(fnf.notice_amount ?? (fnf.notice_days * gross) / 30);
  if (fnf.notice_mode === 'recover' && noticeAmount > 0) items.push({ key: 'fnf:notice', name: `Notice pay recovery (${fnf.notice_days} days)`, kind: 'deduction', amount: noticeAmount, account_id: A.otherIncome, tag: 'notice', ref_id: ref });
  if (fnf.notice_mode === 'pay' && noticeAmount > 0) items.push({ key: 'fnf:notice', name: `Notice pay in lieu (${fnf.notice_days} days)`, kind: 'earning', amount: noticeAmount, account_id: A.salaries, tag: 'notice', ref_id: ref, taxable: noticeAmount });

  // Leave encashment on leaving (s. 10(10AA)).
  const balance = encashableBalance(employee, dolMonth, ctx.leaveTypes, ctx.leaveEntries);
  const rate = round2(basicDa / LEAVE_DAY_DIVISOR);
  const leaveAmount = round2(fnf.leave_amount ?? fnf.leave_days * rate);
  const leaveExempt = leaveEncashExempt(leaveAmount, basicDa, dol, fnf.reason);
  if (leaveAmount > 0) items.push({ key: 'fnf:leave', name: `Leave encashment (${fnf.leave_days} days)`, kind: 'earning', amount: leaveAmount, account_id: A.leaveEncashment, tag: 'leave', ref_id: ref, taxable: round2(leaveAmount - leaveExempt) });

  // Gratuity (Payment of Gratuity Act; exempt u/s 10(10)(ii)).
  const g = gratuityFor({ doj: employee.doj, asOf: dol, lastDrawn: basicDa, reason: fnf.reason });
  const gPaid = round2(fnf.gratuity_amount ?? g.amount);
  const gExempt = gratuityExempt(gPaid, g, fnf.reason);
  if (gPaid > 0) items.push({ key: 'fnf:gratuity', name: `Gratuity (${g.service.gratuity_years} years)`, kind: 'earning', amount: gPaid, account_id: A.gratuity, tag: 'gratuity', ref_id: ref, taxable: round2(gPaid - gExempt) });

  // Outstanding loans / advances recovered in full (with the month's interest).
  const loans: FnfWorking['loans'] = [];
  if (fnf.recover_loans) {
    for (const loan of ctx.loans.filter((l) => l.employee_id === employee.id)) {
      const out = loanOutstanding(loan, ctx.runs, fnf.pay_month);
      if (out <= 0) continue;
      const interest = monthlyInterest(out, loan.interest_rate);
      loans.push({ loan_id: loan.id, number: loan.number, outstanding: out, interest });
      items.push({ key: `loan:${loan.id}`, name: `${loan.kind === 'advance' ? 'Advance' : 'Loan'} ${loan.number} — balance recovered`, kind: 'deduction', amount: round2(out + interest), account_id: A.staffAdvances, tag: 'loan', ref_id: loan.id, ...(interest ? { interest } : {}) });
    }
  }

  fnf.other.forEach((o, i) => {
    if (!(o.amount > 0) || !o.name.trim()) return;
    items.push({ key: `fnf:o${i}`, name: o.name.trim(), kind: o.kind, amount: round2(o.amount), account_id: o.kind === 'earning' ? A.salaries : A.otherIncome, tag: 'adjust', ref_id: ref, ...(o.kind === 'earning' ? { taxable: o.taxable === false ? 0 : round2(o.amount) } : {}) });
  });

  return {
    dol,
    basic_da: basicDa,
    monthly_gross: gross,
    notice: { mode: fnf.notice_mode, days: fnf.notice_days, amount: noticeAmount },
    leave: { balance, days: fnf.leave_days, rate, amount: leaveAmount, exempt: leaveExempt },
    gratuity: { ...g, paid: gPaid, exempt: gExempt },
    loans,
    items,
  };
}

/* ── Extras for one payslip ───────────────────────────────────── */

export interface DepthData {
  arrears: readonly ArrearsRecord[];
  loans: readonly EmployeeLoan[];
  leaveTypes: readonly LeaveType[];
  leaveEntries: readonly LeaveEntry[];
  adjustments: readonly PayrollAdjustment[];
  perquisites: readonly Perquisite[];
  fnf: readonly FnfSettlement[];
}

export const EMPTY_DEPTH: DepthData = { arrears: [], loans: [], leaveTypes: [], leaveEntries: [], adjustments: [], perquisites: [], fnf: [] };

/** Everything paid to / recovered from `employee` in `month` besides the structure. */
export function extrasFor(employee: Employee, month: string, depth: DepthData, base: { structures: readonly SalaryStructure[]; heads: readonly PayHead[]; runs: readonly PayrollRun[] }): PayslipExtras {
  const items: ExtraItem[] = [];
  const fnf = depth.fnf.find((f) => f.employee_id === employee.id && f.pay_month === month);
  const fw = fnf ? fnfWorking(fnf, employee, { ...base, loans: depth.loans, leaveTypes: depth.leaveTypes, leaveEntries: depth.leaveEntries }) : null;
  const fnfLoans = new Set(fw?.loans.map((l) => l.loan_id) ?? []);

  // Loan EMIs (a settlement recovering the loan replaces the month's EMI).
  for (const loan of depth.loans.filter((l) => l.employee_id === employee.id && !fnfLoans.has(l.id))) {
    const emi = loanEmiFor(loan, month, base.runs);
    if (!emi) continue;
    const amount = round2(emi.principal + emi.interest);
    items.push({ key: `loan:${loan.id}`, name: `${loan.kind === 'advance' ? 'Advance' : 'Loan'} EMI ${loan.number}`, kind: 'deduction', amount, account_id: A.staffAdvances, tag: 'loan', ref_id: loan.id, ...(emi.interest ? { interest: emi.interest } : {}) });
  }

  // Leave encashment during service (fully taxable).
  const encash = depth.leaveEntries.filter((x) => x.employee_id === employee.id && x.kind === 'encash' && x.month === month);
  if (encash.length) {
    const rate = round2(lastDrawn(employee, month, base.structures, base.heads).basicDa / LEAVE_DAY_DIVISOR);
    for (const x of encash) {
      const t = depth.leaveTypes.find((lt) => lt.id === x.type_id);
      const amount = round2(x.amount ?? x.days * rate);
      if (amount > 0) items.push({ key: `leave:${x.id}`, name: `Leave encashment${t ? ` (${t.code})` : ''} ${x.days} days`, kind: 'earning', amount, account_id: A.leaveEncashment, tag: 'leave', ref_id: x.id, taxable: amount });
    }
  }

  // Reimbursements, bonus and other one-off adjustments.
  for (const a of depth.adjustments.filter((x) => x.employee_id === employee.id && x.month === month)) {
    const taxable = a.kind === 'earning' ? (a.tag === 'reimb' ? reimbursementTaxable(a, employee.tax_regime) : a.taxable_amount ?? a.amount) : undefined;
    items.push({
      key: `adj:${a.id}`,
      name: a.name,
      kind: a.kind,
      amount: a.amount,
      account_id: a.account_id || (a.kind === 'deduction' ? A.otherCl : a.tag === 'bonus' ? A.bonus : A.allowances),
      tag: a.tag,
      ref_id: a.id,
      ...(taxable !== undefined ? { taxable: round2(taxable) } : {}),
    });
  }
  if (fw) items.push(...fw.items);

  // Perquisites (s. 17(2)): typed values + the interest-free / concessional loan perquisite.
  const mineLoans = depth.loans.filter((l) => l.employee_id === employee.id);
  const perq = (m: string) => round2(perquisiteFor(depth.perquisites, employee.id, m) + loanPerquisite(mineLoans, m, base.runs));
  const now = perq(month);
  const fyEnd = `${Number(fyStartOfMonth(month).slice(0, 4)) + 1}-03`;
  const later = monthRange(addMonths(month, 1), employee.dol && employee.dol.slice(0, 7) < fyEnd ? employee.dol.slice(0, 7) : fyEnd);
  const laterAvg = later.length ? round2(later.reduce((s, m) => s + perquisiteFor(depth.perquisites, employee.id, m), 0) / later.length + loanPerquisite(mineLoans, month, base.runs)) : 0;

  const arrears = depth.arrears.filter((r) => r.employee_id === employee.id && r.pay_month === month);
  return {
    ...(arrears.length ? { arrears } : {}),
    ...(items.length ? { items } : {}),
    ...(now ? { perquisites: now } : {}),
    ...(laterAvg ? { perquisitesLater: laterAvg } : {}),
    ...(fnf ? { fnfId: fnf.id } : {}),
  };
}

/** Days in month helper re-exported for screens. */
export { daysInMonth };
