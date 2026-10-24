/**
 * Cost centres / projects (6.16) and budgets vs actual (6.17).
 * Hand-worked numbers in the comments.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { EMPTY_BOOKS, type BooksData } from '../src/lib/books.ts';
import {
  A,
  budgetReportRows,
  budgetVsActual,
  budgetsFromActuals,
  buildLedger,
  costCentrePnl,
  costCentrePnlRows,
  fyMonthIndex,
  itemsByCostCentre,
  ledgerProfitAndLoss,
  loadBudgets,
  marginPercent,
  monthlyActuals,
  rangeFor,
  saveBudget,
  saveBudgets,
  saveVoucher,
  loadVouchers,
  spreadEvenly,
  sumMonths,
  UNALLOCATED,
  variance,
  chartOf,
  type Budget,
  type LedgerInput,
} from '../src/lib/ledger/index.ts';
import {
  costCentreUsage,
  deleteCostCentre,
  hoistCostCentre,
  loadCostCentres,
  matchCostCentre,
  saveCostCentre,
  validateCostCentre,
  type CostCentre,
} from '../src/lib/cost-centres.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import { buildBackup, parseBackup, restoreBackup, validateBackupData, wipeAppData } from '../src/lib/backup.ts';
import { DB_PREFIX, getTable, setTable } from '../src/lib/storage.ts';
import { timeLines, mileageLines, expenseLine } from '../src/lib/timesheets.ts';
import { DEFAULT_TIME_PREFS } from '../src/types/time.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => resetStorage());

const FY = { start: '2025-04-01', end: '2026-03-31' };
const input = (over: Partial<LedgerInput> = {}): LedgerInput => ({ ...EMPTY_BOOKS, userAccounts: [], manual: [], assets: [], today: '2026-03-31', ...over });
const inv = (over: Record<string, unknown>) => ({ status: 'Sent', doc_type: 'INVOICE', client: { name: 'Acme' }, ...over });
const invoices = (rows: Record<string, unknown>[]) => rows.map(inv) as unknown as BooksData['invoices'];
const bill = (over: Record<string, unknown>) => ({
  id: 'P', kind: 'PURCHASE', vendor_name: 'Supplier', bill_number: 'B-1', date: '2025-07-01', category: 'Purchases',
  lines: [], taxable: 1000, cgst: 90, sgst: 90, igst: 0, itc_eligible: true, total: 1180, amount_paid: 0, ...over,
});
const cc = (id: string, name: string, over: Partial<CostCentre> = {}): CostCentre => ({ id, name, kind: 'project', active: true, created_at: '', ...over });
const CENTRES = [cc('web', 'Website'), cc('app', 'Mobile app'), cc('north', 'North', { kind: 'branch' }), cc('delhi', 'Delhi', { kind: 'branch', parent_id: 'north' })];

/* ── Postings carry the cost centre ───────────────────────────── */

test('invoice, bill and voucher lines carry their cost centre; receipts and payments do not', () => {
  const led = buildLedger(input({
    invoices: invoices([{ id: 'S', issue_date: '2025-04-10', taxable_value: 1000, igst_amount: 180, tax_amount: 180, total: 1180, cost_centre_id: 'web' }]),
    transactions: [{ id: 't', invoice_id: 'S', amount: 1180, method: 'UPI', date: '2025-04-20' }],
    purchases: [bill({ id: 'E', kind: 'EXPENSE', category: 'Software & subscriptions', cost_centre_id: 'web', taxable: 500, cgst: 0, sgst: 0, total: 500 })],
  }));
  const sale = led.vouchers.find((v) => v.id === 'sale:S')!;
  assert.ok(sale.lines.every((l) => l.cost_centre === 'web'));
  assert.ok(led.vouchers.find((v) => v.id === 'exp:E')!.lines.every((l) => l.cost_centre === 'web'));
  assert.ok(led.vouchers.find((v) => v.id === 'rcpt:t')!.lines.every((l) => l.cost_centre === undefined));
});

