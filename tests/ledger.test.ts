/**
 * Double-entry ledger (Phase 6.1–6.4): posting rules, balancing, statements.
 * Expected numbers are worked out by hand in the comments.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { EMPTY_BOOKS, profitAndLoss, type BooksData } from '../src/lib/books.ts';
import {
  A,
  accountStatement,
  buildLedger,
  cashFlowStatement,
  chartOf,
  daysInclusive,
  deleteVoucher,
  depreciationSchedule,
  ledgerBalanceSheet,
  ledgerProfitAndLoss,
  loadVouchers,
  nextVoucherNumber,
  rupeesToPaise,
  saveUserAccount,
  saveVoucher,
  trialBalance,
  trialBalanceCsv,
  validateVoucher,
  voucherDiff,
  type FixedAsset,
  type LedgerInput,
  type LedgerVoucher,
  type ManualVoucher,
} from '../src/lib/ledger/index.ts';
import { depreciationRate } from '../src/lib/tax-rules.ts';
import { SINGLETON_KEYS, getTable, setJson } from '../src/lib/storage.ts';
import { isPeriodLockedError } from '../src/lib/period-lock.ts';

beforeEach(() => resetStorage());

const FY = { start: '2025-04-01', end: '2026-03-31' };

function input(over: Partial<LedgerInput> = {}): LedgerInput {
  return { ...EMPTY_BOOKS, userAccounts: [], manual: [], assets: [], today: '2026-03-31', ...over };
}

function inv(over: Record<string, unknown>) {
  return { status: 'Sent', doc_type: 'INVOICE', client: { name: 'Acme', company: 'Acme Pvt Ltd' }, ...over };
}

const invoices = (rows: Record<string, unknown>[]) => rows.map(inv) as unknown as BooksData['invoices'];

/** Lines of a voucher as { account: signed rupees } (debit positive). */
function lines(v: LedgerVoucher | undefined): Record<string, number> {
  assert.ok(v, 'voucher missing');
  const out: Record<string, number> = {};
  for (const l of v!.lines) out[l.account] = (out[l.account] ?? 0) + (l.dr - l.cr) / 100;
  return out;
}

const find = (vs: LedgerVoucher[], id: string) => vs.find((v) => v.id === id);

test('sales invoice: party Dr total; sales, freight, GST heads, cess, TCS and round off Cr', () => {
  // taxable 1,000 + untaxed freight 100; CGST 90 + SGST 90; cess 10; TCS 1.38; round off -0.38 → total 1,291
  const led = buildLedger(input({
    invoices: invoices([{ id: 'S', invoice_number: 'INV/1', issue_date: '2025-04-10', taxable_value: 1000, shipping: 100, cgst_amount: 90, sgst_amount: 90, tax_amount: 180, cess_amount: 10, tcs_amount: 1.38, round_off: -0.38, total: 1291 }]),
  }));
  assert.deepEqual(lines(find(led.vouchers, 'sale:S')), {
    [A.debtors]: 1291, [A.sales]: -1000, [A.freightOut]: -100, [A.outCgst]: -90, [A.outSgst]: -90, [A.outCess]: -10, [A.tcsPayable]: -1.38, [A.roundOff]: 0.38,
  });
  assert.equal(find(led.vouchers, 'sale:S')!.lines.find((l) => l.account === A.debtors)!.party, 'Acme Pvt Ltd');
});

test('taxed freight goes to the freight account and only the items to Sales', () => {
  const led = buildLedger(input({
    invoices: invoices([{ id: 'S', issue_date: '2025-04-10', taxable_value: 1100, shipping: 100, charges_taxable: true, igst_amount: 198, tax_amount: 198, total: 1298 }]),
  }));
  assert.deepEqual(lines(find(led.vouchers, 'sale:S')), { [A.debtors]: 1298, [A.sales]: -1000, [A.freightOut]: -100, [A.outIgst]: -198 });
});

