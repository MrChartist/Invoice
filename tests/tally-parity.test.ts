/**
 * Tally-parity accounting: TDS on payables (rates, thresholds, deduct on bill / on payment, challans,
 * interest), 26Q / 27EQ / 16A working papers, voucher variants (optional, memorandum, post-dated,
 * reversing), bill-wise payables and ratio analysis. Expected figures are worked out in comments.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { EMPTY_BOOKS, balanceSheet, loadBooksData } from '../src/lib/books.ts';
import {
  A,
  buildLedger,
  closingBalances,
  loadVouchers,
  makeRegular,
  postDatedSummary,
  ratioAnalysis,
  saveVoucher,
  trialBalance,
  variantRegister,
  loadLedgerInput,
  type Ledger,
  type LedgerInput,
  type ManualVoucher,
} from '../src/lib/ledger/index.ts';
import {
  autoLink,
  deleteChallan,
  depositDueDate,
  interestFor,
  loadChallans,
  monthsOrPart,
  priorCreditsFor,
  quarterSummaries,
  returnDueDate,
  saveChallan,
  setReturnFiled,
  suggestTds,
  tdsDeductions,
  tdsRateFor,
  thresholdCheck,
  validateChallan,
  dueCalendar,
  loadReturnMarks,
  type PriorCredit,
  type TdsChallan,
} from '../src/lib/tds-payables.ts';
import { form16AData, form26Q, form27EQ, paperCsv, paperText, tcsCollections } from '../src/lib/tds-returns.ts';
import { adjustAgainstBill, billwisePayables, payablesTotals, planAllocation, recordSupplierPayment, vendorPaymentsDb, deleteVendorPayment } from '../src/lib/billwise.ts';
import { balanceOf, paymentsDb, purchasesDb } from '../src/lib/purchases.ts';
import { supplierPayable } from '../src/lib/purchase-normalize.ts';
import { sectionRate, tdsThreshold } from '../src/lib/tds-rules.ts';
import { DB_PREFIX, SINGLETON_KEYS, getTable, setJson, setTable } from '../src/lib/storage.ts';
import { isPeriodLockedError } from '../src/lib/period-lock.ts';
import { isAccessDeniedError, setActorProvider } from '../src/lib/access.ts';
import { buildBackup, parseBackup, restoreBackup, validateBackupData, wipeAppData } from '../src/lib/backup.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => resetStorage());
afterEach(() => setActorProvider(null));

const FY = { start: '2025-04-01', end: '2026-03-31' };
const PAN_CO = 'AAACA1234B';
const PAN_IND = 'ABCPK1234F';

function input(over: Partial<LedgerInput> = {}): LedgerInput {
  return { ...EMPTY_BOOKS, userAccounts: [], manual: [], assets: [], today: '2026-03-31', ...over };
}

function tbBalanced(ledger: Ledger, period = FY): void {
  const tb = trialBalance(ledger, period);
  assert.equal(tb.totals.debit, tb.totals.credit, 'trial balance movements balance');
  assert.equal(tb.totals.closingDr, tb.totals.closingCr, 'trial balance closing balances balance');
  assert.deepEqual(ledger.warnings, []);
}

const bal = (ledger: Ledger, acc: string, date = '2026-03-31', party?: string) => (closingBalances(ledger, date, party).get(acc) ?? 0) / 100;

function bill(over: Partial<PurchaseRecord> = {}): PurchaseRecord {
  return {
    id: 'b1',
    kind: 'PURCHASE',
    vendor_id: 'v1',
    vendor_name: 'Rao & Co (CA)',
    bill_number: 'RC/7',
    date: '2025-06-10',
    due_date: '2025-06-25',
    category: 'Professional fees',
    lines: [{ id: 'l1', name: 'Audit fee', quantity: 1, rate: 100000, tax_rate: 18 }],
    taxable: 100000,
    cgst: 0,
    sgst: 0,
    igst: 18000,
    itc_eligible: true,
    total: 118000,
    amount_paid: 0,
    ...over,
  };
}

const tdsBill = (over: Partial<PurchaseRecord> = {}) =>
  bill({ tds_section: '194J', tds_rate: 10, tds_base: 100000, tds_amount: 10000, tds_on: 'BILL', tds_pan: PAN_IND, tds_deductee_type: 'INDIVIDUAL', ...over });

function mv(over: Partial<ManualVoucher> & Pick<ManualVoucher, 'id' | 'lines'>): ManualVoucher {
  return { type: 'JOURNAL', number: `JV/${over.id}`, date: '2025-05-01', narration: '', created_at: '', ...over };
}

/* ── Rates ───────────────────────────────────────────────────── */

