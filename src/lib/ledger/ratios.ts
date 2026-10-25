/**
 * Ratio analysis (Tally's "Ratio Analysis" report) from the double-entry ledger: principal groups
 * (working capital, cash, bank, bank OD, debtors, creditors, sales, purchases, stock, net profit,
 * turnovers) and principal ratios (current, quick, debt / equity, gross and net profit %, operating
 * cost %, receivable and payable days, return on investment, return on working capital).
 *
 * Formulas follow Tally's definitions where it has one (noted per item); money is integer PAISE,
 * ratios are plain numbers, a ratio whose denominator is 0 is null. Pure. Working papers — verify
 * with your CA.
 */

import type { Period } from '../books';
import { daysBetween } from '../compliance';
import { A, groupOf, type GroupId } from './accounts';
import type { Ledger } from './postings';
import { closingBalances, ledgerProfitAndLoss } from './reports';

export type RatioUnit = 'money' | 'ratio' | 'percent' | 'days' | 'times';

export interface RatioItem {
  id: string;
  label: string;
  /** Paise for money, else the number itself (percent as 12.5 = 12.5%). Null when undefined (÷ 0). */
  value: number | null;
  unit: RatioUnit;
  formula: string;
  /** Accounts behind the figure, for drill-down to the ledger. */
  accounts: string[];
}

export interface RatioAnalysis {
  period: Period;
  asOf: string;
  days: number;
  groups: RatioItem[];
  ratios: RatioItem[];
  /** Raw components (paise) — exposed for tests and the CSV. */
  parts: {
    currentAssets: number;
    currentLiabilities: number;
    workingCapital: number;
    cash: number;
    bank: number;
    bankOd: number;
    debtors: number;
    creditors: number;
    sales: number;
    purchases: number;
    stock: number;
    grossProfit: number;
    netProfit: number;
    loans: number;
    capital: number;
  };
}

const CA: readonly GroupId[] = ['INVENTORIES', 'TRADE_RECEIVABLES', 'CASH_BANK', 'LOANS_ADV_ST', 'OTHER_CA'];
const CL: readonly GroupId[] = ['LOANS_ST', 'TRADE_PAYABLES', 'DUTIES_TAXES', 'OTHER_CL', 'PROVISIONS'];