test('per-line override splits Sales by each line’s taxable value, exact to the paisa', () => {
  // Lines 700 (web, the document's) + 300 (app) → Sales 700 web / 300 app.
  const rec = inv({
    id: 'S', issue_date: '2025-05-01', cost_centre_id: 'web', gst_mode: 'NONE',
    items: [
      { id: 'a', name: 'A', quantity: 7, rate: 100, amount: 700 },
      { id: 'b', name: 'B', quantity: 1, rate: 300, amount: 300, cost_centre_id: 'app' },
    ],
    taxable_value: 1000, total: 1000,
  }) as unknown as InvoiceRecord;
  assert.deepEqual(itemsByCostCentre(rec, 100000), [['web', 70000], ['app', 30000]]);
  // Odd paise: 3 equal lines over 100.00 → 33.34 / 33.33 / 33.33, sums back exactly.
  const odd = inv({
    id: 'O', issue_date: '2025-05-01', gst_mode: 'NONE',
    items: [
      { id: 'a', name: 'A', quantity: 1, rate: 1, amount: 1, cost_centre_id: 'web' },
      { id: 'b', name: 'B', quantity: 1, rate: 1, amount: 1, cost_centre_id: 'app' },
      { id: 'c', name: 'C', quantity: 1, rate: 1, amount: 1 },
    ],
  }) as unknown as InvoiceRecord;
  const parts = itemsByCostCentre(odd, 10000);
  assert.equal(parts.reduce((s, [, p]) => s + p, 0), 10000);
  assert.equal(parts.length, 3);
  const led = buildLedger(input({ invoices: [rec] as BooksData['invoices'] }));
  const sales = led.vouchers[0].lines.filter((l) => l.account === A.sales);
  assert.deepEqual(sales.map((l) => [l.cost_centre, l.cr]), [['web', 70000], ['app', 30000]]);
});

/* ── Project P&L reconciles with the overall P&L ──────────────── */

function mixedLedger() {
  return buildLedger(input({
    invoices: invoices([
      // Website: 10,000 sale; Delhi branch: 4,000 sale; untagged: 2,500 sale; credit note on Website: 1,000.
      { id: 'S1', issue_date: '2025-04-10', taxable_value: 10000, igst_amount: 1800, tax_amount: 1800, total: 11800, cost_centre_id: 'web' },
      { id: 'S2', issue_date: '2025-06-10', taxable_value: 4000, total: 4000, cost_centre_id: 'delhi' },
      { id: 'S3', issue_date: '2025-06-11', taxable_value: 2500, total: 2500 },
      { id: 'C1', doc_type: 'CREDIT_NOTE', issue_date: '2025-07-01', taxable_value: 1000, igst_amount: 180, tax_amount: 180, total: 1180, cost_centre_id: 'web' },
      // Out of period
      { id: 'S9', issue_date: '2026-04-02', taxable_value: 999, total: 999, cost_centre_id: 'web' },
    ]),
    purchases: [
      bill({ id: 'P1', cost_centre_id: 'web' }), // Purchases 1,000 (direct), ITC claimed
      bill({ id: 'P2', kind: 'EXPENSE', category: 'Rent', taxable: 3000, cgst: 0, sgst: 0, total: 3000 }), // untagged indirect
      bill({ id: 'P3', kind: 'EXPENSE', category: 'Travel', taxable: 600, cgst: 54, sgst: 54, itc_eligible: false, total: 708, cost_centre_id: 'app' }),
    ],
    manual: [
      {
        id: 'm1', type: 'JOURNAL', number: 'JV/1', date: '2025-08-01', narration: 'Salary share', created_at: '',
        lines: [
          { account_id: A.salaries, dr: 200000, cr: 0, cost_centre_id: 'web' },
          { account_id: A.salaries, dr: 50000, cr: 0 },
          { account_id: A.bank, dr: 0, cr: 250000 },
        ],
      },
    ],
    assets: [{ id: 'fa', name: 'Laptop', block: 'COMPUTER', account_id: A.faComputers, cost: 50000, acquired_on: '2025-04-01', put_to_use: '2025-04-01', paid_from: A.bank, created_at: '' }],
  }));
}

