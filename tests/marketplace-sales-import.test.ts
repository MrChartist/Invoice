/** R5-A3: marketplace sales / returns import — presets, documents, idempotency, summary mode, lock, undo, GSTR-1 14(a). */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { AMZ_MH, fixture, importMtr, setupWorld } from './helpers/marketplace.ts';
import { guessColumns } from '../src/lib/marketplace/file-map.ts';
import { SALES_FIELDS, liveSalesContext, planSalesImport, rowKind, undoSalesImport, loadImports, summaryOrderIds } from '../src/lib/marketplace/sales-import.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { buildGstr1 } from '../src/lib/gst-reports.ts';
import type { SalesChannel } from '../src/types/marketplace-r5.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

let ch: SalesChannel;
beforeEach(() => { ch = setupWorld(); });
const docs = () => localDb.invoices.getAll().filter((d) => d.channel_id === ch.id);
const byNo = (no: string) => docs().find((d) => d.invoice_number === no) as InvoiceRecord;

test('each preset synonym table maps its fixture header row', () => {
  const amz = guessColumns(fixture('amazon-mtr.csv').headers, SALES_FIELDS);
  for (const f of ['kind', 'invoice_no', 'invoice_date', 'order_id', 'sku', 'listing_id', 'qty', 'taxable', 'igst', 'cgst', 'sgst', 'total', 'ship_to', 'ship_from', 'buyer_gstin', 'cn_no', 'cn_date']) assert.ok(amz.has(f), `amazon ${f}`);
  const fk = guessColumns(['Order ID', 'Order Item ID', 'SKU', 'FSN', 'Event Type', 'Item Quantity', 'Taxable Value (Final Invoice Amount -Taxes)', 'IGST Amount', 'CGST Amount', 'SGST Amount (Or UTGST as applicable)', 'Buyer Invoice ID', 'Buyer Invoice Date', 'Buyer Invoice Amount', "Customer's Delivery State", 'Order Shipped From (State)'], SALES_FIELDS);
  for (const f of ['order_id', 'sku', 'listing_id', 'kind', 'qty', 'taxable', 'igst', 'cgst', 'sgst', 'invoice_no', 'invoice_date', 'total', 'ship_to', 'ship_from']) assert.ok(fk.has(f), `flipkart ${f}`);
  const ms = guessColumns(fixture('meesho-sales.csv').headers, SALES_FIELDS);
  for (const f of ['order_id', 'invoice_date', 'qty', 'tax_rate', 'taxable', 'tax', 'total', 'ship_to', 'sku']) assert.ok(ms.has(f), `meesho ${f}`);
  assert.equal(rowKind('Return Cancellation', 'sale'), 'cancel');
  assert.equal(rowKind('Refund', 'sale'), 'return');
  assert.equal(rowKind('', 'return'), 'return');
});

test('B2C row → INVOICE with ECO tag and ship-to state; B2B → TAX_INVOICE; refund → linked credit note; cancel skipped', () => {
  const { plan, res } = importMtr(ch);
  assert.equal(plan.counts.invoices, 3);
  assert.equal(plan.counts.creditNotes, 1);
  assert.equal(plan.counts.cancelled, 1);
  assert.equal(plan.errors.length, 0, JSON.stringify(plan.errors));
  assert.equal(res.saved.length, 4);
  const b2c = byNo('IN-1001');
  assert.equal(b2c.doc_type, 'INVOICE');
  assert.equal(b2c.issue_date, '2026-10-05');
  assert.equal(b2c.eco_gstin, AMZ_MH);
  assert.equal(b2c.eco_section, 'TCS_52');
  assert.equal(b2c.place_of_supply, '29');
  assert.equal(b2c.gst_mode, 'IGST');
  assert.equal(b2c.igst_amount, 90);
  assert.equal(b2c.total, 590);
  assert.equal(b2c.channel_order_id, '402-111');
  assert.match(b2c.client.name, /Amazon customer: Karnataka/);
  assert.equal(b2c.status !== 'Draft', true, 'issued, not a draft');
  const b2b = byNo('IN-1003');
  assert.equal(b2b.doc_type, 'TAX_INVOICE');
  assert.equal(b2b.client.gstin, '29AABCT1332L1ZA');
  const cn = byNo('CN-501');
  assert.equal(cn.doc_type, 'CREDIT_NOTE');
  assert.equal(cn.goods_returned, true);
  assert.equal(cn.issue_date, '2026-10-12');
  const link = getTable<{ from_id: string; to_id: string; relation: string }>('doc_links').find((l) => l.to_id === cn.id);
  assert.equal(link?.from_id, b2c.id);
  assert.equal(link?.relation, 'credit_note');
  assert.ok(plan.reconciled, `${plan.fileTotal} vs ${plan.docsTotal}`);
  assert.equal(plan.fileTotal, 590 + 1062 + 590 + 1180);
  // A3 refund rows open a returns-desk row (pending receipt).
  assert.equal(getTable<{ credit_note_id?: string }>('marketplace_returns').filter((r) => r.credit_note_id === cn.id).length, 1);
});

