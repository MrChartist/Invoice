/**
 * Sales orders (SO) and purchase orders (PO), end to end through the store and the
 * storage-backed lib APIs: numbering, exclusion from every tax/books/stock classifier,
 * partial fulfilment (challan → invoice + a direct invoice), close / reopen, and
 * PO → two partial bills → Received.
 */
import '../helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from '../helpers/shim.ts';
import { SELLER_GSTIN, clientMH, createViaStore, installSettings, reload } from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { allowedConversions, convertDocument, DocumentError, readLinks } from '../../src/lib/documents.ts';
import { orderFulfilment, pendingQuantities } from '../../src/lib/sales-orders.ts';
import { isRevenueDoc, summarize } from '../../src/lib/stats.ts';
import { buildReceivables, isLedgerDoc } from '../../src/lib/receivables.ts';
import { loadBooksData, profitAndLoss, buildVouchers } from '../../src/lib/books.ts';
import { buildGstReport } from '../../src/lib/gst-reports.ts';
import { collectEvents } from '../../src/lib/inventory.ts';
import { voucherKindOf } from '../../src/lib/export-shared.ts';
import { eInvoiceDocType } from '../../src/lib/einvoice.ts';
import { isSaleDoc } from '../../src/lib/sales-reports.ts';
import { stampFor, WATERMARK_AUTO } from '../../src/lib/design-prefs.ts';
import { calcInputFromRecord, calculateInvoice } from '../../src/lib/invoice-calc.ts';
import { quoteState } from '../../src/lib/quote-status.ts';
import {
  billSeedFromPo,
  nextPoNumber,
  poFulfilment,
  poHtml,
  purchaseOrdersDb,
} from '../../src/lib/purchase-orders.ts';
import { computePurchaseTotals, purchasesDb } from '../../src/lib/purchases.ts';
import { validateBackupData } from '../../src/lib/backup.ts';
import type { InvoiceRecord } from '../../src/types/invoice.ts';
import type { PurchaseOrder } from '../../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  freezeDate('2026-05-10T10:00:00');
});
afterEach(() => thawDate());

const all = () => localDb.invoices.getAll();
const state = (so: InvoiceRecord) => orderFulfilment(reload(so.id), all(), readLinks()).state;
const lineQty = (doc: InvoiceRecord, name: string) => doc.items.find((i) => i.name === name)?.quantity ?? 0;

/** Keep only the named lines at the given quantities (what a user does in the editor). */
function editLines(doc: InvoiceRecord, qty: Record<string, number>): InvoiceRecord {
  const items = doc.items.filter((i) => qty[i.name] > 0).map((i) => ({ ...i, quantity: qty[i.name], amount: qty[i.name] * i.rate }));
  const next = { ...doc, items, status: 'Sent' as const };
  const t = calculateInvoice(calcInputFromRecord(next));
  return localDb.invoices.save({ ...next, total: t.total, balance_due: t.balance_due, taxable_value: t.taxable_value, subtotal: t.subtotal });
}

function makeOrder(): InvoiceRecord {
  return createViaStore({
    docType: 'SALES_ORDER',
    date: '2026-05-02',
    due: '2026-05-20',
    lines: [
      { name: 'Widget', hsn: '8471', qty: 10, rate: 100 },
      { name: 'Gadget', hsn: '8473', qty: 4, rate: 500 },
    ],
  });
}

test('sales orders get their own SO/FY series and convert from a quotation', () => {
  const quote = createViaStore({ docType: 'QUOTATION', date: '2026-05-01', lines: [{ name: 'Widget', qty: 10, rate: 100 }] });
  assert.ok(allowedConversions(quote).some((o) => o.target === 'SALES_ORDER'));
  const so = convertDocument(quote, 'SALES_ORDER');
  assert.equal(so.doc_type, 'SALES_ORDER');
  assert.equal(so.invoice_number, 'SO/FY26-27/0001');
  assert.equal(so.sales_order_id, undefined);
  assert.equal(quoteState(reload(quote.id), readLinks()), 'Converted');
  assert.equal(reload(quote.id).quote_status, 'Accepted');
  // The next one from the editor continues the series; invoices keep their own.
  assert.equal(makeOrder().invoice_number, 'SO/FY26-27/0002');
  assert.equal(createViaStore({ date: '2026-05-03', lines: [{ qty: 1, rate: 100 }] }).invoice_number, 'INV/FY26-27/0001');
  // Indian FY: an order dated 1 April 2027 starts FY27-28.
  assert.equal(createViaStore({ docType: 'SALES_ORDER', date: '2027-04-01', lines: [{ qty: 1, rate: 1 }] }).invoice_number, 'SO/FY27-28/0001');
});