test('project P&L columns add up to the overall P&L (income, direct costs, net)', () => {
  const led = mixedLedger();
  const pnl = costCentrePnl(led, FY, CENTRES);
  const overall = ledgerProfitAndLoss(led, FY);
  const sum = (pick: (t: (typeof pnl.grand)) => number) => Object.values(pnl.totals).reduce((s, t) => s + pick(t), 0);
  assert.equal(sum((t) => t.income), overall.revenue);
  assert.equal(sum((t) => t.directCosts), overall.directCosts);
  assert.equal(sum((t) => t.netProfit), overall.netProfit);
  assert.equal(pnl.grand.netProfit, overall.netProfit);
  assert.equal(pnl.grand.income, overall.totalIncome);
  // Every account row's columns add up to its own total, which equals the P&L line.
  for (const r of pnl.rows) assert.equal(Object.values(r.amounts).reduce((s, x) => s + x, 0), r.total);
  // Website: 10,000 − 1,000 returns = 9,000 income; 1,000 purchases; margin 8,000; 2,000 salaries → 6,000.
  assert.deepEqual(pnl.totals.web, { income: 900000, directCosts: 100000, margin: 800000, indirectExpenses: 200000, netProfit: 600000 });
  assert.equal(marginPercent(pnl.totals.web), 88.9);
  // Mobile app: 708 travel (ITC not claimed) only.
  assert.equal(pnl.totals.app.netProfit, -70800);
  // Unallocated: 2,500 sale − 3,000 rent − 500 salaries − depreciation (50,000 × 40% = 20,000).
  assert.equal(pnl.totals[UNALLOCATED].income, 250000);
  assert.equal(pnl.totals[UNALLOCATED].indirectExpenses, 300000 + 50000 + 2000000);
  assert.equal(pnl.columns.at(-1)!.key, UNALLOCATED);
});

test('roll-up merges a child centre into its parent column and still reconciles', () => {
  const led = mixedLedger();
  const flat = costCentrePnl(led, FY, CENTRES);
  assert.ok(flat.columns.some((c) => c.key === 'delhi' && c.label === 'North › Delhi'));
  const rolled = costCentrePnl(led, FY, CENTRES, { rollUp: true });
  assert.ok(!rolled.columns.some((c) => c.key === 'delhi'));
  assert.equal(rolled.totals.north.income, 400000);
  assert.equal(rolled.grand.netProfit, flat.grand.netProfit);
  // A centre missing from the master is reported in its own column, never dropped.
  const orphan = costCentrePnl(led, FY, CENTRES.filter((c) => c.id !== 'app'));
  assert.ok(orphan.columns.some((c) => c.label === 'Deleted cost centre'));
  assert.equal(orphan.grand.netProfit, flat.grand.netProfit);
  const rows = costCentrePnlRows(flat);
  assert.equal(rows[0].at(-1), 'Total');
  assert.ok(rows.some((r) => r[2] === 'Net profit / (loss)' && r.at(-1) === flat.grand.netProfit / 100));
});

/* ── Inheritance: duplicate, credit / debit notes, conversions ─── */

test('credit and debit notes and conversions inherit the cost centre; normalizeRecord keeps line overrides', async () => {
  const docs = await import('../src/lib/documents.ts');
  const { calculateInvoice } = await import('../src/lib/invoice-calc.ts');
  const base = normalizeRecord({
    id: 'i1', invoice_number: 'INV/FY25-26/0001', doc_type: 'TAX_INVOICE', issue_date: '2025-06-01', due_date: '2025-06-15', status: 'Sent',
    gst_mode: 'CGST_SGST', place_of_supply: '27', cost_centre_id: 'web',
    items: [
      { id: 'a', name: 'Research', quantity: 2, rate: 1000, tax_rate: 18, amount: 2000 },
      { id: 'b', name: 'App work', quantity: 1, rate: 500, tax_rate: 18, amount: 500, cost_centre_id: 'app' },
    ],
  });
  const t = calculateInvoice(base);
  const original = { ...base, taxable_value: t.taxable_value, total: t.total };
  assert.equal(original.cost_centre_id, 'web');
  assert.equal(original.items[1].cost_centre_id, 'app');
  assert.equal(original.items[0].cost_centre_id, undefined);

  const cn = docs.buildCreditNote(original, { reason: 'Return', lines: [{ itemId: 'b', quantity: 1 }] }, [], [original], { id: 'cn', invoice_number: 'CRN/1', today: '2025-07-01' }).record!;
  assert.equal(cn.cost_centre_id, 'web');
  assert.equal(cn.items[0].cost_centre_id, 'app', 'the credited line keeps its override');
  const dn = docs.buildDebitNote(original, { lines: [{ name: 'Extra', quantity: 1, rate: 100 }], reason: 'Short billed' }, { id: 'dn', invoice_number: 'DBN/1', today: '2025-07-01', dueDays: 7 });
  assert.equal(dn.cost_centre_id, 'web');
  const quote = { ...original, doc_type: 'QUOTATION' as const, status: 'Draft' as const };
  const conv = docs.buildConvertedDraft(quote, 'TAX_INVOICE', { id: 'c', invoice_number: 'INV/2', today: '2025-07-01', dueDays: 7 });
  assert.equal(conv.cost_centre_id, 'web');
  assert.equal(conv.items[1].cost_centre_id, 'app');
  // A credit note posts its Sales returns to the same centres as the original line.
  const led = buildLedger(input({ invoices: [cn] as BooksData['invoices'] }));
  const ret = led.vouchers[0].lines.filter((l) => l.account === A.salesReturns);
  assert.deepEqual(ret.map((l) => l.cost_centre), ['app']);
});