test('credit note mirrors the sale through Sales returns; debit note posts like a sale', () => {
  const led = buildLedger(input({
    invoices: invoices([
      { id: 'C', doc_type: 'CREDIT_NOTE', issue_date: '2025-05-01', taxable_value: 200, cgst_amount: 18, sgst_amount: 18, tax_amount: 36, total: 236 },
      { id: 'D', doc_type: 'DEBIT_NOTE', issue_date: '2025-05-02', taxable_value: 50, igst_amount: 9, tax_amount: 9, total: 59 },
      { id: 'X', status: 'Cancelled', issue_date: '2025-05-02', taxable_value: 50, total: 50 },
      { id: 'Q', doc_type: 'QUOTATION', issue_date: '2025-05-02', taxable_value: 50, total: 50 },
    ]),
  }));
  assert.deepEqual(lines(find(led.vouchers, 'cn:C')), { [A.debtors]: -236, [A.salesReturns]: 200, [A.outCgst]: 18, [A.outSgst]: 18 });
  assert.equal(find(led.vouchers, 'sale:D')!.kind, 'Debit Note');
  assert.deepEqual(lines(find(led.vouchers, 'sale:D')), { [A.debtors]: 59, [A.sales]: -50, [A.outIgst]: -9 });
  assert.equal(led.vouchers.length, 2);
});

test('receipts: cash vs bank, and TDS booked on the receipt that clears the cash due', () => {
  // total 11,800, TDS 1,000 (on taxable) → cash due 10,800; paid 5,000 then 5,800
  const led = buildLedger(input({
    invoices: invoices([{ id: 'S', issue_date: '2025-04-10', taxable_value: 10000, igst_amount: 1800, tax_amount: 1800, tds_amount: 1000, tds_section: '194J', total: 11800 }]),
    transactions: [
      { id: 't1', invoice_id: 'S', amount: 5000, method: 'Cash', date: '2025-04-20' },
      { id: 't2', invoice_id: 'S', amount: 5800, method: 'UPI', date: '2025-05-20' },
    ],
  }));
  assert.deepEqual(lines(find(led.vouchers, 'rcpt:t1')), { [A.cash]: 5000, [A.debtors]: -5000 });
  assert.deepEqual(lines(find(led.vouchers, 'rcpt:t2')), { [A.bank]: 5800, [A.tdsReceivable]: 1000, [A.debtors]: -6800 });
  // The customer's account is closed.
  const st = accountStatement(led, A.debtors, FY, 'Acme Pvt Ltd')!;
  assert.equal(st.closing, 0);
});

test('foreign-currency invoice and its receipt post in rupees at the invoice rate', () => {
  // USD 100 @ 83.25 = 8,325; export under LUT, no tax
  const led = buildLedger(input({
    invoices: invoices([{ id: 'F', issue_date: '2025-06-01', currency: 'USD', exchange_rate: 83.25, taxable_value: 100, tax_amount: 0, total: 100 }]),
    transactions: [{ id: 'r', invoice_id: 'F', amount: 100, method: 'Bank transfer', date: '2025-06-20' }],
  }));
  assert.deepEqual(lines(find(led.vouchers, 'sale:F')), { [A.debtors]: 8325, [A.sales]: -8325 });
  assert.deepEqual(lines(find(led.vouchers, 'rcpt:r')), { [A.bank]: 8325, [A.debtors]: -8325 });
  assert.match(find(led.vouchers, 'sale:F')!.narration, /USD 100\.00 @ ₹83\.25/);
});

const bill = (over: Record<string, unknown>) => ({
  id: 'P', kind: 'PURCHASE', vendor_name: 'Supplier', bill_number: 'B-1', date: '2025-07-01', category: 'Purchases',
  lines: [], taxable: 1000, cgst: 90, sgst: 90, igst: 0, itc_eligible: true, total: 1180, amount_paid: 0, ...over,
});

test('purchase with ITC; blocked ITC is part of cost; expense category maps to its account', () => {
  const led = buildLedger(input({
    purchases: [
      bill({ id: 'P1' }),
      bill({ id: 'P2', itc_eligible: false, itc_reversal_reason: 'SEC_17_5' }),
      bill({ id: 'E1', kind: 'EXPENSE', category: 'Rent', taxable: 500, cgst: 0, sgst: 0, total: 500 }),
    ],
  }));
  assert.deepEqual(lines(find(led.vouchers, 'pur:P1')), { [A.purchases]: 1000, [A.inCgst]: 90, [A.inSgst]: 90, [A.creditors]: -1180 });
  assert.deepEqual(lines(find(led.vouchers, 'pur:P2')), { [A.purchases]: 1180, [A.creditors]: -1180 });
  assert.deepEqual(lines(find(led.vouchers, 'exp:E1')), { [A.rent]: 500, [A.creditors]: -500 });
});

