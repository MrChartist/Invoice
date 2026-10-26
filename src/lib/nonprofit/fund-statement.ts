/**
 * R5-C4 fund statement, read from the ledger's posting lines tagged with the fund (`PostingLine.cost_centre`):
 *  - receipts  = credits less debits on income and own-funds (reserves / capital) ledgers — donations, grants,
 *                corpus; interest is the part on ledgers named "interest";
 *  - utilisation = debits less credits on expense ledgers and fixed assets (capital expenditure), by ledger;
 *  - transfers = the "Inter-fund transfers" ledger (in = credit, out = debit);
 *  - closing   = opening + receipts + transfers − utilisation (an unrestricted fund may go negative: warning only).
 * Corpus donations credit the corpus fund ledger, never income. Amounts in rupees. Pure. Working paper.
 */
import type { Period } from '../books';
import type { Ledger } from '../ledger/postings';
import { groupOf, type Account } from '../ledger/accounts';
import { round2 } from '../invoice-calc';
import { toCsv } from '../csv';
import { INTER_FUND_ACCOUNT } from '../institutions/r5c';
import type { Fund } from './funds';

export interface FundLine {
  account: Account;
  amount: number;
}
export interface FundStatement {
  fund: Fund;
  opening: number;
  receipts: FundLine[];
  receiptsTotal: number;
  interest: number;
  utilisation: FundLine[];
  utilisationTotal: number;
  transfersIn: number;
  transfersOut: number;
  closing: number;
  /** Closing below zero (restricted / corpus / FCRA: overspent; unrestricted: allowed with a warning). */
  negative: boolean;
}

export type LineRole = 'receipt' | 'use' | 'transfer' | '';

/** What a tagged line means for a fund. */
export function roleOf(a: Account | undefined): LineRole {
  if (!a) return '';
  if (a.name === INTER_FUND_ACCOUNT) return 'transfer';
  const g = groupOf(a.group);
  if (g.nature === 'income' || a.group === 'RESERVES' || a.group === 'CAPITAL') return 'receipt';
  if (g.nature === 'expense' || a.group === 'FIXED_ASSETS') return 'use';
  return '';
}

const add = (m: Map<string, FundLine>, a: Account, v: number) => {
  const r = m.get(a.id) ?? { account: a, amount: 0 };
  r.amount = round2(r.amount + v);
  m.set(a.id, r);
};

export function fundStatement(ledger: Ledger, fund: Fund, period: Period): FundStatement {
  let opening = 0;
  let tin = 0;
  let tout = 0;
  let interest = 0;
  const rec = new Map<string, FundLine>();
  const use = new Map<string, FundLine>();
  for (const v of ledger.vouchers) {
    if (v.date > period.end) continue;
    const before = v.date < period.start;
    for (const l of v.lines) {
      if (l.cost_centre !== fund.id) continue;
      const a = ledger.byId.get(l.account);
      const role = roleOf(a);
      const net = (l.cr - l.dr) / 100;
      if (!role || !a) continue;
      if (before) {
        opening += net;
        continue;
      }
      if (role === 'receipt') {
        add(rec, a, net);
        if (/interest/i.test(a.name)) interest += net;
      } else if (role === 'use') add(use, a, -net);
      else if (net > 0) tin += net;
      else tout -= net;
    }
  }
  const receipts = [...rec.values()].filter((r) => r.amount);
  const utilisation = [...use.values()].filter((r) => r.amount);
  const receiptsTotal = round2(receipts.reduce((s, r) => s + r.amount, 0));
  const utilisationTotal = round2(utilisation.reduce((s, r) => s + r.amount, 0));
  const closing = round2(opening + receiptsTotal + tin - tout - utilisationTotal);
  return { fund, opening: round2(opening), receipts, receiptsTotal, interest: round2(interest), utilisation, utilisationTotal, transfersIn: round2(tin), transfersOut: round2(tout), closing, negative: closing < -0.004 };
}

export function fundStatementCsv(s: FundStatement, head: { opening: string; receipts: string; utilisation: string; tin: string; tout: string; closing: string }): string {
  const rows: unknown[][] = [[s.fund.name, s.fund.fund.nature], [head.opening, s.opening]];
  for (const r of s.receipts) rows.push([`${head.receipts}: ${r.account.name}`, r.amount]);
  rows.push([head.tin, s.transfersIn]);
  for (const r of s.utilisation) rows.push([`${head.utilisation}: ${r.account.name}`, -r.amount]);
  rows.push([head.tout, -s.transfersOut], [head.closing, s.closing]);
  return toCsv(rows);
}