/* ── Master ──────────────────────────────────────────────────── */

test('cost centre master: validation, one level of grouping, delete blocked while in use', () => {
  const web = saveCostCentre({ name: 'Website', kind: 'project', active: true });
  assert.deepEqual(validateCostCentre({ name: 'website', kind: 'project', active: true }, loadCostCentres()), ['A cost centre named "website" already exists.']);
  const north = saveCostCentre({ name: 'North', kind: 'branch', active: true });
  const delhi = saveCostCentre({ name: 'Delhi', kind: 'branch', active: true, parent_id: north.id });
  assert.match(validateCostCentre({ name: 'Saket', kind: 'branch', active: true, parent_id: delhi.id }, loadCostCentres())[0], /one level/);
  assert.match(validateCostCentre({ id: north.id, name: 'North', kind: 'branch', active: true, parent_id: web.id }, loadCostCentres())[0], /groups others/);
  setTable('purchases', [bill({ id: 'X', cost_centre_id: web.id })]);
  assert.throws(() => deleteCostCentre(web.id), /mark it inactive/);
  assert.throws(() => deleteCostCentre(north.id), /mark it inactive/);
  deleteCostCentre(delhi.id);
  assert.equal(loadCostCentres().length, 2);
  saveCostCentre({ ...web, active: false });
  assert.equal(matchCostCentre('website', loadCostCentres()), undefined, 'inactive centres are not matched');
  assert.equal(matchCostCentre(' north ', loadCostCentres()), north.id);
  assert.equal(costCentreUsage(web.id, { invoices: [{ items: [{ cost_centre_id: web.id }] }] }).invoices, 1);
});

test('time, mileage and re-billed expenses carry their cost centre onto invoice lines', () => {
  const centres = [cc('web', 'Website')];
  const entry = (over: Record<string, unknown>) => ({ id: String(Math.random()), client_name: 'Acme', description: 'Build', date: '2025-05-01', minutes: 60, hourly_rate: 1000, billable: true, ...over });
  const lines = timeLines([entry({ project: 'website' }), entry({ project: 'Other' }), entry({ project: 'Other', cost_centre_id: 'web' })] as never, DEFAULT_TIME_PREFS, centres);
  assert.deepEqual(lines.map((l) => l.cost_centre_id), ['web', undefined, 'web']);
  const trips = mileageLines([
    { id: '1', client_name: 'Acme', date: '2025-05-01', from: 'A', to: 'B', purpose: '', km: 10, rate_per_km: 10, cost_centre_id: 'web' },
    { id: '2', client_name: 'Acme', date: '2025-05-01', from: 'A', to: 'B', purpose: '', km: 5, rate_per_km: 10 },
  ], DEFAULT_TIME_PREFS);
  assert.deepEqual(trips.map((t) => [t.quantity, t.cost_centre_id]), [[10, 'web'], [5, undefined]]);
  assert.equal(expenseLine(bill({ cost_centre_id: 'web' }) as never, DEFAULT_TIME_PREFS).cost_centre_id, 'web');
  assert.deepEqual(hoistCostCentre([{ cost_centre_id: 'web' }, { cost_centre_id: 'web' }]), { costCentreId: 'web', items: [{}, {}] });
  assert.equal(hoistCostCentre([{ cost_centre_id: 'web' }, {}]).costCentreId, undefined);
});

