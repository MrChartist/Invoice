/**
 * Independent GST / accounting review — one regression per finding (items 1–14). The cross-module
 * dataset (RCM outward / inward agreement across every report) is in gst-review-cross.test.ts.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { SELLER_GSTIN, BUYER_SEZ_GJ, clientMH, createViaStore, installSettings, reload } from './helpers/world.ts';
import { calcInputFromRecord, calculateInvoice } from '../src/lib/invoice-calc.ts';
import { computeSetOff, buildGstReport, normalizePurchase as gstNormalize, type ReportPeriod } from '../src/lib/gst-reports.ts';
import { buildGstr1Json } from '../src/lib/gstr-json.ts';
import { buildGstr9 } from '../src/lib/gstr9.ts';
import { documentTurnover } from '../src/lib/composition-returns.ts';
import { buildLateFeeInvoice, buildLateFeeItem, principalItem, computeClientLateFee } from '../src/lib/late-fee.ts';
import { interestInputFor } from '../src/lib/interest.ts';
import { localDb } from '../src/lib/localDb.ts';
import { buildCreditNote, createCreditNote, readLinks } from '../src/lib/documents.ts';
import { blankStockItem, collectEvents, loadPositions, stockDb } from '../src/lib/inventory.ts';
import { docTrackingIssues } from '../src/lib/stock-tracking.ts';
import { creditNoteReturnsGoods, reasonReturnsGoods } from '../src/lib/credit-restock.ts';
import { itemProfitability } from '../src/lib/profitability.ts';
import { summarize, monthlyBilled } from '../src/lib/stats.ts';
import { effectiveStatus } from '../src/lib/invoice-status.ts';
import { tcsPresets, tdsSections } from '../src/lib/tax-rules.ts';
import { buildPosRecord } from '../src/lib/pos.ts';
import { isNonSupplyCategory, supplierPayable, selfAssessedTaxOf, readPurchase } from '../src/lib/purchase-normalize.ts';
import { balanceOf, payablesOutstanding } from '../src/lib/purchases.ts';
import { msmeBills } from '../src/lib/msme.ts';
import { vendorBalances } from '../src/lib/vendors.ts';
import { normalizePurchase as booksNormalize, gstSummary, EMPTY_BOOKS } from '../src/lib/books.ts';
import { normalizePurchase as exportNormalize } from '../src/lib/export-shared.ts';
import { receivableBalance, receivableTotal, supplierView } from '../src/lib/rcm.ts';
import { isRcmTotals, rcmTaxNote } from '../src/components/templates/paper-helpers.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import type { InvoiceRecord, SenderProfile } from '../src/types/invoice.ts';
import type { PurchaseRecord, Vendor } from '../src/types/purchases.ts';

beforeEach(() => resetStorage());

const MAY: ReportPeriod = { kind: 'month', fyStart: 2025, month: 5 };
const REGULAR = { companyName: 'Regular Co', companyGstin: SELLER_GSTIN, stateCode: '27' } as SenderProfile;
let seq = 0;
const item = (name: string, qty: number, rate: number, tax: number, hsn = '998311', type = 'service') =>
  ({ id: `i${++seq}`, name, type, hsn, unit: 'NOS', quantity: qty, rate, tax_rate: tax, amount: qty * rate });
function doc(over: Partial<InvoiceRecord>): InvoiceRecord {
  const base = {
    id: `d${++seq}`, invoice_number: `INV/FY25-26/${String(++seq).padStart(4, '0')}`, doc_type: 'TAX_INVOICE', issue_date: '2025-05-05',
    due_date: '2025-05-20', status: 'Sent', currency: 'INR', template_id: 't', client: { name: 'Buyer', email: '', address: '', city: '', zip: '' },
    sender: REGULAR, items: [], gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT',
    discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, notes: '', terms: '',
    ...over,
  } as InvoiceRecord;
  const t = calculateInvoice(calcInputFromRecord(base));
  return { ...base, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due, cess_amount: t.cess_amount };
}
const bill = (over: Partial<PurchaseRecord>): PurchaseRecord => ({
  id: `p${++seq}`, kind: 'PURCHASE', vendor_name: 'V', bill_number: `B${seq}`, date: '2025-05-08', category: 'Purchases',
  lines: [], taxable: 10000, cgst: 900, sgst: 900, igst: 0, itc_eligible: true, total: 11800, amount_paid: 0, ...over,
});

/* ── 1. Outward reverse charge ───────────────────────────────────────── */

