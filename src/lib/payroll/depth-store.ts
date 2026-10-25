/**
 * Payroll depth (7P) — writes for arrears, loans, leave, adjustments (reimbursements / bonus),
 * perquisites and full & final settlements, plus provision journals for gratuity / leave / bonus.
 *
 * Same contract as `store.ts`: every write needs `books.edit` AND `payroll.view`, is audited
 * (entity `payroll`, masters `employee`), and anything dated that reaches the ledger respects the
 * period lock. Items that feed a payslip cannot change once that month's payroll is finalized.
 * Working papers — verify with your CA.
 */

import { requireAccess } from '../access';
import { audit } from '../audit';
import { num, round2 } from '../invoice-calc';
import { assertUnlocked } from '../period-lock';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { generateId, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { A } from '../ledger/accounts';
import { saveVoucher } from '../ledger/vouchers';
import type {
  ArrearsRecord,
  EmployeeLoan,
  FnfSettlement,
  LeaveEntry,
  LeaveType,
  PayrollAdjustment,
  Perquisite,
} from '../../types/payroll';
import { PAYROLL_TABLES, day, isMonth, loadPayrollPayments, loadRuns, str } from './records';
import { PayrollError, deletePayrollPayment, loadEmployees, loadPayrollData, recordPayrollPayment } from './store';
import { arrearsEarlierFy, computeArrears, loanRecoveries } from './depth';
import {
  loadAdjustments,
  loadArrears,
  loadFnf,
  loadLeaveEntries,
  loadLeaveTypes,
  loadLoans,
  loadPerquisites,
  normalizeAdjustments,
  normalizeArrears,
  normalizeFnf,
  normalizeLeaveEntries,
  normalizeLeaveTypes,
  normalizeLoans,
  normalizePerquisites,
} from './depth-records';
import { lastDayOfMonth } from './statutory';

export * from './depth-records';

const now = () => new Date().toISOString();

// Review H1: audit summaries name the record but never carry an employee's amounts; those stay in
// the payroll records themselves (owner / payroll.view only).
function guard(): void {
  requireAccess('books.edit');
  requireAccess('payroll.view');
}

/** Refuse a change to a payslip item of a month whose payroll is finalized. */
function assertMonthOpen(month: string, what: string): void {
  const run = loadRuns().find((r) => r.month === month && r.status === 'final');
  if (run) throw new PayrollError(`Payroll for ${month} is finalized (${run.number}); reopen it to change ${what}.`);
}

const employeeName = (id: string) => {
  const e = loadEmployees().find((x) => x.id === id);
  return e ? `${e.code} ${e.name}` : 'employee';
};

/* ── Arrears ──────────────────────────────────────────────────── */

export interface ArrearsInput {
  employee_id: string;
  from_month: string;
  pay_month: string;
  note?: string;
}

/** Compute (without saving) the arrears of a back-dated revision. */
export function previewArrears(input: ArrearsInput): ArrearsRecord['months'] {
  const data = loadPayrollData();
  const e = data.employees.find((x) => x.id === input.employee_id);
  if (!e) throw new PayrollError('Choose the employee.');
  if (!isMonth(input.from_month) || !isMonth(input.pay_month)) throw new PayrollError('Choose the months.');
  if (input.from_month >= input.pay_month) throw new PayrollError('Arrears are paid in a month after the revision takes effect.');
  return computeArrears({ employee: e, fromMonth: input.from_month, payMonth: input.pay_month, heads: data.heads, structures: data.structures, attendance: data.attendance, runs: data.runs });
}

/** Save the arrears to be paid with the run of `pay_month` (replaces earlier arrears for the same employee and months). */
export function saveArrears(input: ArrearsInput): ArrearsRecord {
  guard();
  assertMonthOpen(input.pay_month, 'arrears');
  const months = previewArrears(input);
  if (!months.length) throw new PayrollError('No difference: the finalized months already match the current salary structure. Save the revised structure (effective from the first arrear month) first.');
  const all = loadArrears();
  const prev = all.find((r) => r.employee_id === input.employee_id && r.pay_month === input.pay_month && r.from_month === input.from_month);
  const gross = round2(months.reduce((s, m) => s + m.gross, 0));
  const [row] = normalizeArrears([{ id: prev?.id ?? generateId(), employee_id: input.employee_id, from_month: input.from_month, pay_month: input.pay_month, months, gross, note: str(input.note), created_at: prev?.created_at ?? now() }]);
  setTable(PAYROLL_TABLES.arrears, prev ? all.map((r) => (r.id === row.id ? row : r)) : [...all, row]);
  audit.record({ entity: 'payroll', entity_id: row.id, action: prev ? 'update' : 'create', summary: `Arrears for ${employeeName(row.employee_id)}: ${months.length} month${months.length === 1 ? '' : 's'} from ${row.from_month}, paid with ${row.pay_month}${arrearsEarlierFy(row) ? ' (earlier FY — relief u/s 89)' : ''}` });
  return row;
}

export function deleteArrears(id: string): void {
  guard();
  const all = loadArrears();
  const row = all.find((r) => r.id === id);
  if (!row) return;
  assertMonthOpen(row.pay_month, 'arrears');
  setTable(PAYROLL_TABLES.arrears, all.filter((r) => r.id !== id));
  audit.record({ entity: 'payroll', entity_id: id, action: 'delete', summary: `Arrears for ${employeeName(row.employee_id)} (${row.from_month} → paid ${row.pay_month}) deleted` });
}

/* ── Loans & advances ─────────────────────────────────────────── */

export type LoanInput = Omit<EmployeeLoan, 'id' | 'number' | 'created_at' | 'payment_id'> & { id?: string };

export function validateLoan(input: LoanInput): string[] {
  const errors: string[] = [];
  if (!loadEmployees().some((e) => e.id === input.employee_id)) errors.push('Choose the employee.');
  if (!day(input.date)) errors.push('Choose the date the loan was paid.');
  if (!(num(input.amount) > 0)) errors.push('Enter the amount.');
  if (!(num(input.emi) > 0)) errors.push('Enter the monthly instalment.');
  if (num(input.interest_rate) < 0 || num(input.interest_rate) > 50) errors.push('Interest is a yearly rate between 0 and 50%.');
  if (!isMonth(input.start_month)) errors.push('Choose the first recovery month.');
  else if (day(input.date) && input.start_month < input.date.slice(0, 7)) errors.push('Recovery cannot start before the loan is paid.');
  if (num(input.interest_rate) > 0 && num(input.emi) <= round2((num(input.amount) * num(input.interest_rate)) / 1200)) errors.push('The instalment does not cover the monthly interest.');
  return errors;
}

/**
 * Record a loan / advance: numbered `LOAN/FY…`, paid out through a payroll payment (Dr Loans &
 * advances to employees 3615 | Cr cash / bank). After the first recovery only the terms (EMI,
 * interest, start month, purpose, SBI rate, notes) can change.
 */
export function saveLoan(input: LoanInput): EmployeeLoan {
  guard();
  const errors = validateLoan(input);
  if (errors.length) throw new PayrollError(errors[0]);
  // Review M1: the disbursement is re-booked in steps (delete the old payment, record the new one,
  // repoint the loan); a refusal on the way (period lock on either date) puts all three tables back.
  return withTablesRollback([PAYROLL_TABLES.loans, PAYROLL_TABLES.payments, 'series_counters'], () => saveLoanSteps(input));
}

function saveLoanSteps(input: LoanInput): EmployeeLoan {
  const all = loadLoans();
  const prev = input.id ? all.find((l) => l.id === input.id) : undefined;
  if (prev) {
    const recovered = loanRecoveries(prev, loadRuns()).length > 0;
    const moneyChanged = round2(num(input.amount)) !== prev.amount || input.date !== prev.date || (input.paid_from || 'bank') !== prev.paid_from || input.employee_id !== prev.employee_id;
    if (moneyChanged && recovered) throw new PayrollError('Instalments have been recovered; only the terms can change. Record a new loan for a top-up.');
    if (moneyChanged) {
      // Re-book the disbursement.
      if (prev.payment_id) {
        setTable(PAYROLL_TABLES.loans, all.filter((l) => l.id !== prev.id));
        try {
          deletePayrollPayment(prev.payment_id);
        } finally {
          setTable(PAYROLL_TABLES.loans, all);
        }
      }
    }
    const payment = moneyChanged ? recordPayrollPayment({ kind: 'loan', loan_id: prev.id, date: input.date, amount: round2(num(input.amount)), paid_from: input.paid_from || 'bank', reference: prev.number }) : null;
    const [row] = normalizeLoans([{ ...prev, ...input, id: prev.id, number: prev.number, payment_id: payment?.id ?? prev.payment_id, created_at: prev.created_at }]);
    setTable(PAYROLL_TABLES.loans, loadLoans().map((l) => (l.id === row.id ? row : l)));
    audit.record({ entity: 'payroll', entity_id: row.id, action: 'update', doc_number: row.number, summary: `Loan ${row.number} to ${employeeName(row.employee_id)} edited` });
    return row;
  }
  const id = generateId();
  const number = nextSeriesNumberFor('LOAN', input.date, all.map((l) => l.number));
  assertUnlocked({ id, issue_date: input.date, invoice_number: number }, 'create');
  const payment = recordPayrollPayment({ kind: 'loan', loan_id: id, date: input.date, amount: round2(num(input.amount)), paid_from: input.paid_from || 'bank', reference: number });
  const [row] = normalizeLoans([{ ...input, id, number, payment_id: payment.id, created_at: now() }]);
  setTable(PAYROLL_TABLES.loans, [...all, row]);
  recordSeries(number);
  audit.record({ entity: 'payroll', entity_id: id, action: 'create', doc_number: number, summary: `${row.kind === 'advance' ? 'Salary advance' : 'Loan'} ${number} to ${employeeName(row.employee_id)} on ${row.date}, recovered from ${row.start_month}` });
  return row;
}

/** Delete a loan that has had no recovery (its disbursement payment goes too). */
export function deleteLoan(id: string): void {
  guard();
  const all = loadLoans();
  const row = all.find((l) => l.id === id);
  if (!row) return;
  if (loanRecoveries(row, loadRuns()).length) throw new PayrollError('Instalments have been recovered in a finalized payroll; the loan cannot be deleted.');
  setTable(PAYROLL_TABLES.loans, all.filter((l) => l.id !== id));
  try {
    const pay = loadPayrollPayments().find((p) => p.id === row.payment_id || (p.kind === 'loan' && p.loan_id === id));
    if (pay) deletePayrollPayment(pay.id);
  } catch (err) {
    setTable(PAYROLL_TABLES.loans, all);
    throw err;
  }
  audit.record({ entity: 'payroll', entity_id: id, action: 'delete', doc_number: row.number, summary: `Loan ${row.number} to ${employeeName(row.employee_id)} deleted` });
}

/* ── Leave ────────────────────────────────────────────────────── */

export type LeaveTypeInput = Omit<LeaveType, 'id' | 'created_at'> & { id?: string };

export function saveLeaveType(input: LeaveTypeInput): LeaveType {
  guard();
  const all = loadLeaveTypes();
  const name = str(input.name);
  const code = str(input.code).toUpperCase();
  if (!name) throw new PayrollError('Enter the leave type.');
  if (!code) throw new PayrollError('Enter a short code (CL, SL, EL).');
  if (all.some((t) => t.id !== input.id && (t.code === code || t.name.toLowerCase() === name.toLowerCase()))) throw new PayrollError(`Leave type ${code} already exists.`);
  if (num(input.accrual) < 0 || num(input.accrual) > 31) throw new PayrollError('Accrual is days per month (0–31).');
  const prev = input.id ? all.find((t) => t.id === input.id) : undefined;
  const [row] = normalizeLeaveTypes([{ ...input, name, code, id: prev?.id ?? generateId(), created_at: prev?.created_at ?? now() }]);
  setTable(PAYROLL_TABLES.leaveTypes, prev ? all.map((t) => (t.id === row.id ? row : t)) : [...all, row]);
  audit.record({ entity: 'employee', entity_id: row.id, action: prev ? 'update' : 'create', summary: `${prev ? 'Edited' : 'Added'} leave type ${row.code} ${row.name} (${row.paid ? 'paid' : 'unpaid'}, ${row.accrual} day/month${row.encashable ? ', encashable' : ''})` });
  return row;
}

export function deleteLeaveType(id: string): void {
  guard();
  const row = loadLeaveTypes().find((t) => t.id === id);
  if (!row) return;
  if (loadLeaveEntries().some((x) => x.type_id === id)) throw new PayrollError(`Leave entries use ${row.code}; delete them first.`);
  setTable(PAYROLL_TABLES.leaveTypes, loadLeaveTypes().filter((t) => t.id !== id));
  audit.record({ entity: 'employee', entity_id: id, action: 'delete', summary: `Deleted leave type ${row.code} ${row.name}` });
}

export type LeaveEntryInput = Omit<LeaveEntry, 'id' | 'created_at'>;

export function addLeaveEntry(input: LeaveEntryInput): LeaveEntry {
  guard();
  if (!loadEmployees().some((e) => e.id === input.employee_id)) throw new PayrollError('Choose the employee.');
  if (!loadLeaveTypes().some((t) => t.id === input.type_id)) throw new PayrollError('Choose the leave type.');
  if (!day(input.date)) throw new PayrollError('Choose the date.');
  const days = round2(num(input.days));
  if (input.kind === 'adjust' ? days === 0 : !(days >= 0)) throw new PayrollError('Enter the number of days.');
  if ((input.kind === 'taken' || input.kind === 'encash') && !(days > 0)) throw new PayrollError('Enter the number of days.');
  if (input.kind === 'encash') {
    if (!isMonth(input.month)) throw new PayrollError('Choose the month the encashment is paid in.');
    if (!loadLeaveTypes().find((t) => t.id === input.type_id)?.encashable) throw new PayrollError('This leave type cannot be encashed.');
    assertMonthOpen(input.month, 'leave encashment');
  }
  if (input.kind === 'taken') assertMonthOpen(input.date.slice(0, 7), 'leave taken');
  const [row] = normalizeLeaveEntries([{ ...input, days, id: generateId(), created_at: now() }]);
  setTable(PAYROLL_TABLES.leaveEntries, [...loadLeaveEntries(), row]);
  audit.record({ entity: 'payroll', entity_id: row.id, action: 'create', summary: `Leave ${row.kind} for ${employeeName(row.employee_id)}: ${row.days} day${row.days === 1 ? '' : 's'} (${row.date}${row.month ? `, paid with ${row.month}` : ''})` });
  return row;
}

export function deleteLeaveEntry(id: string): void {
  guard();
  const all = loadLeaveEntries();
  const row = all.find((x) => x.id === id);
  if (!row) return;
  if (row.kind === 'encash' && row.month) assertMonthOpen(row.month, 'leave encashment');
  if (row.kind === 'taken') assertMonthOpen(row.date.slice(0, 7), 'leave taken');
  setTable(PAYROLL_TABLES.leaveEntries, all.filter((x) => x.id !== id));
  audit.record({ entity: 'payroll', entity_id: id, action: 'delete', summary: `Leave ${row.kind} entry for ${employeeName(row.employee_id)} (${row.days} days, ${row.date}) deleted` });
}

/* ── Adjustments (reimbursements, bonus, one-off items) ───────── */

export type AdjustmentInput = Omit<PayrollAdjustment, 'id' | 'created_at'>;

export function addAdjustment(input: AdjustmentInput): PayrollAdjustment {
  guard();
  if (!loadEmployees().some((e) => e.id === input.employee_id)) throw new PayrollError('Choose the employee.');
  if (!isMonth(input.month)) throw new PayrollError('Choose the payroll month.');
  if (!str(input.name)) throw new PayrollError('Enter a description.');
  if (!(num(input.amount) > 0)) throw new PayrollError('Enter the amount.');
  if (input.taxable_amount !== undefined && (input.taxable_amount < 0 || input.taxable_amount > num(input.amount))) throw new PayrollError('The taxable part is between nil and the amount.');
  assertMonthOpen(input.month, 'its items');
  const [row] = normalizeAdjustments([{ ...input, id: generateId(), created_at: now() }]);
  setTable(PAYROLL_TABLES.adjustments, [...loadAdjustments(), row]);
  audit.record({ entity: 'payroll', entity_id: row.id, action: 'create', summary: `${row.tag === 'reimb' ? 'Reimbursement' : row.tag === 'bonus' ? 'Bonus' : 'Payroll item'} “${row.name}” for ${employeeName(row.employee_id)} in ${row.month}` });
  return row;
}

export function deleteAdjustment(id: string): void {
  guard();
  const all = loadAdjustments();
  const row = all.find((x) => x.id === id);
  if (!row) return;
  assertMonthOpen(row.month, 'its items');
  setTable(PAYROLL_TABLES.adjustments, all.filter((x) => x.id !== id));
  audit.record({ entity: 'payroll', entity_id: id, action: 'delete', summary: `Payroll item “${row.name}” (${row.month}) deleted` });
}

/* ── Perquisites ──────────────────────────────────────────────── */

export type PerquisiteInput = Omit<Perquisite, 'id' | 'created_at'> & { id?: string };

export function savePerquisite(input: PerquisiteInput): Perquisite {
  guard();
  if (!loadEmployees().some((e) => e.id === input.employee_id)) throw new PayrollError('Choose the employee.');
  if (!isMonth(input.from_month)) throw new PayrollError('Choose the first month.');
  if (input.to_month && (!isMonth(input.to_month) || input.to_month < input.from_month)) throw new PayrollError('The last month is before the first.');
  if (!(num(input.monthly_value) > 0)) throw new PayrollError('Enter the taxable value per month.');
  const all = loadPerquisites();
  const prev = input.id ? all.find((p) => p.id === input.id) : undefined;
  const [row] = normalizePerquisites([{ ...input, id: prev?.id ?? generateId(), created_at: prev?.created_at ?? now() }]);
  setTable(PAYROLL_TABLES.perquisites, prev ? all.map((p) => (p.id === row.id ? row : p)) : [...all, row]);
  audit.record({ entity: 'employee', entity_id: row.id, action: prev ? 'update' : 'create', summary: `Perquisite (${row.kind}) for ${employeeName(row.employee_id)} from ${row.from_month}${row.to_month ? ` to ${row.to_month}` : ''}` });
  return row;
}

export function deletePerquisite(id: string): void {
  guard();
  const all = loadPerquisites();
  const row = all.find((p) => p.id === id);
  if (!row) return;
  setTable(PAYROLL_TABLES.perquisites, all.filter((p) => p.id !== id));
  audit.record({ entity: 'employee', entity_id: id, action: 'delete', summary: `Perquisite (${row.kind}) for ${employeeName(row.employee_id)} deleted` });
}

/* ── Full & final settlement ──────────────────────────────────── */

export type FnfInput = Omit<FnfSettlement, 'id' | 'number' | 'created_at' | 'updated_at'> & { id?: string };

export function validateFnf(input: FnfInput): string[] {
  const errors: string[] = [];
  const e = loadEmployees().find((x) => x.id === input.employee_id);
  if (!e) errors.push('Choose the employee.');
  else if (!e.dol) errors.push(`Set ${e.name}’s date of leaving first (Employees).`);
  else if (isMonth(input.pay_month) && input.pay_month < e.dol.slice(0, 7)) errors.push('The settlement is paid in or after the month of leaving.');
  if (!isMonth(input.pay_month)) errors.push('Choose the month the settlement is paid in.');
  if (num(input.notice_days) < 0 || num(input.leave_days) < 0) errors.push('Days cannot be negative.');
  if (input.notice_mode !== 'none' && !(num(input.notice_days) > 0) && !(num(input.notice_amount) > 0)) errors.push('Enter the notice days.');
  return errors;
}

/** Save the settlement; its items are paid with (and posted by) the payroll run of `pay_month`. */
export function saveFnf(input: FnfInput): FnfSettlement {
  guard();
  const errors = validateFnf(input);
  if (errors.length) throw new PayrollError(errors[0]);
  const all = loadFnf();
  const prev = input.id ? all.find((f) => f.id === input.id) : all.find((f) => f.employee_id === input.employee_id);
  if (prev) assertMonthOpen(prev.pay_month, 'the settlement');
  assertMonthOpen(input.pay_month, 'the settlement');
  const date = lastDayOfMonth(input.pay_month);
  const number = prev?.number || nextSeriesNumberFor('FNF', date, all.map((f) => f.number));
  const [row] = normalizeFnf([{ ...input, id: prev?.id ?? generateId(), number, created_at: prev?.created_at ?? now(), ...(prev ? { updated_at: now() } : {}) }]);
  setTable(PAYROLL_TABLES.fnf, prev ? all.map((f) => (f.id === row.id ? row : f)) : [...all, row]);
  if (!prev) recordSeries(number);
  audit.record({ entity: 'payroll', entity_id: row.id, action: prev ? 'update' : 'create', doc_number: number, summary: `Full & final settlement ${number} for ${employeeName(row.employee_id)} (${row.reason}) ${prev ? 'edited' : 'prepared'}, paid with ${row.pay_month}` });
  return row;
}

export function deleteFnf(id: string): void {
  guard();
  const all = loadFnf();
  const row = all.find((f) => f.id === id);
  if (!row) return;
  assertMonthOpen(row.pay_month, 'the settlement');
  setTable(PAYROLL_TABLES.fnf, all.filter((f) => f.id !== id));
  audit.record({ entity: 'payroll', entity_id: id, action: 'delete', doc_number: row.number, summary: `Full & final settlement ${row.number} for ${employeeName(row.employee_id)} deleted` });
}

/* ── Provision journals ───────────────────────────────────────── */

export type ProvisionKind = 'gratuity' | 'leave' | 'bonus';

const PROVISION_ACCOUNT: Record<ProvisionKind, string> = { gratuity: A.gratuity, leave: A.leaveEncashment, bonus: A.bonus };
const PROVISION_WORD: Record<ProvisionKind, string> = { gratuity: 'gratuity', leave: 'leave encashment', bonus: 'statutory bonus' };

/**
 * Journal for a provision (Dr Gratuity 6006 / Leave encashment 6007 / Bonus 6002 | Cr Provisions
 * 2500) — the increase (or, negative, the release) the working shows. Goes through `saveVoucher`
 * (period lock, audit, roles).
 */
export function postProvisionJournal(kind: ProvisionKind, date: string, amount: number, note = '') {
  guard();
  if (!day(date)) throw new PayrollError('Choose the journal date.');
  const paise = Math.round(round2(amount) * 100);
  if (!paise) throw new PayrollError('Enter the provision amount.');
  const expense = PROVISION_ACCOUNT[kind];
  const up = paise > 0;
  const p = Math.abs(paise);
  return saveVoucher({
    type: 'JOURNAL',
    date,
    narration: `${up ? 'Provision for' : 'Release of provision for'} ${PROVISION_WORD[kind]} as at ${date} (payroll working — verify with your CA)${note ? ` · ${note}` : ''}`,
    lines: up
      ? [{ account_id: expense, dr: p, cr: 0 }, { account_id: A.provisions, dr: 0, cr: p }]
      : [{ account_id: A.provisions, dr: p, cr: 0 }, { account_id: expense, dr: 0, cr: p }],
    voucher_class: 'Payroll provision',
  });
}