const div = (a: number, b: number): number | null => (b === 0 ? null : a / b);
const r2 = (x: number | null): number | null => (x === null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

/** `asOf` defaults to the period end. Balances are taken at the end of `asOf`; flows over `period.start`..`asOf`. */
export function ratioAnalysis(ledger: Ledger, period: Period, asOf: string = period.end): RatioAnalysis {
  const end = asOf < period.end ? asOf : period.end;
  const bal = closingBalances(ledger, end);
  const pnl = ledgerProfitAndLoss(ledger, { start: period.start, end });
  const ids = (pred: (g: GroupId, id: string) => boolean) => ledger.accounts.filter((a) => pred(a.group, a.id)).map((a) => a.id);
  const sumDr = (list: string[]) => list.reduce((s, id) => s + (bal.get(id) ?? 0), 0);

  const caIds = ids((g) => CA.includes(g));
  const clIds = ids((g) => CL.includes(g));
  const currentAssets = sumDr(caIds);
  const currentLiabilities = -sumDr(clIds);
  const workingCapital = currentAssets - currentLiabilities;
  const cashIds = ids((g, id) => g === 'CASH_BANK' && (id === A.cash || /cash/i.test(ledger.byId.get(id)?.name ?? '')));
  const bankIds = ids((g, id) => g === 'CASH_BANK' && !cashIds.includes(id));
  const odIds = ids((g) => g === 'LOANS_ST');
  const debtorIds = ids((g) => g === 'TRADE_RECEIVABLES');
  const creditorIds = ids((g) => g === 'TRADE_PAYABLES');
  const stockIds = ids((g) => g === 'INVENTORIES');
  const loanIds = ids((g) => g === 'LOANS_LT' || g === 'LOANS_ST');
  const capIds = ids((g) => g === 'CAPITAL' || g === 'RESERVES');
  const salesIds = ids((g) => g === 'SALES');
  const purchaseIds = ids((g) => g === 'PURCHASES');

  const cash = sumDr(cashIds);
  const bank = sumDr(bankIds);
  const bankOd = -sumDr(odIds);
  const debtors = sumDr(debtorIds);
  const creditors = -sumDr(creditorIds);
  const stock = sumDr(stockIds);
  const loans = -sumDr(loanIds);
  const capital = -sumDr(capIds);
  const sales = pnl.income.filter((x) => x.group === 'SALES').reduce((s, x) => s + x.total, 0);
  const purchases = pnl.expenses.filter((x) => x.group === 'PURCHASES').reduce((s, x) => s + x.total, 0);
  const netProfit = pnl.netProfit;
  // Gross profit on the trading account: sales less direct costs (purchases + direct expenses).
  const grossProfit = sales - pnl.directCosts;
  const days = Math.max(daysBetween(period.start, end) + 1, 1);

  const money = (id: string, label: string, value: number, formula: string, accounts: string[]): RatioItem => ({ id, label, value, unit: 'money', formula, accounts });
  const item = (id: string, label: string, value: number | null, unit: RatioUnit, formula: string, accounts: string[] = []): RatioItem => ({ id, label, value: r2(value), unit, formula, accounts });

  const groups: RatioItem[] = [
    money('workingCapital', 'Working capital', workingCapital, 'Current assets − current liabilities', [...caIds, ...clIds]),
    money('cash', 'Cash-in-hand', cash, 'Closing balance of cash accounts', cashIds),
    money('bank', 'Bank accounts', bank, 'Closing balance of bank accounts', bankIds),
    money('bankOd', 'Bank OD / cash credit', bankOd, 'Closing balance of short-term borrowings', odIds),
    money('debtors', 'Sundry debtors', debtors, 'Closing trade receivables', debtorIds),
    money('creditors', 'Sundry creditors', creditors, 'Closing trade payables', creditorIds),
    money('sales', 'Sales accounts', sales, 'Net sales (sales − returns + charges recovered) in the period', salesIds),
    money('purchases', 'Purchase accounts', purchases, 'Purchases in the period', purchaseIds),
    money('stock', 'Stock-in-hand', stock, 'Closing inventories (as journalised)', stockIds),
    money('netProfit', 'Net profit', netProfit, 'Income − expenses in the period', []),
    item('wcTurnover', 'Working capital turnover', div(sales, workingCapital), 'times', 'Sales ÷ working capital (Tally)'),
    item('inventoryTurnover', 'Inventory turnover', div(sales, stock), 'times', 'Sales ÷ closing stock (Tally)', stockIds),
  ];
  const ratios: RatioItem[] = [
    item('currentRatio', 'Current ratio', div(currentAssets, currentLiabilities), 'ratio', 'Current assets ÷ current liabilities', [...caIds, ...clIds]),
    item('quickRatio', 'Quick ratio', div(currentAssets - stock, currentLiabilities), 'ratio', '(Current assets − stock) ÷ current liabilities', [...caIds, ...clIds]),
    item('debtEquity', 'Debt / equity', div(loans, capital + netProfit), 'ratio', 'Loans ÷ (capital + reserves + net profit) (Tally: loans ÷ capital + net profit)', [...loanIds, ...capIds]),
    item('grossProfitPct', 'Gross profit %', div(grossProfit * 100, sales), 'percent', '(Sales − direct costs) ÷ sales × 100', salesIds),
    item('netProfitPct', 'Net profit %', div(netProfit * 100, sales), 'percent', 'Net profit ÷ sales × 100', salesIds),
    item('operatingCostPct', 'Operating cost %', div((sales - netProfit) * 100, sales), 'percent', '(Sales − net profit) ÷ sales × 100 (Tally)', salesIds),
    item('receivableDays', 'Receivable turnover in days', div(debtors * days, sales), 'days', `Closing debtors ÷ sales × ${days} days (Tally)`, debtorIds),
    item('payableDays', 'Payable turnover in days', div(creditors * days, purchases), 'days', `Closing creditors ÷ purchases × ${days} days`, creditorIds),
    item('roi', 'Return on investment %', div(netProfit * 100, capital + netProfit), 'percent', 'Net profit ÷ (capital + reserves + net profit) × 100 (Tally)', capIds),
    item('rowc', 'Return on working capital %', div(netProfit * 100, workingCapital), 'percent', 'Net profit ÷ working capital × 100 (Tally)'),
  ];
  return {
    period,
    asOf: end,
    days,
    groups,
    ratios,
    parts: { currentAssets, currentLiabilities, workingCapital, cash, bank, bankOd, debtors, creditors, sales, purchases, stock, grossProfit, netProfit, loans, capital },
  };
}

/** Label of a ratio's value for CSV / screen ("12.50%", "1.80 : 1", "45 days", "₹…" handled by the caller). */
export function ratioText(r: RatioItem): string {
  if (r.value === null) return '—';
  if (r.unit === 'money') return (r.value / 100).toFixed(2);
  if (r.unit === 'percent') return `${r.value.toFixed(2)}%`;
  if (r.unit === 'days') return `${Math.round(r.value)} days`;
  if (r.unit === 'times') return `${r.value.toFixed(2)} times`;
  return `${r.value.toFixed(2)} : 1`;
}

export function ratioGroupLabel(id: GroupId): string {
  return groupOf(id).label;
}
