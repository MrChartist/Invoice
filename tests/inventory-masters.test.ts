/**
 * WP-8 inventory masters & analysis (pure): units + alternate units on lines, stock groups / categories
 * and the group-wise summary, godown hierarchy, price lists, Stock Query, sales-order outstanding,
 * reorder pending POs with receipt notes, ageing slabs, item references.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  baseQty, cleanAltUnits, compoundText, decimalsFor, factorFor, lineFactor, lineUnitPatch, rescaleRate, roundToUnit,
  unitChoices, unitList, unitPickContext, unitReferences, unitSymbols, uqcFor, validateAltUnits, validateUnit, type UnitMaster,
} from '../src/lib/units.ts';
import {
  buildItemIndex, collectEvents, computeStock, movementSummary, shortfallsFromPositions, type StockItem,
} from '../src/lib/inventory.ts';
import { descendantIds, itemsUnder, nodeReferences, pathOf, treeRows, validateNode, type StockGroup } from '../src/lib/stock-groups.ts';
import { ageBucketBounds, groupWiseSummary, parseAgeSlabs, stockAgeing } from '../src/lib/stock-reports.ts';
import { godownParentIssue, godownTree, rollUpGodowns } from '../src/lib/godowns.ts';
import { cleanPriceList, rateOn, soLinesFor, stockQuery, validatePriceList } from '../src/lib/stock-query.ts';
import { groupOutstanding, salesOrderOutstanding } from '../src/lib/sales-orders.ts';
import { pendingPoQty } from '../src/lib/reorder.ts';
import { itemVoucherReferences } from '../src/lib/item-references.ts';
import { allocateLandedCost, cleanLandedCosts, landedTotal } from '../src/lib/landed-cost.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import type { PurchaseOrder, PurchaseRecord, PurchaseReturn, ReceiptNote } from '../src/types/purchases.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const item = (id: string, name: string, extra: Partial<StockItem> = {}): StockItem => ({
  id, name, unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, ...extra,
});
const soap = item('soap', 'Soap', { alt_units: [{ unit: 'BOX', factor: 12 }] });

const bill = (lines: PurchaseRecord['lines'], extra: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
  id: 'b1', kind: 'PURCHASE', vendor_name: 'Acme', bill_number: 'A/1', date: '2026-05-01', category: 'Purchases',
  lines, taxable: 0, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 1, amount_paid: 0, ...extra,
});

/* ── Units ─────────────────────────────────────────────────────── */

test('units: line factor, alternate-unit cleaning and validation, unit choices', () => {
  assert.equal(lineFactor({}), 1);
  assert.equal(lineFactor({ unit_factor: 0 }), 1);
  assert.equal(lineFactor({ unit_factor: 12 }), 12);
  assert.equal(baseQty({ quantity: 2, unit_factor: 12 }), 24);
  assert.deepEqual(cleanAltUnits([{ unit: 'BOX', factor: 12 }, { unit: 'nos', factor: 2 }, { unit: 'box', factor: 6 }, { unit: 'PKT', factor: 1 }, { unit: '', factor: 3 }], 'NOS'), [{ unit: 'BOX', factor: 12 }]);
  assert.equal(cleanAltUnits([], 'NOS'), undefined);
  assert.equal(validateAltUnits([{ unit: 'BOX', factor: 12 }], 'NOS'), '');
  assert.match(validateAltUnits([{ unit: 'NOS', factor: 12 }], 'NOS'), /main unit/);
  assert.match(validateAltUnits([{ unit: 'BOX', factor: 12 }, { unit: 'box', factor: 6 }], 'NOS'), /twice/);
  assert.match(validateAltUnits([{ unit: 'BOX', factor: 0 }], 'NOS'), /how many NOS/);
  assert.equal(validateAltUnits([{ unit: '', factor: 0 }], 'NOS'), '', 'an empty row is ignored');
  assert.deepEqual(unitChoices(soap).map((c) => c.unit), ['NOS', 'BOX']);
  assert.equal(factorFor(soap, 'box'), 12);
  assert.equal(factorFor(soap, 'NOS'), 1);
  assert.equal(factorFor(soap, 'KG'), undefined);
});

