/**
 * Business loans & EMI tracker (8H, roadmap 8.123) — term loans, vehicle / machinery loans, OD-style
 * EMIs a business pays (not employee loans: those are payroll, `employee_loans`).
 *
 *  - Loan master (table `business_loans`, numbered `LOAN/FY26-27/0001` through `series-counters`):
 *    lender, principal, annual rate, tenure in months, disbursement date and first EMI date.
 *  - `emiSchedule`: reducing-balance EMI, EMI = P·r·(1+r)^n / ((1+r)^n − 1) with r = rate / 12 / 100
 *    (r = 0 → P / n). Every row rounds to paise; the last row absorbs the rounding so the loan closes at 0.
 *  - Each loan gets its own ledger under Long-term borrowings (or Short-term for 12 months or less),
 *    created on first use. Disbursement (optional): Receipt voucher Dr Bank | Cr Loan.
 *    Each EMI paid: Payment voucher Dr Loan (principal) + Dr Interest on loans (interest) | Cr Bank / Cash —
 *    through `saveVoucher`, so the period lock, roles and audit log apply like any voucher.
 *  - `loanStatement`: schedule vs paid, outstanding principal, interest paid to date.
 *
 * Interest certificates, moratoriums, prepayment re-schedules and floating-rate resets are not
 * modelled: record a prepayment as an extra principal payment and verify with your lender / CA.
 * Pure above "Storage".
 */
import { round2 } from './invoice-calc';
import { isoDay } from './dates';
import { requireAccess } from './access';
import { generateId, getTable, setTable } from './storage';
import { nextSeriesNumberFor, recordSeries } from './series-counters';
import { withTablesRollback } from './table-txn';
import { A, chartOf, loadUserAccounts, saveUserAccount } from './ledger/accounts';
import { deleteVoucher, saveVoucher } from './ledger/vouchers';

export const LOANS_TABLE = 'business_loans';
export const LOAN_PREFIX = 'LOAN';

export interface LoanPayment {
  id: string;
  /** EMI number (1-based); 0 = an extra principal prepayment. */
  n: number;
  date: string;
  principal: number;
  interest: number;
  voucher_id: string;
  voucher_number: string;
}

export interface BusinessLoan {
  id: string;
  number: string;
  lender: string;
  /** Disbursement date (YYYY-MM-DD). */
  date: string;
  principal: number;
  /** Annual interest rate, % (reducing balance). */
  rate: number;
  tenure_months: number;
  /** First EMI date; later EMIs fall on the same day of each month (clamped to month end). */
  first_emi: string;
  /** Ledger id of the loan (created on first use). */
  account_id?: string;
  /** Cash / bank ledger the EMIs are paid from (default: Bank). */
  pay_from?: string;
  disbursal_voucher_id?: string;
  payments: LoanPayment[];
  notes?: string;
  closed?: boolean;
  created_at?: string;
}

export interface ScheduleRow {
  n: number;
  date: string;
  opening: number;
  emi: number;
  interest: number;
  principal: number;
  closing: number;
}

export class LoanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoanError';
  }
}

/** Monthly EMI for a reducing-balance loan, rounded to paise. */
export function emiAmount(principal: number, annualRate: number, months: number): number {
  const p = Number(principal);
  const n = Math.floor(Number(months));
  if (!(p > 0) || !(n > 0)) return 0;
  const r = Number(annualRate) / 12 / 100;
  if (!(r > 0)) return round2(p / n);
  const f = Math.pow(1 + r, n);
  return round2((p * r * f) / (f - 1));
}