test('pack-of-3 listing → 3 units at taxable ÷ 3', () => {
  importMtr(ch);
  const inv = byNo('IN-1002');
  assert.equal(inv.items[0].name, 'Red Mug');
  assert.equal(inv.items[0].quantity, 3);
  assert.equal(inv.items[0].rate, 300);
  assert.equal(inv.cgst_amount, 81);
  assert.equal(inv.gst_mode, 'CGST_SGST');
});

test('re-importing the same file changes nothing', () => {
  importMtr(ch);
  const n = localDb.invoices.getAll().length;
  const t = fixture('amazon-mtr.csv');
  const again = planSalesImport(t, guessColumns(t.headers, SALES_FIELDS), 'amazon_mtr_b2c', liveSalesContext(ch));
  assert.equal(again.docs.length, 0);
  assert.equal(again.counts.already, 4);
  assert.equal(localDb.invoices.getAll().length, n);
});

test('summary mode totals equal per-order totals', () => {
  const t = fixture('amazon-mtr.csv');
  const ctx = liveSalesContext(ch);
  const per = planSalesImport(t, guessColumns(t.headers, SALES_FIELDS), 'amazon_mtr_b2c', ctx);
  const sum = planSalesImport(t, guessColumns(t.headers, SALES_FIELDS), 'amazon_mtr_b2c', ctx, { summary: true });
  assert.deepEqual(sum.totals, per.totals);
  assert.ok(sum.docs.some((d) => d.record.channel_order_id?.startsWith('SUMMARY:')));
  assert.ok(sum.reconciled);
});

test('rows in a locked period are refused; unmapped SKUs block their row', () => {
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-10-05' });
  const t = fixture('amazon-mtr.csv');
  t.rows[1][10] = 'NOT-MAPPED';
  t.rows[1][8] = '';
  const plan = planSalesImport(t, guessColumns(t.headers, SALES_FIELDS), 'amazon_mtr_b2c', liveSalesContext(ch));
  assert.ok(plan.errors.some((e) => /period lock/.test(e.message)));
  assert.ok(plan.errors.some((e) => /not mapped/.test(e.message)));
  assert.deepEqual(plan.unmapped.map((u) => u.sku), ['NOT-MAPPED']);
  assert.ok(!plan.docs.some((d) => d.record.invoice_number === 'IN-1001' || d.record.invoice_number === 'IN-1002'));
});

test('undo cancels every document (never deletes) and is refused after a payment', () => {
  const { res } = importMtr(ch);
  const id = res.import.id;
  localDb.payments.record({ invoiceId: byNo('IN-1002').id, amount: 100, method: 'UPI', date: '2026-10-20' });
  assert.throws(() => undoSalesImport(id), /payment/);
  assert.equal(byNo('IN-1001').status !== 'Cancelled', true);
  localDb.payments.remove(localDb.payments.listFor(byNo('IN-1002').id)[0].id);
  const out = undoSalesImport(id);
  assert.equal(out.cancelled, 4);
  assert.ok(docs().every((d) => d.status === 'Cancelled'));
  assert.equal(docs().length, 4, 'nothing deleted');
  assert.ok(loadImports(ch.id).find((i) => i.id === id)?.undone_at);
  // After an undo the same file imports again.
  const t = fixture('amazon-mtr.csv');
  const again = planSalesImport(t, guessColumns(t.headers, SALES_FIELDS), 'amazon_mtr_b2c', liveSalesContext(ch));
  assert.equal(again.counts.already, 0);
});