test('units: switching a line unit rescales the rate and snapshots the factor', () => {
  assert.deepEqual(lineUnitPatch(soap, { unit: 'NOS', rate: 50 }, 'BOX'), { unit: 'BOX', unit_factor: 12, rate: 600 });
  assert.deepEqual(lineUnitPatch(soap, { unit: 'BOX', unit_factor: 12, rate: 600 }, 'NOS'), { unit: 'NOS', unit_factor: undefined, rate: 50 });
  assert.equal(rescaleRate(0, 1, 12), 0);
  assert.equal(compoundText(26, soap), '2 BOX 2 NOS');
  assert.equal(compoundText(24, soap), '2 BOX');
  assert.equal(compoundText(-13, soap), '-1 BOX 1 NOS');
  assert.equal(compoundText(5, soap), '', 'below one box');
  assert.equal(compoundText(30, item('x', 'X')), '');
});

test('units master: built-ins with overrides, decimals, UQC, validation, references', () => {
  const stored: UnitMaster[] = [
    { id: 'u1', symbol: 'KG', uqc: 'KGS', decimals: 2 },
    { id: 'u2', symbol: 'TIN', name: 'Tin', uqc: 'CAN', decimals: 0 },
    { id: 'u3', symbol: 'BOX of 12 NOS', first: 'BOX', factor: 12, second: 'NOS' },
  ];
  const list = unitList(stored);
  assert.ok(list.some((u) => u.symbol === 'NOS' && u.decimals === 0));
  assert.equal(list.find((u) => u.symbol === 'KG')?.decimals, 2, 'stored row overrides the built-in');
  assert.ok(list.some((u) => u.symbol === 'TIN'));
  assert.ok(!list.some((u) => u.first), 'compound rows are not simple units');
  assert.ok(unitSymbols(stored, 'CTN').includes('CTN'), 'an old unit on a line stays selectable');
  assert.equal(decimalsFor('kg', stored), 2);
  assert.equal(decimalsFor('XYZ', stored), 3);
  assert.equal(roundToUnit(1.23456, 2), 1.23);
  assert.equal(uqcFor('TIN', stored, () => 'OTH'), 'CAN');
  assert.equal(uqcFor('NOS', stored, (u) => `map:${u}`), 'map:NOS');
  assert.equal(validateUnit({ id: '', symbol: 'tin' }, stored), 'The unit tin already exists.');
  assert.equal(validateUnit({ id: 'u2', symbol: 'TIN' }, stored), '');
  assert.match(validateUnit({ id: '', symbol: '' }, stored), /symbol/);
  assert.match(validateUnit({ id: '', symbol: '', first: 'BOX', second: 'NOS', factor: 6 }, stored), /already exists/);
  assert.match(validateUnit({ id: '', symbol: '', first: 'BOX', second: 'BOX', factor: 6 }, stored), /different/);
  assert.deepEqual(unitReferences('box', [soap, item('t', 'Tea', { unit: 'TIN' })]), ['Soap']);
});

test('unit pick context: null for simple users, finds items with alternate units only', () => {
  const plain = [item('a', 'Pen')];
  assert.equal(unitPickContext(plain, buildItemIndex(plain)), null);
  const items = [soap, item('a', 'Pen')];
  const ctx = unitPickContext(items, buildItemIndex(items));
  assert.ok(ctx);
  assert.deepEqual(ctx.find('soap')?.choices.map((c) => c.unit), ['NOS', 'BOX']);
  assert.equal(ctx.find('Pen'), undefined);
  assert.equal(ctx.find(''), undefined);
});

/* ── Stock engine with alternate units and item_id ─────────────── */

