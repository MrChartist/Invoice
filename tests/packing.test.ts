/** R2-C4: packing list — allocation completeness, alternate units, weights / CBM, numbering, snapshot. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  autoPackages,
  blankPackage,
  linesFromDocument,
  loadPackingLists,
  nextPackingNumber,
  packageFigures,
  packageTypesDb,
  packedQty,
  packingFromDocument,
  packingSheetRows,
  packingTotals,
  renumber,
  savePackingList,
  setCatalogWeights,
  toKg,
  validatePacking,
  weightIndex,
  loadWeightIndex,
  PackingError,
} from '../src/lib/packing.ts';
import { packingListHtml } from '../src/lib/packing-print.ts';
import { seriesHigh } from '../src/lib/series-counters.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';

const item = (id: string, name: string, quantity: number, extra: Partial<InvoiceItem> = {}): InvoiceItem =>
  ({ id, name, type: 'Goods', quantity, rate: 10, amount: quantity * 10, unit: 'NOS', ...extra }) as InvoiceItem;

const invoice = (items: InvoiceItem[]): InvoiceRecord =>
  ({
    id: 'inv-1', doc_type: 'TAX_INVOICE', invoice_number: 'INV/FY25-26/0007', issue_date: '2025-11-05', status: 'Sent',
    client: { name: 'Buyer Ltd', email: '', address: '', city: '', zip: '' }, items,
    ship_to: { name: 'Warehouse 2', city: 'Pune' },
  }) as unknown as InvoiceRecord;

beforeEach(() => resetStorage());

test('weights: stock item first, catalogue fills gaps, grams converted, aliases matched', () => {
  const w = weightIndex(
    [{ name: 'Soap', net_weight: 100, weight_unit: 'g', aliases: ['Bath soap'] }],
    [{ name: 'soap', net_weight: 5 }, { name: 'Oil 1L', net_weight: 0.92, gross_weight: 1.0 }],
  );
  assert.equal(w.get('soap')?.net_kg, 0.1);
  assert.equal(w.get('bath soap')?.net_kg, 0.1);
  assert.deepEqual(w.get('oil 1l'), { net_kg: 0.92, gross_kg: 1 });
  assert.equal(toKg(250, 'g'), 0.25);
  assert.equal(toKg(-3, 'kg'), 0);
});

test('alternate units: a BOX line of 12 converts through lineFactor; lines without quantity are left out', () => {
  const w = weightIndex([], [{ name: 'Soap', net_weight: 0.1 }]);
  const lines = linesFromDocument([item('a', 'Soap', 2, { unit: 'BOX', unit_factor: 12 }), item('b', 'Note', 0)], w);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].unit_factor, 12);
  const [p] = autoPackages(lines, 'all-in-one', undefined, () => 'p1');
  assert.equal(packageFigures(p, lines).net_kg, 2.4, '2 boxes × 12 × 0.1 kg');
});

test('allocation completeness: shortfall, excess and empty packages are reported', () => {
  const lines = linesFromDocument([item('a', 'Soap', 10), item('b', 'Oil', 4)], new Map());
  const pkgs = autoPackages(lines, 'per-line', undefined, (() => { let n = 0; return () => `p${++n}`; })());
  assert.deepEqual(validatePacking(lines, pkgs), []);
  // Two identical boxes of 4 soap each = 8 packed of 10.
  const short = renumber([{ ...pkgs[0], count: 2, contents: [{ line_id: 'a', qty: 4 }] }, pkgs[1]]);
  assert.equal(packedQty(short).get('a'), 8);
  assert.match(validatePacking(lines, short)[0].message, /2 not packed/);
  const over = [{ ...pkgs[0], contents: [{ line_id: 'a', qty: 11 }] }, pkgs[1]];
  assert.match(validatePacking(lines, over)[0].message, /1 packed more/);
  const empty = [...pkgs, blankPackage(3)];
  assert.ok(validatePacking(lines, empty).some((i) => /empty/.test(i.message)));
  assert.equal(short[1].from_no, 3, 'box numbers run on after a row of 2');
});

test('weights and CBM: net from items, gross = net + packaging + tare, counts multiply', () => {
  const w = weightIndex([], [{ name: 'Oil', net_weight: 0.9, gross_weight: 1.0 }, { name: 'Soap', net_weight: 0.1 }]);
  const lines = linesFromDocument([item('a', 'Oil', 6), item('b', 'Soap', 10)], w);
  const box = { ...blankPackage(1), id: 'b1', count: 2, length_cm: 40, breadth_cm: 30, height_cm: 25, tare_kg: 0.5, contents: [{ line_id: 'a', qty: 3 }, { line_id: 'b', qty: 5 }] };
  const f = packageFigures(box, lines);
  assert.equal(f.net_kg, 3.2, '3 × 0.9 + 5 × 0.1');
  assert.equal(f.gross_kg, 4, '3.2 + 3 × 0.1 packaging + 0.5 tare');
  assert.equal(f.cbm, 0.03);
  const t = packingTotals([box], lines);
  assert.deepEqual(t, { packages: 2, net_kg: 6.4, gross_kg: 8, cbm: 0.06 });
});

test('numbering PKL/FY…, never reused; snapshot kept when the invoice changes; FY respected', () => {
  setTable('items_catalog', [item('c1', 'Soap', 1)]);
  setCatalogWeights('c1', { net_weight: 100, weight_unit: 'g' });
  assert.equal(getTable<InvoiceItem>('items_catalog')[0].net_weight, 100);
  const inv = invoice([item('a', 'Soap', 10)]);
  const input = packingFromDocument(inv, loadWeightIndex(), '2025-11-06');
  assert.equal(input.party, 'Buyer Ltd');
  assert.equal(input.ship_to, 'Warehouse 2, Pune');
  assert.equal(input.lines[0].net_kg, 0.1);
  assert.throws(() => savePackingList(input), PackingError, 'no packages yet');
  const pl1 = savePackingList({ ...input, packages: autoPackages(input.lines, 'all-in-one') });
  assert.equal(pl1.number, 'PKL/FY25-26/0001');
  const pl2 = savePackingList({ ...input, packages: autoPackages(input.lines, 'per-line') });
  assert.equal(pl2.number, 'PKL/FY25-26/0002');
  setTable('packing_lists', loadPackingLists().filter((r) => r.id !== pl2.id));
  assert.equal(nextPackingNumber('2025-12-01'), 'PKL/FY25-26/0003', 'a deleted latest number is not reused');
  assert.equal(seriesHigh('PKL', '25-26'), 2);
  assert.equal(nextPackingNumber('2026-04-02'), 'PKL/FY26-27/0001');
  // The invoice changes later: the saved list keeps its own lines.
  inv.items[0].quantity = 99;
  assert.equal(loadPackingLists()[0].lines[0].quantity, 10);
  // Edit keeps the number.
  const edited = savePackingList({ ...pl1, notes: 'Fragile' });
  assert.equal(edited.number, pl1.number);
  assert.equal(edited.notes, 'Fragile');
});

test('package types master, sheet rows and print are escaped and script-free', () => {
  const t = packageTypesDb.save({ name: 'Carton L', length_cm: 60, breadth_cm: 40, height_cm: 40, tare_kg: 0.8 });
  assert.throws(() => packageTypesDb.save({ name: 'carton l', length_cm: 1, breadth_cm: 1, height_cm: 1, tare_kg: 0 }), /already exists/);
  const lines = linesFromDocument([item('a', '<b>Soap</b>', 4)], new Map([['<b>soap</b>', { net_kg: 0.25 }]]));
  const pkgs = autoPackages(lines, 'all-in-one', t);
  assert.equal(pkgs[0].tare_kg, 0.8);
  const pl = { id: 'x', number: 'PKL/FY25-26/0001', date: '2025-11-06', source: { kind: 'invoice' as const, id: 'i', number: 'INV/1', doc_type: 'TAX_INVOICE' as const }, party: 'A & B', lines, packages: pkgs, created_at: '' };
  const html = packingListHtml(pl, { name: 'Shop' }, '#0f766e');
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes('&lt;b&gt;Soap&lt;/b&gt;') && html.includes('A &amp; B'));
  assert.ok(html.includes('#0f766e'));
  const rows = packingSheetRows(pl);
  assert.equal(rows[0][1], 'PKL/FY25-26/0001');
  assert.equal(rows.at(-1)?.[3], 1, 'net 4 × 0.25 kg');
});
