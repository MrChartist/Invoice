import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATASETS,
  UTF8_BOM,
  buildAccountantBundle,
  buildAllDatasets,
  buildDataset,
  csvCell,
  fyRange,
  inRange,
  money,
  safeText,
  toCsv,
  fmtDate,
  fyStartYearOf,
} from '../src/lib/accounting-export.ts';
import { fullSource, makeInvoice } from './export-fixtures.ts';

const val = (c: unknown) => (c && typeof c === 'object' ? (c as { money: number }).money : c);
const row = (rows: unknown[][], i: number) => rows[i].map(val);

test('csvCell quoting and formula-injection guard', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell(money(1180)), '1180.00');
  assert.equal(csvCell(money(-0.4)), '-0.40');
  assert.equal(csvCell(money(-0.001)), '0.00');
  assert.equal(csvCell(null), '');
  assert.equal(safeText('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(safeText('@cmd'), "'@cmd");
  assert.equal(safeText('-cmd|x'), "'-cmd|x");
  assert.equal(safeText('+91 98200 00000'), '+91 98200 00000');
  assert.equal(safeText('-12.50'), '-12.50');
});

test('toCsv uses CRLF and optional UTF-8 BOM', () => {
  const t = { headers: ['A', 'B'], rows: [['x', 1], ['₹ y', money(2)]] };
  assert.equal(toCsv(t), 'A,B\r\nx,1\r\n₹ y,2.00\r\n');
  assert.ok(toCsv(t, { bom: true }).startsWith(UTF8_BOM + 'A,B'));
});

test('date helpers and Indian FY ranges', () => {
  assert.deepEqual(fyRange(2025), { from: '2025-04-01', to: '2026-03-31' });
  assert.ok(inRange('2026-03-31', fyRange(2025)));
  assert.ok(!inRange('2026-04-01', fyRange(2025)));
  assert.equal(fyStartYearOf('2026-03-31'), 2025);
  assert.equal(fyStartYearOf('2026-04-01'), 2026);
  assert.equal(fmtDate('2025-04-15', 'dmy'), '15-04-2025');
});

test('sales register: hand-computed amounts, credit notes negative', () => {
  const t = buildDataset('sales_register', fullSource());
  assert.equal(t.rows.length, 3);
  assert.equal(t.headers.length, t.rows[0].length);
  const h = (name: string) => t.headers.indexOf(name);
  const r0 = row(t.rows, 0);
  assert.equal(r0[h('Voucher No')], 'INV/FY25-26/0001');
  assert.equal(r0[h('Taxable Value')], 1000);
  assert.equal(r0[h('CGST')], 90);
  assert.equal(r0[h('SGST')], 90);
  assert.equal(r0[h('IGST')], 0);
  assert.equal(r0[h('Invoice Total')], 1180);
  assert.equal(r0[h('Place of Supply')], '27-Maharashtra');
  const r1 = row(t.rows, 1);
  assert.equal(r1[h('IGST')], 179.91);
  assert.equal(r1[h('Round Off')], -0.41);
  assert.equal(r1[h('Invoice Total')], 1179);
  const r2 = row(t.rows, 2);
  assert.equal(r2[h('Document Type')], 'Credit Note');
  assert.equal(r2[h('Taxable Value')], -1000);
  assert.equal(r2[h('Invoice Total')], -1180);
});

test('sales register honours date range, drafts and date format', () => {
  const src = fullSource();
  src.invoices.push(makeInvoice({ id: 'd', invoice_number: 'D1', status: 'Draft' }));
  assert.equal(buildDataset('sales_register', src).rows.length, 3);
  assert.equal(buildDataset('sales_register', src, { includeDrafts: true }).rows.length, 4);
  const may = buildDataset('sales_register', src, { range: { from: '2025-05-01', to: '2025-05-31' }, dateFormat: 'dmy' });
  assert.equal(may.rows.length, 1);
  assert.equal(may.rows[0][0], '01-05-2025');
});

test('sales line items: Zoho-style columns with computed line tax', () => {
  const t = buildDataset('sales_items', fullSource());
  assert.equal(t.rows.length, 3);
  const h = (n: string) => t.headers.indexOf(n);
  assert.ok(t.headers.includes('Customer Name') && t.headers.includes('Item Price') && t.headers.includes('Item Tax %'));
  const r = row(t.rows, 0);
  assert.equal(r[h('Item Name')], 'Consulting');
  assert.equal(r[h('Quantity')], 2);
  assert.equal(r[h('Item Price')], 500);
  assert.equal(r[h('Taxable Value')], 1000);
  assert.equal(r[h('Item Tax %')], 18);
  assert.equal(r[h('Line Total')], 1180);
  assert.equal(r[h('GST Treatment')], 'business_gst');
  assert.equal(row(t.rows, 2)[h('Line Total')], -1180);
});

