/**
 * WP-3: purchase returns / supplier notes (P0-5), receipt notes + rejections out (P1-8) and the
 * purchase-side pending reports (P1-12). Expected figures are worked out in comments.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import type { PurchaseOrder, PurchaseRecord, PurchaseReturn, ReceiptNote } from '../src/types/purchases.ts';
import { balanceOf, purchasesDb } from '../src/lib/purchases.ts';
import { nextNoteNumber, noteTotals, purchaseReturnsDb, returnableLines, validateNote } from '../src/lib/purchase-returns.ts';
import { booksReturnEffects, itcAdjustmentsFromNotes, itcNoteSummary, notesAsBookBills } from '../src/lib/purchase-returns-gst.ts';
import { purchaseReturnPostings } from '../src/lib/ledger/postings-returns.ts';
import { A, chartOf, voucherDiff } from '../src/lib/ledger/index.ts';
import { buildGstReport, type ReportPeriod } from '../src/lib/gst-reports.ts';
import { bookBills, matchGstr2b, type Gstr2bLine } from '../src/lib/gstr2b.ts';
import { billwisePayables } from '../src/lib/billwise.ts';
import { computeStock } from '../src/lib/inventory.ts';
import { billSeedFromGrn, goodsReceivedNotBilled, grnStatus, nextReceiptNumber, purchaseOrderOutstanding, receiptNotesDb, validateReceiptNote } from '../src/lib/receipt-notes.ts';
import { buildTallyModel, buildTallyVouchersXml, voucherImbalance } from '../src/lib/tally-xml.ts';
import { emptySource } from '../src/lib/export-shared.ts';
import { balanceSheet, EMPTY_BOOKS, profitAndLoss } from '../src/lib/books.ts';

beforeEach(() => resetStorage());

const GSTIN = '27AAPFU0939F1ZV';
const bill = (over: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
  id: 'b1',
  kind: 'PURCHASE',
  vendor_id: 'v1',
  vendor_name: 'Acme Supplies',
  vendor_gstin: GSTIN,
  bill_number: 'AS/22',
  date: '2025-05-10',
  place_of_supply: '27',
  category: 'Purchases',
  lines: [{ id: 'l1', name: 'Paper ream', hsn: '4802', unit: 'NOS', quantity: 10, rate: 100, tax_rate: 18 }],
  taxable: 1000,
  cgst: 90,
  sgst: 90,
  igst: 0,
  itc_eligible: true,
  total: 1180,
  amount_paid: 0,
  ...over,
});

const may: ReportPeriod = { kind: 'month', fyStart: 2025, month: 5 } as ReportPeriod;
const june: ReportPeriod = { kind: 'month', fyStart: 2025, month: 6 } as ReportPeriod;

test('DN numbering follows the Indian FY of the note date', () => {
  assert.equal(nextNoteNumber([], '2026-03-31'), 'DN/FY25-26/0001');
  assert.equal(nextNoteNumber(['DN/FY25-26/0007'], '2026-03-31'), 'DN/FY25-26/0008');
  assert.equal(nextNoteNumber(['DN/FY25-26/0007'], '2026-04-01'), 'DN/FY26-27/0001');
  assert.equal(nextReceiptNumber(['GRN/FY25-26/0002'], 'GRN', '2025-06-01'), 'GRN/FY25-26/0003');
  assert.equal(nextReceiptNumber([], 'REJECTION_OUT', '2025-06-01'), 'RJO/FY25-26/0001');
});

test('debit note: quantity limited to billed less earlier returns; bill balance falls (Agst Ref); delete undoes it', () => {
  purchasesDb.save(bill());
  // 3 of 10 back at ₹100 + 9% + 9% = 300 + 27 + 27 = 354.
  const dn = purchaseReturnsDb.create({ kind: 'DEBIT_NOTE', date: '2025-06-05', purchaseId: 'b1', reason: '01', goodsReturned: true, lines: [{ id: 'x', bill_line_id: 'l1', name: 'Paper ream', hsn: '4802', quantity: 3, rate: 100, tax_rate: 18 }] });
  assert.equal(dn.note_number, 'DN/FY25-26/0001');
  assert.deepEqual([dn.taxable, dn.cgst, dn.sgst, dn.igst, dn.total, dn.adjusted_amount], [300, 27, 27, 0, 354, 354]);
  assert.equal(dn.bill_number, 'AS/22');
  assert.equal(balanceOf(purchasesDb.get('b1')!), 826);
  const r = returnableLines(purchasesDb.get('b1')!, purchaseReturnsDb.all());
  assert.deepEqual([r[0].billed, r[0].returned, r[0].available], [10, 3, 7]);
  assert.throws(
    () => purchaseReturnsDb.create({ kind: 'DEBIT_NOTE', date: '2025-06-06', purchaseId: 'b1', reason: '01', goodsReturned: true, lines: [{ id: 'y', bill_line_id: 'l1', name: 'Paper ream', quantity: 8, rate: 100, tax_rate: 18 }] }),
    /only 7 can be returned/,
  );
  assert.throws(() => purchasesDb.remove('b1'), /Delete the note first/);
  purchaseReturnsDb.remove(dn.id);
  assert.equal(balanceOf(purchasesDb.get('b1')!), 1180);
  assert.equal(purchaseReturnsDb.all().length, 0);
});

test('a note on a paid bill stays on account; bill-wise shows the Agst Ref and the open debit', () => {
  purchasesDb.save(bill({ amount_paid: 1000 })); // balance 180
  const cn = purchaseReturnsDb.create({ kind: 'SUPPLIER_CN', date: '2025-06-10', purchaseId: 'b1', supplierNoteNumber: 'CN-9', supplierNoteDate: '2025-06-08', reason: '02', goodsReturned: false, lines: [{ id: 'v', name: 'Discount', quantity: 1, rate: 500, tax_rate: 18 }] });
  assert.equal(cn.total, 590);
  assert.equal(cn.adjusted_amount, 180);
  assert.equal(balanceOf(purchasesDb.get('b1')!), 0);
  const parties = billwisePayables({ purchases: purchasesDb.all(), payments: [], vendorPayments: [], asOf: '2025-06-30', includeSettled: true, returns: purchaseReturnsDb.all() });
  const p = parties[0];
  assert.ok(p.bills[0].allocations.some((a) => a.ref === cn.note_number && a.amount === 180));
  assert.equal(p.advances[0].noteId, cn.id);
  assert.equal(p.advances[0].unallocated, 410); // 590 − 180
  assert.equal(p.net, -410);
});

test('validation: DN needs a bill, SUPPLIER_CN needs the supplier number, value cannot exceed the bill', () => {
  const b = bill();
  assert.match(validateNote({ kind: 'DEBIT_NOTE', date: '2025-06-01', reason: '01', goodsReturned: false, lines: [{ id: 'a', name: 'x', quantity: 1, rate: 1, tax_rate: 0 }] }, undefined, []), /bill/);
  assert.match(validateNote({ kind: 'SUPPLIER_CN', date: '2025-06-01', purchaseId: 'b1', reason: '02', goodsReturned: false, lines: [{ id: 'a', name: 'x', quantity: 1, rate: 1, tax_rate: 0 }] }, b, []), /credit note number/);
  assert.match(validateNote({ kind: 'DEBIT_NOTE', date: '2025-05-01', purchaseId: 'b1', reason: '02', goodsReturned: false, lines: [{ id: 'a', name: 'x', quantity: 1, rate: 1, tax_rate: 0 }] }, b, []), /before its bill/);
  assert.match(validateNote({ kind: 'DEBIT_NOTE', date: '2025-06-01', purchaseId: 'b1', reason: '02', goodsReturned: false, lines: [{ id: 'a', name: 'x', quantity: 1, rate: 1100, tax_rate: 18 }] }, b, []), /exceeds/);
  assert.deepEqual(noteTotals([{ id: 'a', name: 'x', quantity: 2, rate: 50, tax_rate: 18 }], 'IGST'), { taxable: 100, cgst: 0, sgst: 0, igst: 18, total: 118 });
});

const note = (over: Partial<PurchaseReturn> = {}): PurchaseReturn => ({
  id: 'n1', kind: 'DEBIT_NOTE', note_number: 'DN/FY25-26/0001', date: '2025-06-05', purchase_id: 'b1', bill_number: 'AS/22', bill_date: '2025-05-10',
  vendor_id: 'v1', vendor_name: 'Acme Supplies', vendor_gstin: GSTIN, reason: '01', goods_returned: true,
  lines: [{ id: 'x', bill_line_id: 'l1', name: 'Paper ream', hsn: '4802', quantity: 3, rate: 100, tax_rate: 18 }],
  taxable: 300, cgst: 27, sgst: 27, igst: 0, total: 354, itc_eligible: true, bill_kind: 'PURCHASE', category: 'Purchases', adjusted_amount: 354,
  ...over,
});

test('ledger: Dr Creditors | Cr Purchase returns, Cr Input CGST/SGST; RCM reverses the payable; ineligible ITC credits cost', () => {
  const [v] = purchaseReturnPostings([note()], chartOf());
  assert.equal(v.kind, 'Debit Note');
  assert.equal(voucherDiff(v), 0);
  const by = (acc: string) => v.lines.filter((l) => l.account === acc).reduce((s, l) => s + l.dr - l.cr, 0);
  assert.deepEqual([by(A.creditors), by(A.purchaseReturns), by(A.inCgst), by(A.inSgst)], [35400, -30000, -2700, -2700]);
  const [r] = purchaseReturnPostings([note({ reverse_charge: true })], chartOf());
  assert.deepEqual([r.lines.find((l) => l.account === A.creditors)!.dr, r.lines.find((l) => l.account === A.rcmPayable)!.dr], [30000, 5400]);
  const [n] = purchaseReturnPostings([note({ itc_eligible: false })], chartOf());
  assert.equal(n.lines.find((l) => l.account === A.purchaseReturns)!.cr, 35400);
  const [e] = purchaseReturnPostings([note({ bill_kind: 'EXPENSE', category: 'Rent' })], chartOf());
  assert.equal(e.lines.find((l) => l.account === A.rent)!.cr, 30000);
});

test('GSTR-3B: a note in the period reduces 4A(5) and net ITC (4C); nothing in other periods', () => {
  const notes = [note()];
  const may3b = buildGstReport([], [bill()], { period: may, filerStateCode: '27', purchaseNotes: notes }).gstr3b;
  assert.deepEqual([may3b.itc.availableOther.cgst, may3b.itc.net.cgst], [90, 90]);
  const jun3b = buildGstReport([], [bill()], { period: june, filerStateCode: '27', purchaseNotes: notes }).gstr3b;
  assert.deepEqual([jun3b.itc.availableOther.cgst, jun3b.itc.availableOther.sgst, jun3b.itc.net.cgst], [-27, -27, 0]);
  const both = buildGstReport([], [bill({ date: '2025-06-01' })], { period: june, filerStateCode: '27', purchaseNotes: notes }).gstr3b;
  assert.deepEqual([both.itc.availableOther.cgst, both.itc.net.cgst, both.itc.net.sgst], [63, 63, 63]);
  // Reverse charge: 3.1(d) and 4A(3) fall together.
  const rcm = itcAdjustmentsFromNotes([note({ reverse_charge: true })], () => true);
  assert.equal(rcm[0].reverseCharge, true);
  assert.deepEqual(itcNoteSummary(notes, (d) => d.startsWith('2025-06')), { count: 1, igst: 0, cgst: 27, sgst: 27, total: 54 });
});

test('GSTR-2B: a CDNR credit note matches the supplier note by number, a value-only DN by value; invoices never match notes', () => {
  const line = (over: Partial<Gstr2bLine>): Gstr2bLine => ({
    key: 'CDNR|x', section: 'CDNR', ctin: GSTIN, tradeName: 'Acme', number: 'CN-9', date: '2025-06-08', docType: 'CN', sign: -1,
    value: 354, taxable: 300, igst: 0, cgst: 27, sgst: 27, cess: 0, pos: '27', reverseCharge: false, itcAvailable: true, reason: '', ...over,
  });
  const bills = bookBills([bill()], '27', [note({ supplier_note_number: 'CN-9', supplier_note_date: '2025-06-08' })]);
  assert.equal(bills.length, 2);
  const m = matchGstr2b({ lines: [line({}), line({ key: 'B2B|AS22', section: 'B2B', number: 'AS/22', docType: 'INV', sign: 1, date: '2025-05-10', taxable: 1000, cgst: 90, sgst: 90, value: 1180 })] }, bills);
  assert.equal(m.rows.find((r) => r.line?.number === 'CN-9')!.cls, 'matched');
  assert.equal(m.rows.find((r) => r.line?.number === 'CN-9')!.taxDiff, 0);
  assert.equal(m.rows.find((r) => r.line?.number === 'AS/22')!.cls, 'matched');
  // A DN without the supplier's number: matched on value (flagged as a number difference).
  const fuzzy = matchGstr2b({ lines: [line({})] }, notesAsBookBills([note({ date: '2025-06-07' })]));
  assert.equal(fuzzy.rows[0].cls, 'mismatch');
  assert.deepEqual(fuzzy.rows[0].diffs, ['number']);
});

test('stock: a goods debit note takes stock out; a value-only note does not', () => {
  const items = [{ id: 's1', name: 'Paper ream', hsn: '4802', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }];
  const base = { items, moves: [], invoices: [], purchases: [bill()] };
  assert.equal(computeStock({ ...base, returnDocs: { notes: [note()], receipts: [] } })[0].qty, 7);
  assert.equal(computeStock({ ...base, returnDocs: { notes: [note({ goods_returned: false })], receipts: [] } })[0].qty, 10);
  const pos = computeStock({ ...base, returnDocs: { notes: [note()], receipts: [] } })[0];
  assert.equal(pos.soldQty, 0, 'a purchase return is not a sale');
  assert.equal(pos.adjustedOutQty, 3);
});

test('GRN → bill: goods come in once (on the GRN date), rejection out takes them out, pending and PO outstanding reports', () => {
  const items = [{ id: 's1', name: 'Paper ream', hsn: '4802', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }];
  const po: PurchaseOrder = { id: 'po1', po_number: 'PO/FY25-26/0001', date: '2025-05-01', expected_date: '2025-05-05', vendor_id: 'v1', vendor_name: 'Acme Supplies', lines: [{ id: 'pl1', name: 'Paper ream', hsn: '4802', quantity: 20, rate: 100, tax_rate: 18 }], taxable: 2000, cgst: 180, sgst: 180, igst: 0, total: 2360 };
  const grn: ReceiptNote = { id: 'g1', kind: 'GRN', number: 'GRN/FY25-26/0001', date: '2025-05-08', vendor_id: 'v1', vendor_name: 'Acme Supplies', po_id: 'po1', lines: [{ id: 'gl1', name: 'Paper ream', hsn: '4802', quantity: 12, rate: 100, tax_rate: 18, po_line_id: 'pl1' }] };
  const rj: ReceiptNote = { id: 'r1', kind: 'REJECTION_OUT', number: 'RJO/FY25-26/0001', date: '2025-05-09', vendor_name: 'Acme Supplies', grn_id: 'g1', lines: [{ id: 'rl1', name: 'Paper ream', quantity: 2, rate: 100, tax_rate: 18, grn_line_id: 'gl1' }] };
  const receipts = [grn, rj];
  // Before the bill: 12 in, 2 out.
  assert.equal(computeStock({ items, moves: [], invoices: [], purchases: [], returnDocs: { notes: [], receipts } })[0].qty, 10);
  const seed = billSeedFromGrn(grn, [], receipts);
  assert.deepEqual([seed.po_id, seed.lines[0].quantity, seed.lines[0].grn_line_id, seed.lines[0].po_line_id], ['po1', 10, 'gl1', 'pl1']);
  const billed = bill({ po_id: 'po1', lines: [{ id: 'l1', name: 'Paper ream', hsn: '4802', quantity: 10, rate: 110, tax_rate: 18, grn_line_id: 'gl1', po_line_id: 'pl1' }], taxable: 1100, cgst: 99, sgst: 99, total: 1298 });
  // After the bill: still 10 (not 20); valued at the bill rate; the stock entered on the GRN date.
  const pos = computeStock({ items, moves: [], invoices: [], purchases: [billed], returnDocs: { notes: [], receipts } })[0];
  assert.equal(pos.qty, 10);
  assert.equal(pos.value, 1100);
  assert.equal(computeStock({ items, moves: [], invoices: [], purchases: [billed], returnDocs: { notes: [], receipts }, asOf: '2025-05-08' })[0].qty, 12);
  assert.equal(grnStatus(grn, [billed], receipts).state, 'Billed');
  assert.equal(grnStatus(grn, [], receipts).pendingValue, 1000);
  assert.deepEqual(goodsReceivedNotBilled(receipts, [], '2025-05-20').map((r) => [r.pending, r.value, r.ageDays]), [[10, 1000, 12]]);
  assert.equal(goodsReceivedNotBilled(receipts, [billed], '2025-05-20').length, 0);
  // PO: 20 ordered, 10 accepted on the GRN → 10 outstanding, 15 days late on 20 May.
  const out = purchaseOrderOutstanding([po], [billed], receipts, '2025-05-20');
  assert.deepEqual(out.map((r) => [r.ordered, r.received, r.pending, r.overdueDays]), [[20, 10, 10, 15]]);
  assert.match(validateReceiptNote({ ...rj, lines: [{ ...rj.lines[0], quantity: 13 }] }, { purchases: [], notes: [grn] }), /only 12 can be rejected/);
});

test('receipt notes storage: numbering, billed GRN cannot be deleted', () => {
  const g = receiptNotesDb.save({ kind: 'GRN', date: '2025-05-08', vendor_name: 'Acme', lines: [{ id: 'gl1', name: 'Paper ream', quantity: 5, rate: 100, tax_rate: 18 }] }, []);
  assert.equal(g.number, 'GRN/FY25-26/0001');
  const b = bill({ lines: [{ id: 'l1', name: 'Paper ream', quantity: 5, rate: 100, tax_rate: 18, grn_line_id: 'gl1' }] });
  assert.throws(() => receiptNotesDb.remove(g.id, [b]), /Close it instead/);
  receiptNotesDb.remove(g.id, []);
  assert.equal(receiptNotesDb.all().length, 0);
});

test('Tally: a Debit Note voucher, Agst Ref the bill, balanced', () => {
  const build = buildTallyModel({ ...emptySource(), purchases: [bill()], vendors: [], purchaseReturns: [note()] }, { companyName: 'Co' });
  const dn = build.vouchers.find((v) => v.type === 'Debit Note')!;
  assert.ok(dn);
  assert.equal(voucherImbalance(dn), 0);
  assert.deepEqual(dn.entries.find((e) => e.ledger === 'Acme Supplies'), { ledger: 'Acme Supplies', side: 'Dr', paise: 35400, bill: { name: 'AS/22', type: 'Agst Ref' } });
  assert.ok(build.ledgers.some((l) => l.name === 'Purchase Returns' && l.parent === 'Purchase Accounts'));
  assert.match(buildTallyVouchersXml(build, { companyName: 'Co' }), /VCHTYPE="Debit Note"/);
});

test('Books: the note takes cost back in the accrual P&L and reduces payables and ITC', () => {
  const data = { ...EMPTY_BOOKS, purchases: [bill()] as never[], purchaseReturns: [note()] };
  const pl = profitAndLoss(data, { start: '2025-04-01', end: '2026-03-31' }, 'accrual');
  assert.equal(pl.netProfit, -700); // −1000 cost + 300 returned
  const bs = balanceSheet(data, '2026-03-31');
  assert.equal(bs.liabilities.payables, 826);
  assert.equal(booksReturnEffects([note()])[0].itc, 54);
});