test('section rates come from the dated TDS history; 194C by deductee type; 194Q only from 1 Jul 2021', () => {
  assert.equal(sectionRate('194C-1', '2025-06-01', 'INDIVIDUAL'), 1);
  assert.equal(sectionRate('194C-1', '2025-06-01', 'COMPANY'), 2);
  assert.equal(sectionRate('194J', '2025-06-01'), 10);
  assert.equal(sectionRate('194J-T', '2025-06-01'), 2);
  assert.equal(sectionRate('194H', '2024-09-30'), 5);
  assert.equal(sectionRate('194H', '2024-10-01'), 2);
  assert.equal(sectionRate('194A', '2020-06-01'), 7.5);
  assert.equal(sectionRate('194A', '2025-06-01'), 10);
  assert.equal(sectionRate('194Q', '2021-06-30'), null);
  assert.equal(sectionRate('194Q', '2021-07-01'), 0.1);
});

test('206AA: no valid PAN → 20% (194Q 5%); 197 certificate lowers the rate; 206AB only while in force', () => {
  const noPan = tdsRateFor('194J', '2025-06-01', {})!;
  assert.deepEqual([noPan.rate, noPan.reason, noPan.panValid], [20, 'C', false]);
  assert.equal(tdsRateFor('194Q', '2025-06-01', { pan: 'bad' })!.rate, 5);
  const cert = tdsRateFor('194J', '2025-06-01', { pan: PAN_IND, lowerRate: 2, lowerCert: 'LDC/123' })!;
  assert.deepEqual([cert.rate, cert.reason], [2, 'A']);
  // 206AB (1 Jul 2021 – 31 Mar 2025): higher of 2 × 2% and 5% for a non-filer contractor company.
  assert.deepEqual([tdsRateFor('194C-2', '2024-06-01', { pan: PAN_CO, nonFiler: true })!.rate, tdsRateFor('194C-2', '2024-06-01', { pan: PAN_CO, nonFiler: true })!.reason], [5, 'C']);
  assert.equal(tdsRateFor('194C-2', '2025-06-01', { pan: PAN_CO, nonFiler: true })!.rate, 2);
  assert.equal(tdsRateFor('194C-2', '2025-06-01', { pan: PAN_IND })!.rate, 1, 'deductee type from the PAN: individual → 1%');
});

/* ── Thresholds ──────────────────────────────────────────────── */

test('194C thresholds: single ₹30,000 and FY aggregate ₹1,00,000 with catch-up on earlier untaxed bills', () => {
  const prior: PriorCredit[] = [
    { id: 'a', date: '2025-05-01', base: 25000, tds: 0, code: '194C-2' },
    { id: 'b', date: '2025-06-01', base: 28000, tds: 0, code: '194C-2' },
    // Last FY: never counts.
    { id: 'z', date: '2025-03-15', base: 90000, tds: 0, code: '194C-2' },
  ];
  const small = thresholdCheck('194C-2', '2025-07-01', 20000, prior);
  assert.deepEqual([small.applies, small.reason, small.aggregateAfter], [false, 'Y', 73000]);
  const single = thresholdCheck('194C-2', '2025-07-01', 35000, prior);
  assert.deepEqual([single.applies, single.taxableBase, single.catchUp], [true, 35000, 0]);
  // After the ₹35,000 bill (taxed), a ₹15,000 bill takes the FY to ₹1,03,000: TDS on it AND on the two untaxed bills.
  const crossing = thresholdCheck('194C-2', '2025-08-01', 15000, [...prior, { id: 'c', date: '2025-07-01', base: 35000, tds: 700, code: '194C-2' }]);
  assert.deepEqual([crossing.applies, crossing.aggregateAfter, crossing.catchUp, crossing.taxableBase], [true, 103000, 53000, 68000]);
  const s = suggestTds('194C-2', '2025-08-01', 15000, { pan: PAN_CO }, [...prior, { id: 'c', date: '2025-07-01', base: 35000, tds: 700, code: '194C-2' }])!;
  assert.deepEqual([s.rate, s.base, s.amount], [2, 68000, 1360]);
});

test('thresholds are date-keyed: 194J ₹30,000 → ₹50,000 and 194I per month from 1 Apr 2025; 194Q taxes only the excess over ₹50 lakh', () => {
  assert.equal(thresholdCheck('194J', '2024-06-01', 40000, []).applies, true);
  assert.equal(thresholdCheck('194J', '2025-06-01', 40000, []).applies, false);
  assert.equal(tdsThreshold('194I', '2024-06-01')!.aggregate, 240000);
  assert.equal(tdsThreshold('194I', '2019-03-31')!.aggregate, 180000);
  assert.deepEqual(tdsThreshold('194I', '2025-06-01'), { single: 50000, perMonth: true });
  assert.equal(thresholdCheck('194I-B', '2025-06-01', 45000, []).applies, false);
  assert.equal(thresholdCheck('194I-B', '2025-06-01', 60000, []).applies, true);
  const q = thresholdCheck('194Q', '2025-11-01', 500000, [{ date: '2025-06-01', base: 4800000, tds: 0, code: '194Q' }]);
  assert.deepEqual([q.applies, q.taxableBase], [true, 300000]);
  const s = suggestTds('194Q', '2025-11-01', 500000, { pan: PAN_CO }, [{ date: '2025-06-01', base: 4800000, tds: 0, code: '194Q' }])!;
  assert.equal(s.amount, 300, '0.1% of ₹3,00,000');
});

