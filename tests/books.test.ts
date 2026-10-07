import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVouchers,
  dayBook,
  cashBook,
  profitAndLoss,
  monthlyTrend,
  gstSummary,
  balanceSheet,
  periodForPreset,
  fyPeriod,
  accountForMethod,
  getProfitSnapshot,
  toCsv,
  EMPTY_BOOKS,
  type BooksData,
} from '../src/lib/books.ts';
import { getIndianFY } from '../src/lib/invoice-number.ts';

/* ── Hand-computed fixture ───────────────────────────────────────
   Sales A  2025-04-10  taxable 1000  GST 180 (90+90)  total 1180
   Sales B  2025-03-20  taxable  500  GST  90          total  590   (previous FY)
   CN       2025-05-05  taxable  200  GST  36          total  236
   Draft    2025-04-12  ignored
   Receipts: A 590 UPI 04-20 | B 590 Cash 03-25 | A 100 Cash 05-02
   Purchase P1 2025-04-15 'Materials' taxable 400 GST 72 ITC  total 472
   Expense  E1 2025-05-10 'Rent'      taxable 300 GST 54 no ITC total 354
   Payments: P1 236 Bank 04-30 | E1 354 Cash 05-10
   Openings: cash 1000 and bank 5000 as of 2025-03-01
   ──────────────────────────────────────────────────────────────── */
function inv(over: Record<string, unknown>) {
  return {
    status: 'Sent',
    doc_type: 'INVOICE',
    client: { name: 'Acme', company: 'Acme Pvt Ltd' },
    ...over,
  };
}

const data: BooksData = {
  ...EMPTY_BOOKS,
  invoices: [
    inv({ id: 'A', invoice_number: 'INV/FY25-26/0001', issue_date: '2025-04-10', taxable_value: 1000, cgst_amount: 90, sgst_amount: 90, igst_amount: 0, tax_amount: 180, total: 1180 }),
    inv({ id: 'B', invoice_number: 'INV/FY24-25/0009', issue_date: '2025-03-20', status: 'Paid', taxable_value: 500, cgst_amount: 45, sgst_amount: 45, tax_amount: 90, total: 590 }),
    inv({ id: 'C', invoice_number: 'CRN/FY25-26/0001', doc_type: 'CREDIT_NOTE', issue_date: '2025-05-05', taxable_value: 200, cgst_amount: 18, sgst_amount: 18, tax_amount: 36, total: 236 }),
    inv({ id: 'D', invoice_number: 'INV/FY25-26/0002', status: 'Draft', issue_date: '2025-04-12', taxable_value: 9999, tax_amount: 0, total: 9999 }),
    inv({ id: 'Q', invoice_number: 'QTN/FY25-26/0001', doc_type: 'QUOTATION', issue_date: '2025-04-12', taxable_value: 7777, tax_amount: 0, total: 7777 }),
  ] as unknown as BooksData['invoices'],
  transactions: [
    { id: 't1', invoice_id: 'A', amount: 590, method: 'UPI', date: '2025-04-20' },
    { id: 't2', invoice_id: 'B', amount: 590, method: 'Cash', date: '2025-03-25' },
    { id: 't3', invoice_id: 'A', amount: 100, method: 'Cash', date: '2025-05-02' },
  ],
  purchases: [
    { id: 'P1', purchase_number: 'BILL-1', date: '2025-04-15', vendor_id: 'v1', category: 'Materials', taxable_value: 400, tax_amount: 72, total: 472, itc_eligible: true },
    { id: 'E1', kind: 'EXPENSE', date: '2025-05-10', vendor_id: 'v1', category: 'Rent', taxable_value: 300, tax_amount: 54, total: 354, itc_eligible: false },
  ],
  vendors: [{ id: 'v1', name: 'Vendor One' }],
  purchasePayments: [
    { id: 'pp1', purchase_id: 'P1', amount: 236, date: '2025-04-30', method: 'Bank transfer' },
    { id: 'pp2', purchase_id: 'E1', amount: 354, date: '2025-05-10', method: 'Cash' },
  ],
  openings: [
    { id: 'o1', account: 'cash', amount: 1000, as_of: '2025-03-01' },
    { id: 'o2', account: 'bank', amount: 5000, as_of: '2025-03-01' },
  ],
};

const FY2526 = { start: '2025-04-01', end: '2026-03-31' };

