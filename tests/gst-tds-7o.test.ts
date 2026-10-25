/**
 * 7O — GST & TDS follow-ups: purchase cess everywhere (Books, itcTotals, accounting / Tally exports, RCM cess out
 * of the supplier payable), ITC carry-forward and negative net ITC in the set-off plan, RCM self-invoice / payment
 * voucher series, purchase returns in GSTR-9 and on TDS bills, vendor-form TDS fields with Sec 197 limits, the
 * date-keyed 194-O / 194R / 194S presets and TDS due dates in the bell. Expected figures are worked out in comments.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import type { PurchaseRecord, PurchaseReturn } from '../src/types/purchases.ts';
import { readPurchase, selfAssessedCessOf, supplierPayable } from '../src/lib/purchase-normalize.ts';
import { EMPTY_BOOKS, gstSummary, itcWithCess, normalizePurchase as booksNormalize, purchaseCost, balanceSheet } from '../src/lib/books.ts';
import { itcTotals, purchasesDb } from '../src/lib/purchases.ts';
import { emptySource, normalizePurchase as exportNormalize } from '../src/lib/export-shared.ts';
import { buildDataset } from '../src/lib/accounting-export.ts';
import { buildTallyModel, voucherImbalance } from '../src/lib/tally-xml.ts';
import { A, buildLedger, trialBalance } from '../src/lib/ledger/index.ts';
import { buildGstReport, computeSetOff, type Gstr3bReport } from '../src/lib/gst-reports.ts';
import { carryForwardFor, creditLedgerBalance, loadSetOffs, planSetOff, postSetOff, setOffVoucherLines } from '../src/lib/gst-setoff.ts';
import { nextRcmNumber, rcmBills, rcmDocsDb, rcmDocsHtml, selfInvoiceDueDate, validatePaymentVoucher } from '../src/lib/rcm-self-invoice.ts';
import { RCM_SELF_INVOICE_DAYS_RULES } from '../src/lib/gst-penalties.ts';
import { purchaseReturnsDb } from '../src/lib/purchase-returns.ts';
import { noteSupplierAmount } from '../src/lib/purchase-returns-gst.ts';
import { purchaseReturnPostings } from '../src/lib/ledger/postings-returns.ts';
import { chartOf } from '../src/lib/ledger/accounts.ts';
import { buildGstr9 } from '../src/lib/gstr9.ts';
import {
  certificateUsed,
  cleanVendorTds,
  loadTdsDue,
  suggestTds,
  tdsDeductions,
  tdsRateFor,
  tdsReversalForReturn,
  usesTds,
  vendorTdsProblem,
} from '../src/lib/tds-payables.ts';
import { TDS_EXTRA_THRESHOLD_RULES, TDS_PAYABLE_SECTIONS, sectionRate, tdsThreshold } from '../src/lib/tds-rules.ts';
import { TDS_EXTRA_SECTION_RULES, tdsSections } from '../src/lib/tax-rules.ts';
import { businessNotices, tdsDueReminders } from '../src/lib/business-alerts.ts';
import { getTable } from '../src/lib/storage.ts';
import { gstinChecksumChar } from '../src/lib/gstin.ts';
import { IFF_LIMIT_RULES, buildIffJson, iffCheck, isIffMonth } from '../src/lib/iff.ts';

beforeEach(() => resetStorage());

const REG = '27AAPFU0939F1ZV';
/** Reverse-charge bill from an unregistered supplier with cess: 1000 + CGST 140 + SGST 140 + cess 120 = 1400. */
const rcmBill = (over: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
  id: 'r1', kind: 'PURCHASE', vendor_name: 'Local Transporter', bill_number: 'LT-7', date: '2026-05-10', place_of_supply: '27',
  category: 'Freight', lines: [{ id: 'l1', name: 'Goods transport', hsn: '996511', unit: 'NOS', quantity: 1, rate: 1000, tax_rate: 28 }],
  taxable: 1000, cgst: 140, sgst: 140, igst: 0, cess_amount: 120, reverse_charge: true, itc_eligible: true, total: 1400, amount_paid: 0,
  ...over,
});
/** Ordinary bill with cess from a registered supplier: 1000 + 140 + 140 + 120 = 1400. */
const cessBill = (over: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
  id: 'c1', kind: 'PURCHASE', vendor_name: 'Tobacco Co', vendor_gstin: REG, bill_number: 'T-1', date: '2026-05-12', place_of_supply: '27',
  category: 'Purchases', lines: [], taxable: 1000, cgst: 140, sgst: 140, igst: 0, cess_amount: 120, itc_eligible: true, total: 1400, amount_paid: 0,
  ...over,
});
const ledgerOf = (purchases: unknown[], notes: PurchaseReturn[] = []) =>
  buildLedger({ ...EMPTY_BOOKS, purchases: purchases as never, purchaseReturns: notes, vendors: [], userAccounts: [], manual: [], assets: [], today: '2026-10-25' } as never);

