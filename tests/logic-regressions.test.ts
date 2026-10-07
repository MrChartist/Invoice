/**
 * Regression tests for defects found in the logic audit (docs/qa/logic.md).
 * Each test is named REGRESSION and fails on the code as it was before the fix.
 */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUYER_MH,
  SELLER,
  SELLER_GSTIN,
  clientMH,
  gstin,
} from './helpers/world.ts';
import { amountInWords } from '../src/lib/amount-in-words.ts';
import { mulRound2, pctOf, backOutPct, calculateInvoice, round2 } from '../src/lib/invoice-calc.ts';
import { csvCell, safeText, toCsv } from '../src/lib/csv.ts';
import * as download from '../src/lib/download.ts';
import * as books from '../src/lib/books.ts';
import * as recv from '../src/lib/receivables.ts';
import * as gstrJson from '../src/lib/gstr-json.ts';
import * as acct from '../src/lib/accounting-export.ts';
import { normalizeUnit, resolveStateText, parseDate, buildPreview } from '../src/lib/importers.ts';
import { parseTable } from '../src/lib/csv.ts';
import { guessMapping } from '../src/lib/import-mapping.ts';
import { readPurchase, readPurchaseLines, isVoidStatus } from '../src/lib/purchase-normalize.ts';
import { normalizePurchase as booksNorm } from '../src/lib/books.ts';
import { normalizePurchase as exportNorm, filterPurchases } from '../src/lib/export-shared.ts';
import { normalizePurchase as gstNorm } from '../src/lib/gst-reports.ts';
import { collectEvents } from '../src/lib/inventory.ts';
import { buildTallyModel, voucherImbalance } from '../src/lib/tally-xml.ts';
import { buildEway } from '../src/lib/eway.ts';
import { validateEway } from '../src/lib/einvoice-validate.ts';
import { buildEInvoice } from '../src/lib/einvoice.ts';
import { validateEInvoice } from '../src/lib/einvoice-validate.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import { buildCreditNote } from '../src/lib/documents.ts';
import { localDb } from '../src/lib/localDb.ts';
import { summarize, monthlyBilled } from '../src/lib/stats.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

/* ───────────────────────── money maths ───────────────────────── */

test('REGRESSION: tax of an exact half-paisa rounds HALF UP (11 x 1.5% = 0.165 -> 0.17, not 0.16)', () => {
  assert.equal(pctOf(11, 1.5), 0.17);
  assert.equal(pctOf(1000.25, 18), 180.05); // 180.045
  assert.equal(pctOf(0.25, 18), 0.05); // 0.045
  assert.equal(pctOf(-11, 1.5), -0.17);
  assert.equal(mulRound2(2.5, 1.01), 2.53); // 2.525
  assert.equal(mulRound2(1.5, 3.33), 5); // 4.995
  assert.equal(backOutPct(999, 18), 846.61);
  assert.equal(backOutPct(118, 18), 100);
  // end-to-end through the calculator
  const t = calculateInvoice({
    items: [{ id: 'a', name: 'x', type: 'g', quantity: 1, rate: 11, tax_rate: 1.5, amount: 11 }],
    gst_mode: 'IGST', discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0,
  });
  assert.equal(t.tax_amount, 0.17);
  assert.equal(t.total, 11.17);
});

test('REGRESSION: round2 rounds negatives symmetrically (a credit note mirrors its invoice to the paisa)', () => {
  assert.equal(round2(-2.345), -2.35);
  assert.equal(round2(2.345), 2.35);
  assert.equal(round2(-0.125), -0.13);
  assert.equal(round2(1.005), 1.01);
});

test('REGRESSION: an invoice-level discount on an all-negative document is never negative', () => {
  const t = calculateInvoice({
    items: [{ id: 'a', name: 'x', type: 'g', quantity: -1, rate: 100, tax_rate: 0, amount: 0 }],
    gst_mode: 'NONE', discount_type: 'AMOUNT', discount_rate: 50, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0,
  });
  assert.equal(t.invoice_discount_amount, 0);
});

/* ───────────────────────── words ───────────────────────── */

test('REGRESSION: amountInWords never prints "undefined" for amounts that round up to the next rupee', () => {
  assert.equal(amountInWords(19.999), 'Rupees Twenty Only');
  assert.equal(amountInWords(99999.995), 'Rupees One Lakh Only');
  assert.equal(amountInWords(0.5), 'Rupees Zero and Fifty Paise Only');
  assert.equal(amountInWords(0.004), 'Zero');
  assert.equal(amountInWords(-1234.5), 'Minus Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only');
  assert.equal(amountInWords(1234.57), 'Rupees One Thousand Two Hundred Thirty Four and Fifty Seven Paise Only');
  for (const n of [0.995, 1.995, 9.999, 99.999, 999.995, 12.345]) {
    assert.ok(!/undefined|NaN/.test(amountInWords(n)), `amountInWords(${n}) = ${amountInWords(n)}`);
  }
});