test('voucher stream: types, exclusions and chronological order', () => {
  const v = buildVouchers(data);
  assert.equal(v.length, 10); // draft + quotation excluded
  const count = (t: string) => v.filter((x) => x.type === t).length;
  assert.deepEqual(
    [count('Sales'), count('Credit Note'), count('Receipt'), count('Purchase'), count('Expense'), count('Payment')],
    [2, 1, 3, 1, 1, 2],
  );
  const dates = v.map((x) => x.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(v[0].id, 'sale:B');
  const sale = v.find((x) => x.id === 'sale:A')!;
  assert.equal(sale.debit, 1180);
  assert.equal(sale.link, '/invoice/A');
  assert.equal(v.find((x) => x.id === 'cn:C')!.credit, 236);
  assert.equal(v.find((x) => x.type === 'Payment')!.party, 'Vendor One');
});

test('day book filters by date and totals', () => {
  const v = buildVouchers(data);
  const d = dayBook(v, '2025-04-10');
  assert.equal(d.vouchers.length, 1);
  assert.equal(d.totalDebit, 1180);
  assert.equal(dayBook(v, '2025-04-11').vouchers.length, 0);
  assert.equal(dayBook(v, '2025-05-10', ['Payment']).vouchers.length, 1);
});

test('payment method mapping', () => {
  assert.equal(accountForMethod('Cash'), 'cash');
  assert.equal(accountForMethod('cash'), 'cash');
  for (const m of ['UPI', 'Bank transfer', 'Cheque', 'Card', '', undefined]) {
    assert.equal(accountForMethod(m), 'bank');
  }
});

test('cash book: opening carried across period start, running balance, closing', () => {
  const v = buildVouchers(data);
  const b = cashBook(v, data.openings, 'cash', { start: '2025-04-01', end: '2025-05-31' });
  assert.equal(b.opening, 1590); // 1000 + 590 cash receipt on 03-25
  assert.deepEqual(b.rows.map((r) => r.balance), [1690, 1336]);
  assert.equal(b.totalReceipts, 100);
  assert.equal(b.totalPayments, 354);
  assert.equal(b.closing, 1336);
});

test('bank book over the FY', () => {
  const v = buildVouchers(data);
  const b = cashBook(v, data.openings, 'bank', FY2526);
  assert.equal(b.opening, 5000);
  assert.equal(b.closing, 5354); // +590 UPI, -236 bank transfer
});

test('cash book: opening balance entered mid-period ignores earlier vouchers', () => {
  const v = buildVouchers(data);
  const openings = [{ id: 'x', account: 'cash' as const, amount: 200, as_of: '2025-05-01' }];
  const b = cashBook(v, openings, 'cash', { start: '2025-04-01', end: '2025-05-31' });
  assert.equal(b.opening, 200);
  assert.equal(b.closing, 200 + 100 - 354);
});

test('cash book without any opening is flagged and starts at zero', () => {
  const v = buildVouchers(data);
  const b = cashBook(v, [], 'cash', FY2526);
  assert.equal(b.openingMissing, true);
  assert.equal(b.opening, 590); // all-time movements before the FY start
});

test('P&L accrual: GST excluded, credit note deducted, non-ITC GST is cost', () => {
  const r = profitAndLoss(data, FY2526, 'accrual');
  assert.equal(r.sales, 1000);
  assert.equal(r.creditNotes, 200);
  assert.equal(r.income, 800);
  assert.equal(r.directCosts, 400); // ITC GST 72 excluded
  assert.equal(r.indirectExpenses, 354); // 300 + 54 blocked GST
  assert.equal(r.grossProfit, 400);
  assert.equal(r.netProfit, 46);
  assert.equal(r.margin, 5.75);
  assert.deepEqual(r.expenses.map((e) => [e.category, e.amount]), [['Materials', 400], ['Rent', 354]]);
});

test('P&L accrual: single month', () => {
  const r = profitAndLoss(data, { start: '2025-04-01', end: '2025-04-30' }, 'accrual');
  assert.equal(r.income, 1000);
  assert.equal(r.netProfit, 600);
  assert.equal(r.margin, 60);
});

test('P&L cash basis apportions receipts/payments to the taxable/cost share', () => {
  const r = profitAndLoss(data, FY2526, 'cash');
  // 590*1000/1180 = 500 ; 100*1000/1180 = 84.75 ; less credit note 200
  assert.equal(r.sales, 584.75);
  assert.equal(r.income, 384.75);
  // 236*400/472 = 200 ; E1 fully paid = 354
  assert.equal(r.directCosts, 200);
  assert.equal(r.indirectExpenses, 354);
  assert.equal(r.netProfit, -169.25);
  assert.equal(r.margin, -43.99);
});

test('FY boundaries: previous FY holds March activity only', () => {
  const prev = fyPeriod(2024);
  assert.deepEqual(prev, { start: '2024-04-01', end: '2025-03-31' });
  const acc = profitAndLoss(data, prev, 'accrual');
  assert.equal(acc.income, 500); // invoice B on 2025-03-20
  const cash = profitAndLoss(data, prev, 'cash');
  assert.equal(cash.income, 500); // 590*500/590 received 2025-03-25
  // Period edges are inclusive.
  const edge = profitAndLoss(data, { start: '2025-03-20', end: '2025-03-20' }, 'accrual');
  assert.equal(edge.income, 500);
});

test('monthly trend sums back to the period P&L', () => {
  const t = monthlyTrend(data, { start: '2025-04-01', end: '2025-05-31' });
  assert.deepEqual(t.map((x) => x.month), ['2025-04', '2025-05']);
  assert.deepEqual(t.map((x) => [x.income, x.expenses, x.profit]), [[1000, 400, 600], [-200, 354, -554]]);
  assert.equal(t[0].label, 'Apr 25');
  assert.equal(t.reduce((s, x) => s + x.profit, 0), 46);
});

test('GST summary: output less credit notes, ITC only when eligible', () => {
  const g = gstSummary(data, FY2526);
  assert.equal(g.outputCgst, 72); // 90 - 18
  assert.equal(g.outputSgst, 72);
  assert.equal(g.outputIgst, 0);
  assert.equal(g.outputTotal, 144);
  assert.equal(g.itc, 72);
  assert.equal(g.blockedGst, 54);
  assert.equal(g.netPayable, 72);
});

test('balance sheet: identity and components', () => {
  const b = balanceSheet(data, '2026-03-31');
  assert.equal(b.indicative, true);
  assert.equal(b.assets.cash, 1336);
  assert.equal(b.assets.bank, 5354);
  assert.equal(b.assets.receivables, 254); // 1770 - 236 - 1280
  assert.equal(b.liabilities.payables, 236); // 826 - 590
  assert.equal(b.liabilities.gstPayable, 162); // 234 - 72
  assert.equal(b.assets.total, 6944);
  assert.equal(b.liabilities.total, 398);
  assert.equal(b.equity.retainedEarnings, 546);
  assert.equal(b.equity.capitalAndOther, 6000); // = the two opening balances
  assert.equal(b.assets.total, b.liabilities.total + b.equity.total);
});

test('balance sheet as of an earlier date ignores later documents', () => {
  const b = balanceSheet(data, '2025-03-31');
  assert.equal(b.assets.receivables, 0);
  assert.equal(b.assets.cash, 1590);
  assert.equal(b.liabilities.gstPayable, 90); // only invoice B's GST so far
});

test('ITC exceeding output shows as an asset', () => {
  const d: BooksData = { ...EMPTY_BOOKS, purchases: [{ id: 'p', date: '2025-06-01', taxable_value: 1000, tax_amount: 180, total: 1180 }] };
  const b = balanceSheet(d, '2025-06-30');
  assert.equal(b.assets.itcReceivable, 180);
  assert.equal(b.liabilities.gstPayable, 0);
  assert.equal(b.liabilities.payables, 1180);
});

test('period presets are Indian-FY aware', () => {
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);
  assert.deepEqual(periodForPreset('this_fy', at(2026, 3, 31)), { start: '2025-04-01', end: '2026-03-31' });
  assert.deepEqual(periodForPreset('this_fy', at(2026, 4, 1)), { start: '2026-04-01', end: '2027-03-31' });
  assert.deepEqual(periodForPreset('last_fy', at(2026, 4, 1)), { start: '2025-04-01', end: '2026-03-31' });
  assert.deepEqual(periodForPreset('this_quarter', at(2025, 5, 15)), { start: '2025-04-01', end: '2025-06-30' });
  assert.deepEqual(periodForPreset('this_quarter', at(2025, 11, 30)), { start: '2025-10-01', end: '2025-12-31' });
  assert.deepEqual(periodForPreset('this_quarter', at(2026, 2, 10)), { start: '2026-01-01', end: '2026-03-31' });
  assert.deepEqual(periodForPreset('last_month', at(2026, 1, 20)), { start: '2025-12-01', end: '2025-12-31' });
  assert.deepEqual(periodForPreset('this_month', at(2024, 2, 5)), { start: '2024-02-01', end: '2024-02-29' });
  // Agrees with the app-wide FY helper.
  assert.equal(getIndianFY('2026-03-31').startYear, 2025);
  assert.equal(getIndianFY('2026-04-01').startYear, 2026);
});