test('1: the calculator leaves recipient-paid GST out of total / payable / balance, but still computes it', () => {
  const rec = doc({ reverse_charge: true, rcm_tax_excluded: true, items: [item('Transport', 1, 1000, 5, '996511')], tcs_enabled: true, tcs_rate: 1 });
  const t = calculateInvoice(calcInputFromRecord(rec));
  assert.deepEqual([t.taxable_value, t.cgst_amount, t.sgst_amount, t.tax_amount, t.rcm_tax], [1000, 25, 25, 50, 50]);
  assert.equal(t.tcs_amount, 10, 'TCS base leaves out the tax the supplier does not collect');
  assert.equal(t.total, 1010);
  assert.equal(t.balance_due, 1010);
  // A legacy record (no marker) recalculates exactly as stored: the template never changes.
  const legacy = doc({ reverse_charge: true, items: [item('Transport', 1, 1000, 5, '996511')] });
  assert.equal(legacy.total, 1050);
  assert.equal(calculateInvoice(calcInputFromRecord(legacy)).total, 1050);
  assert.equal(calculateInvoice(calcInputFromRecord(legacy)).rcm_tax, 0);
  // Bill of Supply: never reverse charge.
  const bos = calculateInvoice(calcInputFromRecord({ ...rec, doc_type: 'BILL_OF_SUPPLY' }));
  assert.equal(bos.rcm_tax, 0);
});

test('1: readers adapt older reverse-charge records without rewriting them', () => {
  const legacy = doc({ reverse_charge: true, items: [item('Transport', 1, 1000, 5, '996511')] });
  assert.equal(receivableTotal(legacy), 1000);
  assert.equal(receivableBalance(legacy), 1000);
  const view = supplierView(legacy);
  assert.deepEqual([view.total, view.tax_amount, view.cgst_amount, view.balance_due], [1000, 0, 0, 1000]);
  assert.equal(legacy.total, 1050, 'input untouched');
  const paid = { ...legacy, amount_paid: 1000, balance_due: 50 };
  assert.equal(effectiveStatus({ ...paid, status: 'Sent', due_date: '2025-01-01' }, new Date(2025, 5, 1)), 'Paid');
  const s = summarize([paid], new Date(2025, 5, 1));
  assert.deepEqual([s.billed, s.received, s.outstanding], [1000, 1000, 0]);
  assert.equal(monthlyBilled([paid], 1, new Date(2025, 4, 20))[0].billed, 1000);
  // Forward-charge documents are untouched by the helpers.
  const normal = doc({ items: [item('Consulting', 1, 1000, 18)] });
  assert.equal(receivableTotal(normal), 1180);
  assert.equal(supplierView(normal), normal);
});