/* ───────────────────────── CSV ───────────────────────── */

test('REGRESSION: one CSV cell implementation everywhere; negatives stay numeric; formulas are neutralised', () => {
  // identity: every module re-exports the SAME functions
  assert.equal(download.csvCell, csvCell);
  assert.equal(download.toCsv, toCsv);
  assert.equal(books.toCsv, toCsv);
  assert.equal(recv.csvCell, csvCell);
  assert.equal(recv.toCsv, toCsv);
  assert.equal(gstrJson.csvCell, csvCell);
  assert.equal(acct.safeText, safeText);

  assert.equal(csvCell(-1250.5), '-1250.5'); // number stays a number
  assert.equal(csvCell('-1250.5'), '-1250.5'); // numeric-looking text too
  assert.equal(csvCell('(1,200.00)'), '"(1,200.00)"');
  assert.equal(csvCell('+91 98765-43210'), '+91 98765-43210'); // phone numbers are not mangled
  for (const evil of ['=HYPERLINK("http://x")', '=1+1', '@SUM(A1)', '+cmd|calc', '-2+3', '\t=1', '\r=1']) {
    assert.ok(csvCell(evil).replace(/^"/, '').startsWith("'"), `${JSON.stringify(evil)} -> ${csvCell(evil)}`);
  }
  assert.equal(csvCell('Acme, "Ltd"'), '"Acme, ""Ltd"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(Number.NaN), '');
  assert.equal(csvCell(Number.POSITIVE_INFINITY), '');
  assert.equal(toCsv([['a', -1], ['=x', 2]]), "a,-1\r\n'=x,2");
  // books / receivables used to leave "-5" TEXT quoted with an apostrophe; and receivables printed NaN
  assert.equal(books.dayBookCsv([]), 'Date,Voucher type,Vch no.,Particulars,Narration,Debit,Credit');
});

/* ───────────────────────── import: prototype-shaped keys ───────────────────────── */

test('REGRESSION: importer lookups ignore Object.prototype keys ("constructor") instead of crashing or returning functions', () => {
  assert.equal(normalizeUnit('constructor'), 'CONSTRUCTOR');
  assert.equal(typeof normalizeUnit('Constructor'), 'string');
  assert.doesNotThrow(() => resolveStateText('constructor'));
  assert.equal(resolveStateText('constructor'), undefined);
  assert.doesNotThrow(() => resolveStateText('Con')); // squashes to 3 letters
  assert.equal(parseDate('5 constructor 2025'), null);
  assert.equal(parseDate('Constructor 5, 2025'), null);
  assert.equal(parseDate('5 Mar 2025'), '2025-03-05');
  assert.equal(normalizeUnit('Kgs'), 'KG');
});

/* ───────────────────────── one purchase reader for every module ───────────────────────── */

const bill = {
  id: 'p1', kind: 'PURCHASE', vendor_name: 'Acme Supplies', vendor_gstin: gstin('27AAPFU0939F1Z'), bill_number: 'AS/22',
  date: '2026-04-12', place_of_supply: '27', category: 'Purchases',
  lines: [{ id: 'l1', name: 'Paper ream', hsn: '4802', unit: 'NOS', quantity: 10, rate: 100, tax_rate: 18 }],
  taxable: 1000, cgst: 90, sgst: 90, igst: 0, itc_eligible: true, total: 1180, amount_paid: 0,
};

test('REGRESSION: books, GST, exports and inventory read a purchase identically (one shared reader)', () => {
  const core = readPurchase(bill)!;
  assert.deepEqual(
    [core.date, core.taxable, core.cgst, core.sgst, core.igst, core.tax, core.total, core.itcEligible, core.isExpense],
    ['2026-04-12', 1000, 90, 90, 0, 180, 1180, true, false],
  );
  const b = booksNorm(bill as never)!;
  const e = exportNorm(bill)!;
  const g = gstNorm(bill, '27')!;
  for (const view of [
    [b.date, e.date, g.date],
    [b.taxable, e.taxable, g.taxable],
    [b.cgst, e.cgst, g.cgst],
    [b.sgst, e.sgst, g.sgst],
    [b.total, e.total, 1180],
  ]) assert.ok(view.every((v) => v === view[0]), JSON.stringify(view));
  assert.equal(b.number, e.number);
  assert.equal(e.number, g.number);
  // legacy / aliased spellings still read
  const legacy = { id: 'x', bill_date: '2026-05-01', supplier_name: 'Old Co', taxable_value: 200, gst_amount: 36, grand_total: 236 };
  assert.deepEqual([readPurchase(legacy)!.taxable, readPurchase(legacy)!.tax, readPurchase(legacy)!.total], [200, 36, 236]);
  assert.equal(readPurchase({ ...legacy, bill_date: undefined, date: undefined }), null, 'no date = not a bill');
});

test('REGRESSION: draft / cancelled / void bills are excluded by EVERY consumer (exports used to keep drafts)', () => {
  for (const status of ['draft', 'Cancelled', 'canceled', 'VOID']) {
    const row = { ...bill, status };
    assert.ok(isVoidStatus(status));
    assert.equal(booksNorm(row as never), null, `books ${status}`);
    assert.equal(gstNorm(row, '27'), null, `gst ${status}`);
    assert.equal(filterPurchases([row], [], {}).length, 0, `exports ${status}`);
    const ev = collectEvents({
      items: [{ id: 's', name: 'Paper ream', hsn: '4802', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }],
      moves: [], invoices: [], purchases: [row] as never,
    });
    assert.equal((ev.get('s') ?? []).length, 0, `inventory ${status}`);
  }
  assert.equal(filterPurchases([bill], [], {}).length, 1);
});

test('REGRESSION: an EXPENSE bill never adds stock, even when a line shares a stock item\'s name', () => {
  const ev = collectEvents({
    items: [{ id: 's', name: 'Paper ream', hsn: '4802', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }],
    moves: [], invoices: [], purchases: [{ ...bill, kind: 'EXPENSE' }] as never,
  });
  assert.equal((ev.get('s') ?? []).length, 0);
  assert.equal(readPurchaseLines(bill)[0].unitCost, 100);
});

test('REGRESSION: Tally posts GST on a bill with BLOCKED ITC into the purchase cost, not to "Input GST"', () => {
  const blocked = { ...bill, itc_eligible: false };
  const t = buildTallyModel({ invoices: [], payments: [], clients: [], items: [], purchases: [blocked, bill], vendors: [] }, { companyName: 'X' });
  const [vBlocked, vOk] = t.vouchers.filter((v) => v.type === 'Purchase').sort((a, b) => Number(!!a.entries.find((e) => e.ledger === 'Input CGST')) - Number(!!b.entries.find((e) => e.ledger === 'Input CGST')));
  const ledger = (v: typeof vOk, name: string) => v.entries.filter((e) => e.ledger === name).reduce((s, e) => s + e.paise, 0);
  assert.equal(ledger(vBlocked, 'Purchases'), 118000); // 1,000 + 180 GST all cost
  assert.equal(ledger(vBlocked, 'Input CGST'), 0);
  assert.equal(ledger(vOk, 'Purchases'), 100000);
  assert.equal(ledger(vOk, 'Input CGST'), 9000);
  assert.equal(voucherImbalance(vBlocked), 0);
  assert.equal(voucherImbalance(vOk), 0);
});

/* ───────────────────────── e-Way / e-Invoice details ───────────────────────── */

const goodsInvoice = (over: Partial<InvoiceRecord> = {}): InvoiceRecord =>
  normalizeRecord({
    id: 'g1', invoice_number: 'INV/FY26-27/0001', issue_date: '2026-04-10', due_date: '2026-04-24', status: 'Sent', doc_type: 'INVOICE',
    sender: SELLER, client: { ...clientMH, gstin: BUYER_MH }, gst_mode: 'CGST_SGST', place_of_supply: '27', currency: 'INR',
    items: [{ id: 'i1', name: 'Steel', hsn: '730890', unit: 'KG', quantity: 100, rate: 1000, tax_rate: 28, cess_rate: 12, cess_per_unit: 1, amount: 100000 }],
    discount_type: 'PERCENT', discount_rate: 0, tax_rate: 28, shipping: 500, other_charges: 0, round_off_enabled: false,
    tcs_enabled: true, tcs_rate: 1, tcs_base: 'total', ...over,
  });

test('REGRESSION: e-Way bill carries cess and TCS so its value breakup reconciles with the invoice total', () => {
  const inv = goodsInvoice();
  // taxable 100,000; GST 28% 28,000; cess 12% = 12,000 + 100 x 1 = 100 fixed; freight 500
  // before TCS = 100,000 + 28,000 + 12,100 + 500 = 140,600 ; TCS 1% of total = 1,406 ; total 142,006
  const { bill } = buildEway(inv);
  assert.equal(bill.cessValue, 12000);
  assert.equal(bill.TotNonAdvolVal, 100);
  assert.equal(bill.OthValue, 1906); // freight 500 + TCS 1,406
  assert.equal(bill.totInvValue, 142006);
  const parts = bill.totalValue + bill.cgstValue + bill.sgstValue + bill.igstValue + bill.cessValue + bill.TotNonAdvolVal + bill.OthValue;
  assert.equal(parts, bill.totInvValue);
  assert.equal(bill.itemList[0].cessRate, 12);
  assert.equal(bill.itemList[0].cessNonadvol, 100);
  assert.equal(validateEway(bill).filter((i) => i.code === 'EWB_RECONCILE').length, 0);
});

test('REGRESSION: e-Invoice for a deemed export is a DOMESTIC supply (not an overseas URP buyer)', () => {
  const inv = goodsInvoice({ supply_type: 'DEEMED_EXPORT', tcs_enabled: false });
  const { payload } = buildEInvoice(inv);
  assert.equal(payload.TranDtls.SupTyp, 'DEXP');
  assert.equal(payload.BuyerDtls.Gstin, BUYER_MH);
  assert.equal(payload.BuyerDtls.Stcd, '27');
  const issues = validateEInvoice(payload, inv).map((i) => i.code);
  assert.ok(!issues.includes('EXPORT_COUNTRY'));
});

test('REGRESSION: tax-inclusive lines go to the IRP ex-tax so TotAmt - Discount = AssAmt', () => {
  const inv = goodsInvoice({ price_includes_tax: true, tcs_enabled: false, shipping: 0 });
  const { payload } = buildEInvoice(inv);
  const it = payload.ItemList[0];
  assert.ok(Math.abs(it.TotAmt - it.Discount - it.AssAmt) < 0.011);
  assert.ok(Math.abs(it.Qty * it.UnitPrice - it.TotAmt) < 0.5);
  const codes = validateEInvoice(payload, inv).map((i) => i.code);
  for (const c of ['ITEM_ASSAMT', 'ITEM_TOTAMT', 'ITEM_TOTVAL', 'SUM_TOTAL']) assert.ok(!codes.includes(c), c);
});

test('REGRESSION: GSTR-1 JSON carries cess (csamt) instead of a hard-coded 0', () => {
  // exercised end-to-end in tests/integration/supply-types.test.ts; here the builder alone
  const json = gstrJson.buildGstr1Json({
    period: { kind: 'month', fyStart: 2026, month: 4 }, gstin: SELLER_GSTIN, fp: '042026',
    b2b: [{ invoiceId: 'a', number: 'N1', date: '2026-04-10', value: 1, pos: '27', rchrg: 'N', partyName: 'x', ctin: BUYER_MH, taxable: 100, igst: 0, cgst: 9, sgst: 9, invTyp: 'SEWOP',
      items: [{ rate: 18, txval: 100, igst: 0, cgst: 9, sgst: 9, cess: 7.5 }] }],
    b2cl: [], b2cs: [], cdnr: [], cdnur: [], exp: [], nil: [], hsn: [], docIssue: [],
    totals: { taxable: 100, igst: 0, cgst: 9, sgst: 9, value: 1 }, counts: { included: 1, drafts: 0, cancelled: 0, notTaxDocs: 0 },
  } as never) as { b2b: { inv: { inv_typ: string; itms: { itm_det: { csamt: number } }[] }[] }[] };
  assert.equal(json.b2b[0].inv[0].inv_typ, 'SEWOP');
  assert.equal(json.b2b[0].inv[0].itms[0].itm_det.csamt, 7.5);
});

/* ───────────────────────── documents ───────────────────────── */

test('REGRESSION: converting / crediting a recurring-generated invoice does not inherit its recurring stamp', () => {
  const inv = normalizeRecord({
    id: 'r1', invoice_number: 'INV/FY26-27/0001', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-04-10', due_date: '2026-04-24',
    sender: SELLER, client: clientMH, gst_mode: 'CGST_SGST', place_of_supply: '27', round_off_enabled: true,
    items: [{ id: 'i1', name: 'Retainer', hsn: '998311', quantity: 2, rate: 5000, tax_rate: 18, amount: 10000 }],
    discount_type: 'PERCENT', discount_rate: 0, tax_rate: 18, recurring_id: 'sched-1', recurring_date: '2026-04-10',
    total: 11800,
  });
  const out = buildCreditNote(inv, { lines: [{ itemId: 'i1', quantity: 1 }], reason: 'Sales return' }, [], [inv], { id: 'c1', invoice_number: 'CRN/1', today: '2026-04-20' });
  assert.ok(out.record, out.errors.join());
  assert.equal(out.record!.recurring_id, undefined);
  assert.equal(out.record!.recurring_date, undefined);
  assert.equal(out.record!.total, 5900);
});

/* ───────────────────────── CRM / catalogue / currency ───────────────────────── */

test('REGRESSION: typing an existing client\'s name again must not wipe its GSTIN / phone / address', () => {
  localStorage.clear();
  const id = localDb.clients.upsert({ id: 'c1', name: 'Bharat Traders', gstin: BUYER_MH, phone: '9820012345', address: '5 MG Road', city: 'Pune' });
  // an invoice saved with the name typed in lower case and nothing else filled in
  const same = localDb.clients.upsert({ name: 'bharat traders', gstin: '', phone: '', address: '', city: '' });
  assert.equal(same, id, 'same party, not a duplicate row');
  const row = localDb.clients.getById(id)!;
  assert.equal(row.gstin, BUYER_MH);
  assert.equal(row.phone, '9820012345');
  assert.equal(row.address, '5 MG Road');
  assert.equal(localDb.clients.getAll().length, 1);
  // an explicit edit by id may still clear a field
  localDb.clients.upsert({ id, name: 'Bharat Traders', phone: '' });
  assert.equal(localDb.clients.getById(id)!.phone, '');
});

test('REGRESSION: renaming client A to the name of client B edits A, it does not merge into B', () => {
  localStorage.clear();
  localDb.clients.upsert({ id: 'b', name: 'Beta Ltd', gstin: BUYER_MH });
  localDb.clients.upsert({ id: 'a', name: 'Alpha Ltd', gstin: '' });
  localDb.clients.upsert({ id: 'a', name: 'Beta Ltd', phone: '1' }); // user types B's name into A's form
  const rows = localDb.clients.getAll();
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.id === 'a')!.phone, '1');
  assert.equal(rows.find((r) => r.id === 'b')!.gstin, BUYER_MH, 'B is untouched');
});

test('REGRESSION: saving an invoice line without an HSN does not erase the catalogue HSN', () => {
  localStorage.clear();
  localDb.items.upsert({ name: 'Consulting', hsn: '998311', unit: 'HRS', rate: 1000, tax_rate: 18, type: 'Service' });
  localDb.items.upsert({ name: 'consulting', hsn: '', unit: undefined, rate: 1200, tax_rate: 18, type: 'Service' });
  const [row] = localDb.items.getAll();
  assert.equal(row.hsn, '998311');
  assert.equal(row.unit, 'HRS');
  assert.equal(row.rate, 1200); // the latest price is still learned
});

test('REGRESSION: the dashboard never adds USD to INR (summarize / monthlyBilled take a currency)', () => {
  const mk = (id: string, total: number, currency: string) =>
    ({ id, doc_type: 'INVOICE', status: 'Sent', total, amount_paid: 0, balance_due: total, currency, issue_date: '2026-04-05', due_date: '2026-04-20' }) as never;
  const rows = [mk('a', 1000, 'INR'), mk('b', 1000, 'USD'), mk('c', 500, '')];
  const now = new Date('2026-04-10T10:00:00');
  assert.equal(summarize(rows, now, [], 'INR').billed, 1500);
  assert.equal(summarize(rows, now, [], 'USD').billed, 1000);
  assert.equal(monthlyBilled(rows, 1, now, 'INR')[0].billed, 1500);
  assert.equal(monthlyBilled(rows, 1, now, 'usd')[0].billed, 1000);
});

test('REGRESSION: an imported "Overdue" invoice is stored as Sent (Overdue is derived from the due date, never stored)', () => {
  const table = parseTable('Invoice No,Date,Customer,Total,Status\nA1,01/04/2026,Zed,"1,000",Overdue');
  const guess = guessMapping('invoices', table.headers, table.rows);
  const preview = buildPreview({
    kind: 'invoices', table, mapping: guess.mapping, existing: { clients: [], items: [], invoices: [] }, options: { senderStateCode: '27' },
  });
  const inv = preview.rows[0].record as InvoiceRecord;
  assert.equal(inv.status, 'Sent');
  assert.equal(inv.balance_due, 1000);
});
