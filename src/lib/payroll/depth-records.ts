/**
 * Payroll depth (7P) — tolerant readers for the new tables: `payroll_arrears`, `employee_loans`,
 * `leave_types`, `leave_entries`, `payroll_adjustments`, `perquisites`, `fnf_settlements`.
 * Malformed rows are skipped. No writes here (see `depth-store.ts`).
 */

import { num, round2 } from '../invoice-calc';
import { getTable } from '../storage';
import type {
  AdjustmentTag,
  ArrearsMonth,
  ArrearsRecord,
  EmployeeLoan,
  FnfReason,
  FnfSettlement,
  LeaveEntry,
  LeaveEntryKind,
  LeaveType,
  PayrollAdjustment,
  Perquisite,
  PerquisiteKind,
} from '../../types/payroll';
import type { DepthData } from './depth';
import { PAYROLL_TABLES, day, isMonth, obj, opt, str } from './records';
import { loadRelief89 } from './followups-records';

const n2 = (v: unknown) => round2(num(v));

function normalizeArrearsMonth(v: unknown): ArrearsMonth | null {
  const o = obj(v);
  if (!o || !isMonth(o.month) || !Array.isArray(o.earnings)) return null;
  const earnings = (o.earnings as unknown[]).map(obj).filter((x): x is Record<string, unknown> => !!x && !!str(x.pay_head_id)).map((x) => ({
    pay_head_id: str(x.pay_head_id),
    name: str(x.name) || str(x.pay_head_id),
    amount: n2(x.amount),
    account_id: str(x.account_id) || 'salaries',
    taxable: x.taxable !== false,
  }));
  const m: ArrearsMonth = { month: o.month, earnings, gross: 0, taxable: 0, pf_wages: 0, pf_ee: 0, eps: 0, epf_er: 0, edli: 0, pf_admin: 0, esi_wages: 0, esi_ee: 0, esi_er: 0 };
  for (const k of ['gross', 'taxable', 'pf_wages', 'pf_ee', 'eps', 'epf_er', 'edli', 'pf_admin', 'esi_wages', 'esi_ee', 'esi_er'] as const) m[k] = n2(o[k]);
  // 7T (additive): EPS / EDLI wage differences, absent on older records.
  if (o.eps_wages !== undefined && o.eps_wages !== null) m.eps_wages = n2(o.eps_wages);
  if (o.edli_wages !== undefined && o.edli_wages !== null) m.edli_wages = n2(o.edli_wages);
  return m;
}

export function normalizeArrears(rows: unknown[]): ArrearsRecord[] {
  const out: ArrearsRecord[] = [];
  for (const r of rows) {
    const o = obj(r);
    if (!o || !str(o.id) || !str(o.employee_id) || !isMonth(o.from_month) || !isMonth(o.pay_month) || !Array.isArray(o.months)) continue;
    const months = (o.months as unknown[]).map(normalizeArrearsMonth).filter((m): m is ArrearsMonth => !!m);
    out.push({ id: str(o.id), employee_id: str(o.employee_id), from_month: o.from_month, pay_month: o.pay_month, months, gross: n2(o.gross), ...(opt(o.note) ? { note: opt(o.note) } : {}), created_at: str(o.created_at) });
  }
  return out;
}

export function normalizeLoans(rows: unknown[]): EmployeeLoan[] {
  const out: EmployeeLoan[] = [];
  for (const r of rows) {
    const o = obj(r);
    const date = day(o?.date);
    if (!o || !str(o.id) || !str(o.employee_id) || !date || !(num(o.amount) > 0) || !isMonth(o.start_month)) continue;
    out.push({
      id: str(o.id),
      number: str(o.number),
      employee_id: str(o.employee_id),
      kind: o.kind === 'advance' ? 'advance' : 'loan',
      date,
      amount: n2(o.amount),
      interest_rate: Math.max(0, num(o.interest_rate)),
      emi: Math.max(0, n2(o.emi)),
      start_month: o.start_month,
      paid_from: str(o.paid_from) || 'bank',
      ...(o.purpose === 'medical' ? { purpose: 'medical' as const } : {}),
      ...(num(o.sbi_rate) > 0 ? { sbi_rate: num(o.sbi_rate) } : {}),
      ...(opt(o.payment_id) ? { payment_id: opt(o.payment_id) } : {}),
      ...(opt(o.notes) ? { notes: opt(o.notes) } : {}),
      created_at: str(o.created_at),
    });
  }
  return out;
}

