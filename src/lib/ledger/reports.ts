/**
 * Statements built from the ledger (Phase 6.2–6.4): trial balance, account statement,
 * profit & loss, Schedule III balance sheet and an AS 3 (indirect method) cash-flow statement.
 *
 * All amounts are integer PAISE (divide by 100 for display). Conventions:
 *  - a "balance" is signed debit-positive (dr − cr);
 *  - income & expense accounts restart every Indian FY: their balance is the movement since
 *    1 April, and every earlier year's profit is carried to Reserves & surplus;
 *  - balance-sheet accounts carry their whole history.
 * Pure. Working papers — verify with your CA.
 */

import { dayBefore, fyPeriod, fyStartYearOf, type Period } from '../books';
import { toCsv } from '../csv';
import { A, groupOf, type Account, type GroupId } from './accounts';
import type { Ledger, LedgerVoucher } from './postings';
import { stockChange, type StockValuer } from './closing-stock';
import { isDirectGroup } from './report-groups';
import { scopeLedger, type ReportScope } from './branch-books';

const isPnl = (a: Account) => {
  const n = groupOf(a.group).nature;
  return n === 'income' || n === 'expense';
};

const fyStartOf = (date: string) => fyPeriod(fyStartYearOf(date)).start;

/** Per-account sums over vouchers matching `keep`. */
function sums(ledger: Ledger, keep: (v: LedgerVoucher) => boolean, party?: string): Map<string, { dr: number; cr: number }> {
  const m = new Map<string, { dr: number; cr: number }>();
  for (const v of ledger.vouchers) {
    if (!keep(v)) continue;
    for (const l of v.lines) {
      if (party !== undefined && (l.party ?? '') !== party) continue;
      const s = m.get(l.account) ?? { dr: 0, cr: 0 };
      s.dr += l.dr;
      s.cr += l.cr;
      m.set(l.account, s);
    }
  }
  return m;
}

const net = (s: { dr: number; cr: number } | undefined) => (s ? s.dr - s.cr : 0);

/**
 * Balances after everything dated before `before`, with the FY rule applied for the FY that
 * starts on `fyStart`: income/expense accounts only count from `fyStart`, and the profit of
 * all earlier FYs is added to Reserves & surplus.
 */
function balancesBefore(ledger: Ledger, before: string, fyStart: string, party?: string): Map<string, number> {
  const all = sums(ledger, (v) => v.date < before, party);
  const prior = party === undefined ? sums(ledger, (v) => v.date < fyStart) : new Map<string, { dr: number; cr: number }>();
  const out = new Map<string, number>();
  let carried = 0;
  for (const a of ledger.accounts) {
    if (isPnl(a)) {
      const priorNet = net(prior.get(a.id));
      carried += priorNet;
      out.set(a.id, net(all.get(a.id)) - priorNet);
    } else {
      out.set(a.id, net(all.get(a.id)));
    }
  }
  if (carried) out.set(A.reserves, (out.get(A.reserves) ?? 0) + carried);
  return out;
}

/** Balances at the START of `date` (FY of `date`). */
export function openingBalances(ledger: Ledger, date: string, party?: string): Map<string, number> {
  return balancesBefore(ledger, date, fyStartOf(date), party);
}

/** Balances at the END of `date` (FY of `date`, so 31 March still shows that year's profit). */
export function closingBalances(ledger: Ledger, date: string, party?: string): Map<string, number> {
  return balancesBefore(ledger, nextDay(date), fyStartOf(date), party);
}

/** Closing balance of each party on a control account at the end of `date`. */
function partyBalances(ledger: Ledger, accountId: string, date: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of ledger.vouchers) {
    if (v.date > date) continue;
    for (const l of v.lines) {
      if (l.account !== accountId) continue;
      const p = l.party || '(no party)';
      out.set(p, (out.get(p) ?? 0) + l.dr - l.cr);
    }
  }
  return out;
}

function nextDay(iso: string): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + 1));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/* ── Trial balance ─────────────────────────────────────────────── */