test('prior credits for the threshold come from the same supplier’s bills', () => {
  const rows = [tdsBill(), bill({ id: 'b2', vendor_id: 'v2', vendor_name: 'Other' }), bill({ id: 'b3', date: '2025-07-01' })];
  const prior = priorCreditsFor(rows, { id: 'v1', name: 'Rao & Co (CA)' });
  assert.deepEqual(prior.map((p) => [p.id, p.base, p.tds, p.code]), [['b1', 100000, 10000, '194J'], ['b3', 100000, 0, '']]);
});

/* ── Deduct on bill / on payment ─────────────────────────────── */

test('deduct on bill: the supplier is owed total − TDS; ledger credits the 194J TDS payable account; trial balance ties', () => {
  const b = tdsBill();
  assert.equal(supplierPayable(b), 108000);
  assert.equal(balanceOf(b), 108000);
  const ledger = buildLedger(input({ purchases: [b as never], purchasePayments: [{ id: 'p1', purchase_id: 'b1', amount: 108000, date: '2025-06-20', method: 'Bank transfer' }] }));
  const pur = ledger.vouchers.find((v) => v.id === 'pur:b1')!;
  const line = (acc: string) => pur.lines.filter((l) => l.account === acc).reduce((s, l) => s + l.cr - l.dr, 0) / 100;
  assert.equal(line(A.creditors), 108000);
  assert.equal(line(A.tds194j), 10000);
  assert.equal(bal(ledger, A.creditors, '2026-03-31', 'Rao & Co (CA)'), 0, 'paying the net amount clears the supplier');
  assert.equal(bal(ledger, A.tds194j), -10000, 'TDS 194J payable (credit) until deposited');
  tbBalanced(ledger);
  // Books (single-entry view): payables cleared, the TDS shows as a tax liability.
  const bs = balanceSheet({ ...EMPTY_BOOKS, purchases: [b as never], purchasePayments: [{ id: 'p1', purchase_id: 'b1', amount: 108000, date: '2025-06-20', method: 'UPI' }] }, '2026-03-31');
  assert.equal(bs.liabilities.payables, 0);
});

test('deduct on payment: cash + TDS settle the bill; the payment posts Cr TDS payable; late deduction interest from the bill date', () => {
  purchasesDb.save(tdsBill({ tds_on: 'PAYMENT', date: '2025-05-10', due_date: undefined }));
  const b = purchasesDb.get('b1')!;
  assert.equal(balanceOf(b), 118000, 'TDS on payment does not reduce the bill up front');
  assert.throws(() => paymentsDb.record('b1', { amount: 110000, date: '2025-07-15', method: 'UPI', tdsAmount: 10000 }), /exceeds/);
  const pay = paymentsDb.record('b1', { amount: 108000, date: '2025-07-15', method: 'UPI', tdsAmount: 10000 });
  assert.equal(purchasesDb.get('b1')!.amount_paid, 118000);
  assert.equal(balanceOf(purchasesDb.get('b1')!), 0);
  const rows = tdsDeductions({ purchases: purchasesDb.all(), payments: paymentsDb.all() });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].key, rows[0].creditedOn, rows[0].deductedOn, rows[0].amount, rows[0].base, rows[0].quarter], [`pay:${pay.id}`, '2025-05-10', '2025-07-15', 10000, 100000, 2]);
  const ledger = buildLedger(loadLedgerInput(loadBooksData(), '2026-03-31'));
  assert.equal(bal(ledger, A.creditors, '2026-03-31', 'Rao & Co (CA)'), 0);
  assert.equal(bal(ledger, A.tds194j), -10000);
  tbBalanced(ledger);
  paymentsDb.remove(pay.id);
  assert.equal(purchasesDb.get('b1')!.amount_paid, 0, 'removing the payment takes its TDS back off the bill');
});

/* ── Challans & interest ─────────────────────────────────────── */