test('1: the editor saves new reverse-charge documents without the tax in the total; a recorded payment settles the taxable value', () => {
  installSettings();
  freezeDate('2025-05-10T10:00:00');
  try {
    const rec = createViaStore({ date: '2025-05-10', client: clientMH, reverseCharge: true, lines: [{ qty: 1, rate: 1000, tax: 5, hsn: '996511' }] });
    assert.deepEqual([rec.total, rec.balance_due, rec.tax_amount, rec.rcm_tax_excluded], [1000, 1000, 50, true]);
    const old = createViaStore({ date: '2025-05-10', client: clientMH, reverseCharge: true, patch: { rcm_tax_excluded: undefined }, lines: [{ qty: 1, rate: 1000, tax: 5, hsn: '996511' }] });
    assert.equal(old.total, 1050);
    localDb.payments.record({ invoiceId: old.id, amount: 1000, method: 'UPI', date: '2025-05-11' });
    const after = reload(old.id);
    assert.equal(after.status, 'Paid');
    assert.equal(after.total, 1050, 'stored total never rewritten');
    // A credit note against the new-style document is itself new-style.
    const cn = createCreditNote(rec, { lines: [{ itemId: rec.items[0].id, quantity: 1 }], reason: 'Discount' });
    assert.deepEqual([cn.total, cn.rcm_tax_excluded], [1000, true]);
  } finally {
    thawDate();
  }
});

test('1: the paper prints the tax as payable by the recipient (Rule 46(p)) only for new-style documents', () => {
  const t = calculateInvoice(calcInputFromRecord(doc({ reverse_charge: true, rcm_tax_excluded: true, items: [item('Transport', 1, 1000, 5, '996511')] })));
  assert.equal(isRcmTotals(t), true);
  const note = rcmTaxNote(t, (n) => `₹${n.toFixed(2)}`);
  assert.match(note, /Tax payable by the recipient under reverse charge/);
  assert.match(note, /CGST ₹25\.00, SGST ₹25\.00, total ₹50\.00/);
  assert.match(note, /Not included in the amount payable/);
  const legacy = calculateInvoice(calcInputFromRecord(doc({ reverse_charge: true, items: [item('Transport', 1, 1000, 5, '996511')] })));
  assert.equal(rcmTaxNote(legacy, String), '');
  const engine = readFileSync(new URL('../src/components/templates/TemplateEngine.tsx', import.meta.url), 'utf8');
  assert.match(engine, /\{rcmNote && <SupplyDeclaration text=\{rcmNote\} \/>\}/);
  assert.equal(normalizeRecord({ reverse_charge: true, rcm_tax_excluded: true }).rcm_tax_excluded, true);
  assert.equal(normalizeRecord({ reverse_charge: false, rcm_tax_excluded: true }).rcm_tax_excluded, undefined);
});

/* ── 2. Inward reverse charge / imports: supplier payable ─────────────── */

test('2: supplierPayable takes self-assessed GST out of what the supplier is owed (all readers)', () => {
  const rcm = bill({ reverse_charge: true, amount_paid: 10000 });
  const imp = bill({ import_type: 'GOODS', cgst: 0, sgst: 0, igst: 1800 });
  const svc = bill({ import_type: 'SERVICES', cgst: 0, sgst: 0, igst: 1800 });
  const fwd = bill({});
  const taxableOnly = bill({ reverse_charge: true, total: 10000 }); // an imported row without the tax in its total
  assert.deepEqual([rcm, imp, svc, fwd, taxableOnly].map(supplierPayable), [10000, 10000, 10000, 11800, 10000]);
  assert.equal(selfAssessedTaxOf(readPurchase(taxableOnly)!), 0);
  assert.equal(balanceOf(rcm), 0);
  assert.equal(payablesOutstanding([rcm, imp, fwd]), 21800);
  assert.equal(booksNormalize(rcm as never)!.payable, 10000);
  assert.equal(booksNormalize(rcm as never)!.total, 11800, 'bill total unchanged');
  const ex = exportNormalize(imp)!;
  assert.deepEqual([ex.payable, ex.selfTax, ex.selfTaxKind], [10000, 1800, 'CUSTOMS']);
  assert.equal(exportNormalize(svc)!.selfTaxKind, 'RCM');
  const vendor: Vendor = { id: 'v1', name: 'Small Co', msme_udyam: 'UDYAM-MH-00-0000001', msme_category: 'MICRO' };
  const msme = msmeBills([{ ...rcm, vendor_id: 'v1', amount_paid: 0 }], [vendor], [], '2025-06-30');
  assert.equal(msme[0].total, 10000, 'MSME tracker: the MSE is owed the taxable value');
  const v = vendorBalances([{ ...rcm, vendor_id: 'v1' }]).get('v1')!;
  assert.deepEqual([v.billed, v.outstanding], [10000, 0]);
});