/* ── 1. Cess completeness ─────────────────────────────────────── */

test('RCM cess is self-assessed: out of the supplier payable, onto RCM payable (ledger)', () => {
  const b = rcmBill();
  assert.equal(selfAssessedCessOf(readPurchase(b)!), 120);
  // Supplier is owed only the taxable value: 1400 − GST 280 − cess 120.
  assert.equal(supplierPayable(b), 1000);
  const tb = trialBalance(ledgerOf([b]), { start: '2026-04-01', end: '2027-03-31' });
  const row = (id: string) => tb.rows.find((r) => r.account.id === id);
  assert.equal(row(A.creditors)!.credit, 100000);
  assert.equal(row(A.rcmPayable)!.credit, 40000, 'GST 280 + cess 120 on reverse charge');
  assert.equal(row(A.inCess)!.debit, 12000);
  assert.equal(row(A.roundOff), undefined, 'nothing lands in round-off');
});

test('Books: purchase cess in gstSummary ITC (separate head), cost when not claimed, balance sheet', () => {
  const data = { ...EMPTY_BOOKS, purchases: [rcmBill(), cessBill()] as never };
  const g = gstSummary(data, { start: '2026-05-01', end: '2026-05-31' });
  assert.equal(g.itc, 560, 'GST credit only: 280 + 280');
  assert.equal(g.itcCess, 240);
  assert.equal(g.rcmCess, 120);
  // Output cess 0 + RCM cess 120 − cess credit 240 = −120 (cess credit carried).
  assert.equal(g.netCessPayable, -120);
  assert.equal(itcWithCess(g), 800);
  // GST net payable is untouched by cess credit: 0 + RCM 280 − 560.
  assert.equal(g.netPayable, -280);
  const blocked = booksNormalize(cessBill({ itc_eligible: false }) as never)!;
  assert.equal(purchaseCost(blocked), 1400, 'cess not claimed is a cost, never lost');
  const bs = balanceSheet(data, '2026-05-31');
  // Payables 1000 (RCM supplier) + 1400; GST: RCM 280 + 120 owed, ITC 560 + 240 → receivable 400.
  assert.equal(bs.liabilities.payables, 2400);
  assert.equal(bs.assets.itcReceivable, 400);
});

test('itcTotals carries cess credit; ineligible cess counts as not claimed', () => {
  const t = itcTotals([rcmBill(), cessBill({ id: 'c2', itc_eligible: false })]);
  assert.equal(t.cess, 120);
  assert.equal(t.total, 400);
  assert.equal(t.ineligible, 400);
});

test('accounting export and Tally carry purchase cess (no more round-off)', () => {
  const n = exportNormalize(rcmBill())!;
  assert.equal(n.cess, 120);
  assert.equal(n.selfCess, 120);
  assert.equal(n.roundOff, 0);
  assert.equal(n.payable, 1000);
  const reg = buildDataset('purchase_register', { ...emptySource(), purchases: [cessBill()] });
  const h = (k: string) => reg.headers.indexOf(k);
  const cell = (c: unknown) => (c && typeof c === 'object' ? (c as { money: number }).money : c);
  assert.equal(cell(reg.rows[0][h('Cess')]), 120);
  assert.equal(cell(reg.rows[0][h('Round Off')]), 0);

  const build = buildTallyModel({ ...emptySource(), purchases: [rcmBill(), cessBill(), cessBill({ id: 'c3', bill_number: 'T-3', itc_eligible: false })] }, { companyName: 'Test' });
  const v = (no: string) => build.vouchers.find((x) => x.number === no)!;
  const posted = (no: string, ledger: string) => v(no).entries.filter((e) => e.ledger === ledger).reduce((s, e) => s + (e.side === 'Cr' ? e.paise : -e.paise), 0);
  for (const no of ['LT-7', 'T-1', 'T-3']) {
    assert.equal(voucherImbalance(v(no)), 0, `${no} balances`);
    assert.equal(posted(no, 'Round Off'), 0, `${no}: cess never lands in Round Off`);
  }
  assert.equal(posted('LT-7', 'Input Cess'), -12000);
  assert.equal(posted('LT-7', 'GST Payable on Reverse Charge'), 40000);
  assert.equal(posted('LT-7', 'Local Transporter'), 100000);
  assert.equal(posted('T-1', 'Input Cess'), -12000);
  assert.equal(posted('T-3', 'Purchases'), -140000, 'blocked credit: GST and cess into cost');
});