test('due dates: 7th of next month, March TDS by 30 April, March TCS by 7 April; returns 31 Jul / 31 Oct / 31 Jan / 31 May; 27EQ on the 15th', () => {
  assert.equal(depositDueDate('2025-06-10'), '2025-07-07');
  assert.equal(depositDueDate('2025-12-31'), '2026-01-07');
  assert.equal(depositDueDate('2026-03-15'), '2026-04-30');
  assert.equal(depositDueDate('2026-03-15', 'TCS'), '2026-04-07');
  assert.deepEqual([1, 2, 3, 4].map((q) => returnDueDate(2025, q as 1 | 2 | 3 | 4)), ['2025-07-31', '2025-10-31', '2026-01-31', '2026-05-31']);
  assert.equal(returnDueDate(2025, 4, 'TCS'), '2026-05-15');
});

test('Sec 201(1A) interest: 1% a month for late deduction, 1.5% a month for late deposit (months or part, calendar)', () => {
  assert.equal(monthsOrPart('2025-05-10', '2025-07-15'), 3);
  assert.equal(monthsOrPart('2025-07-15', '2025-07-15'), 0);
  const est = interestFor({ creditedOn: '2025-05-10', deductedOn: '2025-07-15', amount: 10000 }, '2025-09-10', '2026-01-01');
  assert.deepEqual([est.due, est.monthsLateDeduction, est.lateDeduction, est.monthsLatePayment, est.latePayment, est.total], ['2025-08-07', 3, 300, 3, 450, 750]);
  const onTime = interestFor({ creditedOn: '2025-06-10', deductedOn: '2025-06-10', amount: 10000 }, '2025-07-07', '2026-01-01');
  assert.equal(onTime.total, 0);
  const unpaid = interestFor({ creditedOn: '2025-06-10', deductedOn: '2025-06-10', amount: 10000 }, undefined, '2025-08-20');
  assert.deepEqual([unpaid.accruing, unpaid.monthsLatePayment, unpaid.latePayment], [true, 3, 450]);
});

test('challans: BSR / serial validation, auto-link, one challan per deduction, ledger clears the section account; period lock and roles', () => {
  purchasesDb.save(tdsBill());
  purchasesDb.save(tdsBill({ id: 'b2', bill_number: 'RC/8', date: '2025-06-20', tds_amount: 5000, tds_base: 50000, total: 59000, taxable: 50000, igst: 9000 }));
  const rows = tdsDeductions({ purchases: purchasesDb.all(), payments: [] });
  assert.equal(rows.length, 2);
  const keys = autoLink(rows, [], 12000, '2025-07-05');
  assert.deepEqual(keys, ['bill:b1'], 'only what fits in the challan amount, oldest first');
  const base = { kind: 'TDS' as const, date: '2025-07-05', bsr_code: '0510308', challan_no: '00042', amount: 15000, interest: 0, deduction_keys: ['bill:b1', 'bill:b2'] };
  assert.deepEqual(validateChallan({ ...base, bsr_code: '123' }, rows), ['BSR code is 7 digits.']);
  assert.match(validateChallan({ ...base, amount: 10000 }, rows)[0], /exceed/);
  const ch = saveChallan(base, rows);
  assert.throws(() => saveChallan({ ...base, challan_no: '00043', deduction_keys: ['bill:b1'] }, rows), /already deposited/);
  const ledger = buildLedger(loadLedgerInput(loadBooksData(), '2026-03-31'));
  assert.equal(bal(ledger, A.tds194j), 0, 'challan debits the 194J account by the linked deductions');
  assert.equal(bal(ledger, A.bank), -15000);
  tbBalanced(ledger);
  const q = quarterSummaries(rows, loadChallans(), [], 2025, '2025-07-20');
  assert.deepEqual([q[0].deducted, q[0].deposited, q[0].undeposited, q[0].interest, q[0].status], [15000, 15000, 0, 0, 'due']);
  const cal = dueCalendar(rows, loadChallans(), [], 2025, '2025-07-20');
  assert.deepEqual(cal.map((d) => [d.what, d.period, d.status]), [['deposit', '2025-06', 'done'], ['return', '2025-Q1', 'upcoming'], ['certificate', '2025-Q1', 'upcoming']]);
  setReturnFiled('26Q', 2025, 1, '2025-07-30', 'TOKEN1');
  assert.equal(quarterSummaries(rows, loadChallans(), loadReturnMarks(), 2025, '2025-07-20')[0].status, 'filed');

  setActorProvider(() => ({ id: 'u2', name: 'Viewer', role: 'viewer' }));
  assert.throws(() => deleteChallan(ch.id), (e: unknown) => isAccessDeniedError(e));
  assert.throws(() => setTable('tds_challans', []), (e: unknown) => isAccessDeniedError(e));
  setActorProvider(null);
  setJson(SINGLETON_KEYS.settings, { lock_until: '2025-07-31' });
  assert.throws(() => deleteChallan(ch.id), (e: unknown) => isPeriodLockedError(e));
});

/* ── Returns ─────────────────────────────────────────────────── */