test('a sales order is never revenue, GST, books, receivable or stock', async () => {
  const so = makeOrder();
  assert.equal(so.status, 'Sent');
  assert.equal(so.total, 3540); // 3,000 + 18%
  assert.equal(isRevenueDoc(so), false);
  assert.equal(isLedgerDoc(so), false);
  assert.equal(isSaleDoc(so), false);
  assert.equal(voucherKindOf(so, true), null);
  assert.equal(eInvoiceDocType(so), null);
  assert.equal(stampFor(WATERMARK_AUTO, 'Overdue', 'SALES_ORDER'), null);

  const now = new Date('2026-06-30T10:00:00');
  const s = summarize(all(), now, readLinks());
  assert.equal(s.billed, 0);
  assert.equal(s.outstanding, 0);
  const rec = buildReceivables({ invoices: all(), payments: [], clients: [clientMH] }, { now });
  assert.equal(rec.totals.net, 0);

  const data = loadBooksData();
  assert.equal(profitAndLoss(data, { start: '2026-04-01', end: '2027-03-31' }, 'accrual').sales, 0);
  assert.equal(buildVouchers(data).length, 0);
  const { buildLedger } = await import('../../src/lib/ledger/index.ts');
  const led = buildLedger({ ...data, userAccounts: [], manual: [], assets: [], today: '2026-06-30' });
  assert.equal(led.vouchers.length, 0, 'the double-entry ledger never posts a sales order');

  const rep = buildGstReport(all(), [], { period: { kind: 'month', fyStart: 2026, month: 5 }, gstin: SELLER_GSTIN });
  assert.equal(rep.gstr1.b2b.length, 0);
  assert.equal(rep.gstr1.totals.taxable, 0);
  assert.equal(rep.gstr1.docIssue.reduce((n, r) => n + r.total, 0), 0);

  const events = collectEvents({
    items: [{ id: 's1', name: 'Widget', hsn: '8471', unit: 'NOS', track_stock: true, opening_qty: 50, opening_rate: 60, reorder_level: 0 }],
    moves: [],
    invoices: all(),
    includeChallans: true,
  });
  assert.equal((events.get('s1') ?? []).filter((e) => e.kind !== 'opening').length, 0);
});