/* ── 2. ITC carry-forward and negative net ITC ────────────────── */

function g3(liab: { igst: number; cgst: number; sgst: number }, itc: { igst: number; cgst: number; sgst: number; cess?: number }, signed?: { igst: number; cgst: number; sgst: number; cess: number }): Gstr3bReport {
  const payment = computeSetOff(liab, itc);
  payment.cess = 0;
  const z = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const zh = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
  return {
    outward: { taxable: { ...z, taxable: 10000, ...liab }, zeroRated: z, nilExempt: { inter: 0, intra: 0 }, inwardRcm: z, nonGst: 0 },
    interStateUnreg: [],
    itc: { importGoods: zh, importServices: zh, availableRcm: zh, availableOther: { ...zh, ...itc }, reversedRules: zh, reversedOther: zh, net: { cess: 0, ...itc }, ineligible: zh, ...(signed ? { netSigned: signed } : {}) },
    inwardExempt: { inter: 0, intra: 0 },
    payment,
    unadjustedCredit: { igst: 0, cgst: 0, sgst: 0 },
    purchasesConsidered: 1,
    outwardRcmTaxable: 0,
  };
}
const MAY = { kind: 'month' as const, fyStart: 2026, month: 5 };
const JUNE = { kind: 'month' as const, fyStart: 2026, month: 6 };
const AUG = { kind: 'month' as const, fyStart: 2026, month: 8 };

test('ITC carried in joins the period credit before the utilisation order', () => {
  // Liability CGST 500 + SGST 500; own ITC CGST 200 + SGST 200; carried CGST 400 + SGST 100.
  // Credit CGST 600 → 500 used, 100 carried; SGST 300 → 300 used, 200 in cash.
  const plan = planSetOff(g3({ igst: 0, cgst: 500, sgst: 500 }, { igst: 0, cgst: 200, sgst: 200 }), { period: JUNE, due: '', openingItc: { cgst: 400, sgst: 100 } });
  assert.deepEqual(plan.itcOpening, { igst: 0, cgst: 400, sgst: 100, cess: 0 });
  assert.deepEqual(plan.itcAvailable, { igst: 0, cgst: 600, sgst: 300, cess: 0 });
  assert.deepEqual(plan.itcUsed, { igst: 0, cgst: 500, sgst: 300, cess: 0 });
  assert.deepEqual(plan.cashTax, { igst: 0, cgst: 0, sgst: 200, cess: 0 });
  assert.deepEqual(plan.itcCarry, { igst: 0, cgst: 100, sgst: 0, cess: 0 });
  // Without a carry-in the plan is exactly the 3B's own set-off.
  const own = planSetOff(g3({ igst: 0, cgst: 500, sgst: 500 }, { igst: 0, cgst: 200, sgst: 200 }), { period: JUNE, due: '' });
  assert.equal(own.itcOpening, undefined);
  assert.deepEqual(own.cashTax, { igst: 0, cgst: 300, sgst: 300, cess: 0 });
});

test('posted set-off stores the carry; the next period picks it up; gaps and pre-7O rows are flagged', () => {
  // May: IGST liability 10, ITC CGST 90 + SGST 90 → CGST credit pays the IGST 10 (Rule 88A), carry 80 / 90.
  const may = planSetOff(g3({ igst: 10, cgst: 0, sgst: 0 }, { igst: 0, cgst: 90, sgst: 90 }), { period: MAY, due: '' });
  postSetOff(may, { date: '2026-06-20', gstin: REG });
  const rows = loadSetOffs();
  assert.deepEqual(rows[0].itc_carry, { igst: 0, cgst: 80, sgst: 90, cess: 0 });
  const june = carryForwardFor(rows, '2026-06-01', REG);
  assert.deepEqual(june.heads, { igst: 0, cgst: 80, sgst: 90, cess: 0 });
  assert.deepEqual(june.notes, []);
  assert.equal(june.fromKey, '2026-05');
  assert.deepEqual(carryForwardFor(rows, '2026-08-01', REG).notes, ['CARRY_GAP']);
  assert.deepEqual(carryForwardFor(rows, '2026-06-01', 'OTHERGSTIN').heads, { igst: 0, cgst: 0, sgst: 0, cess: 0 });
  assert.deepEqual(creditLedgerBalance(rows, REG), { igst: 0, cgst: 80, sgst: 90, cess: 0 });
  const legacy = rows.map((r) => ({ ...r, itc_carry: undefined }));
  assert.deepEqual(carryForwardFor(legacy, '2026-06-01', REG).notes, ['CARRY_UNKNOWN']);
  void AUG;
});