test('Form 26Q: challan and deductee rows in RPU order, unlinked and PAN-less deductions warned, non-residents left for 27Q', () => {
  const purchases = [tdsBill(), tdsBill({ id: 'b2', vendor_name: 'No PAN Ltd', tds_pan: '', tds_rate: 20, tds_amount: 4000, tds_base: 20000, tds_section: '194C-2', date: '2025-06-12' })];
  const rows = tdsDeductions({ purchases, payments: [] });
  const challans: TdsChallan[] = [{ id: 'c1', kind: 'TDS', date: '2025-07-05', bsr_code: '0510308', challan_no: '00042', amount: 10000, interest: 0, minor_head: '200', deduction_keys: ['bill:b1'] }];
  const p = form26Q(rows, challans, 2025, 1);
  assert.deepEqual(p.challanRows[1], [1, '4JB', '10000.00', '0.00', '0.00', '0.00', '0.00', '0.00', '10000.00', '', '0510308', '05/07/2025', '00042', '200', 'N']);
  assert.deepEqual(p.deducteeRows[1], [1, 1, '4JB', '02', PAN_IND, 'Rao & Co (CA)', '10/06/2025', '100000.00', '10000.00', '0.00', '0.00', '10000.00', '10000.00', '10/06/2025', 10, '', '']);
  assert.deepEqual(p.deducteeRows[2].slice(0, 6), [2, '', '94C', '02', 'PANNOTAVBL', 'No PAN Ltd']);
  assert.deepEqual(p.totals, { deducted: 14000, deposited: 10000, challans: 1 });
  assert.ok(p.warnings.some((w) => /not linked to a challan/.test(w)));
  assert.ok(p.warnings.some((w) => /PAN missing/.test(w)));
  assert.match(paperCsv(p), /UNVERIFIED/);
  assert.match(paperText(p).split('\n')[3], /^Sr\. No\.\tSection code/);
  const nr = tdsDeductions({ purchases: [tdsBill()], payments: [], vendors: [{ id: 'v1', name: 'Rao', non_resident: true }] });
  const p2 = form26Q(nr, [], 2025, 1);
  assert.equal(p2.deducteeRows.length, 1);
  assert.ok(p2.warnings.some((w) => /27Q/.test(w)));
  const f16 = form16AData(rows, challans, 2025, 1);
  assert.deepEqual(f16.map((g) => [g.payee, g.totalTds, g.challans.length]), [['No PAN Ltd', 4000, 0], ['Rao & Co (CA)', 10000, 1]]);
});

test('Form 27EQ from TCS on sales invoices (206C(1G) code), deposited through a TCS challan', () => {
  const inv = {
    id: 'i1', doc_type: 'INVOICE', status: 'Sent', invoice_number: 'INV/FY25-26/0007', issue_date: '2025-11-05',
    client: { name: 'Asha', pan: PAN_IND }, total: 105000, tcs_amount: 5000, tcs_rate: 5, tcs_label: '206C(1G) overseas remittance 5%',
  } as unknown as InvoiceRecord;
  const rows = tcsCollections([inv, { ...inv, id: 'i2', status: 'Draft' } as InvoiceRecord]);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].code, rows[0].base, rows[0].amount, rows[0].quarter], ['6CQ', 100000, 5000, 3]);
  const p = form27EQ(rows, [{ id: 't1', kind: 'TCS', date: '2025-12-05', bsr_code: '0510308', challan_no: '00077', amount: 5000, deduction_keys: ['tcs:i1'] }], 2025, 3);
  assert.deepEqual(p.deducteeRows[1].slice(0, 10), [1, 1, '6CQ', '02', PAN_IND, 'Asha', '105000.00', '100000.00', '05/11/2025', '5000.00']);
  assert.deepEqual(p.totals, { deducted: 5000, deposited: 5000, challans: 1 });
  const ledger = buildLedger(input({ invoices: [inv], challans: [{ id: 't1', kind: 'TCS', date: '2025-12-05', bsr_code: '0510308', challan_no: '00077', amount: 5000, deduction_keys: ['tcs:i1'] }] }));
  assert.equal(bal(ledger, A.tcsPayable), 0);
  tbBalanced(ledger);
});

/* ── Voucher variants ────────────────────────────────────────── */

const pair = (dr: string, cr: string, rupees: number) => [{ account_id: dr, dr: rupees * 100, cr: 0 }, { account_id: cr, dr: 0, cr: rupees * 100 }];

