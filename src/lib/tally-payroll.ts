/**
 * Tally export of payroll (7P). A fragment for `tally-xml.ts`, called with one line inside its
 * books block; the vouchers are rendered by the same `voucherXml`.
 *
 *   Payroll (final run)   Journal: Dr each earning / employer-contribution ledger (cost centre = the
 *                         employee's department) | Cr each employee's ledger (net pay), PF / ESI / PT /
 *                         TDS 192 payable, loan recoveries (Loans & advances to employees, Interest
 *                         received), other deductions.
 *   Salary payment        Payment: Dr the employees' ledgers (by net pay of the run) or Salary payable
 *                         | Cr bank / cash.
 *   Statutory payment     Payment: Dr PF / ESI / PT / TDS 192 payable | Cr bank / cash.
 *   Loan to an employee   Payment: Dr Loans & advances to employees | Cr bank / cash.
 *
 * Employee ledgers are named "<name> (<code>)" under Current Liabilities (Tally's "Employee" masters
 * are payroll-module objects; ledgers keep the import to plain accounting). Pure: everything comes
 * in through `TallyBooksSource` (`payrollRuns`, `payrollPayments`, read only when the user may see
 * payroll). Working papers — verify with your CA before importing into Tally.
 */

import { A } from './ledger/accounts';
import { inRange, toPaise } from './export-shared';
import { ledgerResolver, type BooksLedgerNames, type RegisterBooksLedger, type TallyBooksSource } from './tally-books';
import type { TallyEntry, TallyVoucher } from './tally-xml';
import { normalizePayments, normalizeRuns } from './payroll/records';
import { STATUTORY_PAYABLE } from './payroll/postings';
import type { PayrollRun, PayslipLine } from '../types/payroll';

export const TDS_192_LEDGER = 'TDS Payable 192';

const employeeLedger = (l: Pick<PayslipLine, 'name' | 'code'>) => `${l.name} (${l.code})`;

class Entries {
  private readonly map = new Map<string, TallyEntry>();
  add(ledger: string, side: 'Dr' | 'Cr', paise: number, cc?: string): void {
    if (paise === 0) return;
    const s = paise > 0 ? side : side === 'Dr' ? 'Cr' : 'Dr';
    const p = Math.abs(paise);
    const key = `${ledger}|${s}`;
    const cur = this.map.get(key) ?? { ledger, side: s, paise: 0 };
    cur.paise += p;
    if (cc) {
      const list = cur.costCentres ?? [];
      const hit = list.find((c) => c.name === cc);
      if (hit) hit.paise += p;
      else list.push({ name: cc, paise: p });
      cur.costCentres = list;
    }
    this.map.set(key, cur);
  }
  list(): TallyEntry[] {
    return [...this.map.values()].filter((e) => e.paise > 0).sort((a, b) => (a.side === b.side ? a.ledger.localeCompare(b.ledger) : a.side === 'Dr' ? -1 : 1));
  }
}

function voucher(type: TallyVoucher['type'], date: string, number: string, narration: string, entries: TallyEntry[], reference = ''): TallyVoucher {
  return { type, date, number, party: '', partyGstin: '', stateName: '', narration, reference, entries, inventory: [], inventoryLedger: '' };
}