test('negative net ITC (supplier note above the month ITC): shown signed in 3B, paid in cash unless carried credit covers it', () => {
  // May bill: 10 × 100 + 9% + 9%. June: debit note for 3 units → ITC −27 / −27 in June, no June purchases.
  const bill: PurchaseRecord = cessBill({ id: 'b1', cess_amount: undefined, cgst: 90, sgst: 90, total: 1180, date: '2026-05-10', lines: [{ id: 'l1', name: 'Paper', hsn: '4802', unit: 'NOS', quantity: 10, rate: 100, tax_rate: 18 }] });
  purchasesDb.save(bill);
  purchaseReturnsDb.create({ kind: 'DEBIT_NOTE', date: '2026-06-05', purchaseId: 'b1', reason: '01', goodsReturned: true, lines: [{ id: 'x', bill_line_id: 'l1', name: 'Paper', hsn: '4802', quantity: 3, rate: 100, tax_rate: 18 }] });
  const notes = getTable<PurchaseReturn>('purchase_returns');
  const r = buildGstReport([], purchasesDb.all(), { period: JUNE, gstin: REG, purchaseNotes: notes });
  assert.deepEqual(r.gstr3b.itc.net, { igst: 0, cgst: 0, sgst: 0, cess: 0 }, 'set-off never uses a negative credit');
  assert.deepEqual(r.gstr3b.itc.netSigned, { igst: 0, cgst: -27, sgst: -27, cess: 0 });
  const plan = planSetOff(r.gstr3b, { period: JUNE, due: '' });
  assert.ok(plan.warnings.includes('NEGATIVE_NET_ITC'));
  assert.deepEqual(plan.itcNegative, { igst: 0, cgst: 27, sgst: 27, cess: 0 });
  assert.deepEqual(plan.cashTax, { igst: 0, cgst: 27, sgst: 27, cess: 0 });
  const lines = setOffVoucherLines(plan);
  assert.equal(lines.find((l) => l.account_id === A.inCgst)?.dr, 2700, 'journal restores the input ledger');
  assert.equal(lines.find((l) => l.account_id === A.gstCash)?.cr, 5400);
  // With May's unutilised 90 / 90 carried in, the credit covers the reversal: 63 / 63 carried on, no cash.
  const covered = planSetOff(r.gstr3b, { period: JUNE, due: '', openingItc: { cgst: 90, sgst: 90 } });
  assert.equal(covered.itcNegative, undefined);
  assert.deepEqual(covered.cashTax, { igst: 0, cgst: 0, sgst: 0, cess: 0 });
  assert.deepEqual(covered.itcCarry, { igst: 0, cgst: 63, sgst: 63, cess: 0 });
});

/* ── 3. RCM self-invoice / payment voucher ────────────────────── */