test('getProfitSnapshot works on supplied data and on empty storage', () => {
  const s = getProfitSnapshot(FY2526, 'accrual', data);
  assert.equal(s.income, 800);
  assert.equal(s.expenses, 754);
  assert.equal(s.netProfit, 46);
  const empty = getProfitSnapshot('this_fy');
  assert.equal(empty.netProfit, 0);
  assert.equal(empty.margin, 0);
});

test('defensive: absent / malformed purchase rows do not throw', () => {
  const d: BooksData = {
    ...EMPTY_BOOKS,
    purchases: [{ id: 'x' }, { id: 'y', date: 'garbage' }, { id: 'z', date: '2025-04-01', total: 118, tax_amount: 18 }],
    purchasePayments: [{ purchase_id: 'nope', amount: 5, date: '2025-04-02' }],
  };
  const r = profitAndLoss(d, FY2526, 'accrual');
  assert.equal(r.directCosts, 100); // taxable derived = total - gst, ITC default eligible
  assert.doesNotThrow(() => buildVouchers(d));
});

test('csv escaping and formula-injection guard', () => {
  assert.equal(toCsv([['a,b', 'say "hi"', 3]]), '"a,b","say ""hi""",3');
  assert.equal(toCsv([['=SUM(A1)', -5]]), "'=SUM(A1),-5");
});