test('stock: lines in an alternate unit move base units, cost per base unit; item_id beats name matching', () => {
  const purchases = [
    bill([{ id: 'l1', name: 'Soap', unit: 'BOX', quantity: 2, rate: 600, tax_rate: 18, unit_factor: 12 }]),
    // Supplier calls it something else, but the line was picked from the item list.
    bill([{ id: 'l2', name: 'Bath soap 75g', unit: 'NOS', quantity: 6, rate: 45, tax_rate: 18, item_id: 'soap' }], { id: 'b2', bill_number: 'A/2', date: '2026-05-02' }),
    // Older line without item_id: name + HSN matching still works.
    bill([{ id: 'l3', name: 'soap', quantity: 1, rate: 50, tax_rate: 18 }], { id: 'b3', bill_number: 'A/3', date: '2026-05-03' }),
  ];
  const invoices = [{
    id: 'i1', doc_type: 'INVOICE' as const, status: 'Sent' as const, issue_date: '2026-05-04', invoice_number: 'INV/1', client: { name: 'Asha' },
    items: [{ id: 'x', name: 'Soap', type: 'product', unit: 'BOX', quantity: 1, rate: 720, amount: 720, unit_factor: 12 }],
  }] as never;
  const ev = collectEvents({ items: [soap], moves: [], invoices, purchases }).get('soap') ?? [];
  assert.deepEqual(ev.map((e) => [e.kind, e.qty, e.rate ?? e.saleRate]), [['purchase', 24, 50], ['purchase', 6, 45], ['purchase', 1, 50], ['sale', -12, 60]]);
  const [p] = computeStock({ items: [soap], moves: [], invoices, purchases });
  assert.equal(p.qty, 19);
  assert.equal(p.soldQty, 12);
  assert.equal(p.revenue, 720);
  // Shortfall check counts the box too.
  const short = shortfallsFromPositions({ items: [{ id: 'y', name: 'Soap', type: 'p', quantity: 2, rate: 1, amount: 2, unit_factor: 12 }] }, [p]);
  assert.deepEqual(short.map((s) => [s.requested, s.available]), [[24, 19]]);
});

test('stock: an item_id pointing at an untracked or missing item falls back to name matching', () => {
  const items = [soap, item('svc', 'Soap', { track_stock: false })];
  const ev = collectEvents({ items, moves: [], invoices: [], purchases: [bill([{ id: 'l', name: 'Soap', quantity: 3, rate: 50, tax_rate: 0, item_id: 'svc' }])] });
  assert.equal(ev.get('soap')?.[0]?.qty, 3);
});

test('stock: receipt notes, bills against them and purchase returns convert with the line factor', () => {
  const grn: ReceiptNote = {
    id: 'g1', kind: 'GRN', number: 'GRN/FY26-27/0001', date: '2026-05-01', vendor_name: 'Acme',
    lines: [{ id: 'gl', name: 'Soap', unit: 'BOX', quantity: 2, rate: 600, tax_rate: 18, unit_factor: 12, item_id: 'soap' }],
  } as ReceiptNote;
  const billed = bill([{ id: 'bl', name: 'Soap', unit: 'BOX', quantity: 2, rate: 660, tax_rate: 18, unit_factor: 12, grn_line_id: 'gl' }], { date: '2026-05-05' });
  const ret = { id: 'r1', kind: 'DEBIT_NOTE', note_number: 'DN/1', date: '2026-05-06', purchase_id: 'b1', vendor_name: 'Acme', goods_returned: true, total: 660, lines: [{ id: 'rl', bill_line_id: 'bl', name: 'Soap', quantity: 1, rate: 660, tax_rate: 18 }] } as unknown as PurchaseReturn;
  const ev = collectEvents({ items: [soap], moves: [], invoices: [], purchases: [billed], returnDocs: { receipts: [grn], notes: [ret] } }).get('soap') ?? [];
  assert.deepEqual(ev.map((e) => [e.refType, e.qty, Math.round((e.rate ?? e.saleRate ?? 0) * 100) / 100]), [['grn', 24, 55], ['purchase_return', -12, 55]], 'the bill brings nothing in twice; the GRN is valued at the billed rate per NOS');
});

test('invoice lines keep unit_factor through normalizeRecord; base-unit lines gain none', () => {
  const r = normalizeRecord({ gst_mode: 'IGST', items: [{ id: 'a', name: 'Soap', unit: 'BOX', quantity: 2, rate: 600, amount: 1200, unit_factor: 12 }, { id: 'b', name: 'Pen', quantity: 1, rate: 5, amount: 5, unit_factor: 1 }] });
  assert.equal(r.items[0].unit_factor, 12);
  assert.ok(!('unit_factor' in r.items[1]));
});

/* ── Groups, categories, group-wise summary ────────────────────── */