test('RCM self-invoice: unregistered RCM bills, Rule 47A due date, FY series, consolidated month, never re-used numbers', () => {
  assert.equal(selfInvoiceDueDate('2024-10-15'), '', 'no time limit in the rules before 1 Nov 2024');
  assert.equal(selfInvoiceDueDate('2026-05-10'), '2026-06-09');
  assert.deepEqual(RCM_SELF_INVOICE_DAYS_RULES.map((r) => r.from), [...RCM_SELF_INVOICE_DAYS_RULES.map((r) => r.from)].sort());
  purchasesDb.save(rcmBill());
  purchasesDb.save(rcmBill({ id: 'r2', bill_number: 'LT-8', date: '2026-05-20', vendor_name: 'Another Carrier' }));
  purchasesDb.save(rcmBill({ id: 'r3', bill_number: 'REG-1', vendor_gstin: REG }));
  purchasesDb.save(cessBill());
  let bills = rcmBills(purchasesDb.all(), []);
  assert.deepEqual(bills.map((b) => b.id).sort(), ['r1', 'r2'], 'registered supplier / ordinary bills are not listed');
  assert.equal(rcmBills(purchasesDb.all(), [], false).length, 3);
  const rec = { name: 'Us Pvt Ltd', gstin: REG, state_code: '27' };
  const n1 = nextRcmNumber('SELF_INVOICE', '2026-05-31', []);
  assert.equal(n1, 'RCM/FY26-27/0001');
  assert.ok(n1.length <= 16);
  const one = rcmDocsDb.create('SELF_INVOICE', { date: '2026-05-31', number: n1, recipient: rec, bills: [purchasesDb.get('r1')] });
  assert.equal(one.taxable, 1000);
  assert.equal(one.cgst + one.sgst, 280);
  assert.equal(one.cess, 120);
  assert.equal(one.lines[0].hsn, '996511');
  assert.throws(() => rcmDocsDb.create('SELF_INVOICE', { date: '2026-05-31', number: 'RCM/FY26-27/0009', recipient: rec, bills: [purchasesDb.get('r1')] }), /already has a self-invoice/);
  assert.throws(() => rcmDocsDb.create('SELF_INVOICE', { date: '2026-05-31', number: n1, recipient: rec, bills: [purchasesDb.get('r2')] }), /already used/);
  assert.throws(() => rcmDocsDb.create('SELF_INVOICE', { date: '2026-05-31', number: 'RCM/FY26-27/00001X', recipient: rec, bills: [purchasesDb.get('r2')] }), /16 characters/);
  // Consolidated for May: every bill must be of the month.
  assert.throws(() => rcmDocsDb.create('SELF_INVOICE', { date: '2026-05-31', number: 'RCM/FY26-27/0002', recipient: rec, bills: [purchasesDb.get('r2'), purchasesDb.get('r3')], consolidatedMonth: '2026-04' }), /chosen month/);
  bills = rcmBills(purchasesDb.all(), rcmDocsDb.all());
  assert.equal(bills.find((b) => b.id === 'r1')!.selfInvoice, n1);
  const n2 = nextRcmNumber('SELF_INVOICE', '2026-05-31', rcmDocsDb.all());
  const cons = rcmDocsDb.create('SELF_INVOICE', { date: '2026-05-31', number: n2, recipient: rec, bills: [purchasesDb.get('r2')], consolidatedMonth: '2026-05' });
  assert.equal(cons.number, 'RCM/FY26-27/0002');
  rcmDocsDb.remove(cons.id);
  assert.equal(nextRcmNumber('SELF_INVOICE', '2026-06-01', rcmDocsDb.all()), 'RCM/FY26-27/0003', 'a deleted number is never handed out again');
  assert.equal(nextRcmNumber('SELF_INVOICE', '2027-04-01', rcmDocsDb.all()), 'RCM/FY27-28/0001');
  const html = rcmDocsHtml(rcmDocsDb.all());
  assert.match(html, /reverse charge: <strong>Yes<\/strong>/);
  assert.match(html, /Working paper/);
  assert.ok(!/<script/i.test(html));
});

test('RCM payment voucher (Rule 52): amount limited to what the supplier is owed, tax pro rata', () => {
  purchasesDb.save(rcmBill());
  const rec = { name: 'Us', state_code: '27' };
  const bill = purchasesDb.get('r1');
  assert.match(validatePaymentVoucher({ date: '2026-05-15', number: 'RPV/FY26-27/0001', recipient: rec, bill, amount: 1200 }, []), /more than what is left/);
  const v = rcmDocsDb.create('PAYMENT_VOUCHER', { date: '2026-05-15', number: nextRcmNumber('PAYMENT_VOUCHER', '2026-05-15', []), recipient: rec, bill, amount: 500 });
  assert.equal(v.number, 'RPV/FY26-27/0001');
  // Half of the 1000 owed → half of the bill: taxable 500, CGST 70, SGST 70, cess 60.
  assert.deepEqual([v.amount_paid, v.taxable, v.cgst, v.sgst, v.cess], [500, 500, 70, 70, 60]);
  assert.match(validatePaymentVoucher({ date: '2026-05-16', number: 'RPV/FY26-27/0002', recipient: rec, bill, amount: 600 }, rcmDocsDb.all()), /₹500\.00/);
});

/* ── 4. Purchase returns: GSTR-9 and TDS ──────────────────────── */

/** 100 units × ₹1,000, 18% intra-state, 194C 2% deducted at booking (₹2,000 on ₹1,00,000). */
const tdsBill = (over: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
  id: 't1', kind: 'PURCHASE', vendor_id: 'v1', vendor_name: 'Contractor & Co', vendor_gstin: REG, bill_number: 'C-1', date: '2026-05-10', place_of_supply: '27',
  category: 'Purchases', lines: [{ id: 'l1', name: 'Fabrication', hsn: '998898', unit: 'NOS', quantity: 100, rate: 1000, tax_rate: 18 }],
  taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, itc_eligible: true, total: 118000, amount_paid: 0,
  tds_section: '194C-2', tds_rate: 2, tds_base: 100000, tds_amount: 2000, tds_on: 'BILL', tds_pan: 'AAPFU0939F',
  ...over,
});

