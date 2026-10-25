/**
 * Payroll records the ledger needs (Phase 7): table names, tolerant readers for runs and payments.
 * Kept apart from `store.ts` so the Books ledger chunk does not load the payroll engine.
 */

import { isoDay } from '../dates';
import { num, round2 } from '../invoice-calc';
import { getTable } from '../storage';
import type { PayrollCompany, PayrollPayment, PayrollPaymentKind, PayrollRun, PayslipLine } from '../../types/payroll';

export const PAYROLL_TABLES = {
  employees: 'employees',
  groups: 'employee_groups',
  payHeads: 'pay_heads',
  structures: 'salary_structures',
  attendanceTypes: 'attendance_types',
  attendance: 'attendance',
  runs: 'payroll_runs',
  payments: 'payroll_payments',
  // 7P
  arrears: 'payroll_arrears',
  loans: 'employee_loans',
  leaveTypes: 'leave_types',
  leaveEntries: 'leave_entries',
  adjustments: 'payroll_adjustments',
  perquisites: 'perquisites',
  fnf: 'fnf_settlements',
  // 7T
  relief89: 'payroll_relief89',
  actuarial: 'actuarial_valuations',
} as const;

export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
export const opt = (v: unknown): string | undefined => str(v) || undefined;
export const obj = (r: unknown): Record<string, unknown> | null => (r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : null);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (m: unknown): m is string => typeof m === 'string' && MONTH_RE.test(m);
export const day = (v: unknown): string | undefined => {
  const d = isoDay(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '').trim()) && d ? d : undefined;
};

export function normalizeRuns(rows: unknown[]): PayrollRun[] {
  const out: PayrollRun[] = [];
  for (const r of rows) {
    const o = obj(r);
    const date = day(o?.date);
    if (!o || !str(o.id) || !isMonth(o.month) || !date || !Array.isArray(o.lines)) continue;
    out.push({
      id: str(o.id),
      month: o.month,
      number: str(o.number),
      date,
      status: o.status === 'final' ? 'final' : 'draft',
      lines: (o.lines as unknown[]).filter((l): l is PayslipLine => !!obj(l) && typeof (l as PayslipLine).employee_id === 'string' && Array.isArray((l as PayslipLine).earnings)),
      company: (obj(o.company) as unknown as PayrollCompany | null) ?? null,
      ...(str(o.narration) ? { narration: str(o.narration) } : {}),
      created_at: str(o.created_at),
      ...(str(o.updated_at) ? { updated_at: str(o.updated_at) } : {}),
      ...(str(o.finalized_at) ? { finalized_at: str(o.finalized_at) } : {}),
    });
  }
  return out;
}

/** Kinds that clear a payroll payable (balances). */
export const PAY_KINDS: PayrollPaymentKind[] = ['salary', 'pf', 'esi', 'pt', 'tds'];
/** Every stored kind: the payables + `loan` (7P, loan / advance paid to an employee). */
export const ALL_PAY_KINDS: PayrollPaymentKind[] = [...PAY_KINDS, 'loan'];

export function normalizePayments(rows: unknown[]): PayrollPayment[] {
  const out: PayrollPayment[] = [];
  for (const r of rows) {
    const o = obj(r);
    const date = day(o?.date);
    if (!o || !str(o.id) || !date || !ALL_PAY_KINDS.includes(o.kind as PayrollPaymentKind) || !(num(o.amount) > 0)) continue;
    out.push({
      id: str(o.id),
      kind: o.kind as PayrollPaymentKind,
      number: str(o.number),
      date,
      amount: round2(num(o.amount)),
      paid_from: str(o.paid_from) || 'bank',
      ...(str(o.run_id) ? { run_id: str(o.run_id) } : {}),
      ...(str(o.employee_id) ? { employee_id: str(o.employee_id) } : {}),
      ...(str(o.reference) ? { reference: str(o.reference) } : {}),
      ...(isMonth(o.period) ? { period: o.period } : {}),
      ...(str(o.bsr_code) ? { bsr_code: str(o.bsr_code) } : {}),
      ...(str(o.challan_no) ? { challan_no: str(o.challan_no) } : {}),
      ...(str(o.loan_id) ? { loan_id: str(o.loan_id) } : {}),
      created_at: str(o.created_at),
    });
  }
  return out;
}

export const loadRuns = () => normalizeRuns(getTable<unknown>(PAYROLL_TABLES.runs));
export const loadPayrollPayments = () => normalizePayments(getTable<unknown>(PAYROLL_TABLES.payments));

