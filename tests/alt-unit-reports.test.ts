/**
 * WP-8 follow-ups: invoice lines typed in an alternate unit (2 BOX where 1 BOX = 12 NOS, `unit_factor: 12`)
 * in per-item reports (costing in base units, quantities in the item's base unit) and the units master's
 * UQC in the GSTR-1 HSN summary, e-Invoice and e-Way bill mappers.
 */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateInvoice } from '../src/lib/invoice-calc.ts';
import { buildCoster, itemProfitability, partyProfitability } from '../src/lib/profitability.ts';
import { profitByItem, salesByItem, salesDocs } from '../src/lib/sales-reports.ts';
import { topItems } from '../src/lib/dashboard-tiles.ts';
import { buildItemIndex, computeStock, type StockItem } from '../src/lib/inventory.ts';
import { buildGstReport, hsnLineQty, type ReportPeriod } from '../src/lib/gst-reports.ts';
import { buildGstr9 } from '../src/lib/gstr9.ts';
import { buildEInvoice, isUnitGuessed, portalUqc } from '../src/lib/einvoice.ts';
import { preflightEInvoice } from '../src/lib/einvoice-validate.ts';
import { buildEway } from '../src/lib/eway.ts';
import type { UnitMaster } from '../src/lib/units.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import { gstinChecksumChar } from '../src/lib/gstin.ts';
import { invoice as einvInvoice, item as einvItem } from './einvoice-fixtures.ts';

const FY = { start: '2026-04-01', end: '2027-03-31' };

let seq = 0;
const line = (name: string, quantity: number, rate: number, over: Partial<InvoiceItem> = {}): InvoiceItem =>
  ({ id: `l${++seq}`, name, hsn: '8471', type: 'Goods', unit: 'NOS', quantity, rate, tax_rate: 0, amount: quantity * rate, ...over }) as InvoiceItem;

function sale(over: Partial<InvoiceRecord> & { items: InvoiceItem[] }): InvoiceRecord {
  const taxable = over.items.reduce((s, i) => s + i.quantity * i.rate, 0);
  return {
    id: `S${++seq}`, invoice_number: `INV/${seq}`, doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-06-10', due_date: '2026-06-25', currency: 'INR',
    client: { id: 'c1', name: 'Acme' }, gst_mode: 'NONE', tax_rate: 0, discount_type: 'PERCENT', discount_rate: 0, shipping: 0, other_charges: 0,
    round_off_enabled: false, amount_paid: 0, taxable_value: taxable, tax_amount: 0, total: taxable, balance_due: taxable, ...over,
  } as InvoiceRecord;
}

const box = (qty: number, rate = 600) => line('Pen', qty, rate, { unit: 'BOX', unit_factor: 12 });
const PEN: StockItem = { id: 'pen', name: 'Pen', hsn: '8471', unit: 'NOS', track_stock: true, opening_qty: 100, opening_rate: 50, reorder_level: 0, alt_units: [{ unit: 'BOX', factor: 12 }] };

/* ── invoice-calc / sales lines carry the factor ─────────────── */

test('calculator keeps unit_factor on the line; money stays as typed', () => {
  const calc = calculateInvoice({ items: [box(2), line('Pen', 3, 50)], gst_mode: 'NONE', tax_rate: 0, discount_type: 'PERCENT', discount_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0 } as never);
  assert.equal(calc.lines[0].unit_factor, 12);
  assert.equal(calc.lines[0].quantity, 2);
  assert.equal(calc.lines[0].taxable, 1200);
  assert.equal(calc.lines[1].unit_factor, undefined);
  const doc = salesDocs([sale({ items: [box(2)] })]).docs[0];
  assert.equal(doc.lines[0].unitFactor, 12);
  assert.equal(doc.lines[0].quantity, 2);
});

/* ── Item profit (the bug) ────────────────────────────────────── */

