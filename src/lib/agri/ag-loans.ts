/**
 * AG-D3 loans against stored produce (table `agri_loans`, `books.edit`, dated `date`, numbered `LAS/FY…`), with a lien
 * on the lots the loan names: an open loan blocks the gate pass of those lots (`ag-gatepass.ts`) unless it is cleared,
 * the release keeps the loan covered at the release LTV (setting), or the owner overrides with a reason (audited).
 * Interest: simple by days on the principal outstanding, 365-day year, from disbursement / last repayment
 * (`monthly_compound` adds unpaid interest to the base at each month start); repayments go interest first.
 * Posting (real money, ordinary vouchers, no no-cash marker): disbursement PAYMENT Dr "Loans to depositors" | Cr bank /
 * cash; repayment RECEIPT Dr bank / cash | Cr "Loans to depositors" (principal) + Cr "Interest on loans to depositors"
 * (GST-exempt interest, N 12/2017 entry 27 as recalled; no TDS by the lender; money-lenders law — verify AG24).
 * Pure above "Storage". Also used by an FPO for member loans (same table).
 */
import './ag-registry';
import type { AgriLoan, AgriLoanRepayment, ColdLot } from '../../types/agri-r12d';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { generateId, getTable, setTable } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { A } from '../ledger/accounts';
import { deleteVoucher, saveVoucher } from '../ledger/vouchers';
import { ensureLedger, postPair } from '../trade/tr-ledger';
import { AG_SERIES, AG_TABLES } from './ag-shared';
import { lotBalance } from './ag-cold-lots';

export const LOANS_TABLE = AG_TABLES.agriLoans;
export const LOAN_LEDGER = 'Loans to depositors';
export const INTEREST_LEDGER = 'Interest on loans to depositors';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ── Pure ── */

const dayNo = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
export const daysFrom = (a: string, b: string): number => Math.max(dayNo(b) - dayNo(a), 0);
const nextMonthStart = (d: string) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; };

export interface LoanState {
  principal: number;
  /** Interest accrued and not yet paid. */
  interest: number;
  total: number;
  /** Day the state is worked to. */
  asOf: string;
}

/** Interest accrued on `base` from `from` to `to` (simple, 365-day year); compounding splits at month starts. */
function accrue(loan: Pick<AgriLoan, 'rate_pct' | 'basis'>, principal: number, pending: number, from: string, to: string): number {
  const r = num(loan.rate_pct) / 100 / 365;
  if (loan.basis !== 'monthly_compound') return pending + principal * r * daysFrom(from, to);
  let d = from;
  let p = pending;
  while (d < to) {
    const stop = nextMonthStart(d) < to ? nextMonthStart(d) : to;
    p += (principal + p) * r * daysFrom(d, stop);
    d = stop;
  }
  return p;
}