test('2: Books net GST includes the reverse-charge liability (customs IGST is not a 3B liability)', () => {
  const data = { ...EMPTY_BOOKS, purchases: [bill({ reverse_charge: true }), bill({ import_type: 'GOODS', cgst: 0, sgst: 0, igst: 1800 })] };
  const g = gstSummary(data as never, { start: '2025-04-01', end: '2026-03-31' });
  assert.equal(g.itc, 3600);
  assert.equal(g.rcmPayable, 1800);
  assert.equal(g.netPayable, -1800, 'output 0 + RCM 1,800 − ITC 3,600');
});

/* ── 3. Set-off (Sec 49A / Rule 88A) ─────────────────────────────────── */

test('3: leftover IGST credit covers the head its own credit cannot, no needless cash', () => {
  const r = computeSetOff({ igst: 0, cgst: 100, sgst: 100 }, { igst: 100, cgst: 100, sgst: 0 });
  assert.deepEqual(r.cash, { igst: 0, cgst: 0, sgst: 0 });
  assert.deepEqual(r.itcUsed.igst, { igst: 0, cgst: 0, sgst: 100 });
  assert.deepEqual(r.itcUsed.cgst, { cgst: 100, igst: 0 });
  // IGST credit is used up before CGST / SGST credit (Rule 88A), the rest carries forward.
  const r2 = computeSetOff({ igst: 0, cgst: 100, sgst: 100 }, { igst: 300, cgst: 50, sgst: 50 });
  assert.deepEqual(r2.cash, { igst: 0, cgst: 0, sgst: 0 });
  assert.deepEqual(r2.itcUsed.igst, { igst: 0, cgst: 100, sgst: 100 });
  assert.deepEqual(r2.itcCarry, { igst: 100, cgst: 50, sgst: 50 });
});

/* ── 4. Credit notes move stock only for goods returned ───────────────── */

test('4: a discount / rate-difference credit note neither restocks nor returns serials nor reverses COGS', () => {
  installSettings();
  freezeDate('2025-04-20T10:00:00');
  try {
    stockDb.saveItem(blankStockItem({ id: 's1', name: 'Widget', hsn: '8471', opening_qty: 10, opening_rate: 100, track_stock: true }));
    const sale = createViaStore({ date: '2025-04-15', client: clientMH, lines: [{ name: 'Widget', hsn: '8471', qty: 5, rate: 200, tax: 18 }] });
    const rate = createCreditNote(reload(sale.id), { lines: [{ itemId: reload(sale.id).items[0].id, quantity: 5 }], reason: 'Rate difference' });
    assert.equal(rate.goods_returned, false);
    const qty = () => loadPositions().find((p) => p.item.id === 's1')!.qty;
    assert.equal(qty(), 5, 'the rate-difference note brought nothing back');
    // Profitability: revenue down, cost and quantity untouched.
    const prof = itemProfitability({ invoices: localDb.invoices.getAll(), purchases: [], positions: loadPositions(), links: readLinks() }, { start: '2025-04-01', end: '2026-03-31' });
    const w = prof.rows.find((r) => r.name === 'Widget')!;
    assert.deepEqual([w.quantity, w.revenue, w.cost], [5, 0, 500]);
    // A sales return (the default for that reason) does bring the goods back.
    const sale2 = createViaStore({ date: '2025-04-16', client: clientMH, lines: [{ name: 'Widget', hsn: '8471', qty: 2, rate: 200, tax: 18 }] });
    const ret = createCreditNote(reload(sale2.id), { lines: [{ itemId: reload(sale2.id).items[0].id, quantity: 1 }], reason: 'Sales return' });
    assert.equal(ret.goods_returned, true);
    assert.equal(qty(), 4);
    // The explicit box wins over the reason.
    const sale3 = createViaStore({ date: '2025-04-17', client: clientMH, lines: [{ name: 'Widget', hsn: '8471', qty: 1, rate: 200, tax: 18 }] });
    createCreditNote(reload(sale3.id), { lines: [{ itemId: reload(sale3.id).items[0].id, quantity: 1 }], reason: 'Discount', goodsReturned: true });
    assert.equal(qty(), 4);
  } finally {
    thawDate();
  }
});

