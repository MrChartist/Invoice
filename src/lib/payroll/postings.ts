/**
 * Payroll → double-entry ledger (Phase 7). Like every automatic voucher, these are DERIVED from
 * the stored runs / payments each time the ledger is built; nothing is stored twice. Amounts come
 * from the run's payslip snapshot, so later changes to structures never change a posted month.
 *
 *   Payroll voucher (final run)
 *     Dr each earning's account (Salaries & wages / Allowances & overtime / Bonus …), per cost centre
 *     Cr Salary payable (net) · PF payable (employee PF) · ESI payable · Professional tax payable ·
 *        TDS payable — salaries (192) · other deductions to their own account (loan recovery → Loans
 *        & advances to employees)
 *     Dr Employer's contribution to PF / ESI, PF admin & EDLI charges | Cr PF payable / ESI payable
 *   Payroll payment   Dr Salary payable / PF / ESI / PT / TDS payable | Cr the cash / bank account
 *   Loan / advance    Dr Loans & advances to employees (3615) | Cr the cash / bank account (7P); EMIs
 *                     come back through the Payroll voucher (Cr 3615 principal, Cr Interest received)
 *
 * Pure (no storage). Working papers — verify with your CA.
 */

import type { PayrollPayment, PayrollRun, StatutoryKind } from '../../types/payroll';
import { A } from '../ledger/accounts';
import type { LedgerVoucher, PostingLine } from '../ledger/postings';

/** Credit side of statutory deductions / employer contributions. */
export const STATUTORY_PAYABLE: Record<StatutoryKind, string> = {
  pf: A.pfPayable,
  esi: A.esiPayable,
  pt: A.ptPayable,
  tds: A.tdsSalaryPayable,
  pf_er: A.pfPayable,
  esi_er: A.esiPayable,
  pf_admin: A.pfPayable,
};

const toPaise = (rupees: number): number => Math.round(Math.round(rupees * 1000) / 10);

class Agg {
  private readonly map = new Map<string, PostingLine>();
  add(account: string, paise: number, debit: boolean, costCentre?: string): void {
    const p = Math.round(paise);
    if (!p) return;
    const isDr = p > 0 ? debit : !debit;
    const key = `${account}|${isDr ? 'D' : 'C'}|${costCentre ?? ''}`;
    const cur = this.map.get(key) ?? { account, dr: 0, cr: 0, ...(costCentre ? { cost_centre: costCentre } : {}) };
    if (isDr) cur.dr += Math.abs(p);
    else cur.cr += Math.abs(p);
    this.map.set(key, cur);
  }
  lines(): PostingLine[] {
    return [...this.map.values()].sort((a, b) => (b.dr > 0 ? 1 : 0) - (a.dr > 0 ? 1 : 0) || a.account.localeCompare(b.account));
  }
}

const EMPLOYER_PAYABLE: Partial<Record<StatutoryKind, string>> = { pf_er: A.pfPayable, pf_admin: A.pfPayable, esi_er: A.esiPayable };

/** The Payroll voucher for a FINAL run (null for drafts / empty runs). */
export function payrollVoucher(run: PayrollRun): LedgerVoucher | null {
  if (run.status !== 'final' || !run.lines.length) return null;
  const g = new Agg();
  for (const l of run.lines) {
    const cc = l.cost_centre_id || undefined;
    for (const e of l.earnings) g.add(e.account_id, toPaise(e.amount), true, cc);
    for (const d of l.deductions) {
      // 7P: a loan EMI credits its interest part to Interest received, the principal to the loan account.
      const interest = d.tag === 'loan' && d.interest ? Math.min(toPaise(d.interest), toPaise(d.amount)) : 0;
      if (interest > 0) g.add(A.interestIncome, interest, false);
      g.add(d.statutory ? STATUTORY_PAYABLE[d.statutory] : d.account_id, toPaise(d.amount) - interest, false);
    }
    g.add(A.salaryPayable, toPaise(l.net), false);
    for (const x of l.employer) {
      g.add(x.account_id, toPaise(x.amount), true, cc);
      g.add((x.statutory && EMPLOYER_PAYABLE[x.statutory]) || A.provisions, toPaise(x.amount), false);
    }
  }
  const lines = g.lines();
  // Paise rounding of a hand-typed override can leave a 1-paisa residue: absorb it in Salary payable.
  const diff = lines.reduce((s, x) => s + x.dr - x.cr, 0);
  if (diff !== 0 && Math.abs(diff) <= run.lines.length) {
    const sp = lines.find((x) => x.account === A.salaryPayable && x.cr > 0);
    if (sp) sp.cr += diff;
  }
  return {
    id: `prl:${run.id}`,
    source: 'auto',
    kind: 'Payroll',
    date: run.date,
    number: run.number,
    party: '',
    narration: `Payroll for ${run.month} · ${run.lines.length} employee${run.lines.length === 1 ? '' : 's'}`,
    lines,
    link: `/payroll?tab=run&month=${run.month}`,
  };
}

const PAYMENT_ACCOUNT: Record<PayrollPayment['kind'], string> = {
  salary: A.salaryPayable,
  pf: A.pfPayable,
  esi: A.esiPayable,
  pt: A.ptPayable,
  tds: A.tdsSalaryPayable,
  loan: A.staffAdvances,
};

const PAYMENT_WORD: Record<PayrollPayment['kind'], string> = {
  salary: 'Salary paid',
  pf: 'PF paid (EPFO)',
  esi: 'ESI paid (ESIC)',
  pt: 'Professional tax paid',
  tds: 'TDS on salary paid (192)',
  loan: 'Loan / advance to employee',
};

export function payrollPaymentVoucher(p: PayrollPayment): LedgerVoucher | null {
  const amount = toPaise(p.amount);
  if (amount <= 0) return null;
  return {
    id: `prp:${p.id}`,
    source: 'auto',
    kind: 'Payment',
    date: p.date,
    number: p.reference || p.number,
    party: '',
    narration: [PAYMENT_WORD[p.kind], p.period && `for ${p.period}`, p.number].filter(Boolean).join(' · '),
    lines: [
      { account: PAYMENT_ACCOUNT[p.kind], dr: amount, cr: 0 },
      { account: p.paid_from || A.bank, dr: 0, cr: amount },
    ],
    link: '/payroll?tab=payments',
  };
}

export function payrollVouchers(runs: readonly PayrollRun[], payments: readonly PayrollPayment[]): LedgerVoucher[] {
  const out: LedgerVoucher[] = [];
  for (const r of runs) {
    const v = payrollVoucher(r);
    if (v) out.push(v);
  }
  for (const p of payments) {
    const v = payrollPaymentVoucher(p);
    if (v) out.push(v);
  }
  return out;
}