test('receipts and purchase register', () => {
  const rc = buildDataset('receipts', fullSource());
  assert.equal(rc.rows.length, 2);
  assert.deepEqual(row(rc.rows, 0).slice(0, 6), ['2025-04-20', 'INV/FY25-26/0001', 'Acme Traders', 500, 'UPI', 'Bank']);
  assert.equal(row(rc.rows, 1)[5], 'Cash');
  const pr = buildDataset('purchase_register', fullSource());
  assert.equal(pr.rows.length, 1);
  const h = (n: string) => pr.headers.indexOf(n);
  const r = row(pr.rows, 0);
  assert.equal(r[h('Vendor Name')], 'Supplies & Co');
  assert.equal(r[h('Taxable Value')], 2000);
  assert.equal(r[h('Total Tax')], 360);
  assert.equal(r[h('Bill Total')], 2360);
  assert.equal(r[h('Place of Supply')], '29-Karnataka');
});

test('GST rate-wise summary groups by section and nets credit notes', () => {
  const t = buildDataset('gst_summary', fullSource());
  const rows = t.rows.map((r) => r.map(val));
  // [Section, Rate, Docs, Taxable, CGST, SGST, IGST, Total Tax]
  assert.deepEqual(rows[0], ['Sales', 18, 2, 1999.5, 90, 90, 179.91, 359.91]);
  assert.deepEqual(rows[1], ['Credit Notes', 18, 1, -1000, -90, -90, 0, -180]);
  assert.deepEqual(rows[2], ['Purchases', 18, 1, 2000, 180, 180, 0, 360]);
  assert.deepEqual(rows[3], ['Net Sales', 18, '', 999.5, 0, 0, 179.91, 179.91]);
});

test('party and item masters dedupe and enrich', () => {
  const p = buildDataset('parties', fullSource());
  const names = p.rows.map((r) => `${r[0]}:${r[1]}`);
  assert.deepEqual(names, ['Customer:Acme Traders', 'Customer:Delhi Buyer', 'Vendor:Supplies & Co']);
  const acme = row(p.rows, 0);
  assert.equal(acme[3], '27AAAAA0000A1Z5');
  assert.equal(acme[4], 'Registered');
  assert.equal(acme[5], 'AAAAA0000A');
  assert.equal(acme[7], 'Maharashtra');
  const it = buildDataset('items', fullSource());
  assert.deepEqual(it.rows.map((r) => r[0]), ['Consulting', 'Widget']);
  assert.equal(it.rows[0][7], 'Catalogue'); // catalogue wins over invoice copy
  assert.equal(it.rows[0][3], 'HRS');
});

test('every dataset has rectangular rows and a documented catalogue entry', () => {
  const all = buildAllDatasets(fullSource());
  assert.equal(all.length, DATASETS.length);
  for (const t of all) {
    for (const r of t.rows) assert.equal(r.length, t.headers.length, t.id);
    assert.ok(t.compatibleWith.length > 0);
  }
});

test('empty data yields header-only CSVs without throwing', () => {
  const empty = { invoices: [], payments: [], clients: [], items: [], purchases: [], vendors: [] };
  for (const t of buildAllDatasets(empty)) {
    assert.equal(t.rows.length, 0, t.id);
    assert.ok(toCsv(t).startsWith(t.headers[0]));
  }
});

test('accountant bundle: files, tally xml, combined JSON, warnings', () => {
  const b = buildAccountantBundle(fullSource(), {
    companyName: 'Mr. Chartist & Co',
    datasets: ['sales_register', 'receipts'],
    tally: { masters: true, vouchers: true },
    bom: true,
    range: fyRange(2025),
    rangeLabel: 'FY25-26',
  });
  assert.deepEqual(
    b.files.map((f) => f.filename),
    [
      'mr-chartist-co_fy25-26_sales-register.csv',
      'mr-chartist-co_fy25-26_receipts.csv',
      'mr-chartist-co_fy25-26_tally-masters.xml',
      'mr-chartist-co_fy25-26_tally-vouchers.xml',
    ],
  );
  assert.ok(b.files[0].content.startsWith(UTF8_BOM));
  const json = JSON.parse(b.combined.content);
  assert.deepEqual(Object.keys(json.datasets), ['sales_register', 'receipts']);
  assert.equal(json.datasets.sales_register.rows.length, 3);
  assert.equal(json.datasets.sales_register.rows[0][7], 1000);
  assert.equal(json.tally.sales, 2);
});