export interface TrialBalanceRow {
  account: Account;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

export interface TrialBalance {
  period: Period;
  rows: TrialBalanceRow[];
  totals: { openingDr: number; openingCr: number; debit: number; credit: number; closingDr: number; closingCr: number };
}

/**
 * Opening at the period start, movements inside it, closing = opening + debit − credit.
 * A period that crosses 1 April keeps accumulating income/expense (it is one reporting window).
 */
export function trialBalance(ledger: Ledger, period: Period, scope?: ReportScope): TrialBalance {
  ledger = scopeLedger(ledger, scope);
  const open = openingBalances(ledger, period.start);
  const mv = sums(ledger, (v) => v.date >= period.start && v.date <= period.end);
  const rows: TrialBalanceRow[] = [];
  const t = { openingDr: 0, openingCr: 0, debit: 0, credit: 0, closingDr: 0, closingCr: 0 };
  for (const a of ledger.accounts) {
    const opening = open.get(a.id) ?? 0;
    const m = mv.get(a.id) ?? { dr: 0, cr: 0 };
    const closing = opening + m.dr - m.cr;
    if (!opening && !m.dr && !m.cr) continue;
    rows.push({ account: a, opening, debit: m.dr, credit: m.cr, closing });
    if (opening > 0) t.openingDr += opening;
    else t.openingCr -= opening;
    t.debit += m.dr;
    t.credit += m.cr;
    if (closing > 0) t.closingDr += closing;
    else t.closingCr -= closing;
  }
  return { period, rows, totals: t };
}

/* ── Account statement (ledger drill-down) ────────────────────── */

export interface StatementRow {
  voucher: LedgerVoucher;
  /** Other accounts in the voucher ("particulars"). */
  particulars: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface AccountStatement {
  account: Account;
  party?: string;
  period: Period;
  opening: number;
  rows: StatementRow[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

export function accountStatement(ledger: Ledger, accountId: string, period: Period, party?: string, scope?: ReportScope): AccountStatement | null {
  ledger = scopeLedger(ledger, scope);
  const account = ledger.byId.get(accountId);
  if (!account) return null;
  const opening = openingBalances(ledger, period.start, party).get(accountId) ?? 0;
  const rows: StatementRow[] = [];
  let bal = opening;
  let td = 0;
  let tc = 0;
  for (const v of ledger.vouchers) {
    if (v.date < period.start || v.date > period.end) continue;
    let dr = 0;
    let cr = 0;
    const others = new Set<string>();
    for (const l of v.lines) {
      if (l.account === accountId && (party === undefined || (l.party ?? '') === party)) {
        dr += l.dr;
        cr += l.cr;
      } else if (l.account !== accountId) {
        others.add(ledger.byId.get(l.account)?.name ?? l.account);
      }
    }
    if (!dr && !cr) continue;
    bal += dr - cr;
    td += dr;
    tc += cr;
    const list = [...others];
    rows.push({ voucher: v, particulars: list.length > 2 ? `${list.slice(0, 2).join(', ')} +${list.length - 2}` : list.join(', '), debit: dr, credit: cr, balance: bal });
  }
  return { account, party, period, opening, rows, totalDebit: td, totalCredit: tc, closing: opening + td - tc };
}

/** Party names that appear on an account (debtors / creditors sub-ledger). */
export function partiesOf(ledger: Ledger, accountId: string): string[] {
  const set = new Set<string>();
  for (const v of ledger.vouchers) for (const l of v.lines) if (l.account === accountId && l.party) set.add(l.party);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/* ── Profit & loss ─────────────────────────────────────────────── */

export interface PnlLine {
  account: Account;
  amount: number;
}

export interface PnlSection {
  group: GroupId;
  label: string;
  lines: PnlLine[];
  total: number;
}

/**
 * Tally's Trading account (WP-2): Opening stock + Purchases + Direct expenses − Closing stock against
 * Sales + Direct incomes → "Gross Profit c/o". The P&L proper then takes Gross profit b/f + indirect
 * incomes − indirect expenses = Nett profit. `trading.grossProfit + indirectIncome − indirectExpenses = netProfit`.
 */
export interface TradingAccount {
  /** Income in direct groups (Sales accounts). */
  sales: number;
  openingStock: number;
  /** Purchase accounts (the PURCHASES group) and the other direct expense groups. */
  purchases: number;
  directExpenses: number;
  closingStock: number;
  grossProfit: number;
}

export interface LedgerProfitLoss {
  period: Period;
  income: PnlSection[];
  expenses: PnlSection[];
  totalIncome: number;
  totalExpenses: number;
  /** Books-compatible figures (src/lib/books.ts ProfitLoss), in paise. */
  revenue: number;
  directCosts: number;
  /** All income − direct costs ± stock change (equals books.ts when there is no stock). */
  grossProfit: number;
  indirectExpenses: number;
  /** Includes the stock change (closing − opening stock). */
  netProfit: number;
  /** Tally layout: direct sections, stock, gross profit (indirect income excluded). */
  trading: TradingAccount;
  /** Income in indirect groups (Other income). */
  indirectIncome: number;
  /** Closing-stock source used ('' when stock is not valued). */
  stockLabel: string;
}

export function ledgerProfitAndLoss(ledger: Ledger, period: Period, stock?: StockValuer, scope?: ReportScope): LedgerProfitLoss {
  ledger = scopeLedger(ledger, scope);
  const mv = sums(ledger, (v) => v.date >= period.start && v.date <= period.end);
  const sections = new Map<GroupId, PnlSection>();
  for (const a of ledger.accounts) {
    const g = groupOf(a.group);
    if (g.nature !== 'income' && g.nature !== 'expense') continue;
    const n = net(mv.get(a.id));
    if (!n) continue;
    const amount = g.nature === 'income' ? -n : n;
    const s = sections.get(g.id) ?? { group: g.id, label: g.label, lines: [], total: 0 };
    s.lines.push({ account: a, amount });
    s.total += amount;
    sections.set(g.id, s);
  }
  const ordered = [...sections.values()];
  const income = ordered.filter((s) => groupOf(s.group).nature === 'income');
  const expenses = ordered.filter((s) => groupOf(s.group).nature === 'expense');
  const totalIncome = income.reduce((x, s) => x + s.total, 0);
  const totalExpenses = expenses.reduce((x, s) => x + s.total, 0);
  const directCosts = expenses.filter((s) => isDirectGroup(s.group)).reduce((x, s) => x + s.total, 0);
  const purchases = expenses.filter((s) => s.group === 'PURCHASES').reduce((x, s) => x + s.total, 0);
  const sales = income.filter((s) => isDirectGroup(s.group)).reduce((x, s) => x + s.total, 0);
  const st = stockChange(stock, period.end, dayBefore(period.start));
  const stockDelta = st.closing - st.opening;
  const tradingGross = sales + st.closing - st.opening - directCosts;
  return {
    period,
    income,
    expenses,
    totalIncome,
    totalExpenses,
    revenue: totalIncome,
    directCosts,
    grossProfit: totalIncome - directCosts + stockDelta,
    indirectExpenses: totalExpenses - directCosts,
    netProfit: totalIncome - totalExpenses + stockDelta,
    trading: {
      sales,
      openingStock: st.opening,
      purchases,
      directExpenses: directCosts - purchases,
      closingStock: st.closing,
      grossProfit: tradingGross,
    },
    indirectIncome: totalIncome - sales,
    stockLabel: stock?.label ?? '',
  };
}

/* ── Balance sheet (Schedule III, vertical) ───────────────────── */

export interface BsItem {
  label: string;
  amount: number;
  /** Accounts / parties that make up the line, for drill-down. */
  detail: Array<{ label: string; amount: number; accountId?: string; party?: string }>;
  /** Group the line drills into (Group Summary). */
  groupId?: GroupId;
}

export interface BsSection {
  key: string;
  label: string;
  items: BsItem[];
  total: number;
}

export interface LedgerBalanceSheet {
  asOf: string;
  equityAndLiabilities: BsSection[];
  assets: BsSection[];
  totalEquityAndLiabilities: number;
  totalAssets: number;
  /** Always 0 when the books are internally consistent. */
  difference: number;
  profitForYear: number;
  profitBroughtForward: number;
  fixedAssets: { gross: number; accumulatedDepreciation: number; net: number };
  /** Report-time stock line (0 when stock is not valued). */
  closingStock: number;
  /** Opening stock credited to capital as a difference in opening balances. */
  openingStock: number;
}

type ItemKey =
  | 'capital'
  | 'reserves'
  | 'ltBorrowings'
  | 'stBorrowings'
  | 'tradePayables'
  | 'otherCl'
  | 'provisions'
  | 'ppe'
  | 'investments'
  | 'ltAdvances'
  | 'inventories'
  | 'receivables'
  | 'cash'
  | 'stAdvances'
  | 'otherCa';

const ITEM_LABELS: Record<ItemKey, string> = {
  capital: 'Capital account (net of drawings)',
  reserves: 'Reserves & surplus',
  ltBorrowings: 'Long-term borrowings',
  stBorrowings: 'Short-term borrowings',
  tradePayables: 'Trade payables',
  otherCl: 'Other current liabilities (incl. duties & taxes)',
  provisions: 'Short-term provisions',
  ppe: 'Property, plant & equipment and intangibles (net)',
  investments: 'Non-current investments',
  ltAdvances: 'Long-term loans & advances',
  inventories: 'Inventories',
  receivables: 'Trade receivables',
  cash: 'Cash & cash equivalents',
  stAdvances: 'Short-term loans & advances (incl. GST credit, TDS)',
  otherCa: 'Other current assets',
};

const LIAB_ITEMS: Array<{ key: string; label: string; items: ItemKey[] }> = [
  { key: 'funds', label: "Owner's funds", items: ['capital', 'reserves'] },
  { key: 'ncl', label: 'Non-current liabilities', items: ['ltBorrowings'] },
  { key: 'cl', label: 'Current liabilities', items: ['stBorrowings', 'tradePayables', 'otherCl', 'provisions'] },
];
const ASSET_ITEMS: Array<{ key: string; label: string; items: ItemKey[] }> = [
  { key: 'nca', label: 'Non-current assets', items: ['ppe', 'investments', 'ltAdvances'] },
  { key: 'ca', label: 'Current assets', items: ['inventories', 'receivables', 'cash', 'stAdvances', 'otherCa'] },
];

const GROUP_ITEM: Partial<Record<GroupId, ItemKey>> = {
  CAPITAL: 'capital',
  RESERVES: 'reserves',
  LOANS_LT: 'ltBorrowings',
  LOANS_ST: 'stBorrowings',
  OTHER_CL: 'otherCl',
  PROVISIONS: 'provisions',
  FIXED_ASSETS: 'ppe',
  INVESTMENTS: 'investments',
  LOANS_ADV_LT: 'ltAdvances',
  INVENTORIES: 'inventories',
  CASH_BANK: 'cash',
  LOANS_ADV_ST: 'stAdvances',
  OTHER_CA: 'otherCa',
};

const ITEM_GROUP: Record<ItemKey, GroupId> = {
  capital: 'CAPITAL',
  reserves: 'RESERVES',
  ltBorrowings: 'LOANS_LT',
  stBorrowings: 'LOANS_ST',
  tradePayables: 'TRADE_PAYABLES',
  otherCl: 'OTHER_CL',
  provisions: 'PROVISIONS',
  ppe: 'FIXED_ASSETS',
  investments: 'INVESTMENTS',
  ltAdvances: 'LOANS_ADV_LT',
  inventories: 'INVENTORIES',
  receivables: 'TRADE_RECEIVABLES',
  cash: 'CASH_BANK',
  stAdvances: 'LOANS_ADV_ST',
  otherCa: 'OTHER_CA',
};

const LIAB_KEYS = new Set<ItemKey>(['capital', 'reserves', 'ltBorrowings', 'stBorrowings', 'tradePayables', 'otherCl', 'provisions']);

export function ledgerBalanceSheet(ledger: Ledger, asOf: string, stock?: StockValuer, scope?: ReportScope): LedgerBalanceSheet {
  ledger = scopeLedger(ledger, scope);
  const bal = closingBalances(ledger, asOf);
  const items = new Map<ItemKey, BsItem>();
  const add = (key: ItemKey, label: string, debitBalance: number, accountId?: string, party?: string) => {
    if (!debitBalance) return;
    const amount = LIAB_KEYS.has(key) ? -debitBalance : debitBalance;
    const it = items.get(key) ?? { label: ITEM_LABELS[key], amount: 0, detail: [], groupId: ITEM_GROUP[key] };
    it.amount += amount;
    it.detail.push({ label, amount, accountId, ...(party ? { party } : {}) });
    items.set(key, it);
  };

  // Profit: every income/expense account's FY-to-date balance is the current year's result.
  let profitForYear = 0;
  for (const a of ledger.accounts) if (isPnl(a)) profitForYear -= bal.get(a.id) ?? 0;
  // `closingBalances` folded prior years' profit into the reserves balance; split it back out for display.
  const fyStart = fyStartOf(asOf);
  const prior = sums(ledger, (v) => v.date < fyStart);
  let ledgerBf = 0;
  for (const a of ledger.accounts) if (isPnl(a)) ledgerBf -= net(prior.get(a.id));
  // Stock (report-time): this year's change is profit; earlier years' change is surplus b/f; opening
  // stock is a difference in opening balances. Together they equal the closing stock, so the sheet ties.
  const lastFyEnd = dayBefore(fyStart);
  const st = stockChange(stock, asOf, lastFyEnd);
  profitForYear += st.closing - st.opening;
  const stockBf = stock ? stock.value(lastFyEnd) - stock.openingIn(lastFyEnd) : 0;
  const openingStock = stock ? stock.openingIn(asOf) : 0;
  const profitBroughtForward = ledgerBf + stockBf;

  let gross = 0;
  let accDep = 0;
  for (const a of ledger.accounts) {
    if (isPnl(a)) continue;
    const b = bal.get(a.id) ?? 0;
    if (a.id === A.reserves) {
      add('reserves', 'Reserves (direct entries)', b + ledgerBf, a.id);
      continue;
    }
    if (a.group === 'FIXED_ASSETS') {
      if (a.id === A.accDep) accDep += b;
      else gross += b;
    }
    if (a.group === 'TRADE_RECEIVABLES' || a.group === 'TRADE_PAYABLES') {
      // Party-wise: a customer in credit is an advance received; a supplier in debit is an advance paid.
      for (const [p, pb] of partyBalances(ledger, a.id, asOf)) {
        if (!pb) continue;
        if (a.group === 'TRADE_RECEIVABLES') add(pb > 0 ? 'receivables' : 'otherCl', pb > 0 ? `${a.name}: ${p}` : `Advance from ${p}`, pb, a.id, p);
        else add(pb < 0 ? 'tradePayables' : 'stAdvances', pb < 0 ? `${a.name}: ${p}` : `Advance to ${p}`, pb, a.id, p);
      }
      continue;
    }
    if (a.group === 'DUTIES_TAXES') {
      // Each tax ledger on its own side: a debit balance (credit ledger, TDS receivable) is an asset.
      add(b > 0 ? 'stAdvances' : 'otherCl', a.name, b, a.id);
      continue;
    }
    const key = GROUP_ITEM[a.group];
    if (key) add(key, a.name, b, a.id);
  }
  add('reserves', 'Surplus brought forward (earlier years)', -profitBroughtForward);
  add('reserves', 'Profit / (loss) for the year', -profitForYear);
  if (stock) {
    add('inventories', `Closing stock (${stock.label.toLowerCase()})`, st.closing);
    add('capital', 'Opening stock (difference in opening balances)', -openingStock);
  }

  const build = (spec: typeof LIAB_ITEMS): BsSection[] =>
    spec.map((s) => {
      const its = s.items.map((k) => items.get(k)).filter((x): x is BsItem => !!x && (x.amount !== 0 || x.detail.length > 0));
      return { key: s.key, label: s.label, items: its, total: its.reduce((t, i) => t + i.amount, 0) };
    });
  const equityAndLiabilities = build(LIAB_ITEMS);
  const assets = build(ASSET_ITEMS);
  const totalEquityAndLiabilities = equityAndLiabilities.reduce((t, s) => t + s.total, 0);
  const totalAssets = assets.reduce((t, s) => t + s.total, 0);
  return {
    asOf,
    equityAndLiabilities,
    assets,
    totalEquityAndLiabilities,
    totalAssets,
    difference: totalAssets - totalEquityAndLiabilities,
    profitForYear,
    profitBroughtForward,
    fixedAssets: { gross, accumulatedDepreciation: -accDep, net: gross + accDep },
    closingStock: st.closing,
    openingStock,
  };
}

/* ── Cash flow (AS 3, indirect method) ────────────────────────── */

export interface CashFlowLine {
  label: string;
  amount: number;
}

export interface CashFlowStatement {
  period: Period;
  netProfit: number;
  operating: { adjustments: CashFlowLine[]; workingCapital: CashFlowLine[]; total: number };
  investing: { lines: CashFlowLine[]; total: number };
  financing: { lines: CashFlowLine[]; total: number };
  netChange: number;
  openingCash: number;
  closingCash: number;
  /** closing − opening − netChange: always 0 for a consistent ledger. */
  difference: number;
}

const WC_LABELS: Partial<Record<GroupId, string>> = {
  TRADE_RECEIVABLES: '(Increase) / decrease in trade receivables',
  INVENTORIES: '(Increase) / decrease in inventories',
  LOANS_ADV_ST: '(Increase) / decrease in short-term loans & advances',
  OTHER_CA: '(Increase) / decrease in other current assets',
  TRADE_PAYABLES: 'Increase / (decrease) in trade payables',
  DUTIES_TAXES: 'Increase / (decrease) in GST, TDS & other duties (net)',
  OTHER_CL: 'Increase / (decrease) in other current liabilities',
  PROVISIONS: 'Increase / (decrease) in provisions',
};
const INVESTING_LABELS: Partial<Record<GroupId, string>> = {
  FIXED_ASSETS: 'Purchase of fixed assets (net)',
  INVESTMENTS: 'Investments made (net)',
  LOANS_ADV_LT: 'Long-term loans, advances & deposits given (net)',
};
const FINANCING_LABELS: Partial<Record<GroupId, string>> = {
  CAPITAL: 'Capital introduced / (drawings), incl. opening balances',
  RESERVES: 'Direct entries to reserves',
  LOANS_LT: 'Long-term borrowings raised / (repaid)',
  LOANS_ST: 'Short-term borrowings raised / (repaid)',
};

export function cashFlowStatement(ledger: Ledger, period: Period, stock?: StockValuer, scope?: ReportScope): CashFlowStatement {
  ledger = scopeLedger(ledger, scope);
  const mv = sums(ledger, (v) => v.date >= period.start && v.date <= period.end);
  // −movement of an account = the cash it released (a debit to a non-cash account used cash).
  const released = (a: Account) => -net(mv.get(a.id));
  let netProfit = 0;
  let depreciation = 0;
  const buckets = { wc: new Map<string, number>(), inv: new Map<string, number>(), fin: new Map<string, number>() };
  const addTo = (m: Map<string, number>, label: string, amount: number) => amount && m.set(label, (m.get(label) ?? 0) + amount);
  for (const a of ledger.accounts) {
    const r = released(a);
    if (!r) continue;
    if (isPnl(a)) netProfit += r;
    else if (a.group === 'CASH_BANK') continue;
    else if (a.id === A.accDep) depreciation += r;
    else if (WC_LABELS[a.group]) addTo(buckets.wc, WC_LABELS[a.group]!, r);
    else if (INVESTING_LABELS[a.group]) addTo(buckets.inv, INVESTING_LABELS[a.group]!, r);
    else if (FINANCING_LABELS[a.group]) addTo(buckets.fin, FINANCING_LABELS[a.group]!, r);
  }
  // Report-time stock: the profit it adds is exactly offset by the increase in inventories.
  const st = stockChange(stock, period.end, dayBefore(period.start));
  if (st.closing !== st.opening) {
    netProfit += st.closing - st.opening;
    addTo(buckets.wc, WC_LABELS.INVENTORIES!, st.opening - st.closing);
  }
  const lines = (m: Map<string, number>) => [...m.entries()].map(([label, amount]) => ({ label, amount }));
  const adjustments = depreciation ? [{ label: 'Add: depreciation (non-cash)', amount: depreciation }] : [];
  const workingCapital = lines(buckets.wc);
  const opTotal = netProfit + depreciation + workingCapital.reduce((s, l) => s + l.amount, 0);
  const investing = lines(buckets.inv);
  const financing = lines(buckets.fin);
  const invTotal = investing.reduce((s, l) => s + l.amount, 0);
  const finTotal = financing.reduce((s, l) => s + l.amount, 0);
  const cashOf = (m: Map<string, number>) => ledger.accounts.filter((a) => a.group === 'CASH_BANK').reduce((s, a) => s + (m.get(a.id) ?? 0), 0);
  const openingCash = cashOf(openingBalances(ledger, period.start));
  const closingCash = cashOf(closingBalances(ledger, period.end));
  const netChange = opTotal + invTotal + finTotal;
  return {
    period,
    netProfit,
    operating: { adjustments, workingCapital, total: opTotal },
    investing: { lines: investing, total: invTotal },
    financing: { lines: financing, total: finTotal },
    netChange,
    openingCash,
    closingCash,
    difference: closingCash - openingCash - netChange,
  };
}

/* ── CSV (formula-guarded via csv.ts) ─────────────────────────── */

const r = (p: number) => Math.round(p) / 100;
const drCr = (p: number) => (p === 0 ? '' : `${(Math.abs(p) / 100).toFixed(2)} ${p > 0 ? 'Dr' : 'Cr'}`);

export function trialBalanceCsv(tb: TrialBalance): string {
  return toCsv([
    ['Trial balance', `${tb.period.start} to ${tb.period.end}`, 'Working paper — verify with your CA'],
    ['Code', 'Account', 'Group', 'Opening', 'Debit', 'Credit', 'Closing'],
    ...tb.rows.map((x) => [x.account.code, x.account.name, groupOf(x.account.group).label, drCr(x.opening), r(x.debit), r(x.credit), drCr(x.closing)]),
    ['', 'Total', '', '', r(tb.totals.debit), r(tb.totals.credit), ''],
    ['', 'Closing debit / credit balances', '', '', r(tb.totals.closingDr), r(tb.totals.closingCr), ''],
  ]);
}

export function accountStatementCsv(s: AccountStatement): string {
  return toCsv([
    [`Ledger: ${s.account.code} ${s.account.name}${s.party ? ` — ${s.party}` : ''}`, `${s.period.start} to ${s.period.end}`],
    ['Date', 'Voucher', 'Vch no.', 'Party', 'Particulars', 'Narration', 'Debit', 'Credit', 'Balance'],
    ['', 'Opening balance', '', '', '', '', '', '', drCr(s.opening)],
    ...s.rows.map((x) => [x.voucher.date, x.voucher.kind, x.voucher.number, x.voucher.party, x.particulars, x.voucher.narration, r(x.debit), r(x.credit), drCr(x.balance)]),
    ['', 'Closing balance', '', '', '', '', r(s.totalDebit), r(s.totalCredit), drCr(s.closing)],
  ]);
}

export function balanceSheetLedgerCsv(b: LedgerBalanceSheet): string {
  const rows: unknown[][] = [['Balance sheet (Schedule III format)', `As at ${b.asOf}`, 'Working paper — verify with your CA'], ['Particulars', 'Amount']];
  const section = (title: string, list: BsSection[], total: number) => {
    rows.push([title, '']);
    for (const s of list) {
      rows.push([s.label, '']);
      for (const i of s.items) rows.push([`  ${i.label}`, r(i.amount)]);
      rows.push([`Total ${s.label.toLowerCase()}`, r(s.total)]);
    }
    rows.push([`TOTAL`, r(total)]);
  };
  section('I. EQUITY AND LIABILITIES', b.equityAndLiabilities, b.totalEquityAndLiabilities);
  section('II. ASSETS', b.assets, b.totalAssets);
  return toCsv(rows);
}

export function cashFlowCsv(c: CashFlowStatement): string {
  return toCsv([
    ['Cash-flow statement (AS 3, indirect method)', `${c.period.start} to ${c.period.end}`, 'Working paper — verify with your CA'],
    ['Particulars', 'Amount'],
    ['A. Cash flow from operating activities', ''],
    ['Net profit / (loss)', r(c.netProfit)],
    ...c.operating.adjustments.map((l) => [l.label, r(l.amount)]),
    ...c.operating.workingCapital.map((l) => [l.label, r(l.amount)]),
    ['Net cash from operating activities', r(c.operating.total)],
    ['B. Cash flow from investing activities', ''],
    ...c.investing.lines.map((l) => [l.label, r(l.amount)]),
    ['Net cash from investing activities', r(c.investing.total)],
    ['C. Cash flow from financing activities', ''],
    ...c.financing.lines.map((l) => [l.label, r(l.amount)]),
    ['Net cash from financing activities', r(c.financing.total)],
    ['Net increase / (decrease) in cash & cash equivalents', r(c.netChange)],
    ['Cash & cash equivalents at the beginning', r(c.openingCash)],
    ['Cash & cash equivalents at the end', r(c.closingCash)],
  ]);
}

/* ── Reports engine (WP-2): re-exported so callers (Books tabs, the Gateway viewer) import one module ── */

export * from './closing-stock';
export * from './report-groups';
export * from './group-summary';
export * from './columns';
export * from './registers';
export * from './exceptions';
export * from './funds-flow';
export * from './drill';
export * from './branch-books';