test('tdsReversalForReturn: pro rata on the TDS base, rupee-rounded, capped; none for TDS on payment', () => {
  assert.equal(tdsReversalForReturn(tdsBill(), 25000), 500);
  assert.equal(tdsReversalForReturn(tdsBill(), 33333), 667);
  assert.equal(tdsReversalForReturn(tdsBill(), 250000), 2000);
  assert.equal(tdsReversalForReturn(tdsBill(), 50000, 1800), 200, 'never more than what earlier notes left');
  assert.equal(tdsReversalForReturn(tdsBill({ tds_on: 'PAYMENT' }), 25000), 0);
  assert.equal(tdsReversalForReturn(tdsBill({ tds_amount: undefined }), 25000), 0);
});

test('a return on a TDS bill reverses the TDS: note, bill balance, ledger, TDS register', () => {
  purchasesDb.save(tdsBill());
  const n = purchaseReturnsDb.create({ kind: 'DEBIT_NOTE', date: '2026-06-02', purchaseId: 't1', reason: '01', goodsReturned: true, lines: [{ id: 'x', bill_line_id: 'l1', name: 'Fabrication', hsn: '998898', quantity: 25, rate: 1000, tax_rate: 18 }] });
  // Note 25,000 + 2,250 + 2,250 = 29,500; TDS back 500 → supplier account falls by 29,000.
  assert.equal(n.tds_reversed, 500);
  assert.equal(n.tds_section, '194C-2');
  assert.equal(noteSupplierAmount(n), 29000);
  assert.equal(n.adjusted_amount, 29000);
  const [v] = purchaseReturnPostings([n], chartOf([]));
  const line = (id: string) => v.lines.find((l) => l.account === id);
  assert.equal(line(A.creditors)!.dr, 2900000);
  assert.equal(line(A.tds194c)!.dr, 50000);
  assert.equal(v.lines.reduce((s, l) => s + l.dr - l.cr, 0), 0);
  const rows = tdsDeductions({ purchases: purchasesDb.all(), payments: [], returns: getTable('purchase_returns') });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 1500);
  assert.equal(rows[0].base, 75000);
  assert.equal(rows[0].returnReversed, 500);
  assert.equal(rows[0].returnDate, '2026-06-02');
  // Books: TDS payable falls with the note.
  const bs = balanceSheet({ ...EMPTY_BOOKS, purchases: purchasesDb.all() as never, purchaseReturns: getTable<PurchaseReturn>('purchase_returns') }, '2026-06-30');
  // GST: output 0, ITC 18,000 − 4,500 = 13,500 receivable; payable side carries TDS 1,500 only.
  assert.equal(bs.liabilities.gstPayable, 1500);
});

test('GSTR-9 nets supplier notes in each month’s 3B (6A / Table 9) and in Table 6B, so 6J stays nil', () => {
  purchasesDb.save(tdsBill({ tds_section: undefined, tds_amount: undefined, tds_rate: undefined, tds_base: undefined, tds_on: undefined, tds_pan: undefined }));
  purchaseReturnsDb.create({ kind: 'DEBIT_NOTE', date: '2026-06-02', purchaseId: 't1', reason: '01', goodsReturned: true, lines: [{ id: 'x', bill_line_id: 'l1', name: 'Fabrication', hsn: '998898', quantity: 25, rate: 1000, tax_rate: 18 }] });
  const notes = getTable<PurchaseReturn>('purchase_returns');
  const without = buildGstr9([], purchasesDb.all(), { fyStart: 2026, filerStateCode: '27' });
  const withNotes = buildGstr9([], purchasesDb.all(), { fyStart: 2026, filerStateCode: '27', purchaseNotes: notes });
  const row = (r: typeof withNotes, id: string) => r.table6.find((x) => x.id === id)!;
  assert.equal(row(without, '6A').cgst, 9000);
  assert.equal(row(withNotes, '6A').cgst, 6750, '3B 4A nets the note');
  // SAC 99xxxx line → input services; 9,000 − 2,250.
  assert.equal(row(withNotes, '6B(iii)').cgst, 6750);
  assert.equal(row(withNotes, '6J').cgst, 0);
  assert.ok(withNotes.notes.some((x) => /supplier note/.test(x)));
});