test('optional and memorandum vouchers stay out of the books until made regular; trial balance consistent throughout', () => {
  const regular = saveVoucher({ type: 'JOURNAL', date: '2025-05-01', narration: 'capital', lines: pair(A.bank, A.capital, 50000) });
  const opt = saveVoucher({ type: 'JOURNAL', date: '2025-06-01', narration: 'provision?', lines: pair(A.rent, A.provisions, 3000), variant: 'OPTIONAL', voucher_class: 'Year-end' });
  saveVoucher({ type: 'PAYMENT', date: '2025-06-02', narration: 'staff advance pending bills', lines: pair(A.advances, A.cash, 2000), variant: 'MEMO' });
  let ledger = buildLedger(loadLedgerInput(EMPTY_BOOKS, '2026-03-31'));
  assert.equal(bal(ledger, A.rent), 0);
  assert.equal(bal(ledger, A.advances), 0);
  assert.equal(ledger.vouchers.length, 1);
  tbBalanced(ledger);
  assert.deepEqual(variantRegister(loadVouchers(), 'optional', '2026-03-31').map((r) => [r.voucher.id, r.amount]), [[opt.id, 300000]]);
  assert.deepEqual(variantRegister(loadVouchers(), 'optional', '2026-03-31', 'Other'), []);
  assert.equal(variantRegister(loadVouchers(), 'memo', '2026-03-31').length, 1);
  // Editing keeps the variant.
  saveVoucher({ ...opt, narration: 'provision for rent' });
  assert.equal(loadVouchers().find((v) => v.id === opt.id)!.variant, 'OPTIONAL');
  makeRegular(opt.id);
  assert.equal(loadVouchers().find((v) => v.id === opt.id)!.variant, undefined);
  assert.throws(() => makeRegular(regular.id), /Only an optional/);
  ledger = buildLedger(loadLedgerInput(EMPTY_BOOKS, '2026-03-31'));
  assert.equal(bal(ledger, A.rent), 3000);
  tbBalanced(ledger);
  assert.ok(getTable<{ summary: string }>('audit_log').some((a) => /made regular/.test(a.summary)));
});

test('makeRegular respects the period lock and roles', () => {
  const opt = saveVoucher({ type: 'JOURNAL', date: '2025-06-01', narration: '', lines: pair(A.rent, A.provisions, 1000), variant: 'OPTIONAL' });
  setActorProvider(() => ({ id: 'u2', name: 'Viewer', role: 'viewer' }));
  assert.throws(() => makeRegular(opt.id), (e: unknown) => isAccessDeniedError(e));
  setActorProvider(null);
  setJson(SINGLETON_KEYS.settings, { lock_until: '2025-06-30' });
  assert.throws(() => makeRegular(opt.id), (e: unknown) => isPeriodLockedError(e));
  assert.equal(loadVouchers()[0].variant, 'OPTIONAL');
});

test('post-dated vouchers count only from their date; the summary lists them with post-dated cheques', () => {
  const manual = [
    mv({ id: 'p1', date: '2025-05-01', lines: pair(A.bank, A.capital, 10000) }),
    mv({ id: 'p2', type: 'PAYMENT', date: '2025-09-15', post_dated: true, lines: pair(A.rent, A.bank, 4000) }),
  ];
  const before = buildLedger(input({ manual, today: '2025-09-14' }));
  assert.equal(bal(before, A.rent), 0);
  tbBalanced(before);
  const after = buildLedger(input({ manual, today: '2025-09-15' }));
  assert.equal(bal(after, A.rent), 4000);
  tbBalanced(after);
  const summary = postDatedSummary(manual, '2025-09-14', [
    { id: 'c1', direction: 'issued', cheque_date: '2025-10-01', number: '000123', party_name: 'Landlord', amount: 4000, status: 'issued' },
    { id: 'c2', direction: 'received', cheque_date: '2025-08-01', number: '000999', party_name: 'Old', amount: 10, status: 'cleared' },
  ]);
  assert.deepEqual(summary.map((r) => [r.source, r.number, r.status, r.amount]), [['voucher', 'JV/p2', 'pending', 400000], ['cheque', '000123', 'pending', 400000]]);
});

test('reversing journal: a provision on 31 Mar reverses itself on 1 Apr; validation and lock on the reversal day', () => {
  const v = saveVoucher({ type: 'JOURNAL', date: '2026-03-31', narration: 'Audit fee provision', lines: pair(A.professional, A.provisions, 25000), reverse_on: '2026-04-01' });
  assert.equal(v.reverse_on, '2026-04-01');
  assert.throws(() => saveVoucher({ type: 'JOURNAL', date: '2026-03-31', narration: '', lines: pair(A.professional, A.provisions, 1), reverse_on: '2026-03-31' }), /after the voucher date/);
  assert.throws(() => saveVoucher({ type: 'PAYMENT', date: '2026-03-31', narration: '', lines: pair(A.professional, A.bank, 1), reverse_on: '2026-04-05' }), /Only a journal/);
  const ledger = buildLedger(loadLedgerInput(EMPTY_BOOKS, '2026-04-30'));
  assert.equal(bal(ledger, A.provisions, '2026-03-31'), -25000, 'provision in the books at year end');
  assert.equal(bal(ledger, A.provisions, '2026-04-01'), 0, 'reversed on 1 April');
  assert.equal(bal(ledger, A.professional, '2026-04-01'), -25000, 'the new year opens with the reversal credit');
  tbBalanced(ledger, { start: '2025-04-01', end: '2027-03-31' });
  assert.equal(variantRegister(loadVouchers(), 'reversing', '2026-04-30').length, 1);
  setJson(SINGLETON_KEYS.settings, { lock_until: '2026-04-15' });
  assert.throws(() => saveVoucher({ type: 'JOURNAL', date: '2026-04-20', narration: '', lines: pair(A.professional, A.provisions, 1), reverse_on: '2026-04-10' }), /after the voucher date|locked/i);
});