test('GSTR-1 Table 14(a) for the operator matches the file', () => {
  importMtr(ch);
  const g1 = buildGstr1(localDb.invoices.getAll(), { period: { kind: 'month', fyStart: 2026, month: 10 } });
  const row = g1.gstr1.eco?.tcs.find((r) => r.etin === AMZ_MH);
  assert.ok(row, 'Table 14(a) row');
  assert.equal(row!.value, 500 + 900 + 1000 - 500);
  assert.equal(row!.igst, 90 + 180 - 90);
  assert.equal(row!.cgst, 81);
  assert.equal(row!.sgst, 81);
});

test('Meesho file without invoice numbers: numbered from the order id, flagged for the CA', () => {
  const t = fixture('meesho-sales.csv');
  const plan = planSalesImport(t, guessColumns(t.headers, SALES_FIELDS), 'meesho_gst', liveSalesContext(ch));
  assert.equal(plan.docs[0].record.invoice_number, 'MSH/M-901');
  assert.equal(plan.docs[0].record.place_of_supply, '24');
  assert.ok(plan.warnings.some((w) => /verify with your CA/.test(w.message)));
});

/* ── QA6 F2: summary ↔ per-order re-import must never double-book ── */
const salesTaxable = () => Math.round(docs().filter((d) => d.status !== 'Cancelled' && d.doc_type !== 'CREDIT_NOTE').reduce((s, d) => s + d.taxable_value, 0) * 100) / 100;
const planFile = (summary = false) => {
  const t = fixture('amazon-mtr.csv');
  return planSalesImport(t, guessColumns(t.headers, SALES_FIELDS), 'amazon_mtr_b2c', liveSalesContext(ch), { summary });
};
const summaries = () => docs().filter((d) => d.channel_order_id?.startsWith('SUMMARY:'));

test('QA6 F2: summary import, then the same file per order, imports nothing new; GSTR-1 counts each sale once', () => {
  importMtr(ch, { summary: true });
  assert.equal(salesTaxable(), 500 + 900 + 1000);
  const again = planFile(false);
  assert.equal(again.docs.length, 0, 'no document planned');
  assert.equal(again.counts.already, 4);
  assert.equal(again.errors.length, 0);
  assert.equal(salesTaxable(), 500 + 900 + 1000);
  const g1 = buildGstr1(localDb.invoices.getAll(), { period: { kind: 'month', fyStart: 2026, month: 10 } });
  const b2cs = g1.gstr1.b2cs.reduce((s, r) => s + r.txval, 0);
  assert.equal(Math.round(b2cs * 100) / 100, 500 + 900 - 500, 'B2CS counts each sale once (net of the refund)');
});

test('QA6 F2: summary twice is "already imported", and per order then summary too', () => {
  importMtr(ch, { summary: true });
  const twice = planFile(true);
  assert.equal(twice.docs.length, 0);
  assert.equal(twice.counts.already, 4);
  assert.equal(twice.errors.length, 0);
  ch = setupWorld();
  importMtr(ch);
  const sum = planFile(true);
  assert.equal(sum.docs.length, 0);
  assert.equal(sum.counts.already, 4);
});

test('QA6 F2: a summary saved without order ids is matched from its notes; else its covered range refuses the order', () => {
  importMtr(ch, { summary: true });
  const strip = (notes?: string) => {
    for (const d of summaries()) {
      const legacy: InvoiceRecord = { ...d };
      delete legacy.channel_order_ids;
      localDb.invoices.save(notes === undefined ? legacy : { ...legacy, notes });
    }
  };
  strip();
  assert.ok(summaries().every((d) => !d.channel_order_ids), 'legacy summaries');
  assert.equal(planFile(false).docs.length, 0, 'order ids read back from the summary notes');
  strip('edited by hand');
  const plan = planFile(false);
  assert.equal(plan.docs.filter((d) => d.record.doc_type === 'INVOICE').length, 0, 'no B2C invoice planned');
  assert.ok(plan.errors.some((e) => /already covers/i.test(e.message)), plan.errors.map((e) => e.message).join(' | '));
});

test('summary notes: the order list reads from the new text and from notes saved before the writing rule (em dash)', () => {
  assert.deepEqual(summaryOrderIds({ notes: 'Marketplace summary (Amazon): 2 orders: A1, A2' }), ['A1', 'A2']);
  assert.deepEqual(summaryOrderIds({ notes: 'Marketplace summary (Amazon): 2 orders — A1, A2' }), ['A1', 'A2']);
});
