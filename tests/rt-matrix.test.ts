/** RT-C2 size × colour grid: grid → lines and back (update, never duplicate), three axes, the stock grid, labels. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setTable } from '../src/lib/storage.ts';
import { computeStock, liveInputs, type StockItem } from '../src/lib/inventory.ts';
import { loadTracking } from '../src/lib/stock-tracking.ts';
import { cellKey, gridAxes, gridCells, gridParents, gridToLines, linesToGrid, parentOfName, purchaseLine, saleLine, soldLast30, stockGrid, stockGridCsv } from '../src/lib/retail/rt-matrix.ts';
import { attrLine, expandLabels, labelSheetHtml, layoutById, LABEL_LAYOUTS } from '../src/lib/label-sheet.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const SIZES = ['S', 'M', 'L', 'XL'];
const COLOURS = ['Red', 'Blue', 'Green'];
const parent: StockItem = { id: 'krt', name: 'KRT-104', hsn: '6211', unit: 'PCS', tax_rate: 18, sale_rate: 2799, opening_rate: 1400, gst_band: 'apparel', variant_axes: [{ name: 'Size', values: SIZES }, { name: 'Colour', values: COLOURS }] } as StockItem;
const kids: StockItem[] = SIZES.flatMap((s) => COLOURS.map((c) => ({ id: `k-${s}-${c}`, name: `KRT-104 - ${s} / ${c}`, hsn: '6211', unit: 'PCS', track_stock: true, opening_qty: 3, opening_rate: 1400, variant_of: 'krt', variant_attrs: { Size: s, Colour: c } }) as unknown as StockItem));
const all = [parent, ...kids];
const key = (s: string, c: string) => cellKey({ Size: s, Colour: c }, gridAxes(parent));
let n = 0;
const make = (child: StockItem, qty: number, rate: number) => saleLine(child, parent, qty, rate, `n${++n}`);

test('a 4 × 3 grid makes 12 lines; reopened it reads the bill, a change updates (never duplicates), zero removes', () => {
  assert.equal(gridCells(parent, all).length, 12);
  assert.deepEqual(gridParents(all).map((p) => p.id), ['krt']);
  assert.equal(parentOfName('krt-104 - m / blue', all)?.id, 'krt');
  const grid = SIZES.flatMap((s) => COLOURS.map((c) => ({ key: key(s, c), qty: 2 })));
  const blank = { id: 'b', name: '', quantity: 1, rate: 0 } as InvoiceItem;
  const first = gridToLines([blank], parent, all, grid, 1500, make);
  assert.equal(first.lines.length, 12, 'the blank starter line is dropped');
  assert.ok(first.lines.every((l) => l.quantity === 2 && l.rate === 1500 && l.hsn === '6211' && l.band_rate?.kind === 'apparel'));
  // Back to the grid.
  const back = linesToGrid(first.lines, parent, all);
  assert.deepEqual(back[key('M', 'Blue')], { qty: 2, rate: 1500 });
  // Change one cell, clear another, a per-cell rate; an unrelated line stays.
  const other = { id: 'o', name: 'Socks', quantity: 1, rate: 99 } as InvoiceItem;
  const next = gridToLines([...first.lines, other], parent, all, [{ key: key('M', 'Blue'), qty: 5, rate: 1600 }, { key: key('S', 'Red'), qty: 0 }, ...grid.filter((g) => g.key !== key('M', 'Blue') && g.key !== key('S', 'Red'))], 1500, make);
  assert.equal(next.lines.length, 12, '11 grid lines + the other line');
  const mb = next.lines.filter((l) => l.name === 'KRT-104 - M / Blue');
  assert.equal(mb.length, 1);
  assert.deepEqual([mb[0].quantity, mb[0].rate, mb[0].id], [5, 1600, first.lines.find((l) => l.name === 'KRT-104 - M / Blue')!.id], 'updated in place');
  assert.ok(!next.lines.some((l) => l.name === 'KRT-104 - S / Red'));
  assert.ok(next.lines.some((l) => l.id === 'o'));
  // A duplicate line of the same child collapses into one.
  const dup = gridToLines([first.lines[0], { ...first.lines[0], id: 'dup' }], parent, all, [{ key: cellKey(kids[0].variant_attrs, gridAxes(parent)), qty: 7 }], 1500, make);
  assert.deepEqual(dup.lines.map((l) => [l.id, l.quantity]), [[first.lines[0].id, 7]]);
});

test('missing children are reported, not added; purchase lines stock in by item id at the band of their cost', () => {
  const some = all.filter((i) => i.id !== 'k-XL-Green');
  const r = gridToLines([], parent, some, [{ key: key('XL', 'Green'), qty: 2 }, { key: key('S', 'Red'), qty: 1 }], 1000, make);
  assert.deepEqual(r.missing, ['XL / Green']);
  assert.equal(r.lines.length, 1);
  const pl = purchaseLine(kids[0], parent, 4, 1400, 'p1', '2026-07-01');
  assert.deepEqual([pl.item_id, pl.tax_rate, pl.quantity], ['k-S-Red', 5, 4]);
  assert.equal(purchaseLine(kids[0], parent, 1, 2600, 'p2', '2026-07-01').tax_rate, 18);
  const lines = gridToLines([], parent, all, [{ key: key('S', 'Red'), qty: 4 }, { key: key('M', 'Red'), qty: 6 }], 1400, (c, q, rt) => purchaseLine(c, parent, q, rt, `p${c.id}`, '2026-07-01'));
  assert.deepEqual(lines.lines.map((l) => [l.item_id, l.quantity]), [['k-S-Red', 4], ['k-M-Red', 6]]);
});

test('three axes: one table per value of the third axis, every combination a cell', () => {
  const p3 = { ...parent, id: 'p3', variant_axes: [{ name: 'Size', values: ['S', 'M'] }, { name: 'Colour', values: ['Red'] }, { name: 'Fit', values: ['Slim', 'Regular'] }] } as StockItem;
  const k3 = ['S', 'M'].flatMap((s) => ['Slim', 'Regular'].map((f) => ({ id: `${s}${f}`, name: `P3 ${s} ${f}`, variant_of: 'p3', variant_attrs: { Size: s, Colour: 'Red', Fit: f } }) as unknown as StockItem));
  const cells = gridCells(p3, [p3, ...k3]);
  assert.equal(cells.length, 4);
  assert.ok(cells.every((c) => c.child));
  const r = gridToLines([], p3, [p3, ...k3], [{ key: cellKey({ Size: 'M', Colour: 'Red', Fit: 'Slim' }, gridAxes(p3)), qty: 3 }], 900, (c, q, rt) => saleLine(c, p3, q, rt, 'x'));
  assert.deepEqual(r.lines.map((l) => [l.name, l.quantity]), [['P3 M Slim', 3]]);
});

test('the stock grid equals the per-child stock summary; sold in 30 days; CSV', () => {
  setTable('stock_items', all);
  const sale = { id: 'i1', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-07-10', items: [{ id: 'a', name: 'KRT-104 - M / Blue', quantity: 2, rate: 2799, tax_rate: 5 }] } as unknown as InvoiceRecord;
  const old = { ...sale, id: 'i0', issue_date: '2026-05-01' } as InvoiceRecord;
  setTable('invoices', [sale, old]);
  const positions = computeStock(liveInputs());
  const tracking = loadTracking();
  const sold = soldLast30([sale, old], all, '2026-07-20');
  const cells = stockGrid(parent, all, (id) => tracking.get(id)?.qty ?? 0, sold);
  for (const c of cells) assert.equal(c.qty, positions.find((p) => p.item.id === c.child!.id)!.qty, c.key);
  const mb = cells.find((c) => c.key === key('M', 'Blue'))!;
  assert.deepEqual([mb.qty, mb.sold], [-1, 2], 'two old + new sales of 2 each off 3 opening → -1; only the recent one counts as sold');
  assert.equal(cells.filter((c) => c.qty <= 0).length, 1, 'sold-out cells');
  const csv = stockGridCsv(parent, cells).split('\n');
  assert.equal(csv.length, 13);
  assert.equal(csv[0], '"Size","Colour","Item","In stock","Sold (30 days)"');
});

test('labels carry the variant attributes', () => {
  assert.equal(attrLine({ Size: 'M', Colour: 'Blue' }), 'M / Blue');
  assert.equal(attrLine(undefined), '');
  const { labels } = expandLabels([{ name: 'KRT-104 - M / Blue', code: '2000000000015', rate: 2799, mrp: 2799, attrs: 'M / Blue', copies: 1 }]);
  const html = labelSheetHtml(labels, { layout: layoutById(LABEL_LAYOUTS[0].id), price: 'mrp', currency: 'INR' } as never);
  assert.match(html, /<div class="price">M \/ Blue<\/div>/);
});