test('reverse charge: the GST is credited to RCM payable, not the supplier; ITC still taken', () => {
  const led = buildLedger(input({ purchases: [bill({ reverse_charge: true })] }));
  assert.deepEqual(lines(find(led.vouchers, 'pur:P')), {
    [A.purchases]: 1000, [A.inCgst]: 90, [A.inSgst]: 90, [A.creditors]: -1000, [A.rcmPayable]: -180,
  });
});

test('imports: goods → customs IGST payable; services → RCM payable', () => {
  const led = buildLedger(input({
    purchases: [
      bill({ id: 'G', import_type: 'GOODS', cgst: 0, sgst: 0, igst: 180 }),
      bill({ id: 'S', import_type: 'SERVICES', cgst: 0, sgst: 0, igst: 180 }),
    ],
  }));
  assert.deepEqual(lines(find(led.vouchers, 'pur:G')), { [A.purchases]: 1000, [A.inIgst]: 180, [A.creditors]: -1000, [A.importIgst]: -180 });
  assert.deepEqual(lines(find(led.vouchers, 'pur:S')), { [A.purchases]: 1000, [A.inIgst]: 180, [A.creditors]: -1000, [A.rcmPayable]: -180 });
});

test('ITC reversed on a bill is charged to P&L and taken out of the credit ledger pro rata', () => {
  const led = buildLedger(input({ purchases: [bill({ itc_reversed: 90, itc_reversal_reason: 'RULE_42' })] }));
  assert.deepEqual(lines(find(led.vouchers, 'pur:P')), {
    [A.purchases]: 1000, [A.inCgst]: 45, [A.inSgst]: 45, [A.itcReversed]: 90, [A.creditors]: -1180,
  });
});

test('supplier payments: Dr creditors, Cr cash or bank; a user expense account named like the category is used', () => {
  const courier = { id: 'u1', code: '6400', name: 'Courier', group: 'INDIRECT_EXPENSES' as const };
  const led = buildLedger(input({
    userAccounts: [courier],
    purchases: [bill({ id: 'E', kind: 'EXPENSE', category: 'Courier', taxable: 100, cgst: 0, sgst: 0, total: 100 })],
    purchasePayments: [{ id: 'pp', purchase_id: 'E', amount: 100, date: '2025-07-02', method: 'Cash' }],
  }));
  assert.deepEqual(lines(find(led.vouchers, 'exp:E')), { u1: 100, [A.creditors]: -100 });
  assert.deepEqual(lines(find(led.vouchers, 'pay:pp')), { [A.creditors]: 100, [A.cash]: -100 });
});

test('opening balances from Books become an opening voucher that matches the cash book', () => {
  const led = buildLedger(input({
    openings: [{ id: 'o1', account: 'bank', amount: 5000, as_of: '2025-04-01' }],
    invoices: invoices([{ id: 'S', issue_date: '2025-03-20', taxable_value: 100, total: 100 }]),
    transactions: [{ id: 'early', invoice_id: 'S', amount: 100, method: 'UPI', date: '2025-03-25' }],
  }));
  // The 100 received before the books were opened is absorbed: bank on 1 Apr = 5,000 exactly.
  assert.deepEqual(lines(find(led.vouchers, 'open:o1')), { [A.bank]: 4900, [A.openingDiff]: -4900 });
  const st = accountStatement(led, A.bank, FY)!;
  assert.equal(st.closing, 500000);
});