export function normalizeLeaveTypes(rows: unknown[]): LeaveType[] {
  const out: LeaveType[] = [];
  for (const r of rows) {
    const o = obj(r);
    if (!o || !str(o.id) || !str(o.name)) continue;
    out.push({
      id: str(o.id),
      code: (str(o.code) || str(o.name).slice(0, 2)).toUpperCase(),
      name: str(o.name),
      paid: o.paid !== false,
      accrual: Math.max(0, n2(o.accrual)),
      encashable: o.encashable === true,
      ...(num(o.carry_cap) > 0 ? { carry_cap: n2(o.carry_cap) } : {}),
      created_at: str(o.created_at),
    });
  }
  return out;
}

const LEAVE_KINDS: LeaveEntryKind[] = ['opening', 'taken', 'encash', 'adjust'];

export function normalizeLeaveEntries(rows: unknown[]): LeaveEntry[] {
  const out: LeaveEntry[] = [];
  for (const r of rows) {
    const o = obj(r);
    const date = day(o?.date);
    if (!o || !str(o.id) || !str(o.employee_id) || !str(o.type_id) || !date || !LEAVE_KINDS.includes(o.kind as LeaveEntryKind)) continue;
    out.push({
      id: str(o.id),
      employee_id: str(o.employee_id),
      type_id: str(o.type_id),
      kind: o.kind as LeaveEntryKind,
      date,
      days: n2(o.days),
      ...(isMonth(o.month) ? { month: o.month } : {}),
      ...(num(o.amount) > 0 ? { amount: n2(o.amount) } : {}),
      ...(opt(o.notes) ? { notes: opt(o.notes) } : {}),
      created_at: str(o.created_at),
    });
  }
  return out;
}

const ADJ_TAGS: AdjustmentTag[] = ['reimb', 'bonus', 'adjust'];

export function normalizeAdjustments(rows: unknown[]): PayrollAdjustment[] {
  const out: PayrollAdjustment[] = [];
  for (const r of rows) {
    const o = obj(r);
    if (!o || !str(o.id) || !str(o.employee_id) || !isMonth(o.month) || !str(o.name) || !(num(o.amount) > 0)) continue;
    out.push({
      id: str(o.id),
      employee_id: str(o.employee_id),
      month: o.month,
      kind: o.kind === 'deduction' ? 'deduction' : 'earning',
      tag: ADJ_TAGS.includes(o.tag as AdjustmentTag) ? (o.tag as AdjustmentTag) : 'adjust',
      name: str(o.name),
      amount: n2(o.amount),
      ...(opt(o.head) ? { head: opt(o.head) } : {}),
      ...(o.taxable_amount !== undefined && o.taxable_amount !== null && o.taxable_amount !== '' ? { taxable_amount: Math.max(0, n2(o.taxable_amount)) } : {}),
      ...(opt(o.account_id) ? { account_id: opt(o.account_id) } : {}),
      ...(opt(o.reference) ? { reference: opt(o.reference) } : {}),
      created_at: str(o.created_at),
    });
  }
  return out;
}

const PERQ_KINDS: PerquisiteKind[] = ['accommodation', 'car', 'other', 'meals', 'gift', 'accretion'];