/** Payroll vouchers dated in `o.range`; registers the ledgers (and employee ledgers) they use. */
export function payrollTallyVouchers(src: TallyBooksSource, o: BooksLedgerNames, addLedger: RegisterBooksLedger): TallyVoucher[] {
  const runs = normalizeRuns(src.payrollRuns ?? []).filter((r) => r.status === 'final' && r.lines.length);
  const payments = normalizePayments(src.payrollPayments ?? []);
  if (!runs.length && !payments.length) return [];
  const resolve = ledgerResolver(src, o, addLedger);
  const ledgerOf = (account: string): string => {
    if (account === A.tdsSalaryPayable) {
      addLedger({ name: TDS_192_LEDGER, parent: 'Duties & Taxes' });
      return TDS_192_LEDGER;
    }
    return resolve(account);
  };
  const centres = new Map((src.costCentres ?? []).map((c) => [c.id, c.name]));
  const empLedger = (l: PayslipLine) => {
    const name = employeeLedger(l);
    addLedger({ name, parent: 'Current Liabilities' });
    return name;
  };
  const out: TallyVoucher[] = [];
  const runById = new Map<string, PayrollRun>();

  for (const run of runs) {
    runById.set(run.id, run);
    if (!inRange(run.date, o.range)) continue;
    const e = new Entries();
    for (const l of run.lines) {
      const cc = l.cost_centre_id ? centres.get(l.cost_centre_id) : undefined;
      const dr = (account: string, paise: number) => {
        const name = ledgerOf(account);
        if (cc) addLedger({ name, parent: '', costCentres: true });
        e.add(name, 'Dr', paise, cc);
      };
      for (const x of l.earnings) dr(x.account_id, toPaise(x.amount));
      for (const d of l.deductions) {
        const interest = d.tag === 'loan' && d.interest ? Math.min(toPaise(d.interest), toPaise(d.amount)) : 0;
        if (interest) e.add(ledgerOf(A.interestIncome), 'Cr', interest);
        e.add(ledgerOf(d.statutory ? STATUTORY_PAYABLE[d.statutory] : d.account_id), 'Cr', toPaise(d.amount) - interest);
      }
      e.add(empLedger(l), 'Cr', toPaise(l.net));
      for (const x of l.employer) {
        dr(x.account_id, toPaise(x.amount));
        e.add(ledgerOf(x.statutory ? STATUTORY_PAYABLE[x.statutory] : A.provisions), 'Cr', toPaise(x.amount));
      }
    }
    const entries = e.list();
    // Paise residue from hand-typed overrides goes to Round Off so Tally accepts the voucher.
    const net = entries.reduce((s, x) => s + (x.side === 'Cr' ? x.paise : -x.paise), 0);
    if (net > 0) entries.push({ ledger: ledgerOf(A.roundOff), side: 'Dr', paise: net });
    else if (net < 0) entries.push({ ledger: ledgerOf(A.roundOff), side: 'Cr', paise: -net });
    out.push(voucher('Journal', run.date, run.number, `Payroll for ${run.month} · ${run.lines.length} employee${run.lines.length === 1 ? '' : 's'} (payroll working — verify with your CA)`, entries));
  }

  const PAYABLE: Record<string, string> = { pf: A.pfPayable, esi: A.esiPayable, pt: A.ptPayable, tds: A.tdsSalaryPayable, loan: A.staffAdvances };
  for (const p of payments) {
    if (!inRange(p.date, o.range)) continue;
    const amount = toPaise(p.amount);
    if (amount <= 0) continue;
    const e = new Entries();
    if (p.kind === 'salary') {
      const run = p.run_id ? runById.get(p.run_id) : undefined;
      const totalNet = run ? run.lines.reduce((s, l) => s + Math.max(0, toPaise(l.net)), 0) : 0;
      if (run && totalNet > 0) {
        // Split by each employee's net pay; the last takes the paise left over.
        const lines = run.lines.filter((l) => toPaise(l.net) > 0);
        let left = amount;
        lines.forEach((l, i) => {
          const share = i === lines.length - 1 ? left : Math.round((amount * toPaise(l.net)) / totalNet);
          left -= share;
          e.add(empLedger(l), 'Dr', share);
        });
      } else {
        e.add(ledgerOf(A.salaryPayable), 'Dr', amount);
      }
    } else {
      e.add(ledgerOf(PAYABLE[p.kind]), 'Dr', amount);
    }
    e.add(ledgerOf(p.paid_from || A.bank), 'Cr', amount);
    const word = { salary: 'Salary paid', pf: 'PF paid (EPFO)', esi: 'ESI paid (ESIC)', pt: 'Professional tax paid', tds: 'TDS on salary paid (192)', loan: 'Loan / advance to employee' }[p.kind];
    const challan = p.kind === 'tds' && p.bsr_code ? `BSR ${p.bsr_code} / challan ${p.challan_no ?? ''}` : '';
    out.push(voucher('Payment', p.date, p.number, [word, p.period && `for ${p.period}`, challan, p.reference && `Ref ${p.reference}`].filter(Boolean).join(' | '), e.list(), p.reference ?? ''));
  }
  return out;
}