test('item profit: tracked item sold in BOX is costed per base unit × qty × factor', () => {
  const inv = sale({ id: 'A', items: [box(2)] }); // 2 BOX = 24 NOS @ ₹50 opening cost
  const positions = computeStock({ items: [PEN], moves: [], invoices: [inv], purchases: [] });
  const c = buildCoster([], [], positions);
  assert.deepEqual(c.cost({ name: 'Pen', hsn: '8471', quantity: 2, unitFactor: 12 }, { id: 'A', date: '2026-06-10' }), { cost: 1200, source: 'stock' });
  const rep = itemProfitability({ invoices: [inv], purchases: [], positions }, FY);
  const r = rep.rows[0];
  assert.equal(r.revenue, 1200); // as typed: 2 × ₹600
  assert.equal(r.cost, 1200); // 24 × ₹50 — was 2 × ₹50 = 100 before the fix
  assert.equal(r.profit, 0);
  assert.equal(r.quantity, 24);
  assert.equal(r.unit, 'NOS');
  assert.equal(r.source, 'stock');
  const party = partyProfitability({ invoices: [inv], purchases: [], positions }, FY);
  assert.equal(party.rows[0].cogs, 1200);
});

test('item profit: BOX and NOS lines of one item add up in the base unit', () => {
  const inv = sale({ id: 'B', items: [box(1, 660), line('Pen', 6, 55)] }); // 12 + 6 = 18 NOS
  const positions = computeStock({ items: [PEN], moves: [], invoices: [inv], purchases: [] });
  const r = itemProfitability({ invoices: [inv], purchases: [], positions }, FY).rows[0];
  assert.equal(r.quantity, 18);
  assert.equal(r.revenue, 990);
  assert.equal(r.cost, 900); // 18 × ₹50
  // Credit note returning 1 BOX takes 12 NOS of cost back.
  const crn = sale({ id: 'C', doc_type: 'CREDIT_NOTE', invoice_number: 'CRN/1', issue_date: '2026-06-12', items: [box(1, 660)], goods_returned: true } as never);
  const pos2 = computeStock({ items: [PEN], moves: [], invoices: [inv, crn], purchases: [] });
  const r2 = itemProfitability({ invoices: [inv, crn], purchases: [], positions: pos2 }, FY).rows[0];
  assert.equal(r2.quantity, 6);
  assert.equal(r2.revenue, 330);
  assert.equal(r2.cost, 300);
});

test('item profit: purchase-bill costing converts bill and sale lines to base units', () => {
  const bill = {
    id: 'P', kind: 'PURCHASE', vendor_name: 'S', bill_number: 'B1', date: '2026-05-01', category: 'Purchases', taxable: 1200, cgst: 0, sgst: 0, igst: 0,
    itc_eligible: true, total: 1200, amount_paid: 0,
    lines: [{ id: 'l', name: 'Marker', hsn: '9608', quantity: 2, rate: 600, tax_rate: 0, unit: 'BOX', unit_factor: 12 }],
  } as unknown as PurchaseRecord; // 24 NOS at ₹50
  const c = buildCoster([bill]);
  assert.deepEqual(c.cost({ name: 'Marker', hsn: '9608', quantity: 3 }, { id: 'x', date: '2026-06-01' }), { cost: 150, source: 'purchases' });
  assert.deepEqual(c.cost({ name: 'Marker', hsn: '9608', quantity: 1, unitFactor: 12 }, { id: 'x', date: '2026-06-01' }), { cost: 600, source: 'purchases' });
  // Without a stock item the unit stays as typed and the quantity is not converted.
  const inv = sale({ items: [line('Marker', 1, 700, { hsn: '9608', unit: 'BOX', unit_factor: 12 })] });
  const r = itemProfitability({ invoices: [inv], purchases: [bill] }, FY).rows[0];
  assert.equal(r.cost, 600);
  assert.equal(r.quantity, 1);
  assert.equal(r.unit, 'BOX');
});

/* ── Other per-item quantity reports ──────────────────────────── */

