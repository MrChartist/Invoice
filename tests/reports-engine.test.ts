/**
 * WP-2 reports engine: one accounting truth. On a dataset with stock (opening + purchase + sales),
 * a manual journal, a fixed asset with depreciation and a capital receipt, the trial balance, the
 * Day Book, the Trading / P&L account (closing stock FIFO / weighted average / typed) and the balance
 * sheet reconcile; plus group summary, drill path, registers, comparative columns, period context,
 * ratios, exceptions, funds flow and report prefs. Numbers are worked out by hand in the comments.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { EMPTY_BOOKS, type BooksData } from '../src/lib/books.ts';
import { computeStock, type StockItem } from '../src/lib/inventory.ts';
import {
  A,
  buildLedger,
  cashFlowStatement,
  columnsFor,
  drillDown,
  drillTitle,
  exceptionReport,
  flattenRows,
  fundsFlow,
  groupSummary,
  groupSummaryColumns,
  groupVouchers,
  headId,
  inventoryValuer,
  ledgerBalanceSheet,
  ledgerDayBook,
  ledgerProfitAndLoss,
  loadStockValuer,
  manualValuer,
  monthlySummary,
  previousPeriod,
  ratioAnalysis,
  saveClosingStockConfig,
  setGroupSource,
  builtInGroupSource,
  trialBalance,
  voucherRegister,
  columnarRegister,
  voucherStatistics,
  type DrillLevel,
  type LedgerInput,
  type ManualVoucher,
  type StockValuer,
} from '../src/lib/ledger/index.ts';
import { getPeriodContext, normalizePeriodContext, resetPeriodContextForTests, setPeriodContext } from '../src/lib/period-context.ts';
import { getReportPrefs, normalizeReportPrefs, setReportPrefs } from '../src/lib/report-prefs.ts';
import { setJson } from '../src/lib/storage.ts';

beforeEach(() => {
  resetStorage();
  resetPeriodContextForTests();
});

const FY = { start: '2025-04-01', end: '2026-03-31' };
const FY2 = { start: '2026-04-01', end: '2027-03-31' };

const widget: StockItem = { id: 'w', name: 'Widget', unit: 'NOS', track_stock: true, opening_qty: 10, opening_rate: 100, reorder_level: 0 };

const sale = (id: string, date: string, qty: number) => ({
  id,
  invoice_number: `INV/${id}`,
  doc_type: 'INVOICE',
  status: 'Sent',
  issue_date: date,
  client: { name: 'Acme', company: 'Acme Pvt Ltd' },
  items: [{ id: `${id}l`, name: 'Widget', type: 'product', quantity: qty, rate: 200, amount: qty * 200, tax_rate: 0 }],
  taxable_value: qty * 200,
  tax_amount: 0,
  total: qty * 200,
});

const data: BooksData = {
  ...EMPTY_BOOKS,
  // FY 25-26: 5 sold; FY 26-27: 2 sold.
  invoices: [sale('S1', '2025-06-01', 5), sale('S2', '2026-05-01', 2)] as unknown as BooksData['invoices'],
  transactions: [{ id: 't1', invoice_id: 'S1', amount: 1000, method: 'UPI', date: '2025-06-10' }] as unknown as BooksData['transactions'],
  // 10 @ 120 (GST 18% intra, ITC) on 1 May 2025.
  purchases: [{
    id: 'P1', kind: 'PURCHASE', vendor_name: 'Supplier', bill_number: 'B-1', date: '2025-05-01', category: 'Purchases', status: 'Posted',
    lines: [{ name: 'Widget', quantity: 10, rate: 120 }], taxable: 1200, cgst: 108, sgst: 108, igst: 0, itc_eligible: true, total: 1416, amount_paid: 0,
  }],
};

const manual: ManualVoucher[] = [
  { id: 'cap', type: 'RECEIPT', number: 'RV/FY25-26/0001', date: '2025-04-02', narration: 'Capital', lines: [{ account_id: A.bank, dr: 10000000, cr: 0 }, { account_id: A.capital, dr: 0, cr: 10000000 }], created_at: '' },
  { id: 'jv', type: 'JOURNAL', number: 'JV/FY25-26/0001', date: '2025-07-01', narration: 'Rent provision', lines: [{ account_id: A.rent, dr: 50000, cr: 0 }, { account_id: A.provisions, dr: 0, cr: 50000 }], created_at: '' },
];

const input: LedgerInput = {
  ...data,
  userAccounts: [],
  manual,
  assets: [{ id: 'fa', name: 'Laptop', block: 'COMPUTER', account_id: A.faComputers, cost: 60000, acquired_on: '2025-06-01', put_to_use: '2025-06-01', paid_from: A.bank, created_at: '' }],
  today: '2026-06-30',
};

const ledger = buildLedger(input);
const positions = (method: 'WEIGHTED_AVG' | 'FIFO') =>
  computeStock({ items: [widget], moves: [], invoices: data.invoices as never, purchases: data.purchases as never, method });
const wac = inventoryValuer(positions('WEIGHTED_AVG'), 'WEIGHTED_AVG');
const fifo = inventoryValuer(positions('FIFO'), 'FIFO');

const pnlAccountIds = new Set(ledger.accounts.filter((a) => ['SALES', 'OTHER_INCOME', 'PURCHASES', 'DIRECT_EXPENSES', 'EMPLOYEE', 'FINANCE', 'DEPRECIATION', 'INDIRECT_EXPENSES'].includes(a.group)).map((a) => a.id));

test('dataset posts cleanly: manual journal, fixed asset and depreciation are ledger vouchers', () => {
  assert.deepEqual(ledger.warnings, []);
  const kinds = new Set(ledger.vouchers.map((v) => v.kind));
  for (const k of ['Sales', 'Purchase', 'Receipt', 'Journal', 'Fixed Asset', 'Depreciation'] as const) assert.ok(kinds.has(k), k);
});

test('Trading account: closing stock by weighted average and FIFO', () => {
  // Opening 10 @ 100 = 1,000; bought 10 @ 120 → WAC 110; sold 5 → closing 15 @ 110 = 1,650.
  // GP = sales 1,000 + closing 1,650 − opening 1,000 − purchases 1,200 = 450 (= sales − COGS 550).
  const pl = ledgerProfitAndLoss(ledger, FY, wac);
  assert.deepEqual(pl.trading, { sales: 100000, openingStock: 100000, purchases: 120000, directExpenses: 0, closingStock: 165000, grossProfit: 45000 });
  // Indirect: rent 500 + depreciation 60,000 × 40% = 24,000 → NP 450 − 24,500 = −24,050.
  assert.equal(pl.netProfit, -2405000);
  assert.equal(pl.trading.grossProfit + pl.indirectIncome - pl.indirectExpenses, pl.netProfit);
  // FIFO: the 5 sold come from the opening layer @100 → closing 5 @ 100 + 10 @ 120 = 1,700; GP 500.
  const pf = ledgerProfitAndLoss(ledger, FY, fifo);
  assert.equal(pf.trading.closingStock, 170000);
  assert.equal(pf.trading.grossProfit, 50000);
  // Next FY opens with last year's closing stock.
  const p2 = ledgerProfitAndLoss(ledger, FY2, wac);
  assert.equal(p2.trading.openingStock, 165000);
  assert.equal(p2.trading.closingStock, 143000); // 13 @ 110
  // Without a valuer the old (purchases-based) figures are unchanged.
  assert.equal(ledgerProfitAndLoss(ledger, FY).trading.closingStock, 0);
});

test('TB, P&L, balance sheet and Day Book reconcile with stock, journals, depreciation and fixed assets', () => {
  for (const stock of [wac, fifo, undefined] as Array<StockValuer | undefined>) {
    for (const [period, asOf] of [[FY, FY.end], [FY2, '2026-06-30']] as const) {
      const tb = trialBalance(ledger, period);
      assert.equal(tb.totals.debit, tb.totals.credit);
      const pl = ledgerProfitAndLoss(ledger, period, stock);
      const ledgerProfit = -tb.rows.filter((r) => pnlAccountIds.has(r.account.id)).reduce((s, r) => s + r.closing, 0);
      assert.equal(pl.netProfit, ledgerProfit + pl.trading.closingStock - pl.trading.openingStock, 'P&L = TB P&L ledgers + stock change');

      const bs = ledgerBalanceSheet(ledger, period.end, stock);
      assert.equal(bs.difference, 0, 'balance sheet ties');
      assert.equal(bs.profitForYear, pl.netProfit, 'BS profit = P&L profit');
      const inv = bs.assets.flatMap((s) => s.items).find((i) => i.label === 'Inventories')?.amount ?? 0;
      assert.equal(inv, stock ? stock.value(period.end) : 0, 'closing stock under current assets');
      assert.equal(ledgerBalanceSheet(ledger, asOf, stock).difference, 0);

      const day = ledgerDayBook(ledger, period);
      assert.equal(day.totalDebit, tb.totals.debit, 'Day Book debits = TB movements');
      assert.equal(day.totalCredit, tb.totals.credit);
      assert.equal(day.entries.length, ledger.vouchers.filter((v) => v.date >= period.start && v.date <= period.end).length);

      assert.equal(cashFlowStatement(ledger, period, stock).difference, 0, 'cash flow reconciles');
      assert.equal(fundsFlow(ledger, period, stock).difference, 0, 'funds flow ties to working capital');
    }
  }
  const fyDay = ledgerDayBook(ledger, FY);
  for (const k of ['Journal', 'Depreciation', 'Fixed Asset', 'Receipt'] as const) assert.ok(fyDay.entries.some((e) => e.voucher.kind === k), `day book shows ${k}`);
  // Type filter.
  const jv = ledgerDayBook(ledger, FY, ['Journal']);
  assert.deepEqual(jv.entries.map((e) => e.voucher.number), ['JV/FY25-26/0001']);
  assert.equal(jv.entries[0].amount, 50000);
});

test('manual closing-stock override (stock not maintained) and the stored config', () => {
  const typed = manualValuer({ mode: 'manual', opening: 100000, entries: [{ date: '2026-03-31', value: 200000 }] });
  const pl = ledgerProfitAndLoss(ledger, FY, typed);
  assert.equal(pl.trading.openingStock, 100000);
  assert.equal(pl.trading.closingStock, 200000);
  assert.equal(ledgerBalanceSheet(ledger, FY.end, typed).difference, 0);
  assert.equal(ledgerBalanceSheet(ledger, '2026-06-30', typed).difference, 0);
  // Stored config drives loadStockValuer.
  saveClosingStockConfig({ mode: 'manual', opening: 100000, entries: [{ date: '2026-03-31', value: 200000 }, { date: 'bad', value: 1 }] });
  assert.equal(loadStockValuer()?.value('2026-04-15'), 200000);
  assert.equal(loadStockValuer()?.value('2025-04-15'), 100000);
  saveClosingStockConfig({ mode: 'none' });
  assert.equal(loadStockValuer(), undefined);
  // Automatic: inventory mode as soon as an item tracks stock.
  saveClosingStockConfig({});
  setJson('mrchartist_inv_stock_items', [widget]);
  assert.equal(loadStockValuer()?.mode, 'inventory');
  assert.equal(loadStockValuer()?.value('2025-04-01'), 100000);
});

test('dated opening stock moves are openings, never profit', () => {
  const pos = computeStock({
    items: [{ ...widget, opening_qty: 0 }],
    moves: [{ id: 'm', item_id: 'w', date: '2025-04-01', qty: 10, rate: 100, kind: 'opening' }],
    invoices: [], purchases: [], method: 'WEIGHTED_AVG',
  });
  const v = inventoryValuer(pos);
  const empty = buildLedger({ ...input, ...EMPTY_BOOKS, manual: [], assets: [] });
  const pl = ledgerProfitAndLoss(empty, FY, v);
  assert.equal(pl.trading.openingStock, 100000);
  assert.equal(pl.trading.closingStock, 100000);
  assert.equal(pl.netProfit, 0);
  const bs = ledgerBalanceSheet(empty, FY.end, v);
  assert.equal(bs.difference, 0);
  assert.equal(bs.openingStock, 100000);
});

test('Group Summary totals equal the trial balance; groups roll up their ledgers', () => {
  const tb = trialBalance(ledger, FY);
  const root = groupSummary(ledger, FY, null);
  assert.equal(root.totals.debit, tb.totals.debit);
  assert.equal(root.totals.credit, tb.totals.credit);
  assert.equal(root.totals.opening, 0);
  assert.equal(root.totals.closing, 0);
  for (const head of root.rows) {
    const leaves = flattenRows([head], true).filter((r) => r.kind === 'ledger');
    assert.equal(head.closing, leaves.reduce((s, r) => s + r.closing, 0), head.label);
  }
  const ca = groupSummary(ledger, FY, headId('Current assets'));
  const bank = tb.rows.find((r) => r.account.id === A.bank)!.closing;
  const cashBank = ca.rows.find((r) => r.id === 'CASH_BANK')!;
  assert.equal(cashBank.closing, bank);
  // Debtors split into parties.
  const debt = groupSummary(ledger, FY, 'TRADE_RECEIVABLES').rows[0];
  assert.equal(debt.children[0].party, 'Acme Pvt Ltd');
  // Zero balances hidden by default, shown on request.
  assert.ok(groupSummary(ledger, FY, 'INVESTMENTS').rows.length === 0);
  assert.ok(groupSummary(ledger, FY, 'INVESTMENTS', { showZero: true }).rows.length > 0);
  // Group vouchers.
  assert.ok(groupVouchers(ledger, FY, 'CASH_BANK').rows.some((r) => r.voucher.id === 'mv:cap'));
});

test('group source adapter: a registered tree (WP-1 groups) drives the summary', () => {
  setGroupSource({
    nodes: () => [...builtInGroupSource.nodes(), { id: 'u:mumbai', label: 'Mumbai debtors', parent: 'TRADE_RECEIVABLES', nature: 'asset' }],
    groupOfAccount: (a) => (a.id === A.debtors ? 'u:mumbai' : a.group),
  });
  try {
    const rows = groupSummary(ledger, FY, 'TRADE_RECEIVABLES').rows;
    assert.equal(rows[0].id, 'u:mumbai');
    assert.equal(rows[0].children[0].accountId, A.debtors);
  } finally {
    setGroupSource(null);
  }
});

test('drill path: BS group → sub-group → ledger → monthly summary → vouchers → voucher', () => {
  let at: DrillLevel = { kind: 'group', groupId: null, period: FY };
  at = drillDown(at, { kind: 'group', id: headId('Current assets') })!;
  assert.equal(drillTitle(at, ledger), 'Group Summary: Current assets');
  at = drillDown(at, { kind: 'group', id: 'CASH_BANK' })!;
  at = drillDown(at, { kind: 'ledger', accountId: A.bank })!;
  assert.equal(drillTitle(at, ledger), 'Ledger Monthly Summary: Bank account');
  const ms = monthlySummary(ledger, A.bank, FY)!;
  assert.equal(ms.rows.length, 12);
  assert.equal(ms.rows.at(-1)!.closing, ms.closing);
  const april = ms.rows[0];
  assert.equal(april.debit, 10000000);
  at = drillDown(at, { kind: 'month', period: april.period })!;
  assert.deepEqual(at, { kind: 'vouchers', accountId: A.bank, party: undefined, period: { start: '2025-04-01', end: '2025-04-30' } });
  at = drillDown(at, { kind: 'voucher', voucherId: 'mv:cap' })!;
  assert.equal(drillTitle(at, ledger), 'Receipt RV/FY25-26/0001');
  assert.equal(drillDown(at, { kind: 'month', period: FY }), null);
});

test('registers: month-wise with counts, columnar per ledger, statistics', () => {
  const reg = voucherRegister(ledger, 'sales', FY);
  assert.equal(reg.months.length, 12);
  assert.equal(reg.count, 1);
  assert.equal(reg.months.find((m) => m.key === '2025-06')!.amount, 100000);
  const pur = voucherRegister(ledger, 'purchase', FY);
  const col = columnarRegister(ledger, pur.months.flatMap((m) => m.vouchers));
  assert.deepEqual(col.columns.map((c) => c.accountId).sort(), [A.creditors, A.inCgst, A.inSgst, A.purchases].sort());
  assert.equal(col.totals.reduce((s, x) => s + x, 0), 0);
  const stats = voucherStatistics(ledger, FY);
  assert.equal(stats.total, ledgerDayBook(ledger, FY).entries.length);
  assert.equal(stats.rows.find((r) => r.kind === 'Journal')!.manual, 1);
});

test('comparative columns: previous period, month-wise and quarter-wise', () => {
  assert.deepEqual(previousPeriod(FY), { start: '2024-04-01', end: '2025-03-31' });
  assert.deepEqual(previousPeriod({ start: '2025-05-01', end: '2025-05-31' }), { start: '2025-04-01', end: '2025-04-30' });
  assert.deepEqual(previousPeriod({ start: '2025-05-10', end: '2025-05-19' }), { start: '2025-04-30', end: '2025-05-09' });
  assert.equal(columnsFor(FY, 'monthly').length, 12);
  assert.deepEqual(columnsFor(FY, 'quarterly').map((c) => c.label), ['Q1 FY25-26', 'Q2 FY25-26', 'Q3 FY25-26', 'Q4 FY25-26']);
  // Month columns of an income/expense group add up to the full-period movement.
  const income = groupSummaryColumns(ledger, columnsFor(FY, 'monthly'), headId('Expenses'), { detailed: true });
  assert.ok(income.pnl);
  const full = groupSummary(ledger, FY, headId('Expenses'));
  assert.equal(income.totals.reduce((s, x) => s + x, 0), full.totals.debit - full.totals.credit);
  // Balance-sheet groups compare closing balances.
  const cmp = groupSummaryColumns(ledger, columnsFor(FY2, 'previous'), 'CASH_BANK');
  const bankRow = cmp.rows.find((r) => r.id === A.bank)!;
  assert.equal(bankRow.values[1], trialBalance(ledger, FY).rows.find((r) => r.account.id === A.bank)?.closing ?? 0);
});

test('period context: device-local, presets re-resolved, bad input falls back', () => {
  assert.equal(getPeriodContext().preset, 'this_fy');
  setPeriodContext('custom', { start: '2025-04-01', end: '2025-06-30' });
  resetPeriodContextForTests();
  assert.deepEqual(getPeriodContext(), { preset: 'custom', period: { start: '2025-04-01', end: '2025-06-30' } });
  assert.equal(localStorage.getItem('mrchartist_report_period')?.includes('2025-06-30'), true);
  assert.deepEqual(normalizePeriodContext({ preset: 'this_fy' }, new Date(2026, 4, 10)), { preset: 'this_fy', period: FY2 });
  assert.equal(normalizePeriodContext({ preset: 'custom', period: { start: '2026-02-01', end: '2026-01-01' } }).preset, 'this_fy');
});

test('ratio analysis (TDS package module) takes the closing stock', () => {
  const r = ratioAnalysis(ledger, FY, FY.end, wac);
  assert.equal(r.parts.stock, 165000);
  assert.equal(r.parts.grossProfit, 45000);
  assert.equal(r.ratios.find((x) => x.id === 'grossProfitPct')!.value, 45);
  // Without a valuer the module's own figures are unchanged (no stock journalised here).
  assert.equal(ratioAnalysis(ledger, FY).parts.stock, 0);
});

test('exceptions: negative cash, debtor in credit, post-dated vouchers, negative stock', () => {
  const led = buildLedger({
    ...input,
    manual: [
      { id: 'x', type: 'PAYMENT', number: 'PV/1', date: '2025-05-01', narration: 'Petty', lines: [{ account_id: A.office, dr: 50000, cr: 0 }, { account_id: A.cash, dr: 0, cr: 50000 }], created_at: '' },
      { id: 'y', type: 'JOURNAL', number: 'JV/9', date: '2025-05-02', narration: 'Advance', lines: [{ account_id: A.bank, dr: 1000, cr: 0 }, { account_id: A.debtors, dr: 0, cr: 1000, party: 'Beta' }], created_at: '' },
      { id: 'z', type: 'JOURNAL', number: 'JV/10', date: '2027-01-01', narration: 'Later', lines: [{ account_id: A.rent, dr: 100, cr: 0 }, { account_id: A.provisions, dr: 0, cr: 100 }], created_at: '' },
    ],
  });
  const neg = computeStock({ items: [{ ...widget, opening_qty: 0 }], moves: [], invoices: data.invoices as never, purchases: [], method: 'FIFO' });
  const ex = exceptionReport(led, FY, '2026-06-30', { positions: neg, overdue: [{ party: 'Acme', number: 'INV/1', dueDate: '2025-05-01', outstanding: 10, daysOverdue: 5 }] });
  assert.deepEqual(ex.negativeLedgers.find((n) => n.reason === 'cash_negative'), { accountId: A.cash, label: 'Cash in hand', balance: -50000, firstDate: '2025-05-01', lowest: -50000, reason: 'cash_negative' });
  assert.ok(ex.negativeLedgers.some((n) => n.reason === 'debtor_credit' && n.party === 'Beta'));
  assert.deepEqual(ex.postDated.map((v) => v.number), ['JV/10']);
  assert.equal(ex.negativeStock[0].firstDate, '2025-06-01');
  assert.equal(ex.overdue.length, 1);
});

test('report prefs: device-local per report, tolerant read', () => {
  assert.equal(getReportPrefs('tb').detailed, false);
  setReportPrefs('tb', { ...getReportPrefs('tb'), detailed: true, columns: 'monthly' });
  assert.equal(getReportPrefs('tb').detailed, true);
  assert.equal(getReportPrefs('bs').detailed, false);
  assert.equal(normalizeReportPrefs({ columns: 'weird', showZero: 'yes' }).columns, 'none');
  assert.equal(localStorage.getItem('mrchartist_inv_report_prefs'), null);
});

test('PERF-1: balances are computed once per ledger and day, and every caller gets a fresh Map', async () => {
  const { closingBalances, openingBalances, ledgerBalanceSheet: bsOf } = await import('../src/lib/ledger/reports.ts');
  const first = closingBalances(ledger, FY.end);
  const expected = new Map(first);
  first.set(A.bank, 123);
  first.clear();
  assert.deepEqual(closingBalances(ledger, FY.end), expected, 'a caller changing its Map does not reach the cache');
  const fresh = buildLedger(input);
  assert.deepEqual(closingBalances(ledger, FY.end), closingBalances(fresh, FY.end));
  assert.deepEqual(openingBalances(ledger, FY2.start), openingBalances(fresh, FY2.start));
  assert.deepEqual(closingBalances(ledger, FY.end, 'Acme'), closingBalances(fresh, FY.end, 'Acme'));
  assert.deepEqual(bsOf(ledger, FY2.end), bsOf(fresh, FY2.end));
  assert.deepEqual(bsOf(ledger, FY2.end), bsOf(ledger, FY2.end));
});