export function normalizePerquisites(rows: unknown[]): Perquisite[] {
  const out: Perquisite[] = [];
  for (const r of rows) {
    const o = obj(r);
    if (!o || !str(o.id) || !str(o.employee_id) || !isMonth(o.from_month) || !(num(o.monthly_value) > 0)) continue;
    out.push({
      id: str(o.id),
      employee_id: str(o.employee_id),
      kind: PERQ_KINDS.includes(o.kind as PerquisiteKind) ? (o.kind as PerquisiteKind) : 'other',
      description: str(o.description),
      from_month: o.from_month,
      ...(isMonth(o.to_month) ? { to_month: o.to_month } : {}),
      monthly_value: n2(o.monthly_value),
      ...(opt(o.basis) ? { basis: opt(o.basis) } : {}),
      created_at: str(o.created_at),
    });
  }
  return out;
}

const REASONS: FnfReason[] = ['resignation', 'retirement', 'termination', 'death'];

export function normalizeFnf(rows: unknown[]): FnfSettlement[] {
  const out: FnfSettlement[] = [];
  for (const r of rows) {
    const o = obj(r);
    if (!o || !str(o.id) || !str(o.employee_id) || !isMonth(o.pay_month)) continue;
    const opt2 = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Math.max(0, n2(v)));
    const notice = opt2(o.notice_amount);
    const leave = opt2(o.leave_amount);
    const grat = opt2(o.gratuity_amount);
    out.push({
      id: str(o.id),
      number: str(o.number),
      employee_id: str(o.employee_id),
      reason: REASONS.includes(o.reason as FnfReason) ? (o.reason as FnfReason) : 'resignation',
      pay_month: o.pay_month,
      notice_mode: o.notice_mode === 'recover' || o.notice_mode === 'pay' ? o.notice_mode : 'none',
      notice_days: Math.max(0, n2(o.notice_days)),
      ...(notice !== undefined ? { notice_amount: notice } : {}),
      leave_days: Math.max(0, n2(o.leave_days)),
      ...(leave !== undefined ? { leave_amount: leave } : {}),
      ...(grat !== undefined ? { gratuity_amount: grat } : {}),
      recover_loans: o.recover_loans !== false,
      other: Array.isArray(o.other)
        ? (o.other as unknown[]).map(obj).filter((x): x is Record<string, unknown> => !!x && !!str(x.name)).map((x) => ({ name: str(x.name), kind: x.kind === 'deduction' ? ('deduction' as const) : ('earning' as const), amount: Math.max(0, n2(x.amount)), ...(x.taxable === false ? { taxable: false } : {}) }))
        : [],
      ...(opt(o.note) ? { note: opt(o.note) } : {}),
      created_at: str(o.created_at),
      ...(str(o.updated_at) ? { updated_at: str(o.updated_at) } : {}),
    });
  }
  return out;
}

export const loadArrears = () => normalizeArrears(getTable<unknown>(PAYROLL_TABLES.arrears));
export const loadLoans = () => normalizeLoans(getTable<unknown>(PAYROLL_TABLES.loans));
export const loadLeaveTypes = () => normalizeLeaveTypes(getTable<unknown>(PAYROLL_TABLES.leaveTypes));
export const loadLeaveEntries = () => normalizeLeaveEntries(getTable<unknown>(PAYROLL_TABLES.leaveEntries));
export const loadAdjustments = () => normalizeAdjustments(getTable<unknown>(PAYROLL_TABLES.adjustments));
export const loadPerquisites = () => normalizePerquisites(getTable<unknown>(PAYROLL_TABLES.perquisites));
export const loadFnf = () => normalizeFnf(getTable<unknown>(PAYROLL_TABLES.fnf));

export function loadDepth(): DepthData {
  return {
    arrears: loadArrears(),
    loans: loadLoans(),
    leaveTypes: loadLeaveTypes(),
    leaveEntries: loadLeaveEntries(),
    adjustments: loadAdjustments(),
    perquisites: loadPerquisites(),
    fnf: loadFnf(),
    relief89: loadRelief89(),
  };
}