test('sales by item: alternate-unit lines in the base unit when the item is known', () => {
  const { docs } = salesDocs([sale({ items: [box(2), line('Pen', 5, 50)] })]);
  const idx = buildItemIndex([PEN]);
  const withIdx = salesByItem(docs, FY, 'item', idx).rows[0];
  assert.equal(withIdx.quantity, 29);
  assert.equal(withIdx.unit, 'NOS');
  assert.equal(withIdx.taxable, 1450);
  assert.equal(withIdx.avgRate, 50);
  const hsn = salesByItem(docs, FY, 'hsn', idx).rows[0];
  assert.equal(hsn.quantity, 29);
  // No stock item: as before (typed quantities).
  assert.equal(salesByItem(docs, FY, 'item').rows[0].quantity, 7);
});

test('stock-vs-sold profit and dashboard best sellers count base units', () => {
  const inv = sale({ id: 'D', items: [box(2), line('Pen', 6, 50)] });
  const positions = computeStock({ items: [PEN], moves: [], invoices: [inv], purchases: [] });
  const p = profitByItem(salesDocs([inv]).docs, positions, FY).rows[0];
  assert.equal(p.quantity, 30);
  assert.equal(p.cogs, 1500);
  assert.equal(p.unit, 'NOS');
  assert.equal(topItems([inv], FY.start, FY.end)[0].qty, 30);
});

/* ── GSTR-1 HSN summary ───────────────────────────────────────── */

const g = (first14: string) => first14 + gstinChecksumChar(first14);
const FILER = g('27AAAAA0000A1Z');
const PERIOD: ReportPeriod = { kind: 'month', fyStart: 2025, month: 4 };
const UNITS: UnitMaster[] = [
  { id: 'u1', symbol: 'CRT', name: 'Crate', uqc: 'CTN' },
  { id: 'u2', symbol: 'NOS', uqc: 'PCS' }, // override of a built-in
  { id: 'u3', first: 'BOX', factor: 12, second: 'NOS', symbol: '' }, // compound: never a UQC source
];

function gstInv(items: InvoiceItem[]): InvoiceRecord {
  return {
    id: `g${++seq}`, invoice_number: `G/${seq}`, doc_type: 'TAX_INVOICE', issue_date: '2025-04-05', due_date: '2025-04-20', status: 'Sent', currency: 'INR',
    template_id: 't', client: { name: 'Buyer', email: '', address: '', city: '', zip: '' }, sender: { companyGstin: FILER, stateCode: '27', companyName: 'Me' },
    items, gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0,
    other_charges: 0, round_off_enabled: false, amount_paid: 0,
  } as unknown as InvoiceRecord;
}

test('HSN summary: alternate-unit line in the base unit and its UQC when the item is known', () => {
  const invs = [gstInv([line('Pen', 2, 600, { unit: 'BOX', unit_factor: 12, tax_rate: 18 }), line('Pen', 6, 50, { tax_rate: 18 })])];
  const idx = buildItemIndex([PEN]);
  const withItems = buildGstReport(invs, [], { period: PERIOD, gstin: FILER, items: idx }).gstr1.hsn;
  assert.equal(withItems.length, 1);
  assert.equal(withItems[0].uqc, 'NOS');
  assert.equal(withItems[0].qty, 30);
  assert.equal(withItems[0].taxable, 1500);
  // Without the stock items: as typed, one row per UQC (unchanged behaviour).
  const typed = buildGstReport(invs, [], { period: PERIOD, gstin: FILER }).gstr1.hsn;
  assert.deepEqual(typed.map((h) => [h.uqc, h.qty]).sort(), [['BOX', 2], ['NOS', 6]]);
  // GSTR-9 Table 17 follows the same rule when given the same options.
  const g9 = buildGstr9(invs, [], { fyStart: 2025, gstin: FILER, items: idx });
  const t17 = g9.table17.find((h) => h.hsn === '8471')!;
  assert.equal(t17.uqc, 'NOS');
  assert.equal(t17.qty, 30);
});