test('4: older credit notes (no flag) follow their reason; serials are not returned without goods', () => {
  assert.equal(reasonReturnsGoods('Sales return'), true);
  assert.equal(reasonReturnsGoods('Discount'), false);
  assert.equal(reasonReturnsGoods('GST correction'), false);
  assert.equal(reasonReturnsGoods('Damaged in transit'), true, 'a custom reason keeps the old behaviour');
  const note = { id: 'n1', doc_type: 'CREDIT_NOTE' };
  assert.equal(creditNoteReturnsGoods(note, [{ to_id: 'n1', relation: 'credit_note', reason: 'Discount' }]), false);
  assert.equal(creditNoteReturnsGoods({ ...note, notes: 'Credit note against Invoice X dated 2025-04-01. Reason: Rate difference.' }), false);
  assert.equal(creditNoteReturnsGoods(note), true, 'nothing known: legacy behaviour');
  assert.equal(creditNoteReturnsGoods({ ...note, goods_returned: false }, [{ to_id: 'n1', relation: 'credit_note', reason: 'Sales return' }]), false);
  // buildCreditNote drops serials when no goods come back.
  const inv = doc({ items: [{ ...item('Phone', 2, 100, 18, '8517', 'goods'), serials: ['S1', 'S2'] }] });
  const { record } = buildCreditNote(inv, { lines: [{ itemId: inv.items[0].id, quantity: 2 }], reason: 'Discount' }, [], [inv], { id: 'cn', invoice_number: 'CRN/1', today: '2025-05-06' });
  assert.equal(record!.items[0].serials, undefined);
  // Stock events / tracking checks skip such a note.
  const items = [{ id: 's', name: 'Phone', hsn: '8517', unit: 'NOS', track_stock: true, track_serials: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }];
  const ev = collectEvents({ items, moves: [], invoices: [record!] });
  assert.equal(ev.get('s')!.length, 0);
  assert.deepEqual(docTrackingIssues(record!, { items, moves: [], invoices: [] }).errors, []);
});

/* ── 5. Composition: service providers pay on taxable supplies only ───── */

test('5: a Sec 10(2A) service provider pays 6% on taxable supplies only (exempt stays exempt)', () => {
  const rec = doc({ doc_type: 'BILL_OF_SUPPLY', gst_mode: 'NONE', sender: { ...REGULAR, gst_scheme: 'composition', composition_category: 'service' } as SenderProfile, items: [item('Taxable svc', 1, 1000, 18), item('Exempt svc', 1, 1000, 0)] });
  assert.deepEqual(documentTurnover(rec), { value: 2000, exempt: 1000, base: 1000, rate: 6 });
  const mfr = doc({ ...rec, sender: { ...REGULAR, gst_scheme: 'composition', composition_category: 'manufacturer' } as SenderProfile });
  assert.equal(documentTurnover(mfr).base, 2000, 'manufacturers still pay on the whole turnover');
});

/* ── 6. Late fee: HSN / type of the principal supply; INR document ────── */