/* ── 5. Vendor TDS fields, Sec 197 limits, new sections, due dates ── */

test('vendor TDS fields: validation and cleaning', () => {
  assert.equal(vendorTdsProblem({ pan: 'ABCDE1234F', tds_section: '194J' }), '');
  assert.match(vendorTdsProblem({ pan: 'ABC123' }), /PAN/);
  assert.match(vendorTdsProblem({ tds_lower_rate: 1 }), /certificate number/);
  assert.match(vendorTdsProblem({ tds_lower_cert: 'C1' }), /rate/);
  assert.match(vendorTdsProblem({ tds_lower_cert: 'C1', tds_lower_rate: 1, tds_lower_from: '2026-04-01', tds_lower_to: '2026-03-01' }), /ends before/);
  assert.match(vendorTdsProblem({ tds_section: '999' }), /section/);
  const c = cleanVendorTds({ pan: ' abcde1234f ', tds_lower_cert: '', tds_lower_rate: 1, tds_non_filer: false, non_resident: true });
  assert.equal(c.pan, 'ABCDE1234F');
  assert.equal(c.tds_lower_rate, undefined, 'no certificate → no certificate rate');
  assert.equal(c.tds_non_filer, undefined);
  assert.equal(c.non_resident, true);
});

test('Sec 197 certificate: validity and limit; the excess is taxed at the normal rate', () => {
  const payee = { pan: 'ABCDE1234F', lowerCert: 'CERT1', lowerRate: 1, lowerFrom: '2026-04-01', lowerTo: '2027-03-31', lowerLimit: 60000 };
  assert.equal(tdsRateFor('194J', '2026-06-01', payee)!.reason, 'A');
  assert.equal(tdsRateFor('194J', '2027-04-02', payee)!.rate, 10, 'expired certificate → Act rate');
  assert.equal(tdsRateFor('194J', '2026-06-01', { ...payee, lowerUsed: 60000 })!.rate, 10, 'limit used up');
  // ₹1,00,000 fee, ₹60,000 left on the certificate: 600 + 10% of 40,000 = 4,600.
  const s = suggestTds('194J', '2026-06-01', 100000, payee, [])!;
  assert.equal(s.amount, 4600);
  assert.equal(s.rate, 4.6);
  assert.equal(certificateUsed([{ id: 'a', date: '2026-05-01', base: 20000, tds: 200, code: '194J', cert: 'cert1' }, { id: 'b', date: '2025-05-01', base: 9999, tds: 0, code: '194J', cert: 'CERT1' }], 'CERT1', '2026-06-01'), 20000);
});

test('194-O / 194R / 194S: date-keyed, merged before Custom, payable sections and thresholds', () => {
  const rate = (d: string, s: string) => tdsSections(d).find((x) => x.section === s)?.rate;
  assert.equal(rate('2020-09-30', '194O'), undefined);
  assert.equal(rate('2020-12-01', '194O'), 0.75);
  assert.equal(rate('2023-06-01', '194O'), 1);
  assert.equal(rate('2025-06-01', '194O'), 0.1);
  assert.equal(rate('2022-06-30', '194R'), undefined);
  assert.equal(rate('2022-07-01', '194R'), 10);
  assert.equal(rate('2022-07-01', '194S'), 1);
  const list = tdsSections('2025-06-01');
  assert.equal(list[list.length - 1].section, 'CUSTOM');
  for (const x of TDS_EXTRA_SECTION_RULES) assert.deepEqual(x.versions.map((v) => v.from), [...x.versions.map((v) => v.from)].sort(), `${x.section} oldest first`);
  assert.ok(TDS_PAYABLE_SECTIONS.some((s) => s.code === '194O' && s.rpu === '94O'));
  assert.equal(sectionRate('194S', '2026-06-01'), 1);
  assert.equal(tdsThreshold('194R', '2026-06-01')?.aggregate, 20000);
  assert.ok(TDS_EXTRA_THRESHOLD_RULES['194S']);
  assert.equal(tdsThreshold('194O', '2026-06-01'), undefined);
  // Older sections are unchanged.
  assert.equal(rate('2026-06-01', '194H'), 2);
});