test('manual voucher lines keep their cost centre through save / load', () => {
  saveVoucher({
    type: 'JOURNAL', date: '2025-05-01', narration: 'x',
    lines: [{ account_id: A.rent, dr: 1000, cr: 0, cost_centre_id: 'web' }, { account_id: A.cash, dr: 0, cr: 1000 }],
  }, chartOf([]));
  const v = loadVouchers()[0];
  assert.equal(v.lines[0].cost_centre_id, 'web');
  assert.equal(v.lines[1].cost_centre_id, undefined);
});

/* ── Budgets ─────────────────────────────────────────────────── */

test('spreadEvenly is exact to the paisa, remainder to the first months', () => {
  const s = spreadEvenly(100000_00 + 5); // ₹1,00,000.05
  assert.equal(sumMonths(s), 100000_05);
  assert.deepEqual(s.slice(7, 10), [833334, 833334, 833333]); // 10,000,005 = 12 × 833,333 + 9
  assert.deepEqual(spreadEvenly(1200), Array(12).fill(100));
  assert.equal(sumMonths(spreadEvenly(7)), 7);
  assert.deepEqual(spreadEvenly(0), Array(12).fill(0));
});

test('FY month index and view ranges (Apr = 0 … Mar = 11)', () => {
  assert.equal(fyMonthIndex('2025-04-01', 2025), 0);
  assert.equal(fyMonthIndex('2025-12-31', 2025), 8);
  assert.equal(fyMonthIndex('2026-03-31', 2025), 11);
  assert.equal(fyMonthIndex('2026-04-01', 2025), -1);
  assert.equal(fyMonthIndex('2025-03-31', 2025), -1);
  assert.deepEqual(rangeFor('quarter', 4), { from: 3, to: 5 });
  assert.deepEqual(rangeFor('ytd', 8), { from: 0, to: 8 });
  assert.deepEqual(rangeFor('month', 11), { from: 11, to: 11 });
});

test('variance signs: income above budget favourable, expense above budget adverse', () => {
  assert.deepEqual(variance(true, 1000, 1200), { variance: 200, percent: 20, favourable: true });
  assert.deepEqual(variance(true, 1000, 800), { variance: -200, percent: -20, favourable: false });
  assert.deepEqual(variance(false, 1000, 1200), { variance: 200, percent: 20, favourable: false });
  assert.deepEqual(variance(false, 1000, 800), { variance: -200, percent: -20, favourable: true });
  assert.equal(variance(false, 0, 50).percent, null);
  assert.equal(variance(true, 1000, 1000).favourable, true);
});

test('budget vs actual: month / quarter / YTD, account-level and per cost centre', () => {
  const led = mixedLedger();
  const b = (account_id: string, months: number[], cost_centre_id?: string): Budget =>
    ({ id: `${account_id}-${cost_centre_id ?? ''}`, fy_start_year: 2025, account_id, months, created_at: '', ...(cost_centre_id ? { cost_centre_id } : {}) });
  const budgets = [
    b(A.sales, spreadEvenly(12000_00 * 12)), // 12,000 a month
    b(A.rent, spreadEvenly(2000_00 * 12)),
    b(A.sales, spreadEvenly(6000_00 * 12), 'web'),
  ];
  // April: sales actual 10,000 (S1) vs 12,000 → −2,000 adverse; rent 0 vs 2,000 → favourable.
  const apr = budgetVsActual(led, budgets, 2025, rangeFor('month', 0));
  const sales = apr.rows.find((r) => r.account.id === A.sales)!;
  assert.deepEqual([sales.budget, sales.actual, sales.variance, sales.favourable], [1200000, 1000000, -200000, false]);
  assert.equal(apr.rows.find((r) => r.account.id === A.rent)!.favourable, true);
  assert.equal(apr.rows.length, 2, 'cost-centre budgets are not mixed into the account-level view');
  // Q1 (Apr–Jun): sales 10,000 + 4,000 + 2,500 = 16,500 vs 36,000.
  const q1 = budgetVsActual(led, budgets, 2025, rangeFor('quarter', 1));
  assert.equal(q1.rows.find((r) => r.account.id === A.sales)!.actual, 1650000);
  // YTD to July, Website only: 10,000 sale (credit note posts to Sales returns, not Sales).
  const web = budgetVsActual(led, budgets, 2025, rangeFor('ytd', 3), 'web');
  assert.deepEqual(web.rows.map((r) => [r.budget, r.actual]), [[2400000, 1000000]]);
  // Rent actual: 3,000 in July (P2 is dated 2025-07-01) → YTD to Jul 3,000 vs 8,000.
  const ytd = budgetVsActual(led, budgets, 2025, rangeFor('ytd', 3));
  assert.equal(ytd.expense.actual, 300000);
  assert.equal(ytd.net.budget, ytd.income.budget - ytd.expense.budget);
  const rows = budgetReportRows(ytd);
  assert.deepEqual(rows[2], ['Type', 'Code', 'Account', 'Budget', 'Actual', 'Variance', 'Variance %', 'Result']);
  assert.ok(rows.some((r) => r[2] === 'Net (income − expenses)'));
});

