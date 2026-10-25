/**
 * Funds flow statement (WP-2, P2): sources and applications of funds between the period's opening
 * and closing balance sheets; the difference is the change in working capital (current assets incl.
 * closing stock − current liabilities). Funds from operations = net profit + depreciation.
 * Pure. Working papers — verify with your CA.
 */

import { dayBefore, type Period } from '../books';
import type { Ledger } from './postings';
import type { StockValuer } from './closing-stock';
import { closingBalances, ledgerProfitAndLoss } from './reports';
import { accountGroupId, isPnlNature, natureOfGroup } from './report-groups';

export interface FundsFlowLine {
  label: string;
  amount: number;
}

export interface FundsFlow {
  period: Period;
  sources: FundsFlowLine[];
  applications: FundsFlowLine[];
  totalSources: number;
  totalApplications: number;
  openingWorkingCapital: number;
  closingWorkingCapital: number;
  /** Sources − applications − change in working capital: 0 for consistent books. */
  difference: number;
}

const NON_CURRENT: Record<string, string> = {
  CAPITAL: 'Capital',
  RESERVES: 'Reserves (direct entries)',
  LOANS_LT: 'Long-term borrowings',
  FIXED_ASSETS: 'Fixed assets',
  INVESTMENTS: 'Investments',
  LOANS_ADV_LT: 'Long-term loans & advances',
};

export function fundsFlow(ledger: Ledger, period: Period, stock?: StockValuer): FundsFlow {
  const before = dayBefore(period.start);
  const open = closingBalances(ledger, before);
  const pl = ledgerProfitAndLoss(ledger, period, stock);
  // Raw movements inside the window (no FY folding): double entry makes them sum to zero.
  const mv = new Map<string, number>();
  for (const v of ledger.vouchers) {
    if (v.date < period.start || v.date > period.end) continue;
    for (const l of v.lines) mv.set(l.account, (mv.get(l.account) ?? 0) + l.dr - l.cr);
  }
  let wcOpen = stock ? stock.value(before) : 0;
  let wcClose = stock ? stock.value(period.end) : 0;
  const moves = new Map<string, number>();
  let depreciation = 0;
  for (const a of ledger.accounts) {
    const g = accountGroupId(a);
    if (isPnlNature(natureOfGroup(g))) continue;
    const m = mv.get(a.id) ?? 0;
    const label = NON_CURRENT[g];
    if (label) {
      if (a.id === 'acc_dep') depreciation -= m;
      else if (m) moves.set(label, (moves.get(label) ?? 0) + m);
    } else {
      const o = open.get(a.id) ?? 0;
      wcOpen += o;
      wcClose += o + m;
    }
  }
  // Opening stock brought in is a capital source (difference in opening balances), not profit.
  const openingStockIn = stock ? stock.openingIn(period.end) - stock.openingIn(before) : 0;
  const sources: FundsFlowLine[] = [];
  const applications: FundsFlowLine[] = [];
  const fromOps = pl.netProfit + depreciation;
  if (fromOps >= 0) sources.push({ label: 'Funds from operations (net profit + depreciation)', amount: fromOps });
  else applications.push({ label: 'Funds lost in operations', amount: -fromOps });
  if (openingStockIn) sources.push({ label: 'Opening stock brought in', amount: openingStockIn });
  for (const [label, debitMove] of moves) {
    // A debit movement in a non-current account used funds (asset bought / loan repaid / drawings).
    if (debitMove > 0) applications.push({ label: `${label}: increase / repayment`, amount: debitMove });
    else sources.push({ label: `${label}: raised / sold`, amount: -debitMove });
  }
  const totalSources = sources.reduce((s, l) => s + l.amount, 0);
  const totalApplications = applications.reduce((s, l) => s + l.amount, 0);
  return {
    period,
    sources,
    applications,
    totalSources,
    totalApplications,
    openingWorkingCapital: wcOpen,
    closingWorkingCapital: wcClose,
    difference: totalSources - totalApplications - (wcClose - wcOpen),
  };
}
