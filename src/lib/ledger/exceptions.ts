/**
 * Exception reports (WP-2, P1-5): negative ledgers (cash / bank below zero on any day, debtors in
 * credit, creditors in debit, assets with credit and liabilities with debit balances), negative
 * stock, overdue receivables, post-dated vouchers (dated after today) and vouchers the ledger left
 * out. Memorandum / optional / reversing registers appear here once WIP-C's voucher classes exist
 * (any ledger voucher kind the caller passes in `extraKinds`).
 * Pure. Working papers — verify with your CA.
 */

import type { Period } from '../books';
import type { StockPosition } from '../inventory';
import type { Ledger, LedgerVoucher } from './postings';
import { closingBalances } from './reports';
import { partyFigures } from './group-summary';
import { accountGroupId, natureOfGroup } from './report-groups';

export interface NegativeLedger {
  accountId: string;
  label: string;
  party?: string;
  /** Signed debit-positive balance that is "wrong-sided". */
  balance: number;
  /** For cash / bank: first day the balance went below zero, and its lowest point. */
  firstDate?: string;
  lowest?: number;
  reason: 'cash_negative' | 'debtor_credit' | 'creditor_debit' | 'asset_credit' | 'liability_debit';
}

export interface NegativeStockRow {
  itemId: string;
  name: string;
  firstDate: string;
  lowestQty: number;
  closingQty: number;
}

export interface OverdueBill {
  party: string;
  number: string;
  dueDate: string;
  outstanding: number;
  daysOverdue: number;
  invoiceId?: string;
}

export interface ExceptionReport {
  period: Period;
  negativeLedgers: NegativeLedger[];
  negativeStock: NegativeStockRow[];
  overdue: OverdueBill[];
  postDated: LedgerVoucher[];
  warnings: string[];
}

const CONTROL = new Set(['TRADE_RECEIVABLES', 'TRADE_PAYABLES']);

/** Cash-type ledgers that dipped below zero on any day up to the period end. */
function cashDips(ledger: Ledger, period: Period): NegativeLedger[] {
  const out: NegativeLedger[] = [];
  for (const a of ledger.accounts) {
    if (accountGroupId(a) !== 'CASH_BANK') continue;
    let bal = 0;
    let first = '';
    let lowest = 0;
    let i = 0;
    const vs = ledger.vouchers;
    while (i < vs.length && vs[i].date <= period.end) {
      const day = vs[i].date;
      while (i < vs.length && vs[i].date === day) {
        for (const l of vs[i].lines) if (l.account === a.id) bal += l.dr - l.cr;
        i++;
      }
      // End-of-day balance, judged inside the period only.
      if (day >= period.start && bal < 0) {
        if (!first) first = day;
        lowest = Math.min(lowest, bal);
      }
    }
    if (first) out.push({ accountId: a.id, label: a.name, balance: bal, firstDate: first, lowest, reason: 'cash_negative' });
  }
  return out;
}

export function negativeLedgers(ledger: Ledger, period: Period): NegativeLedger[] {
  const out = cashDips(ledger, period);
  const bal = closingBalances(ledger, period.end);
  for (const a of ledger.accounts) {
    const g = accountGroupId(a);
    if (CONTROL.has(g)) {
      for (const [p, f] of partyFigures(ledger, a.id, period)) {
        if (g === 'TRADE_RECEIVABLES' && f.closing < 0) out.push({ accountId: a.id, label: a.name, party: p, balance: f.closing, reason: 'debtor_credit' });
        if (g === 'TRADE_PAYABLES' && f.closing > 0) out.push({ accountId: a.id, label: a.name, party: p, balance: f.closing, reason: 'creditor_debit' });
      }
      continue;
    }
    // Contra / mixed-side ledgers are not exceptions: tax ledgers, accumulated depreciation, drawings, opening difference.
    if (g === 'CASH_BANK' || g === 'DUTIES_TAXES' || a.id === 'acc_dep' || a.id === 'drawings' || a.id === 'opening_diff') continue;
    const b = bal.get(a.id) ?? 0;
    const n = natureOfGroup(g);
    if (n === 'asset' && b < 0) out.push({ accountId: a.id, label: a.name, balance: b, reason: 'asset_credit' });
    if ((n === 'liability' || n === 'equity') && b > 0 && a.id !== 'reserves') out.push({ accountId: a.id, label: a.name, balance: b, reason: 'liability_debit' });
  }
  return out;
}

/** Items whose running quantity went below zero on or before the period end. */
export function negativeStock(positions: readonly StockPosition[], period: Period): NegativeStockRow[] {
  const out: NegativeStockRow[] = [];
  for (const p of positions) {
    if (!p.item.track_stock) continue;
    let first = '';
    let lowest = 0;
    let closing = 0;
    for (const r of p.ledger) {
      if (r.date && r.date > period.end) break;
      closing = r.balance;
      if (r.balance < 0) {
        if (!first) first = r.date;
        lowest = Math.min(lowest, r.balance);
      }
    }
    if (first) out.push({ itemId: p.item.id, name: p.item.name, firstDate: first, lowestQty: lowest, closingQty: closing });
  }
  return out;
}

export function exceptionReport(
  ledger: Ledger,
  period: Period,
  today: string,
  extra: { positions?: readonly StockPosition[]; overdue?: readonly OverdueBill[] } = {},
): ExceptionReport {
  return {
    period,
    negativeLedgers: negativeLedgers(ledger, period),
    negativeStock: extra.positions ? negativeStock(extra.positions, period) : [],
    overdue: [...(extra.overdue ?? [])].sort((a, b) => b.daysOverdue - a.daysOverdue),
    // The automatic year-end depreciation is dated 31 March of the running FY: not a post-dated entry.
    postDated: ledger.vouchers.filter((v) => v.date > today && v.kind !== 'Depreciation'),
    warnings: [...ledger.warnings],
  };
}