/* ── Bill-wise payables ──────────────────────────────────────── */

test('bill-wise: one payment over two bills (Agst Ref, partial) + On Account; adjust later; ageing by due date; ledger agrees', () => {
  purchasesDb.save(bill({ id: 'b1', bill_number: 'A-1', date: '2025-05-01', due_date: '2025-05-31', total: 50000, taxable: 50000, igst: 0, lines: [] }));
  purchasesDb.save(bill({ id: 'b2', bill_number: 'A-2', date: '2025-06-01', due_date: '2025-07-01', total: 30000, taxable: 30000, igst: 0, lines: [] }));
  purchasesDb.save(bill({ id: 'b3', bill_number: 'A-3', date: '2025-09-01', due_date: '2025-10-31', total: 20000, taxable: 20000, igst: 0, lines: [] }));
  const plan = planAllocation(70000, [
    { purchaseId: 'b1', balance: 50000, due: '2025-05-31' },
    { purchaseId: 'b2', balance: 30000, due: '2025-07-01' },
  ]);
  assert.deepEqual(plan, { lines: [{ purchaseId: 'b1', amount: 50000 }, { purchaseId: 'b2', amount: 20000 }], remainder: 0 });
  const res = recordSupplierPayment({ vendorId: 'v1', vendorName: 'Rao & Co (CA)', date: '2025-07-10', amount: 75000, method: 'Bank transfer', reference: 'UTR9', allocations: plan.lines, remainderKind: 'ON_ACCOUNT' });
  assert.equal(res.payments.length, 2);
  assert.ok(res.payments.every((p) => p.group_id === res.groupId));
  assert.equal(res.remainder!.amount, 5000);
  let parties = billwisePayables({ purchases: purchasesDb.all(), payments: paymentsDb.all(), vendorPayments: vendorPaymentsDb.all(), asOf: '2025-09-15' });
  assert.equal(parties.length, 1);
  assert.deepEqual(parties[0].bills.map((b) => [b.number, b.balance, b.overdueDays, b.bucket]), [['A-2', 10000, 76, 'd61_90'], ['A-3', 20000, 0, 'notDue']]);
  assert.deepEqual([parties[0].billsTotal, parties[0].advancesTotal, parties[0].net], [30000, 5000, 25000]);
  assert.deepEqual(payablesTotals(parties).buckets, { notDue: 20000, d0_30: 0, d31_60: 0, d61_90: 10000, d90plus: 0 });
  // The party's creditor balance in the ledger equals the net bill-wise outstanding.
  let ledger = buildLedger(loadLedgerInput(loadBooksData(), '2025-09-15'));
  assert.equal(bal(ledger, A.creditors, '2025-09-15', 'Rao & Co (CA)'), -25000);
  tbBalanced(ledger);
  // Adjust the on-account ₹5,000 against A-2: no money moves, the bill balance drops.
  assert.throws(() => adjustAgainstBill(res.remainder!.id, 'b2', 6000, '2025-09-20'), /unadjusted/);
  adjustAgainstBill(res.remainder!.id, 'b2', 5000, '2025-09-20');
  assert.equal(balanceOf(purchasesDb.get('b2')!), 5000);
  parties = billwisePayables({ purchases: purchasesDb.all(), payments: paymentsDb.all(), vendorPayments: vendorPaymentsDb.all(), asOf: '2025-09-30', includeSettled: true });
  const a2 = parties[0].bills.find((b) => b.number === 'A-2')!;
  assert.deepEqual(a2.allocations.map((a) => [a.kind, a.amount]), [['payment', 20000], ['adjustment', 5000]]);
  assert.equal(parties[0].advancesTotal, 0);
  ledger = buildLedger(loadLedgerInput(loadBooksData(), '2025-09-30'));
  assert.equal(bal(ledger, A.creditors, '2025-09-30', 'Rao & Co (CA)'), -25000, 'an adjustment does not change the party balance');
  tbBalanced(ledger);
  // Books cash book sees the on-account payment as cash out.
  assert.equal(balanceSheet(loadBooksData(), '2025-09-30').liabilities.payables, 25000);
  deleteVendorPayment(res.remainder!.id);
  assert.equal(balanceOf(purchasesDb.get('b2')!), 10000, 'deleting the advance undoes its adjustment');
  setActorProvider(() => ({ id: 'u3', name: 'Viewer', role: 'viewer' }));
  assert.throws(() => recordSupplierPayment({ vendorName: 'X', date: '2025-07-10', amount: 1, method: 'Cash', allocations: [] }), (e: unknown) => isAccessDeniedError(e));
});