test('every automatic voucher balances to the paisa (fuzzed amounts)', () => {
  const rows: Record<string, unknown>[] = [];
  const purchases: Record<string, unknown>[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 200; i++) {
    const taxable = Math.round(rnd() * 1e7) / 100;
    const cgst = Math.round(taxable * 9) / 100;
    const ship = i % 3 === 0 ? Math.round(rnd() * 5000) / 100 : 0;
    const total = Math.round(taxable + 2 * cgst + ship);
    rows.push({ id: `s${i}`, doc_type: i % 7 === 0 ? 'CREDIT_NOTE' : 'INVOICE', issue_date: '2025-08-01', taxable_value: taxable, shipping: ship, cgst_amount: cgst, sgst_amount: cgst, tax_amount: 2 * cgst, round_off: total - (taxable + 2 * cgst + ship), total, currency: i % 5 === 0 ? 'EUR' : 'INR', exchange_rate: 90.1234 });
    purchases.push(bill({ id: `p${i}`, taxable, cgst, sgst: cgst, total: Math.round((taxable + 2 * cgst) * 100) / 100 + (i % 4 === 0 ? 0.3 : 0), reverse_charge: i % 6 === 0, itc_eligible: i % 5 !== 0, itc_reversed: i % 9 === 0 ? cgst / 3 : 0 }));
  }
  const led = buildLedger(input({ invoices: invoices(rows), purchases }));
  assert.equal(led.warnings.length, 0, led.warnings.join('\n'));
  assert.equal(led.vouchers.length, 400);
  for (const v of led.vouchers) {
    assert.equal(voucherDiff(v), 0, `${v.id} does not balance`);
    for (const l of v.lines) assert.ok(Number.isInteger(l.dr) && Number.isInteger(l.cr) && (l.dr > 0) !== (l.cr > 0), `${v.id} has a bad line`);
  }
  const tb = trialBalance(led, FY);
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal(tb.totals.closingDr, tb.totals.closingCr);
});

test('manual vouchers: validation rules, balanced paise, number series per type and FY', () => {
  const chart = chartOf();
  const ok = { type: 'JOURNAL' as const, date: '2025-06-30', narration: 'Capital', lines: [{ account_id: A.bank, dr: 100000, cr: 0 }, { account_id: A.capital, dr: 0, cr: 100000 }] };
  assert.deepEqual(validateVoucher(ok, chart), []);
  assert.match(validateVoucher({ ...ok, lines: [ok.lines[0], { account_id: A.capital, dr: 0, cr: 99999 }] }, chart).join(), /differ by 0\.01/);
  assert.match(validateVoucher({ ...ok, lines: [ok.lines[0]] }, chart).join(), /at least two lines/);
  assert.match(validateVoucher({ ...ok, type: 'CONTRA' }, chart).join(), /cash and bank accounts only/);
  assert.match(validateVoucher({ ...ok, type: 'PAYMENT' }, chart).join(), /credit a cash or bank/);
  assert.deepEqual(validateVoucher({ ...ok, type: 'RECEIPT' }, chart), []);
  assert.match(validateVoucher({ ...ok, lines: [{ account_id: 'nope', dr: 1, cr: 0 }, { account_id: A.capital, dr: 0, cr: 1 }] }, chart).join(), /choose an account/);
  assert.match(validateVoucher({ ...ok, lines: [{ account_id: A.bank, dr: 1.5, cr: 0 }, { account_id: A.capital, dr: 0, cr: 1.5 }] }, chart).join(), /positive/);

  assert.equal(nextVoucherNumber([], 'JOURNAL', '2025-06-30'), 'JV/FY25-26/0001');
  assert.equal(nextVoucherNumber([{ number: 'JV/FY25-26/0007' }], 'JOURNAL', '2026-03-31'), 'JV/FY25-26/0008');
  assert.equal(nextVoucherNumber([{ number: 'JV/FY25-26/0007' }], 'JOURNAL', '2026-04-01'), 'JV/FY26-27/0001');
  assert.equal(nextVoucherNumber([], 'CONTRA', '2025-06-30'), 'CV/FY25-26/0001');
  assert.equal(rupeesToPaise('1,234.565'), 123457);
  assert.equal(rupeesToPaise(1.005), 101);
});

