/** RT-B3: ceiling + GST warning by date, loose rate from the strip MRP, margins on PTR with free goods. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import type { StockItem } from '../src/lib/inventory.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';
import { addCeiling, applyLoosePrice, ceilingAt, ceilingIssues, importCeilings, loosePack, looseRate, marginCsv, marginRows, parseCeilingCsv, patchStockItem } from '../src/lib/retail/rt-pharmacy-prices.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const item = (over: Partial<StockItem> = {}) => ({ id: 's1', name: 'Amoxycillin 500 CAP', unit: 'CAP', alt_units: [{ unit: 'STRIP', factor: 10 }], ...over }) as StockItem;

test('ceiling + GST warning by date (append-only rows; per STRIP converted to per unit)', () => {
  let list = addCeiling(undefined, { from: '2025-04-01', price_per_unit: 5 });
  list = addCeiling(list, { from: '2026-04-01', price_per_unit: 60, unit: 'STRIP' });
  assert.throws(() => addCeiling(list, { from: '2026-04-01', price_per_unit: 7 }), /already recorded/);
  assert.throws(() => addCeiling(list, { from: '2026-04-01x', price_per_unit: 7 }), /date/);
  assert.equal(ceilingAt(list, '2026-03-31')?.price_per_unit, 5);
  assert.equal(ceilingAt(list, '2026-05-01')?.price_per_unit, 60);
  const items = [item({ ceiling_prices: list })];
  // 2025-26: ceiling 5 + 12% GST = 5.60 per CAP; MRP 5.80 per CAP is above it.
  assert.deepEqual(ceilingIssues([{ name: 'Amoxycillin 500 CAP', mrp: 5.8, tax_rate: 12 }], items, '2025-10-01'), [{ name: 'Amoxycillin 500 CAP', mrp: 5.8, limit: 5.6, ceiling: 5, from: '2025-04-01' }]);
  // From 2026-04-01 the ceiling is ₹60 a STRIP of 10 = ₹6 a CAP → 6.72 with GST: no warning.
  assert.deepEqual(ceilingIssues([{ name: 'Amoxycillin 500 CAP', mrp: 5.8, tax_rate: 12 }], items, '2026-05-01'), []);
  assert.deepEqual(ceilingIssues([{ name: 'Amoxycillin 500 CAP', mrp: 5.6, tax_rate: 12 }], items, '2025-10-01'), [], 'exactly at the limit');
  assert.deepEqual(ceilingIssues([{ name: 'Amoxycillin 500 CAP', tax_rate: 12 }], items, '2025-10-01'), [], 'no MRP, nothing to check');
  assert.deepEqual(ceilingIssues([{ name: 'Amoxycillin 500 CAP', mrp: 9 }], items, '2025-01-01'), [], 'before the first order');
});

test('ceiling CSV: parse and append to the named items', () => {
  const rows = parseCeilingCsv('Item,Ceiling,Unit,Date\nAmoxycillin 500 CAP, 5.25, CAP, 01-04-2026\n"Unknown", 3, , 2026-04-01\nbad,x,,');
  assert.deepEqual(rows.map((r) => [r.name, r.row.from, r.row.price_per_unit]), [['Amoxycillin 500 CAP', '2026-04-01', 5.25], ['Unknown', '2026-04-01', 3]]);
  setTable('stock_items', [item()]);
  assert.deepEqual(importCeilings(rows), { added: 1, missing: ['Unknown'] });
  assert.equal(importCeilings(rows).added, 0, 'the same date is never added twice');
  assert.deepEqual(getTable<StockItem>('stock_items')[0].ceiling_prices, [{ from: '2026-04-01', price_per_unit: 5.25, unit: 'CAP' }]);
  patchStockItem('s1', { narcotic: true, pts: 0 });
  assert.equal(getTable<StockItem>('stock_items')[0].narcotic, true);
  assert.equal('pts' in getTable<StockItem>('stock_items')[0], false);
});

test('loose rate from the strip MRP (₹62 strip of 10 → 4 TAB = ₹24.80)', () => {
  assert.deepEqual(loosePack(item({ unit: 'TAB', alt_units: [{ unit: 'STRIP', factor: 10 }, { unit: 'BOX', factor: 100 }] })), { unit: 'BOX', factor: 100 });
  assert.equal(loosePack(item({ alt_units: undefined })), undefined);
  assert.equal(looseRate(62, 10), 6.2);
  assert.equal(Math.round(4 * looseRate(62, 10) * 100) / 100, 24.8);
  assert.equal(looseRate(62, 10, 10), 5.58, 'less the item\'s MRP-less %');
  setTable('stock_items', [item({ id: 't', name: 'Pan 40 TAB', unit: 'TAB', sale_rate: 0 })]);
  const cat: InvoiceItem = { id: 'c', name: 'Pan 40 TAB', description: '', type: 'Goods', hsn: '3004', unit: 'TAB', quantity: 1, rate: 0, tax_rate: 12, discount_percent: 0, amount: 0 };
  setTable('items_catalog', [cat]);
  assert.equal(applyLoosePrice('t', 62), 6.2);
  const saved = getTable<InvoiceItem>('items_catalog')[0];
  assert.deepEqual([saved.mrp, saved.rate], [6.2, 6.2], 'MRP and rate per TAB (the MRP guard compares per base unit)');
  assert.equal(getTable<StockItem>('stock_items')[0].sale_rate, 6.2);
  // A rate already set by hand is kept (only the MRP per unit is written).
  setTable('items_catalog', [{ ...cat, rate: 6 }]);
  assert.equal(applyLoosePrice('t', 70), 6);
  assert.deepEqual([getTable<InvoiceItem>('items_catalog')[0].mrp, getTable<InvoiceItem>('items_catalog')[0].rate], [7, 6]);
  setTable('stock_items', [item({ id: 'n', name: 'No pack', alt_units: undefined })]);
  assert.throws(() => applyLoosePrice('n', 62), /no larger unit/);
});

test('margin on PTR with free goods (10 + 1 at ₹80 less 5%)', () => {
  const purchases = [
    { id: 'p0', kind: 'PURCHASE', vendor_name: 'Old Dist', bill_number: 'O1', date: '2026-05-01', status: 'unpaid', lines: [{ id: 'a', name: 'Amoxycillin 500 CAP', quantity: 10, rate: 70, batch_no: 'B1' }], total: 700 },
    { id: 'p1', kind: 'PURCHASE', vendor_name: 'Pharma Dist', bill_number: 'D1', date: '2026-06-01', status: 'unpaid', lines: [{ id: 'b', name: 'Amoxycillin 500 CAP', quantity: 10, free_qty: 1, rate: 80, discount_percent: 5, batch_no: 'B1', mrp: 110 }], total: 760 },
    { id: 'p2', kind: 'PURCHASE', vendor_name: 'Pharma Dist', bill_number: 'D2', date: '2026-06-05', status: 'unpaid', lines: [{ id: 'c', name: 'Amoxycillin 500 CAP', quantity: 1, unit: 'STRIP', unit_factor: 10, rate: 700, batch_no: 'B2' }], total: 700 },
  ];
  const rows = marginRows(purchases, [{ id: 's1', name: 'Amoxycillin 500 CAP', pts: 68 }], [{ name: 'Amoxycillin 500 CAP', rate: 95, mrp: 110 }]);
  assert.deepEqual(rows.map((r) => [r.batch, r.ptr, r.cost, r.mrp, r.sell, r.margin, r.marginNet, r.scheme, r.bill, r.pts]), [
    ['B1', 76, 69.09, 110, 95, 25, 37.5, '10 + 1', 'Pharma Dist D1', 68],
    ['B2', 70, 70, 110, 95, 35.71, 35.71, '', 'Pharma Dist D2', 68],
  ]);
  assert.match(marginCsv(rows), /verify with your CA[\s\S]*Amoxycillin 500 CAP,B1,76,69.09,68,110,95,25,37.5,10 \+ 1/);
});