test('copy last year’s actuals as next year’s budget, +x%, then replace or keep on re-copy', () => {
  const led = mixedLedger();
  const plain = budgetsFromActuals(led, 2025, 10);
  const rent = plain.find((r) => r.account_id === A.rent)!;
  assert.equal(rent.fy_start_year, 2026);
  assert.equal(rent.cost_centre_id, undefined);
  assert.equal(rent.months[3], 330000, 'July rent 3,000 × 1.10');
  assert.equal(sumMonths(rent.months), 330000);
  const salesRow = plain.find((r) => r.account_id === A.sales)!;
  assert.equal(sumMonths(salesRow.months), Math.round(16500 * 1.1) * 100);
  // Every copied account matches monthlyActuals × 1.1, rounded to the rupee.
  const act = monthlyActuals(led, 2025);
  for (const r of plain) {
    const src = act.get(`${r.account_id}|*`)!;
    assert.deepEqual(r.months, src.map((m) => Math.round((m * 1.1) / 100) * 100));
  }
  const byCc = budgetsFromActuals(led, 2025, 0, { byCostCentre: true });
  assert.ok(byCc.every((r) => r.cost_centre_id));
  assert.ok(byCc.some((r) => r.account_id === A.sales && r.cost_centre_id === 'web'));

  const accounts = led.accounts;
  saveBudget({ fy_start_year: 2026, account_id: A.rent, months: spreadEvenly(1200_00) }, accounts);
  assert.throws(() => saveBudget({ fy_start_year: 2026, account_id: A.rent, months: spreadEvenly(100) }, accounts), /already has a budget/);
  assert.throws(() => saveBudget({ fy_start_year: 2026, account_id: A.bank, months: spreadEvenly(100) }, accounts), /income and expense/);
  const kept = saveBudgets(plain, { replace: false });
  assert.equal(kept.skipped, 1);
  assert.equal(loadBudgets().find((x) => x.account_id === A.rent)!.months[0], 10000);
  const replaced = saveBudgets(plain, { replace: true });
  assert.deepEqual([replaced.added, replaced.replaced], [0, plain.length]);
  assert.equal(loadBudgets().length, plain.length);
  assert.equal(loadBudgets().find((x) => x.account_id === A.rent)!.months[3], 330000);
});

/* ── Backup ──────────────────────────────────────────────────── */

test('cost centres and budgets ride along in backups and restore identically', () => {
  saveCostCentre({ name: 'Website', kind: 'project', active: true });
  saveBudget({ fy_start_year: 2025, account_id: A.rent, months: spreadEvenly(24000_00) }, chartOf([]));
  const centres = getTable('cost_centres');
  const budgets = getTable('budgets');
  const text = JSON.stringify(buildBackup());
  wipeAppData();
  assert.deepEqual(getTable('cost_centres'), []);
  restoreBackup(parseBackup(text).data);
  assert.deepEqual(getTable('cost_centres'), centres);
  assert.deepEqual(getTable('budgets'), budgets);
  assert.throws(() => validateBackupData({ [DB_PREFIX + 'cost_centres']: JSON.stringify([{ name: 'No id' }]) }), /cost_centres/);
  assert.throws(() => validateBackupData({ [DB_PREFIX + 'budgets']: '{}' }), /budgets/);
});