test('TDS due dates reach the bell: overdue / due within 5 days, certificates skipped', () => {
  const items = [
    { id: 'TDS:dep:2026-09', kind: 'TDS' as const, what: 'deposit' as const, period: '2026-09', due: '2026-10-07', amount: 500, status: 'overdue' as const },
    { id: 'TDS:ret:2026-Q2', kind: 'TDS' as const, what: 'return' as const, period: '2026-Q2', due: '2026-10-31', amount: 500, status: 'upcoming' as const },
    { id: 'TDS:dep:2026-10', kind: 'TDS' as const, what: 'deposit' as const, period: '2026-10', due: '2026-11-07', amount: 100, status: 'upcoming' as const },
    { id: 'TDS:cert:2026-Q1', kind: 'TDS' as const, what: 'certificate' as const, period: '2026-Q1', due: '2026-10-28', amount: 1, status: 'upcoming' as const },
  ];
  assert.deepEqual(tdsDueReminders(items, '2026-10-27').map((d) => d.id), ['TDS:dep:2026-09', 'TDS:ret:2026-Q2']);
  const out = businessNotices({ today: '2026-10-27', at: '2026-10-27T10:00:00Z', approver: false, invoices: [], amc: [], tdsDue: items });
  assert.equal(out.length, 2);
  assert.equal(out[0].severity, 'critical');
  assert.equal(out[1].severity, 'warning');
  assert.equal(out[0].href, '/tds?tab=overview');
});

test('loadTdsDue / usesTds read the stored TDS bills', () => {
  assert.equal(usesTds(), false);
  assert.deepEqual(loadTdsDue('2026-10-25'), []);
  purchasesDb.save(tdsBill());
  assert.equal(usesTds(), true);
  const due = loadTdsDue('2026-10-25');
  const dep = due.find((d) => d.id === 'TDS:dep:2026-05')!;
  assert.equal(dep.due, '2026-06-07');
  assert.equal(dep.status, 'overdue');
  assert.ok(due.some((d) => d.what === 'return' && d.period === '2026-Q1'));
});

/* ── 6. IFF working paper ─────────────────────────────────────── */

test('IFF: months 1–2 of a quarter, B2B + CDNR only, ₹50 lakh check', () => {
  const BUYER = `27AABCU9603R1Z${gstinChecksumChar('27AABCU9603R1Z')}`;
  assert.equal(isIffMonth({ kind: 'month', fyStart: 2026, month: 4 }), true);
  assert.equal(isIffMonth({ kind: 'month', fyStart: 2026, month: 5 }), true);
  assert.equal(isIffMonth({ kind: 'month', fyStart: 2026, month: 6 }), false);
  assert.equal(isIffMonth({ kind: 'month', fyStart: 2026, month: 2 }), true);
  assert.equal(isIffMonth({ kind: 'month', fyStart: 2026, month: 3 }), false);
  assert.deepEqual(IFF_LIMIT_RULES.map((r) => r.from), [...IFF_LIMIT_RULES.map((r) => r.from)].sort());
  const inv = {
    id: 'i1', invoice_number: 'INV/FY26-27/0001', doc_type: 'INVOICE', issue_date: '2026-05-20', due_date: '2026-05-20', status: 'Sent', currency: 'INR',
    sender: { companyName: 'Seller', companyGstin: REG, stateCode: '27' },
    client: { name: 'Buyer', gstin: BUYER, state_code: '27' }, place_of_supply: '27', gst_mode: 'CGST_SGST',
    items: [{ id: 'l1', name: 'Widget', hsn: '8471', quantity: 2, rate: 1000, tax_rate: 18 }],
  };
  const b2c = { ...inv, id: 'i2', invoice_number: 'INV/FY26-27/0002', client: { name: 'Walk-in', state_code: '27' } };
  const g1 = buildGstReport([inv as never, b2c as never], [], { period: MAY, gstin: REG }).gstr1;
  const chk = iffCheck(g1, MAY, '2026-05-01');
  assert.deepEqual([chk.value, chk.invoices, chk.notes, chk.limit], [2000, 1, 0, 5_000_000]);
  assert.deepEqual(chk.warnings, []);
  assert.ok(iffCheck(g1, { kind: 'month', fyStart: 2026, month: 6 }, '2026-06-01').warnings.includes('NOT_IFF_MONTH'));
  assert.ok(iffCheck({ b2b: [{ ...g1.b2b[0], taxable: 6_000_000 }], cdnr: [] }, MAY, '2026-05-01').warnings.includes('OVER_LIMIT'));
  const json = buildIffJson(g1);
  assert.deepEqual(Object.keys(json).sort(), ['b2b', 'fp', 'gstin', 'hash', 'version']);
  assert.equal((json.b2b as { ctin: string }[])[0].ctin, BUYER);
});