test('6: the late-fee line carries the principal supply HSN / type and is an INR line on an INR invoice', () => {
  const orig = doc({ currency: 'USD', exchange_rate: 80, due_date: '2025-04-10', items: [item('Small', 1, 100, 18, '998313'), item('Main', 1, 900, 18, '998311'), item('Goods', 1, 500, 12, '8471', 'goods')] });
  assert.equal(principalItem(orig.items)!.name, 'Main');
  const pct = { mode: 'percent_pa' as const, rate: 36.5, graceDays: 0 };
  const quote = computeClientLateFee(interestInputFor(orig, [], [], [orig]), pct, '2025-04-20');
  const line = buildLateFeeItem(quote, pct, orig)!;
  assert.equal(line.hsn, '998311');
  assert.equal(line.type, 'service');
  assert.equal(line.rate, Math.round(quote.amount * 80 * 100) / 100, 'interest converted to rupees at the original rate');
  const rec = buildLateFeeInvoice(orig, line, { id: 'lf', invoice_number: 'INV/FY25-26/0099', today: '2025-04-21', dueDays: 7 });
  assert.equal(rec.currency, 'INR');
  assert.equal(rec.exchange_rate, undefined);
  const flat = { mode: 'flat' as const, rate: 500, graceDays: 0 };
  assert.equal(buildLateFeeItem(computeClientLateFee(interestInputFor(orig, [], [], [orig]), flat, '2025-04-20'), flat, orig)!.rate, 500);
});

/* ── 7. GSTR-9 amendments ─────────────────────────────────────────────── */

test('7: GSTR-9 4K / 4L carry in-year amendments so 4N agrees with Table 9', () => {
  const original = doc({ id: 'a1', invoice_number: 'INV/FY25-26/0001', issue_date: '2025-04-05', client: { name: 'MH Co', gstin: clientMH.gstin, email: '', address: '', city: '', zip: '' }, items: [item('Laptops', 10, 1000, 18, '8471', 'goods')] });
  const up = doc({ ...original, items: [{ ...original.items[0], quantity: 12, amount: 12000 }], amends: { original_number: original.invoice_number, original_date: '2025-04-05', period: '042025', amended_on: '2025-06-20', original } });
  const g9 = buildGstr9([up], [], { fyStart: 2025, gstin: SELLER_GSTIN });
  const row = (id: string) => g9.table4.find((r) => r.id === id)!;
  assert.deepEqual([row('4K').taxable, row('4K').cgst], [2000, 180]);
  assert.equal(row('4N').cgst, g9.table9.find((r) => r.id === '9-CGST')!.payable);
  const down = doc({ ...original, id: 'a2', items: [{ ...original.items[0], quantity: 8, amount: 8000 }], amends: { original_number: original.invoice_number, original_date: '2025-04-05', period: '042025', amended_on: '2025-06-20', original } });
  // A reduction needs other liability in its month to net against (3B never goes negative).
  const june = doc({ id: 'j1', invoice_number: 'INV/FY25-26/0002', issue_date: '2025-06-10', client: up.client, items: [item('Laptops', 10, 1000, 18, '8471', 'goods')] });
  const g9b = buildGstr9([down, june], [], { fyStart: 2025, gstin: SELLER_GSTIN });
  const rowB = (id: string) => g9b.table4.find((r) => r.id === id)!;
  assert.deepEqual([rowB('4L').taxable, rowB('4L').cgst], [2000, 180]);
  assert.equal(rowB('4N').cgst, g9b.table9.find((r) => r.id === '9-CGST')!.payable);
});

/* ── 8. CDNR inv_typ follows the note ─────────────────────────────────── */

test('8: CDNR inv_typ is the note\'s invoice type (SEZ / deemed export), not always R', () => {
  const sezNote = doc({ doc_type: 'CREDIT_NOTE', supply_type: 'SEZ_WITHOUT_PAYMENT', gst_mode: 'IGST', place_of_supply: '24', client: { name: 'SEZ Unit', gstin: BUYER_SEZ_GJ, email: '', address: '', city: '', zip: '' }, items: [item('Goods', 1, 1000, 18, '8471', 'goods')] });
  const r = buildGstReport([sezNote], [], { period: MAY, gstin: SELLER_GSTIN });
  const json = buildGstr1Json(r.gstr1) as { cdnr: Array<{ nt: Array<{ inv_typ: string }> }> };
  assert.equal(json.cdnr[0].nt[0].inv_typ, 'SEWOP');
});