test('saveVoucher stores, numbers, audits; period lock blocks create/edit/delete', () => {
  const v1 = saveVoucher({ type: 'JOURNAL', date: '2025-06-30', narration: 'Capital brought in', lines: [{ account_id: A.bank, dr: 100000, cr: 0 }, { account_id: A.capital, dr: 0, cr: 100000 }] });
  const v2 = saveVoucher({ type: 'JOURNAL', date: '2025-07-01', narration: '', lines: [{ account_id: A.drawings, dr: 500, cr: 0 }, { account_id: A.cash, dr: 0, cr: 500 }] });
  assert.equal(v1.number, 'JV/FY25-26/0001');
  assert.equal(v2.number, 'JV/FY25-26/0002');
  assert.throws(() => saveVoucher({ type: 'JOURNAL', number: 'JV/FY25-26/0001', date: '2025-07-01', narration: '', lines: v2.lines }), /already used/);
  const audit = getTable<{ entity: string; action: string }>('audit_log');
  assert.equal(audit.filter((a) => a.entity === 'voucher' && a.action === 'create').length, 2);

  setJson(SINGLETON_KEYS.settings, { lock_until: '2025-06-30' });
  assert.throws(() => saveVoucher({ type: 'JOURNAL', date: '2025-06-15', narration: '', lines: v2.lines }), (e: unknown) => isPeriodLockedError(e));
  assert.throws(() => saveVoucher({ ...v1, narration: 'edited' }), (e: unknown) => isPeriodLockedError(e));
  assert.throws(() => deleteVoucher(v1.id), (e: unknown) => isPeriodLockedError(e));
  // Moving an open voucher INTO the locked period is refused too.
  assert.throws(() => saveVoucher({ ...v2, date: '2025-06-01' }), (e: unknown) => isPeriodLockedError(e));
  deleteVoucher(v2.id);
  assert.deepEqual(loadVouchers().map((v) => v.id), [v1.id]);
});

test('user accounts: added to the chart, duplicate codes/names refused', () => {
  const a = saveUserAccount({ code: '3520', name: 'HDFC current account', group: 'CASH_BANK' });
  assert.ok(a.id);
  assert.throws(() => saveUserAccount({ code: '3520', name: 'Other', group: 'CASH_BANK' }), /already used/);
  assert.throws(() => saveUserAccount({ code: '3521', name: 'Sales', group: 'SALES' }), /already exists/);
  assert.throws(() => saveUserAccount({ id: A.sales, code: '4000', name: 'Revenue', group: 'SALES' }), /cannot be changed/);
});

test('depreciation: IT Act WDV, half rate under 180 days, 40% computers from FY 2017-18', () => {
  assert.equal(depreciationRate('COMPUTER', '2016-04-01'), 60);
  assert.equal(depreciationRate('COMPUTER', '2017-04-01'), 40);
  assert.equal(depreciationRate('FURNITURE', '2025-04-01'), 10);
  assert.equal(daysInclusive('2025-10-03', '2026-03-31'), 180);
  const asset = (put: string): FixedAsset => ({ id: 'a', name: 'Laptop', block: 'COMPUTER', account_id: A.faComputers, cost: 100000, acquired_on: put, put_to_use: put, paid_from: A.bank, created_at: '' });
  // 180 days used (3 Oct → 31 Mar) → full 40%; 179 days → 20%
  assert.equal(depreciationSchedule(asset('2025-10-03'), '2026-03-31')[0].depreciation, 4000000);
  const half = depreciationSchedule(asset('2025-10-04'), '2027-03-31');
  assert.equal(half[0].depreciation, 2000000);
  assert.equal(half[0].halfRate, true);
  // Year 2 on WDV 80,000 @ 40% = 32,000
  assert.equal(half[1].depreciation, 3200000);
  assert.equal(half[1].closingWdv, 4800000);
});