/** `date` (YYYY-MM-DD) plus `k` months, keeping the day and clamping to the month end. Local days only. */
export function addMonths(date: string, k: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + k;
  const yy = Math.floor(total / 12);
  const mm = total % 12;
  const last = new Date(yy, mm + 1, 0).getDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** The full reducing-balance schedule. The last EMI is adjusted so the closing balance is exactly 0. */
export function emiSchedule(loan: Pick<BusinessLoan, 'principal' | 'rate' | 'tenure_months' | 'first_emi'>): ScheduleRow[] {
  const n = Math.floor(Number(loan.tenure_months));
  const emi = emiAmount(loan.principal, loan.rate, n);
  if (!emi || !isoDay(loan.first_emi)) return [];
  const r = Number(loan.rate) / 12 / 100;
  const rows: ScheduleRow[] = [];
  let open = round2(Number(loan.principal));
  for (let k = 1; k <= n; k++) {
    const interest = round2(open * (r > 0 ? r : 0));
    let principal = round2(emi - interest);
    if (k === n || principal > open) principal = open;
    const close = round2(open - principal);
    rows.push({ n: k, date: addMonths(loan.first_emi, k - 1), opening: open, emi: round2(principal + interest), interest, principal, closing: close });
    open = close;
    if (open <= 0) break;
  }
  return rows;
}

export interface LoanStatement {
  schedule: ScheduleRow[];
  emi: number;
  totalInterest: number;
  paidPrincipal: number;
  paidInterest: number;
  outstanding: number;
  /** Next unpaid scheduled EMI, or null when every EMI is paid. */
  next: ScheduleRow | null;
  /** Scheduled EMIs dated on or before `today` that are not paid. */
  overdue: ScheduleRow[];
}

export function loanStatement(loan: BusinessLoan, today: string): LoanStatement {
  const schedule = emiSchedule(loan);
  const paidNs = new Set(loan.payments.filter((p) => p.n > 0).map((p) => p.n));
  const paidPrincipal = round2(loan.payments.reduce((s, p) => s + p.principal, 0));
  const paidInterest = round2(loan.payments.reduce((s, p) => s + p.interest, 0));
  const unpaid = schedule.filter((r) => !paidNs.has(r.n));
  return {
    schedule,
    emi: emiAmount(loan.principal, loan.rate, loan.tenure_months),
    totalInterest: round2(schedule.reduce((s, r) => s + r.interest, 0)),
    paidPrincipal,
    paidInterest,
    outstanding: round2(Math.max(0, loan.principal - paidPrincipal)),
    next: unpaid[0] ?? null,
    overdue: unpaid.filter((r) => r.date <= today),
  };
}

/** Problems with a loan draft ([] = it may be saved). */
export function validateLoan(d: Partial<BusinessLoan>): string[] {
  const e: string[] = [];
  if (!d.lender?.trim()) e.push('Enter the lender.');
  if (!(Number(d.principal) > 0)) e.push('Enter the loan amount.');
  if (!(Number(d.rate) >= 0) || Number(d.rate) > 60) e.push('Enter the annual interest rate (0 to 60 %).');
  if (!(Number.isInteger(Number(d.tenure_months)) && Number(d.tenure_months) >= 1 && Number(d.tenure_months) <= 480)) e.push('Tenure is 1 to 480 months.');
  if (!isoDay(d.date)) e.push('Choose the disbursement date.');
  if (!isoDay(d.first_emi)) e.push('Choose the first EMI date.');
  else if (isoDay(d.date) && d.first_emi! < d.date!) e.push('The first EMI cannot be before the disbursement.');
  return e;
}

/* ── Storage ─────────────────────────────────────────────────── */

export function loadLoans(): BusinessLoan[] {
  return getTable<BusinessLoan>(LOANS_TABLE)
    .filter((l) => l && typeof l.id === 'string')
    .map((l) => ({ ...l, payments: Array.isArray(l.payments) ? l.payments : [] }));
}

function writeLoans(rows: BusinessLoan[]): void {
  setTable(LOANS_TABLE, rows);
}

/** Create or edit a loan. Terms of a loan with payments cannot change (delete its payments first). */
export function saveLoan(input: Omit<BusinessLoan, 'id' | 'number' | 'payments'> & { id?: string }): BusinessLoan {
  requireAccess('books.edit');
  const errors = validateLoan(input);
  if (errors.length) throw new LoanError(errors[0]);
  const all = loadLoans();
  const prev = input.id ? all.find((l) => l.id === input.id) : undefined;
  if (prev?.payments.length && (prev.principal !== Number(input.principal) || prev.rate !== Number(input.rate) || prev.tenure_months !== Number(input.tenure_months) || prev.first_emi !== input.first_emi)) {
    throw new LoanError('This loan has EMIs recorded; delete them before changing its terms.');
  }
  const number = prev?.number ?? nextSeriesNumberFor(LOAN_PREFIX, input.date, all.map((l) => l.number));
  const row: BusinessLoan = {
    ...prev,
    ...input,
    id: prev?.id ?? generateId(),
    number,
    lender: input.lender.trim(),
    principal: round2(Number(input.principal)),
    rate: Number(input.rate),
    tenure_months: Math.floor(Number(input.tenure_months)),
    payments: prev?.payments ?? [],
    created_at: prev?.created_at ?? new Date().toISOString(),
  };
  return withTablesRollback([LOANS_TABLE, 'series_counters'], () => {
    writeLoans(prev ? all.map((l) => (l.id === row.id ? row : l)) : [...all, row]);
    recordSeries(number);
    return row;
  });
}

const norm = (s: string) => s.trim().toLowerCase();

/** The loan's own ledger (Long-term / Short-term borrowings), created on first use. */
export function ensureLoanAccount(loan: BusinessLoan): string {
  const chart = chartOf(loadUserAccounts());
  if (loan.account_id && chart.some((a) => a.id === loan.account_id)) return loan.account_id;
  const name = `Loan - ${loan.lender} (${loan.number})`;
  const found = chart.find((a) => norm(a.name) === norm(name));
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let n = 2150;
  while (codes.has(String(n))) n++;
  return saveUserAccount({ code: String(n), name, group: loan.tenure_months <= 12 ? 'LOANS_ST' : 'LOANS_LT' }).id;
}

function update(loan: BusinessLoan): void {
  writeLoans(loadLoans().map((l) => (l.id === loan.id ? loan : l)));
}

const paise = (n: number) => Math.round(round2(n) * 100);

/** Post the disbursement: Receipt voucher Dr Bank (or `pay_from`) | Cr the loan ledger. */
export function postDisbursement(loanId: string): BusinessLoan {
  requireAccess('books.edit');
  const loan = loadLoans().find((l) => l.id === loanId);
  if (!loan) throw new LoanError('Loan not found.');
  if (loan.disbursal_voucher_id) throw new LoanError('The disbursement is already posted.');
  return withTablesRollback([LOANS_TABLE, 'vouchers', 'accounts'], () => {
    const account = ensureLoanAccount(loan);
    const v = saveVoucher({
      type: 'RECEIPT',
      date: loan.date,
      narration: `Loan ${loan.number} received from ${loan.lender}`,
      lines: [
        { account_id: loan.pay_from || A.bank, dr: paise(loan.principal), cr: 0 },
        { account_id: account, dr: 0, cr: paise(loan.principal) },
      ],
      voucher_class: 'Loan',
    });
    const next = { ...loan, account_id: account, disbursal_voucher_id: v.id };
    update(next);
    return next;
  });
}

/**
 * Pay EMI `n` (or a prepayment with n = 0 and `principal`): Payment voucher Dr Loan (principal) +
 * Dr Interest on loans (interest) | Cr Bank / Cash. Amounts default to the schedule row.
 */
export function payEmi(loanId: string, n: number, opts: { date?: string; principal?: number; interest?: number } = {}): LoanPayment {
  requireAccess('books.edit');
  const loan = loadLoans().find((l) => l.id === loanId);
  if (!loan) throw new LoanError('Loan not found.');
  const row = n > 0 ? emiSchedule(loan).find((r) => r.n === n) : undefined;
  if (n > 0 && !row) throw new LoanError(`EMI ${n} is not in the schedule.`);
  if (n > 0 && loan.payments.some((p) => p.n === n)) throw new LoanError(`EMI ${n} is already paid.`);
  const date = opts.date ?? row?.date ?? '';
  if (!isoDay(date)) throw new LoanError('Choose the payment date.');
  const principal = round2(opts.principal ?? row?.principal ?? 0);
  const interest = round2(opts.interest ?? row?.interest ?? 0);
  if (!(principal >= 0) || !(interest >= 0) || principal + interest <= 0) throw new LoanError('Enter the principal and interest paid.');
  const outstanding = loanStatement(loan, date).outstanding;
  if (principal > outstanding + 0.005) throw new LoanError(`Only ${outstanding.toFixed(2)} of principal is outstanding.`);
  return withTablesRollback([LOANS_TABLE, 'vouchers', 'accounts'], () => {
    const account = ensureLoanAccount(loan);
    const lines = [
      ...(principal > 0 ? [{ account_id: account, dr: paise(principal), cr: 0 }] : []),
      ...(interest > 0 ? [{ account_id: A.interestExp, dr: paise(interest), cr: 0 }] : []),
      { account_id: loan.pay_from || A.bank, dr: 0, cr: paise(principal) + paise(interest) },
    ];
    const v = saveVoucher({
      type: 'PAYMENT',
      date,
      narration: `${n > 0 ? `EMI ${n}` : 'Prepayment'} on loan ${loan.number} (${loan.lender}): principal ${principal.toFixed(2)}, interest ${interest.toFixed(2)}`,
      lines,
      voucher_class: 'Loan EMI',
    });
    const pay: LoanPayment = { id: generateId(), n, date, principal, interest, voucher_id: v.id, voucher_number: v.number };
    const payments = [...loan.payments, pay];
    const closed = round2(loan.principal - payments.reduce((s, p) => s + p.principal, 0)) <= 0;
    update({ ...loan, account_id: account, payments, closed });
    return pay;
  });
}

/** Undo a payment (its voucher is deleted; the period lock applies). */
export function deleteLoanPayment(loanId: string, paymentId: string): void {
  requireAccess('books.edit');
  const loan = loadLoans().find((l) => l.id === loanId);
  const pay = loan?.payments.find((p) => p.id === paymentId);
  if (!loan || !pay) return;
  withTablesRollback([LOANS_TABLE, 'vouchers'], () => {
    deleteVoucher(pay.voucher_id);
    update({ ...loan, payments: loan.payments.filter((p) => p.id !== paymentId), closed: false });
  });
}

/** Delete a loan with no payments (and its disbursement voucher). */
export function deleteLoan(loanId: string): void {
  requireAccess('books.edit');
  const loan = loadLoans().find((l) => l.id === loanId);
  if (!loan) return;
  if (loan.payments.length) throw new LoanError('Delete the recorded EMIs first.');
  withTablesRollback([LOANS_TABLE, 'vouchers'], () => {
    if (loan.disbursal_voucher_id) deleteVoucher(loan.disbursal_voucher_id);
    writeLoans(loadLoans().filter((l) => l.id !== loanId));
  });
}