test('HSN summary: units master UQC for user-defined units; built-in map without a row; SAC stays NA', () => {
  assert.deepEqual(hsnLineQty({ name: 'Apples', hsn: '0808', unit: 'CRT', quantity: 4 }, { units: UNITS }), { uqc: 'CTN', qty: 4 });
  assert.deepEqual(hsnLineQty({ name: 'Apples', hsn: '0808', unit: 'CRT', quantity: 4 }, {}), { uqc: 'OTH', qty: 4 });
  assert.deepEqual(hsnLineQty({ name: 'Bolt', hsn: '7318', unit: 'NOS', quantity: 4 }, { units: UNITS }), { uqc: 'PCS', qty: 4 });
  assert.deepEqual(hsnLineQty({ name: 'Bolt', hsn: '7318', unit: 'KG', quantity: 4 }, { units: UNITS }), { uqc: 'KGS', qty: 4 });
  assert.deepEqual(hsnLineQty({ name: 'Bolt', hsn: '7318', unit: 'BOX', quantity: 4 }, { units: UNITS }), { uqc: 'BOX', qty: 4 });
  assert.equal(hsnLineQty({ name: 'Audit', hsn: '998221', unit: 'CRT', quantity: 1 }, { units: UNITS }).uqc, 'NA');
  // Base unit known → converted, base unit's master UQC used.
  assert.deepEqual(hsnLineQty({ name: 'Pen', hsn: '8471', unit: 'BOX', quantity: 2, unit_factor: 12 }, { units: UNITS, items: buildItemIndex([PEN]) }), { uqc: 'PCS', qty: 24 });
  const rep = buildGstReport([gstInv([line('Apples', 4, 100, { hsn: '0808', unit: 'CRT', tax_rate: 0 })])], [], { period: PERIOD, gstin: FILER, units: UNITS });
  assert.equal(rep.gstr1.hsn[0].uqc, 'CTN');
});

/* ── e-Invoice / e-Way ────────────────────────────────────────── */

test('e-Invoice and e-Way: user unit sent as its master UQC; built-in mapping unchanged', () => {
  assert.equal(portalUqc('CRT', UNITS), 'CTN');
  assert.equal(portalUqc('CRT'), 'OTH');
  assert.equal(portalUqc('KG', UNITS), 'KGS');
  assert.equal(portalUqc('NOS', UNITS), 'PCS');
  assert.equal(portalUqc('XYZ', [{ id: 'z', symbol: 'XYZ', uqc: 'NOTAUQC' }]), 'OTH'); // invalid master code ignored
  assert.equal(isUnitGuessed('CRT'), true);
  assert.equal(isUnitGuessed('CRT', UNITS), false);

  const rec = einvInvoice({ items: [einvItem({ unit: 'CRT', quantity: 3, rate: 1000 }), einvItem({ id: 'b', unit: 'KG', quantity: 2, rate: 100 })] });
  assert.deepEqual(buildEInvoice(rec, { units: UNITS }).payload.ItemList.map((i) => i.Unit), ['CTN', 'KGS']);
  assert.deepEqual(buildEInvoice(rec).payload.ItemList.map((i) => i.Unit), ['OTH', 'KGS']);
  const warnCodes = (u?: UnitMaster[]) => preflightEInvoice(rec, { units: u, now: new Date(2025, 5, 20) }).warnings.map((w) => w.code);
  assert.ok(warnCodes().includes('ITEM_UNIT_GUESS'));
  assert.ok(!warnCodes(UNITS).includes('ITEM_UNIT_GUESS'));
  // Alternate-unit line goes to the IRP as typed (2 BOX), matching the printed invoice.
  const alt = einvInvoice({ items: [einvItem({ unit: 'BOX', unit_factor: 12, quantity: 2, rate: 600 })] });
  const it = buildEInvoice(alt, { units: UNITS }).payload.ItemList[0];
  assert.equal(it.Qty, 2);
  assert.equal(it.Unit, 'BOX');

  assert.deepEqual(buildEway(rec, { units: UNITS }).bill.itemList.map((i) => i.qtyUnit), ['CTN', 'KGS']);
  assert.deepEqual(buildEway(rec).bill.itemList.map((i) => i.qtyUnit), ['OTH', 'KGS']);
});