/* ── Ratio analysis ──────────────────────────────────────────── */

test('ratio analysis on a known dataset', () => {
  const manual = [
    mv({ id: 'r1', lines: pair(A.bank, A.capital, 100000) }),
    mv({ id: 'r2', lines: [{ account_id: A.debtors, dr: 6000000, cr: 0, party: 'X' }, { account_id: A.sales, dr: 0, cr: 6000000 }] }),
    mv({ id: 'r3', lines: [{ account_id: A.purchases, dr: 3000000, cr: 0 }, { account_id: A.creditors, dr: 0, cr: 3000000, party: 'Y' }] }),
    mv({ id: 'r4', date: '2026-03-31', lines: pair(A.stock, A.purchases, 10000) }),
    mv({ id: 'r5', lines: pair(A.rent, A.bank, 5000) }),
    mv({ id: 'r6', lines: pair(A.bank, A.unsecuredLoans, 20000) }),
  ];
  const ledger = buildLedger(input({ manual }));
  tbBalanced(ledger);
  const r = ratioAnalysis(ledger, FY);
  // CA = bank 1,15,000 + debtors 60,000 + stock 10,000; CL = creditors 30,000.
  assert.deepEqual(
    [r.parts.currentAssets, r.parts.currentLiabilities, r.parts.workingCapital, r.parts.sales, r.parts.purchases, r.parts.grossProfit, r.parts.netProfit, r.parts.capital, r.parts.loans].map((p) => p / 100),
    [185000, 30000, 155000, 60000, 20000, 40000, 35000, 100000, 20000],
  );
  const v = (id: string) => [...r.groups, ...r.ratios].find((x) => x.id === id)!.value;
  assert.equal(r.days, 365);
  assert.equal(v('currentRatio'), 6.17);
  assert.equal(v('quickRatio'), 5.83);
  assert.equal(v('debtEquity'), 0.15);
  assert.equal(v('grossProfitPct'), 66.67);
  assert.equal(v('netProfitPct'), 58.33);
  assert.equal(v('operatingCostPct'), 41.67);
  assert.equal(v('receivableDays'), 365);
  assert.equal(v('payableDays'), 547.5);
  assert.equal(v('roi'), 25.93);
  assert.equal(v('rowc'), 22.58);
  assert.equal(v('inventoryTurnover'), 6);
  assert.equal(v('cash'), 0);
  assert.equal(v('bank'), 11500000);
  // Empty books: ratios with a zero denominator are null, never NaN / Infinity.
  const empty = ratioAnalysis(buildLedger(input()), FY);
  assert.equal(empty.ratios.find((x) => x.id === 'currentRatio')!.value, null);
});

/* ── Backup ──────────────────────────────────────────────────── */

test('new tables ride along in backups, restore identically, and malformed rows are refused', () => {
  purchasesDb.save(tdsBill());
  const rows = tdsDeductions({ purchases: purchasesDb.all(), payments: [] });
  saveChallan({ kind: 'TDS', date: '2025-07-05', bsr_code: '0510308', challan_no: '00042', amount: 10000, deduction_keys: ['bill:b1'] }, rows);
  setReturnFiled('26Q', 2025, 1, '2025-07-30');
  recordSupplierPayment({ vendorName: 'Rao & Co (CA)', date: '2025-07-10', amount: 500, method: 'Cash', allocations: [], remainderKind: 'ADVANCE' });
  const before = ['tds_challans', 'tds_returns', 'vendor_payments', 'purchases'].map((t) => getTable(t));
  const text = JSON.stringify(buildBackup());
  wipeAppData();
  assert.deepEqual(getTable('tds_challans'), []);
  restoreBackup(parseBackup(text).data);
  assert.deepEqual(['tds_challans', 'tds_returns', 'vendor_payments', 'purchases'].map((t) => getTable(t)), before);
  for (const t of ['tds_challans', 'tds_deductions', 'tds_returns', 'vendor_payments']) {
    assert.throws(() => validateBackupData({ [DB_PREFIX + t]: JSON.stringify([{ amount: 1 }]) }), new RegExp(t));
    assert.throws(() => validateBackupData({ [DB_PREFIX + t]: '{}' }), new RegExp(t));
  }
});