/** The loan worked to `asOf`: principal outstanding and interest due (repayments on or before `asOf`). */
export function loanState(loan: Pick<AgriLoan, 'date' | 'principal' | 'rate_pct' | 'basis' | 'repayments'>, asOf: string): LoanState {
  let principal = num(loan.principal);
  let pending = 0;
  let at = loan.date;
  for (const r of [...(loan.repayments ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
    if (r.date > asOf) break;
    pending = accrue(loan, principal, pending, at, r.date);
    pending -= num(r.interest_part);
    principal -= num(r.principal_part);
    at = r.date;
  }
  if (asOf > at) pending = accrue(loan, principal, pending, at, asOf);
  const p = round2(Math.max(principal, 0));
  const i = round2(Math.max(pending, 0));
  return { principal: p, interest: i, total: round2(p + i), asOf };
}

/** Split a repayment interest first (interest due at its date), then principal; never more than the total due. */
export function splitRepayment(loan: Pick<AgriLoan, 'date' | 'principal' | 'rate_pct' | 'basis' | 'repayments'>, date: string, amount: number): { interest_part: number; principal_part: number } {
  const s = loanState(loan, date);
  const amt = round2(num(amount));
  if (!(amt > 0)) throw new Error('Enter the amount repaid.');
  if (amt > s.total + 0.005) throw new Error(`Only ₹${s.total.toFixed(2)} is due on ${date} (principal ${s.principal.toFixed(2)} + interest ${s.interest.toFixed(2)}).`);
  const interest_part = round2(Math.min(amt, s.interest));
  return { interest_part, principal_part: round2(amt - interest_part) };
}

/** Loan-to-value (memo): principal against balance bags × the typed market rate per bag. Warning only. */
export function ltvWarning(principal: number, bags: number, bagRate: number | undefined, maxPct: number | undefined): string | undefined {
  if (!(num(maxPct) > 0) || !(num(bagRate) > 0)) return undefined;
  const cap = round2((num(bags) * num(bagRate) * num(maxPct)) / 100);
  return num(principal) > cap + 0.005 ? `Loan ₹${round2(num(principal)).toFixed(2)} is above ${num(maxPct)}% of the stored value (₹${cap.toFixed(2)} at ₹${num(bagRate)} a bag) — check the security.` : undefined;
}

/** Open loans (anything due at `asOf`) with a lien on the lot. */
export const liensOn = (lotId: string, loans: readonly AgriLoan[], asOf: string): AgriLoan[] => loans.filter((l) => l.status !== 'closed' && l.lot_ids.includes(lotId) && loanState(l, asOf).total > 0);

/**
 * A partial release under a lien is allowed when the bags left in ALL the loan's lots still cover what is due at
 * `ltvPct` of the loan's typed bag rate (setting `release_ltv_pct`; absent / no bag rate = never).
 */
export function releaseCovered(loan: AgriLoan, lots: readonly ColdLot[], lotId: string, bags: number, asOf: string, ltvPct: number | undefined): boolean {
  if (!(num(ltvPct) > 0) || !(num(loan.bag_rate) > 0)) return false;
  const left = lots.filter((l) => loan.lot_ids.includes(l.id)).reduce((s, l) => s + lotBalance(l) - (l.id === lotId ? num(bags) : 0), 0);
  return (left * num(loan.bag_rate) * num(ltvPct)) / 100 + 0.005 >= loanState(loan, asOf).total;
}

/** Interest statement rows: disbursement and each repayment with days, interest accrued, split and balance. */
export function interestStatement(loan: AgriLoan, asOf: string): { date: string; what: string; days: number; interest: number; paid: number; principal: number }[] {
  const rows = [{ date: loan.date, what: `Disbursed ${loan.number}`, days: 0, interest: 0, paid: 0, principal: round2(num(loan.principal)) }];
  let prev = loan.date;
  const done: AgriLoanRepayment[] = [];
  const step = (date: string, what: string, paid: number) => {
    const before = loanState({ ...loan, repayments: done }, date);
    const was = loanState({ ...loan, repayments: done }, prev);
    rows.push({ date, what, days: daysFrom(prev, date), interest: round2(before.interest - was.interest), paid, principal: before.principal });
    prev = date;
  };
  for (const r of [...loan.repayments].sort((a, b) => a.date.localeCompare(b.date))) {
    if (r.date > asOf) break;
    step(r.date, `Repaid ${r.receipt_no ?? ''}`.trim(), r.amount);
    done.push(r);
    rows[rows.length - 1].principal = loanState({ ...loan, repayments: done }, r.date).principal;
  }
  if (asOf > prev) step(asOf, 'Interest to date', 0);
  return rows;
}

/** Loans past their due date with anything due (the bell / list flag). */
export const overdueLoans = (loans: readonly AgriLoan[], today: string): AgriLoan[] => loans.filter((l) => l.status !== 'closed' && l.due_date && l.due_date < today && loanState(l, today).total > 0);

/* ── Storage ── */

export const loadLoans = (): AgriLoan[] => getTable<AgriLoan>(LOANS_TABLE).filter((r) => r && typeof r.id === 'string').map((r) => ({ ...r, lot_ids: Array.isArray(r.lot_ids) ? r.lot_ids : [], repayments: Array.isArray(r.repayments) ? r.repayments : [] }));
const writeLoans = (rows: AgriLoan[]) => setTable(LOANS_TABLE, rows);
const ledger = () => ensureLedger(LOAN_LEDGER, 'LOANS_ADV_ST', 3400);
const money = (by: 'bank' | 'cash') => (by === 'cash' ? A.cash : A.bank);

export interface LoanInput {
  date: string;
  borrower_id: string;
  borrower_name: string;
  lot_ids: string[];
  principal: number;
  rate_pct: number;
  basis?: AgriLoan['basis'];
  due_date?: string;
  max_ltv_pct?: number;
  bag_rate?: number;
  disbursed_by: 'bank' | 'cash';
}

/** Give a loan (`LAS/FY…`) and post the disbursement payment voucher. */
export function giveLoan(i: LoanInput): AgriLoan {
  requireAccess('books.edit');
  if (!DAY.test(i.date)) throw new Error('Choose the loan date.');
  if (!i.borrower_id) throw new Error('Choose the borrower.');
  if (!i.lot_ids.length) throw new Error('Choose the lot(s) the loan is against.');
  const principal = round2(num(i.principal));
  if (!(principal > 0)) throw new Error('Enter the loan amount.');
  if (!(num(i.rate_pct) >= 0 && num(i.rate_pct) <= 60)) throw new Error('Interest is 0 to 60% a year.');
  if (i.due_date && (!DAY.test(i.due_date) || i.due_date < i.date)) throw new Error('The due date is before the loan date.');
  const all = loadLoans();
  const number = nextSeriesNumberFor(AG_SERIES.las, i.date, all.map((l) => l.number));
  return withTablesRollback([LOANS_TABLE, 'vouchers', 'accounts', 'series_counters'], () => {
    const v = postPair({ type: 'PAYMENT', date: i.date, dr: ledger(), cr: money(i.disbursed_by), amount: principal, narration: `Loan ${number} to ${i.borrower_name} against stored lots`, cls: 'Loan against produce', drParty: i.borrower_name });
    const loan: AgriLoan = {
      id: generateId(), number, date: i.date, borrower_id: i.borrower_id, borrower_name: i.borrower_name.trim(), lot_ids: [...new Set(i.lot_ids)], principal, rate_pct: num(i.rate_pct),
      basis: i.basis === 'monthly_compound' ? 'monthly_compound' : 'simple', disbursed_by: i.disbursed_by, payment_voucher_id: v.id, repayments: [], status: 'open', created_at: new Date().toISOString(),
      ...(i.due_date ? { due_date: i.due_date } : {}), ...(num(i.max_ltv_pct) > 0 ? { max_ltv_pct: num(i.max_ltv_pct) } : {}), ...(num(i.bag_rate) > 0 ? { bag_rate: round2(num(i.bag_rate)) } : {}),
    };
    writeLoans([...all, loan]);
    recordSeries(number);
    return loan;
  });
}

/** Record a repayment (interest first): RECEIPT Dr bank / cash | Cr loan ledger + Cr interest income. Closes at zero. */
export function repayLoan(loanId: string, r: { date: string; amount: number; by: 'bank' | 'cash' }): AgriLoan {
  requireAccess('books.edit');
  const all = loadLoans();
  const loan = all.find((l) => l.id === loanId);
  if (!loan) throw new Error('Loan not found.');
  if (!DAY.test(r.date) || r.date < loan.date) throw new Error('Choose a repayment date on or after the loan date.');
  if (loan.repayments.some((p) => p.date > r.date)) throw new Error('A later repayment is already recorded: record repayments in date order.');
  const split = splitRepayment(loan, r.date, r.amount);
  const amount = round2(num(r.amount));
  return withTablesRollback([LOANS_TABLE, 'vouchers', 'accounts'], () => {
    const p = (n: number) => Math.round(n * 100);
    const v = saveVoucher({
      type: 'RECEIPT', date: r.date, narration: `Repayment of loan ${loan.number} by ${loan.borrower_name}: principal ${split.principal_part.toFixed(2)}, interest ${split.interest_part.toFixed(2)} (interest exempt — verify with your CA)`,
      lines: [
        { account_id: money(r.by), dr: p(amount), cr: 0 },
        ...(split.principal_part > 0 ? [{ account_id: ledger(), dr: 0, cr: p(split.principal_part), party: loan.borrower_name }] : []),
        ...(split.interest_part > 0 ? [{ account_id: ensureLedger(INTEREST_LEDGER, 'OTHER_INCOME', 4930), dr: 0, cr: p(split.interest_part) }] : []),
      ],
      voucher_class: 'Loan against produce',
    });
    const rep: AgriLoanRepayment = { id: generateId(), date: r.date, amount, ...split, receipt_id: v.id, receipt_no: v.number };
    const repayments = [...loan.repayments, rep];
    const next: AgriLoan = { ...loan, repayments, status: loanState({ ...loan, repayments }, r.date).total <= 0 ? 'closed' : 'open' };
    writeLoans(all.map((l) => (l.id === loanId ? next : l)));
    return next;
  });
}

/** Undo the latest repayment (its receipt voucher is deleted; the period lock applies through the voucher). */
export function undoRepayment(loanId: string): AgriLoan {
  requireAccess('books.edit');
  const all = loadLoans();
  const loan = all.find((l) => l.id === loanId);
  const last = loan && [...loan.repayments].sort((a, b) => a.date.localeCompare(b.date)).pop();
  if (!loan || !last) throw new Error('No repayment to undo.');
  return withTablesRollback([LOANS_TABLE, 'vouchers'], () => {
    deleteVoucher(last.receipt_id);
    const next: AgriLoan = { ...loan, repayments: loan.repayments.filter((p) => p.id !== last.id), status: 'open' };
    writeLoans(all.map((l) => (l.id === loanId ? next : l)));
    return next;
  });
}

/** Delete a loan with no repayments, and its disbursement voucher (to the recycle bin); its number stays used. */
export function deleteLoan(loanId: string): void {
  requireAccess('books.edit');
  const all = loadLoans();
  const loan = all.find((l) => l.id === loanId);
  if (!loan) return;
  if (loan.repayments.length) throw new Error('Undo the repayments first.');
  withTablesRollback([LOANS_TABLE, 'vouchers'], () => {
    if (loan.payment_voucher_id) deleteVoucher(loan.payment_voucher_id);
    writeLoans(all.filter((l) => l.id !== loanId));
  });
}
