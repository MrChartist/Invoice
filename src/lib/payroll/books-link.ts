/**
 * Payroll in the Books module (7P): payroll payments in the cash / bank book and Day Book, and the
 * month's salary cost in `books.profitAndLoss` (accrual: the final run's earnings + employer
 * contributions on the voucher date; cash basis: salary and statutory payments when paid).
 *
 * Kept light (records only, no payroll engine) because `books.ts` loads it. The double-entry ledger
 * keeps its own Payroll voucher (`postings.ts`); these are the Books module's simpler views of the
 * same records. Working papers — verify with your CA.
 */

import { round2 } from '../invoice-calc';
import type { PayrollPayment } from '../../types/payroll';
import { normalizePayments, normalizeRuns } from './records';

/** The parts of `books.ts`' Voucher / PnlEvent this module fills (structural, to avoid an import cycle). */
export interface PayrollBooksVoucher {
  id: string;
  date: string;
  type: 'Payment';
  number: string;
  party: string;
  narration: string;
  debit: number;
  credit: number;
  method: string;
  account: 'cash' | 'bank';
  bank_account_id?: string;
  link: string;
}

export interface PayrollPnlEvent {
  date: string;
  kind: 'expense';
  amount: number;
  category: string;
  direct: boolean;
  ref: string;
}

const PARTY: Record<PayrollPayment['kind'], string> = {
  salary: 'Employees (salary)',
  pf: 'EPFO (PF)',
  esi: 'ESIC (ESI)',
  pt: 'Professional tax',
  tds: 'Income-tax (TDS on salary, 192)',
  loan: 'Employee loan / advance',
};

/** `cash` / `bank` / `bank:<id>` / a user cash-bank ledger → the Books cash or bank book. */
function bookOf(paidFrom: string): { account: 'cash' | 'bank'; bank_account_id?: string } {
  if (paidFrom === 'bank') return { account: 'bank' };
  if (paidFrom.startsWith('bank:')) return { account: 'bank', bank_account_id: paidFrom.slice(5) || undefined };
  return { account: paidFrom === 'cash' || /cash/i.test(paidFrom) ? 'cash' : 'bank' };
}

/** Payroll payments (salary, PF, ESI, PT, TDS 192, loans to employees) as Books Payment vouchers. */
export function payrollBooksVouchers(rawPayments: readonly unknown[] | undefined): PayrollBooksVoucher[] {
  return normalizePayments([...(rawPayments ?? [])]).map((p) => {
    const book = bookOf(p.paid_from || 'bank');
    return {
      id: `prp:${p.id}`,
      date: p.date,
      type: 'Payment' as const,
      number: p.reference || p.number,
      party: PARTY[p.kind],
      narration: [`Payroll payment ${p.number}`, p.period && `for ${p.period}`].filter(Boolean).join(' · '),
      debit: p.amount,
      credit: 0,
      method: book.account === 'cash' ? 'Cash' : 'Bank transfer',
      ...book,
      link: '/payroll?tab=payments',
    };
  });
}

const CATEGORY: Record<string, string> = {
  salaries: 'Salaries & wages',
  allowances: 'Allowances & overtime',
  bonus: 'Bonus',
  gratuity: 'Gratuity',
  leave_encashment: 'Leave encashment',
  pf_employer: "Employer's contribution to PF",
  esi_employer: "Employer's contribution to ESI",
  pf_admin: 'PF admin & EDLI charges',
};

/** Salary cost for the Books P&L. Loans to employees are never an expense. */
export function payrollPnlEvents(rawRuns: readonly unknown[] | undefined, rawPayments: readonly unknown[] | undefined, basis: 'accrual' | 'cash'): PayrollPnlEvent[] {
  const out: PayrollPnlEvent[] = [];
  if (basis === 'accrual') {
    for (const r of normalizeRuns([...(rawRuns ?? [])])) {
      if (r.status !== 'final') continue;
      const byCat = new Map<string, number>();
      for (const l of r.lines) for (const x of [...l.earnings, ...l.employer]) {
        const cat = CATEGORY[x.account_id] ?? 'Salaries & wages (other heads)';
        byCat.set(cat, (byCat.get(cat) ?? 0) + x.amount);
      }
      for (const [category, amount] of byCat) if (round2(amount)) out.push({ date: r.date, kind: 'expense', amount: round2(amount), category, direct: false, ref: `prl:${r.id}` });
    }
  } else {
    for (const p of normalizePayments([...(rawPayments ?? [])])) {
      if (p.kind === 'loan') continue;
      out.push({ date: p.date, kind: 'expense', amount: p.amount, category: 'Salaries & wages (paid)', direct: false, ref: `prp:${p.id}` });
    }
  }
  return out;
}