/* ── 9. Table 13: receipt and refund vouchers ─────────────────────────── */

test('9: GSTR-1 Table 13 lists receipt vouchers (doc 6) and refund vouchers (doc 8)', () => {
  const adv = (kind: 'received' | 'refunded', number: string, ref?: string) =>
    ({ kind, advanceId: 'a', number, sourceId: 's', date: '2025-05-10', pos: '27', supply: 'INTRA', rate: 18, taxed: true, gross: 1180, taxable: 1000, igst: 0, cgst: 90, sgst: 90, party: 'X', senderGstin: SELLER_GSTIN, ref }) as never;
  const r = buildGstReport([], [], { period: MAY, gstin: SELLER_GSTIN, advances: [adv('received', 'ADV/FY25-26/0001'), adv('received', 'ADV/FY25-26/0003'), adv('refunded', 'ADV/FY25-26/0001', 'RFV/FY25-26/0001')] });
  const rv = r.gstr1.docIssue.find((d) => d.docType === 'Receipt Voucher')!;
  assert.deepEqual([rv.from, rv.to, rv.total, rv.cancelled, rv.netIssued], ['ADV/FY25-26/0001', 'ADV/FY25-26/0003', 3, 1, 2]);
  assert.equal(r.gstr1.docIssue.find((d) => d.docType === 'Refund Voucher')!.from, 'RFV/FY25-26/0001');
  const json = buildGstr1Json(r.gstr1) as { doc_issue: { doc_det: Array<{ doc_num: number }> } };
  assert.deepEqual(json.doc_issue.doc_det.map((d) => d.doc_num), [6, 8]);
});

/* ── 10. Draft credit notes ───────────────────────────────────────────── */

test('10: a draft credit note does not reduce the dashboard outstanding', () => {
  const inv = doc({ items: [item('X', 1, 10000, 18)] });
  const draft = { ...inv, id: 'cnd', doc_type: 'CREDIT_NOTE' as const, status: 'Draft' as const, total: 5000 };
  const s = summarize([inv, draft], new Date(2025, 4, 6), [{ from_id: inv.id, to_id: 'cnd', relation: 'credit_note' }]);
  assert.equal(s.outstanding, 11800);
  const live = { ...draft, status: 'Sent' as const };
  assert.equal(summarize([inv, live], new Date(2025, 4, 6), [{ from_id: inv.id, to_id: 'cnd', relation: 'credit_note' }]).outstanding, 6800);
});

/* ── 11. 3B Table 5 leaves non-supplies out ───────────────────────────── */

test('11: salaries / statutory dues are not inward exempt supplies; bank interest stays (exempt)', () => {
  for (const c of ['Salaries', 'Wages', 'Directors remuneration', 'PF contribution', 'ESIC', 'Income tax', 'Depreciation']) assert.equal(isNonSupplyCategory(c), true, c);
  for (const c of ['Bank interest', 'Rent', 'Purchases', 'Profit sharing']) assert.equal(isNonSupplyCategory(c), false, c);
  const rows = [
    bill({ kind: 'EXPENSE', category: 'Salaries', taxable: 50000, cgst: 0, sgst: 0, total: 50000 }),
    bill({ kind: 'EXPENSE', category: 'Bank interest', taxable: 2000, cgst: 0, sgst: 0, total: 2000 }),
  ];
  assert.equal(gstNormalize(rows[0], '27')!.nonSupply, true);
  const r = buildGstReport([], rows, { period: MAY, filerStateCode: '27' });
  assert.deepEqual(r.gstr3b.inwardExempt, { inter: 0, intra: 2000 });
});