const groups: StockGroup[] = [
  { id: 'e', name: 'Electronics' },
  { id: 'p', name: 'Phones', parent_id: 'e' },
  { id: 'a', name: 'Accessories', parent_id: 'e' },
  { id: 'g', name: 'Grocery' },
];

test('stock groups: tree, paths, cycle refusal, references, items under a node', () => {
  assert.deepEqual(treeRows(groups).map((r) => [r.path, r.depth]), [['Electronics', 0], ['Electronics / Accessories', 1], ['Electronics / Phones', 1], ['Grocery', 0]]);
  assert.deepEqual([...descendantIds('e', groups)].sort(), ['a', 'e', 'p']);
  assert.equal(pathOf('p', groups), 'Electronics / Phones');
  assert.match(validateNode({ id: 'e', name: 'Electronics', parent_id: 'p' }, groups, 'group'), /under itself/);
  assert.match(validateNode({ id: '', name: 'phones' }, groups, 'group'), /already exists/);
  assert.match(validateNode({ id: '', name: 'X', parent_id: 'zz' }, groups, 'category'), /no longer exists/);
  assert.equal(validateNode({ id: 'p', name: 'Phones', parent_id: 'a' }, groups, 'group'), '');
  const items = [item('i1', 'Phone', { group_id: 'p' }), item('i2', 'Rice', { group_id: 'g' }), item('i3', 'Loose'), item('i4', 'Orphan', { group_id: 'gone' })];
  assert.deepEqual(nodeReferences('e', groups, items, 'group'), ['2 sub-groups']);
  assert.deepEqual(nodeReferences('p', groups, items, 'group'), ['1 stock item']);
  assert.deepEqual(itemsUnder('e', groups, items, 'group').map((i) => i.id), ['i1']);
  assert.deepEqual(itemsUnder('', groups, items, 'group').map((i) => i.id), ['i3', 'i4'], 'no group or a deleted one');
  // A stored cycle never loops.
  assert.equal(treeRows([{ id: 'x', name: 'X', parent_id: 'y' }, { id: 'y', name: 'Y', parent_id: 'x' }]).length, 2);
});