test('trial balance, ledger drill-down, P&L, balance sheet and cash flow agree', () => {
  const manual: ManualVoucher[] = [
    { id: 'm1', type: 'RECEIPT', number: 'RV/FY25-26/0001', date: '2025-04-01', narration: 'Capital', lines: [{ account_id: A.bank, dr: 20000000, cr: 0 }, { account_id: A.capital, dr: 0, cr: 20000000 }], created_at: '' },
    { id: 'm2', type: 'PAYMENT', number: 'PV/FY25-26/0001', date: '2025-09-30', narration: 'Drawings', lines: [{ account_id: A.drawings, dr: 1000000, cr: 0 }, { account_id: A.bank, dr: 0, cr: 1000000 }], created_at: '' },
  ];
  const led = buildLedger(input({
    invoices: invoices([{ id: 'S', issue_date: '2025-05-01', taxable_value: 50000, cgst_amount: 4500, sgst_amount: 4500, tax_amount: 9000, total: 59000 }]),
    transactions: [{ id: 't', invoice_id: 'S', amount: 59000, method: 'UPI', date: '2025-05-15' }],
    purchases: [bill({ taxable: 20000, cgst: 1800, sgst: 1800, total: 23600 })],
    purchasePayments: [{ id: 'pp', purchase_id: 'P', amount: 10000, date: '2025-07-10', method: 'Bank transfer' }],
    manual,
    assets: [{ id: 'fa', name: 'Laptop', block: 'COMPUTER', account_id: A.faComputers, cost: 60000, acquired_on: '2025-06-01', put_to_use: '2025-06-01', paid_from: A.bank, created_at: '' }],
  }));
  const tb = trialBalance(led, FY);
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal(tb.totals.closingDr, tb.totals.closingCr);
  assert.match(trialBalanceCsv(tb), /Verify with your CA|verify with your CA/);

  // Bank: +2,00,000 +59,000 −10,000 −10,000 −60,000 = 1,79,000
  const bank = accountStatement(led, A.bank, FY)!;
  assert.equal(bank.closing, 17900000);
  assert.equal(bank.rows.at(-1)!.balance, 17900000);

  // P&L: sales 50,000 − purchases 20,000 − depreciation 60,000 × 40% = 24,000 → 6,000
  const pl = ledgerProfitAndLoss(led, FY);
  assert.equal(pl.netProfit, 600000);
  assert.equal(pl.grossProfit, 3000000);

  const bs = ledgerBalanceSheet(led, '2026-03-31');
  assert.equal(bs.difference, 0);
  assert.equal(bs.totalAssets, bs.totalEquityAndLiabilities);
  assert.equal(bs.profitForYear, 600000);
  assert.equal(bs.fixedAssets.net, 3600000);

  const cf = cashFlowStatement(led, FY);
  assert.equal(cf.difference, 0);
  assert.equal(cf.closingCash - cf.openingCash, 17900000);
  assert.equal(cf.operating.adjustments[0].amount, 2400000);

  // Next FY: last year's profit is carried to reserves, P&L accounts restart.
  const bs2 = ledgerBalanceSheet(led, '2026-04-30');
  assert.equal(bs2.profitForYear, 0);
  assert.equal(bs2.profitBroughtForward, 600000);
  assert.equal(bs2.difference, 0);
  const tb2 = trialBalance(led, { start: '2026-04-01', end: '2026-04-30' });
  assert.equal(tb2.rows.find((r) => r.account.id === A.sales), undefined);
  assert.equal(tb2.rows.find((r) => r.account.id === A.reserves)!.opening, -600000);
});

test('ledger P&L equals the Books P&L for the same documents (no manual entries)', () => {
  const data: BooksData = {
    ...EMPTY_BOOKS,
    invoices: invoices([
      { id: 'A', issue_date: '2025-04-10', taxable_value: 1000, cgst_amount: 90, sgst_amount: 90, tax_amount: 180, shipping: 50, round_off: 0.2, total: 1230.2 },
      { id: 'C', doc_type: 'CREDIT_NOTE', issue_date: '2025-05-05', taxable_value: 200, cgst_amount: 18, sgst_amount: 18, tax_amount: 36, total: 236 },
      { id: 'F', issue_date: '2025-06-01', currency: 'USD', exchange_rate: 83.5, taxable_value: 99.99, tax_amount: 0, total: 99.99 },
    ]),
    purchases: [bill({ id: 'P1' }), bill({ id: 'P2', itc_eligible: false }), bill({ id: 'E', kind: 'EXPENSE', category: 'Travel', taxable: 300, cgst: 27, sgst: 27, total: 354, itc_eligible: false })],
  };
  const books = profitAndLoss(data, FY, 'accrual');
  const led = ledgerProfitAndLoss(buildLedger(input(data)), FY);
  assert.equal(led.revenue / 100, books.income);
  assert.equal(led.directCosts / 100, books.directCosts);
  assert.equal(led.indirectExpenses / 100, books.indirectExpenses);
  assert.equal(led.netProfit / 100, books.netProfit);
});