/* ── 12. Export lines at a nominal 0% stay in EXP / SEZ ───────────────── */

test('12: a 0% export line is reported in EXP so GSTR-1, 3B 3.1(b) and GSTR-9 5A agree', () => {
  const exp = doc({ supply_type: 'EXPORT_LUT', gst_mode: 'IGST', place_of_supply: '96', currency: 'INR', client: { name: 'Acme', email: '', address: '', city: '', zip: '' }, items: [item('Rice', 1, 4000, 0, '1006', 'goods'), item('Tools', 1, 6000, 18, '8205', 'goods')] });
  const r = buildGstReport([exp], [], { period: MAY, gstin: SELLER_GSTIN });
  assert.equal(r.gstr1.exp.length, 1);
  assert.equal(r.gstr1.exp[0].taxable, 10000);
  assert.deepEqual(r.gstr1.exp[0].items.map((i) => [i.rate, i.txval]), [[0, 4000], [18, 6000]]);
  assert.equal(r.gstr3b.outward.zeroRated.taxable, 10000);
  assert.equal(r.gstr1.nil.length, 0);
  const g9 = buildGstr9([exp], [], { fyStart: 2025, gstin: SELLER_GSTIN });
  assert.equal(g9.table5.find((x) => x.id === '5A')!.taxable, 10000);
});

/* ── 13. Dated TDS / TCS history ──────────────────────────────────────── */

test('13: 194J technical was 10% until 31 Mar 2020; 194Q from 1 Jul 2021; 206C(1H) / (1G) from 1 Oct 2020', () => {
  const rate = (d: string, s: string) => tdsSections(d).find((x) => x.section === s)?.rate;
  assert.equal(rate('2019-06-01', '194J-T'), 10);
  assert.equal(rate('2020-04-01', '194J-T'), 2);
  assert.equal(rate('2020-06-01', '194J-T'), 1.5, 'reduced rate 14 May 2020 – 31 Mar 2021');
  assert.equal(rate('2021-04-01', '194J-T'), 2);
  assert.equal(rate('2021-06-30', '194Q'), undefined);
  assert.equal(rate('2021-07-01', '194Q'), 0.1);
  assert.equal(rate('2024-09-30', '194H'), 5);
  assert.equal(rate('2024-10-01', '194H'), 2);
  assert.deepEqual(tcsPresets('2020-09-30'), []);
  assert.equal(tcsPresets('2020-10-01').find((p) => p.label.startsWith('206C(1H) sale'))!.rate, 0.075);
  assert.equal(tcsPresets('2021-04-01').find((p) => p.label.startsWith('206C(1H) sale'))!.rate, 0.1);
  assert.equal(tcsPresets('2023-09-30').find((p) => p.label.startsWith('206C(1G)'))!.rate, 5);
  assert.equal(tcsPresets('2023-10-01').find((p) => p.label.startsWith('206C(1G)'))!.rate, 20);
  assert.ok(!tcsPresets('2025-04-01').some((p) => p.label.startsWith('206C(1H)')));
});

/* ── 14. POS place of supply ──────────────────────────────────────────── */

test('14: a counter sale to an out-of-state saved client is intra-state unless dispatched', () => {
  installSettings();
  const base = { items: [item('Comb', 2, 50, 12, '9615', 'goods')], settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), day: '2025-05-10' };
  const client = { id: 'c-ka', name: 'Karnataka Tech', email: '', address: '', city: '', zip: '', state_code: '29', gstin: '' };
  const counter = buildPosRecord({ ...base, party: { client } });
  assert.deepEqual([counter.place_of_supply, counter.gst_mode], ['27', 'CGST_SGST']);
  const dispatched = buildPosRecord({ ...base, party: { client }, deliverToClientState: true });
  assert.deepEqual([dispatched.place_of_supply, dispatched.gst_mode], ['29', 'IGST']);
});