test('group-wise stock summary: groups total their sub-groups, values agree with the movement summary', () => {
  const items = [
    item('i1', 'Phone', { group_id: 'p', opening_qty: 10, opening_rate: 100 }),
    item('i2', 'Cable', { group_id: 'a', opening_qty: 5, opening_rate: 20 }),
    item('i3', 'Rice', { group_id: 'g', unit: 'KG', opening_qty: 50, opening_rate: 40 }),
    item('i4', 'Loose', { opening_qty: 1, opening_rate: 7 }),
  ];
  const positions = computeStock({ items, moves: [], invoices: [] });
  const rows = groupWiseSummary(positions, groups, '2026-04-01', '2027-03-31');
  const byKey = new Map(rows.map((r) => [`${r.kind}:${r.id}`, r]));
  assert.equal(byKey.get('group:e')?.closingValue, 1100);
  assert.equal(byKey.get('group:e')?.closingQty, 15, 'same unit: quantities add up');
  assert.equal(byKey.get('group:g')?.closingQty, 50);
  assert.equal(byKey.get('group:')?.closingValue, 7, 'no-group heading');
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.name}:${r.depth}`), [
    'group:Electronics:0', 'group:Accessories:1', 'item:Cable:2', 'group:Phones:1', 'item:Phone:2', 'group:Grocery:0', 'item:Rice:1', 'group::0', 'item:Loose:1',
  ]);
  const total = movementSummary(positions, '2026-04-01', '2027-03-31').reduce((s, m) => s + m.closingValue, 0);
  assert.equal(rows.filter((r) => r.kind === 'group' && r.depth === 0).reduce((s, r) => s + r.closingValue, 0), total);
  const mixed = groupWiseSummary(positions, [{ id: 'all', name: 'All' }], '2026-04-01', '2027-03-31');
  assert.equal(mixed.find((r) => r.id === '')?.closingQty, null, 'NOS + KG do not add up');
});

test('ageing slabs: parsing, bounds, configurable buckets', () => {
  assert.deepEqual(parseAgeSlabs('45, 15 ,90 90 x'), [15, 45, 90]);
  assert.deepEqual(parseAgeSlabs(''), [30, 60, 90, 180]);
  assert.deepEqual(ageBucketBounds([15, 45]), [{ from: 0, to: 15 }, { from: 16, to: 45 }, { from: 46, to: null }]);
  const items = [item('i', 'Old', { opening_qty: 0 })];
  const purchases = [bill([{ id: 'l', name: 'Old', quantity: 4, rate: 10, tax_rate: 0 }], { date: '2026-04-01' })];
  const rows = stockAgeing(computeStock({ items, moves: [], invoices: [], purchases }), '2026-05-01', [15, 45]);
  assert.deepEqual(rows[0].qty, [0, 4, 0]);
});

/* ── Godown hierarchy ──────────────────────────────────────────── */

test('godown hierarchy: tree, parent checks, stock rolled up into parents', () => {
  const list = [{ id: 'main', name: 'Main' }, { id: 'w', name: 'Warehouse' }, { id: 'r1', name: 'Room 1', parent_id: 'w' }, { id: 'r2', name: 'Room 2', parent_id: 'r1' }];
  assert.deepEqual(godownTree(list).map((r) => r.path), ['Main', 'Warehouse', 'Warehouse / Room 1', 'Warehouse / Room 1 / Room 2']);
  assert.match(godownParentIssue('w', 'r2', list), /inside itself/);
  assert.match(godownParentIssue('r1', 'nope', list), /no longer exists/);
  assert.equal(godownParentIssue(undefined, 'w', list), '');
  assert.deepEqual(rollUpGodowns({ main: 1, w: 2, r1: 3, r2: 4 }, list), { main: 1, w: 9, r1: 7, r2: 4 });
});

/* ── Price lists, stock query ──────────────────────────────────── */

test('price lists: effective-dated rates, cleaning, validation', () => {
  const list = [{ from: '2026-06-01', rate: 120 }, { from: '2026-04-01', rate: 100 }, { from: '2026-06-01', rate: 125 }];
  assert.deepEqual(cleanPriceList(list), [{ from: '2026-04-01', rate: 100 }, { from: '2026-06-01', rate: 125 }]);
  assert.equal(rateOn(list, '2026-03-31'), undefined);
  assert.equal(rateOn(list, '2026-05-31'), 100);
  assert.equal(rateOn(list, '2026-06-01'), 125);
  assert.match(validatePriceList([{ from: '', rate: 5 }]), /date/);
  assert.match(validatePriceList([{ from: '2026-04-01', rate: -1 }]), /negative/);
  assert.match(validatePriceList([{ from: '2026-04-01', rate: 1 }, { from: '2026-04-01', rate: 2 }]), /Two prices/);
  assert.equal(validatePriceList([{ from: '', rate: '' }]), '');
});

test('stock query: closing, compound reading, last rates per base unit, pending orders, prices', () => {
  const it = item('soap', 'Soap', { alt_units: [{ unit: 'BOX', factor: 12 }], standard_costs: [{ from: '2026-04-01', rate: 48 }], selling_prices: [{ from: '2026-04-01', rate: 60 }, { from: '2026-06-01', rate: 65 }] });
  const purchases = [bill([{ id: 'l1', name: 'Soap', unit: 'BOX', quantity: 3, rate: 600, tax_rate: 18, unit_factor: 12 }])];
  const invoices = [{ id: 'i1', doc_type: 'INVOICE' as const, status: 'Sent' as const, issue_date: '2026-05-04', invoice_number: 'INV/1', client: { name: 'Asha' }, items: [{ id: 'x', name: 'Soap', type: 'p', quantity: 10, rate: 70, amount: 700 }] }] as never;
  const input = { items: [it], moves: [], invoices, purchases };
  const [position] = computeStock(input);
  const events = collectEvents(input).get('soap') ?? [];
  const so = { id: 'so', doc_type: 'SALES_ORDER', status: 'Sent', issue_date: '2026-05-01', due_date: '2026-05-03', invoice_number: 'SO/1', client: { name: 'Ravi' }, items: [{ id: 'sl', name: 'Soap', type: 'p', unit: 'BOX', quantity: 2, rate: 700, amount: 1400, unit_factor: 12 }] } as unknown as InvoiceRecord;
  const soRows = salesOrderOutstanding([so], [], '2026-05-10');
  const q = stockQuery({ position, events, godowns: [], soLines: soLinesFor(it, soRows, [it]), pendingPo: 5, day: '2026-05-10' });
  assert.equal(q.qty, 26);
  assert.equal(q.compound, '2 BOX 2 NOS');
  assert.deepEqual(q.lastPurchases.map((r) => [r.party, r.qty, r.rate]), [['Acme', 36, 50]]);
  assert.deepEqual(q.lastSales.map((r) => [r.party, r.qty, r.rate]), [['Asha', 10, 70]]);
  assert.equal(q.pendingSo, 24, 'two boxes still to deliver = 24 NOS');
  assert.equal(q.pendingPo, 5);
  assert.equal(q.standardCost, 48);
  assert.equal(q.sellingPrice, 60);
});

/* ── Sales order outstanding ───────────────────────────────────── */

test('sales order outstanding: pending delivery / invoice per line, overdue days, grouping', () => {
  const so = (id: string, party: string, due: string, extra: Partial<InvoiceRecord> = {}) => ({
    id, doc_type: 'SALES_ORDER', status: 'Sent', issue_date: '2026-05-01', due_date: due, invoice_number: `SO/${id}`, client: { name: party },
    items: [{ id: `${id}-l`, name: 'Chair', type: 'p', unit: 'NOS', quantity: 10, rate: 100, discount_percent: 10, amount: 1000 }], ...extra,
  }) as unknown as InvoiceRecord;
  const challan = { id: 'dc', doc_type: 'DELIVERY_CHALLAN', status: 'Sent', issue_date: '2026-05-02', sales_order_id: 'a', items: [{ id: 'dl', name: 'Chair', type: 'p', quantity: 4, rate: 100, amount: 400, order_line_id: 'a-l' }] } as unknown as InvoiceRecord;
  const docs = [
    so('a', 'Asha', '2026-05-05'),
    so('b', 'Ravi', '2026-05-15'),
    so('c', 'Ravi', ''),
    so('d', 'Draft Co', '2026-05-01', { status: 'Draft' }),
    so('e', 'Closed Co', '2026-05-01', { order_closed_on: '2026-05-03' }),
    so('f', 'Future Co', '2026-06-01', { issue_date: '2026-06-01' }),
    challan,
  ];
  const rows = salesOrderOutstanding(docs, [], '2026-05-10');
  // Sorted by due date (an order without one by its date), so SO/c (dated 1 May) comes first.
  assert.deepEqual(rows.map((r) => [r.number, r.pendingDelivery, r.pendingInvoice, r.value, r.overdueDays]), [
    ['SO/c', 10, 10, 900, 0], ['SO/a', 6, 10, 540, 5], ['SO/b', 10, 10, 900, 0],
  ]);
  const a = rows.find((r) => r.number === 'SO/a');
  assert.deepEqual(a && [a.pendingDelivery, a.pendingInvoice, a.value, a.overdueDays, a.delivered], [6, 10, 540, 5, 4]);
  assert.deepEqual(rows.map((r) => r.number).sort(), ['SO/a', 'SO/b', 'SO/c'], 'drafts, closed and future orders are left out');
  assert.deepEqual(groupOutstanding(rows, 'due', '2026-05-10').map((g) => [g.label, g.rows.length]), [['overdue', 1], ['week', 1], ['none', 1]]);
  const early = salesOrderOutstanding(docs, [], '2026-05-01');
  assert.deepEqual(groupOutstanding(early, 'due', '2026-05-01').map((g) => [g.label, g.rows.length]), [['week', 1], ['later', 1], ['none', 1]]);
  assert.deepEqual(groupOutstanding(rows, 'party', '2026-05-10').map((g) => [g.label, g.value, g.overdue]), [['Ravi', 1800, 0], ['Asha', 540, 1]]);
  assert.equal(groupOutstanding(rows, 'item', '2026-05-10')[0].rows.length, 3);
});

/* ── Reorder: pending POs count receipt notes (GRN) ────────────── */

test('reorder pending PO quantity: GRN receipts count before the bill, in base units', () => {
  const items = [soap];
  const po: PurchaseOrder = { id: 'po', po_number: 'PO/1', date: '2026-05-01', vendor_name: 'Acme', lines: [{ id: 'pl', name: 'Soap', unit: 'BOX', quantity: 5, rate: 600, tax_rate: 18, unit_factor: 12, item_id: 'soap' }], taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
  assert.equal(pendingPoQty([po], [], items).get('soap'), 60, 'five boxes on order = 60 NOS');
  const grn = { id: 'g', kind: 'GRN', number: 'GRN/1', date: '2026-05-02', vendor_name: 'Acme', po_id: 'po', lines: [{ id: 'gl', name: 'Soap', unit: 'BOX', quantity: 2, rate: 600, tax_rate: 18, po_line_id: 'pl', unit_factor: 12 }] } as ReceiptNote;
  assert.equal(pendingPoQty([po], [], items, [grn]).get('soap'), 36, 'two boxes received on the GRN');
  assert.equal(pendingPoQty([po], [], items).get('soap'), 60, 'without receipt notes the old rule (bills only) applies');
  const billed = bill([{ id: 'bl', name: 'Soap', unit: 'BOX', quantity: 2, rate: 600, tax_rate: 18, unit_factor: 12, grn_line_id: 'gl', po_line_id: 'pl' }], { po_id: 'po' });
  assert.equal(pendingPoQty([po], [billed], items, [grn]).get('soap'), 36, 'billing the GRN does not count the goods twice');
  assert.equal(pendingPoQty([{ ...po, closed_on: '2026-05-03' }], [], items, [grn]).get('soap'), undefined, 'closed POs are not pending');
});

/* ── Item references (delete guard) ───────────────────────────── */

test('item references: BOMs and stock vouchers that use an item', () => {
  const t = {
    boms: [{ item_id: 'chair', components: [{ item_id: 'wood' }] }, { item_id: 'table', components: [{ item_id: 'wood' }] }],
    manufacturing: [{ item_id: 'chair', components: [{ item_id: 'screw' }], outputs: [] }],
    stockJournals: [{ consume: [{ item_id: 'wood' }], produce: [{ item_id: 'plank' }] }],
    physical: [{ lines: [{ item_id: 'screw' }] }],
  };
  assert.deepEqual(itemVoucherReferences('wood', t), ['2 bills of materials', '1 stock journal']);
  assert.deepEqual(itemVoucherReferences('screw', t), ['1 manufacturing journal', '1 physical stock count']);
  assert.deepEqual(itemVoucherReferences('chair', t), ['1 bill of materials', '1 manufacturing journal']);
  assert.deepEqual(itemVoucherReferences('pen', t), []);
});

/* ── Landed cost ───────────────────────────────────────────────── */

test('landed cost: split by value or by base quantity, loads stock cost only', () => {
  const lines = [{ quantity: 10, unitCost: 100 }, { quantity: 2, unitCost: 600, unitFactor: 12 }, { quantity: 0, unitCost: 5 }];
  const charges = [{ label: 'Freight', amount: 330 }, { label: 'Bad', amount: -5 }, { label: '', amount: 0 }];
  assert.deepEqual(cleanLandedCosts(charges), [{ label: 'Freight', amount: 330 }]);
  assert.equal(landedTotal(charges), 330);
  const byValue = allocateLandedCost(lines, charges);
  assert.deepEqual(byValue.map((x) => Math.round(x * 100) / 100), [15, 90, 0], '1000 : 1200 of 2200 → 150 and 180');
  const byQty = allocateLandedCost(lines, charges, 'qty');
  assert.deepEqual(byQty.map((x) => Math.round(x * 100) / 100), [9.71, 116.47, 0], '10 : 24 base units');
  assert.deepEqual(allocateLandedCost([{ quantity: 4, unitCost: 0 }], [{ label: 'F', amount: 8 }]), [2], 'free goods fall back to quantity');
  assert.deepEqual(allocateLandedCost(lines, []), [0, 0, 0]);
  // Engine: the bill's stock cost includes the freight; the bill total / taxable readers do not.
  const b = bill([{ id: 'l1', name: 'Soap', quantity: 10, rate: 50, tax_rate: 18 }], { landed_costs: [{ label: 'Freight', amount: 100 }], taxable: 500 });
  const [p] = computeStock({ items: [soap], moves: [], invoices: [], purchases: [b] });
  assert.equal(p.value, 600);
  assert.equal(p.avgCost, 60);
});