test('partial fulfilment: challan → invoice, a direct invoice, close, reopen, fulfil', () => {
  const so = makeOrder();
  assert.equal(state(so), 'Open');

  // 1. Deliver 6 widgets on a challan (pre-filled with everything pending; the user trims it).
  const dc0 = convertDocument(so, 'DELIVERY_CHALLAN');
  assert.equal(dc0.invoice_number, 'DCH/FY26-27/0001');
  assert.equal(dc0.sales_order_id, so.id);
  assert.deepEqual([lineQty(dc0, 'Widget'), lineQty(dc0, 'Gadget')], [10, 4]);
  assert.ok(dc0.items.every((i) => so.items.some((l) => l.id === i.order_line_id)));
  const dc = editLines(dc0, { Widget: 6 });
  assert.equal(state(so), 'Partly fulfilled');

  // 2. Invoice that challan: the invoice carries the order stamps, counts as invoiced, not delivered twice.
  const inv1 = convertDocument(dc, 'TAX_INVOICE');
  assert.equal(inv1.sales_order_id, so.id);
  assert.equal(lineQty(inv1, 'Widget'), 6);
  localDb.invoices.setStatus(inv1.id, 'Sent');
  let f = orderFulfilment(reload(so.id), all(), readLinks());
  const widget = () => f.lines.find((l) => l.item.name === 'Widget')!;
  const gadget = () => f.lines.find((l) => l.item.name === 'Gadget')!;
  assert.deepEqual([widget().delivered, widget().invoiced], [6, 6]);
  assert.deepEqual([gadget().delivered, gadget().invoiced], [0, 0]);

  // 3. A direct invoice from the order pre-fills ONLY what is still to invoice: 4 widgets + 4 gadgets.
  const inv2draft = convertDocument(reload(so.id), 'INVOICE');
  assert.deepEqual([lineQty(inv2draft, 'Widget'), lineQty(inv2draft, 'Gadget')], [4, 4]);
  assert.equal(inv2draft.total, 2832); // (400 + 2,000) × 1.18
  const inv2 = editLines(inv2draft, { Widget: 4, Gadget: 2 });
  f = orderFulfilment(reload(so.id), all(), readLinks());
  assert.deepEqual([widget().delivered, widget().invoiced, widget().pendingInvoice], [10, 10, 0]);
  assert.deepEqual([gadget().delivered, gadget().invoiced, gadget().pendingDelivery], [2, 2, 2]);
  assert.equal(f.state, 'Partly fulfilled');
  assert.deepEqual(Object.values(pendingQuantities(f, 'invoice')), [2]);
  assert.equal(f.documentIds.length, 3);

  // The invoices are real revenue; the order still is not.
  assert.equal(summarize(all(), new Date('2026-05-10T12:00:00'), readLinks()).billed, round(708 + 472 + 1180));

  // 4. Close the part-fulfilled order: no more conversions until it is reopened.
  localDb.invoices.setOrderClosed(so.id, '2026-05-10');
  assert.equal(state(so), 'Closed');
  assert.deepEqual(allowedConversions(reload(so.id)), []);
  assert.throws(() => convertDocument(reload(so.id), 'TAX_INVOICE'), DocumentError);

  // 5. Reopen and invoice the remaining 2 gadgets → Fulfilled.
  localDb.invoices.setOrderClosed(so.id, undefined);
  assert.equal(reload(so.id).order_closed_on, undefined);
  const inv3 = convertDocument(reload(so.id), 'TAX_INVOICE');
  assert.deepEqual(inv3.items.map((i) => [i.name, i.quantity]), [['Gadget', 2]]);
  assert.equal(state(so), 'Fulfilled');
  assert.throws(() => convertDocument(reload(so.id), 'INVOICE'), /already been invoiced/);

  // Cancelling an invoice frees its quantity again.
  localDb.invoices.save({ ...reload(inv2.id), status: 'Cancelled' });
  assert.equal(state(so), 'Partly fulfilled');
});

const round = (n: number) => Math.round(n * 100) / 100;

test('closing a sales order and the order stamps survive load → save in the editor', async () => {
  const so = makeOrder();
  localDb.invoices.setOrderClosed(so.id, '2026-05-10');
  const { useInvoiceStore } = await import('../../src/store/useInvoiceStore.ts');
  const st = useInvoiceStore.getState();
  assert.ok(st.loadInvoice(so.id));
  const saved = useInvoiceStore.getState().saveInvoice();
  assert.ok(saved.ok);
  assert.equal(saved.record!.order_closed_on, '2026-05-10');

  // A converted invoice re-saved through the editor keeps its order stamps.
  localDb.invoices.setOrderClosed(so.id, undefined);
  const inv = convertDocument(reload(so.id), 'TAX_INVOICE');
  assert.ok(useInvoiceStore.getState().loadInvoice(inv.id));
  const again = useInvoiceStore.getState().saveInvoice()!;
  assert.ok(again.ok);
  assert.equal(again.record!.sales_order_id, so.id);
  assert.ok(again.record!.items.every((i) => i.order_line_id));
  assert.equal(state(so), 'Fulfilled');
});

/* ── Purchase orders ─────────────────────────────────────────────── */

function makePo(): PurchaseOrder {
  const lines = [
    { id: 'pl1', name: 'Paper ream', hsn: '4802', unit: 'NOS', quantity: 100, rate: 200, tax_rate: 12 },
    { id: 'pl2', name: 'Toner', hsn: '8443', unit: 'NOS', quantity: 5, rate: 3000, tax_rate: 18 },
  ];
  const t = computePurchaseTotals(lines, { placeOfSupply: '27', businessState: '27' });
  return purchaseOrdersDb.save({
    vendor_id: 'v1',
    vendor_name: 'Acme Supplies',
    vendor_gstin: '27AAPFU0939F1ZV',
    date: '2026-05-05',
    expected_date: '2026-05-15',
    place_of_supply: '27',
    lines,
    taxable: t.taxable,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    total: t.total,
  });
}

function billFrom(po: PurchaseOrder, billNo: string, qty: Record<string, number>) {
  const seed = billSeedFromPo(po, purchasesDb.all());
  const lines = seed.lines.filter((l) => qty[l.name] > 0).map((l) => ({ ...l, quantity: qty[l.name] }));
  const t = computePurchaseTotals(lines, { placeOfSupply: '27', businessState: '27' });
  return purchasesDb.save({
    ...seed,
    kind: 'PURCHASE',
    bill_number: billNo,
    date: '2026-05-12',
    category: 'Purchases',
    lines,
    taxable: t.taxable,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    itc_eligible: true,
    total: t.total,
    amount_paid: 0,
  });
}

test('PO numbering follows the Indian FY', () => {
  assert.equal(makePo().po_number, 'PO/FY26-27/0001');
  assert.equal(makePo().po_number, 'PO/FY26-27/0002');
  assert.equal(nextPoNumber(['PO/FY26-27/0007'], '2026-12-01'), 'PO/FY26-27/0008');
  assert.equal(nextPoNumber(['PO/FY26-27/0007'], '2027-04-01'), 'PO/FY27-28/0001');
  assert.equal(nextPoNumber([], '2027-03-31'), 'PO/FY26-27/0001');
});

test('PO → two partial bills → Received, received qty derived from the bills', () => {
  const po = makePo();
  assert.equal(po.total, 40100); // 20,000 × 1.12 + 15,000 × 1.18
  assert.equal(poFulfilment(po, purchasesDb.all()).state, 'Open');

  // First bill: the seed carries everything pending; the supplier sent 60 reams and 5 toners.
  const seed = billSeedFromPo(po, purchasesDb.all());
  assert.equal(seed.po_id, po.id);
  assert.deepEqual(seed.lines.map((l) => [l.name, l.quantity, l.po_line_id]), [['Paper ream', 100, 'pl1'], ['Toner', 5, 'pl2']]);
  const b1 = billFrom(po, 'AS/101', { 'Paper ream': 60, Toner: 5 });
  assert.equal(b1.po_id, po.id);
  let f = poFulfilment(po, purchasesDb.all());
  assert.equal(f.state, 'Partly received');
  assert.deepEqual(f.lines.map((l) => [l.received, l.pending]), [[60, 40], [5, 0]]);

  // Second bill pre-fills only the 40 reams still due.
  const seed2 = billSeedFromPo(po, purchasesDb.all());
  assert.deepEqual(seed2.lines.map((l) => [l.name, l.quantity]), [['Paper ream', 40]]);
  billFrom(po, 'AS/102', { 'Paper ream': 40 });
  f = poFulfilment(po, purchasesDb.all());
  assert.equal(f.state, 'Received');
  assert.equal(f.bills.length, 2);
  assert.throws(() => billSeedFromPo(po, purchasesDb.all()), /received/);

  // Received is derived: deleting a bill re-opens the shortfall; a PO with bills cannot be deleted.
  purchasesDb.remove(b1.id);
  assert.equal(poFulfilment(po, purchasesDb.all()).state, 'Partly received');
  assert.throws(() => purchaseOrdersDb.remove(po.id, purchasesDb.all()), /Close it instead/);

  // Close / reopen.
  purchaseOrdersDb.setClosed(po.id, '2026-05-20');
  assert.equal(poFulfilment(purchaseOrdersDb.get(po.id)!, purchasesDb.all()).state, 'Closed');
  assert.throws(() => billSeedFromPo(purchaseOrdersDb.get(po.id)!, purchasesDb.all()), /closed/);
  purchaseOrdersDb.setClosed(po.id, undefined);
  assert.equal(poFulfilment(purchaseOrdersDb.get(po.id)!, purchasesDb.all()).state, 'Partly received');
});

test('a PO with no bills can be deleted, and the printable PO escapes everything', () => {
  const po = makePo();
  const evil = { ...po, vendor_name: '<script>alert(1)</script>', notes: '"quoted" & <b>' };
  const html = poHtml(evil, { name: 'Me & Co <Ltd>', gstin: SELLER_GSTIN });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Me &amp; Co &lt;Ltd&gt;'));
  assert.ok(html.includes('PO/FY26-27/0001'));
  purchaseOrdersDb.remove(po.id, purchasesDb.all());
  assert.equal(purchaseOrdersDb.all().length, 0);
});

test('backup validation checks the purchase_orders table', () => {
  assert.throws(() => validateBackupData({ mrchartist_inv_purchase_orders: '{"x":1}' }), /purchase_orders/);
  assert.throws(() => validateBackupData({ mrchartist_inv_purchase_orders: '[{"po_number":"PO/1"}]' }), /purchase_orders/);
  validateBackupData({ mrchartist_inv_purchase_orders: '[{"id":"a","po_number":"PO/1"}]' });
});
