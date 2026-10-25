/**
 * WP-8 inventory masters through storage: units / stock groups / categories masters (roles, table guard,
 * audit, delete refusals), godown hierarchy, item delete blocked by BOMs, live Stock Query with
 * alternate-unit bills and a sales order, and backup → wipe → restore of the new tables.
 */
import '../helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, freezeDate, resetStorage, thawDate } from '../helpers/shim.ts';
import { installSettings } from '../helpers/world.ts';
import { DB_PREFIX, setTable } from '../../src/lib/storage.ts';
import { blankStockItem, loadPositions, stockDb } from '../../src/lib/inventory.ts';
import { unitsDb } from '../../src/lib/units.ts';
import { stockCategoriesDb, stockGroupsDb } from '../../src/lib/stock-groups.ts';
import { godownsDb } from '../../src/lib/godowns.ts';
import { bomsDb } from '../../src/lib/manufacturing.ts';
import { loadStockQuery } from '../../src/lib/stock-query.ts';
import { setActorProvider, type Role } from '../../src/lib/access.ts';
import { audit } from '../../src/lib/audit.ts';
import { applyBackup, buildBackup, parseBackup, wipeAppData } from '../../src/lib/backup.ts';
import { DEVICE_LOCAL_KEYS } from '../../src/lib/auth.ts';

const as = (role: Role | null) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role }) : null);

beforeEach(() => {
  resetStorage();
  installSettings();
  freezeDate('2026-05-10T10:00:00');
});
afterEach(() => {
  as(null);
  thawDate();
});

test('masters: units, groups and categories save, audit, refuse bad deletes; viewers are refused', () => {
  const kg = unitsDb.save({ symbol: 'tin', name: 'Tin', uqc: 'can', decimals: 0 });
  assert.deepEqual([kg.symbol, kg.uqc], ['TIN', 'CAN']);
  unitsDb.save({ symbol: '', first: 'box', factor: 12, second: 'nos' });
  assert.throws(() => unitsDb.save({ symbol: 'TIN' }), /already exists/);
  const g = stockGroupsDb.save({ name: 'Electronics' });
  const sub = stockGroupsDb.save({ name: 'Phones', parent_id: g.id });
  assert.throws(() => stockGroupsDb.save({ id: g.id, name: 'Electronics', parent_id: sub.id }), /under itself/);
  const c = stockCategoriesDb.save({ name: 'Brand A' });
  stockDb.saveItem(blankStockItem({ id: 'ph', name: 'Phone X', unit: 'TIN', group_id: sub.id, category_id: c.id }));
  assert.throws(() => stockGroupsDb.remove(g.id, stockDb.items()), /1 sub-group/);
  assert.throws(() => stockGroupsDb.remove(sub.id, stockDb.items()), /1 stock item/);
  assert.throws(() => stockCategoriesDb.remove(c.id, stockDb.items()), /1 stock item/);
  assert.throws(() => unitsDb.remove(kg.id, stockDb.items()), /Phone X/);
  assert.ok(audit.all().some((e) => /Stock group "Phones" added under "Electronics"/.test(e.summary)));
  as('viewer');
  assert.throws(() => unitsDb.save({ symbol: 'PKT' }), /Viewer/);
  assert.throws(() => stockGroupsDb.save({ name: 'Grocery' }), /Viewer/);
  for (const t of ['units', 'stock_groups', 'stock_categories']) assert.throws(() => setTable(t, []), /Viewer\) cannot/, t);
  as('clerk');
  assert.equal(stockCategoriesDb.save({ name: 'Brand B' }).name, 'Brand B');
});

test('godown hierarchy through storage: parent saved, cycles and parents-with-children refused', () => {
  const w = godownsDb.save({ name: 'Warehouse' });
  const r = godownsDb.save({ name: 'Room 1', parent_id: w.id });
  assert.equal(godownsDb.list().find((x) => x.id === r.id)?.parent_id, w.id);
  assert.throws(() => godownsDb.save({ id: w.id, name: 'Warehouse', parent_id: r.id }), /inside itself/);
  assert.throws(() => godownsDb.remove(w.id, false), /inside it first/);
  godownsDb.save({ id: r.id, name: 'Room 1' });
  assert.equal(godownsDb.list().find((x) => x.id === r.id)?.parent_id, undefined, 'moved back to the top level');
  godownsDb.remove(w.id, false);
});

test('a stock item used by a BOM cannot be deleted; a free one can', () => {
  stockDb.saveItem(blankStockItem({ id: 'wood', name: 'Wood' }));
  stockDb.saveItem(blankStockItem({ id: 'chair', name: 'Chair' }));
  stockDb.saveItem(blankStockItem({ id: 'pen', name: 'Pen' }));
  bomsDb.save({ item_id: 'chair', name: 'Std', batch_qty: 1, components: [{ id: 'c', item_id: 'wood', qty: 2 }] }, stockDb.items());
  assert.throws(() => stockDb.deleteItem('wood'), /1 bill of materials/);
  assert.throws(() => stockDb.deleteItem('chair'), /bill of materials/);
  stockDb.deleteItem('pen');
  assert.ok(!stockDb.items().some((i) => i.id === 'pen'));
});

test('live stock query: a bill in boxes, a sale in pieces, a pending sales order', () => {
  stockDb.saveItem(blankStockItem({ id: 'soap', name: 'Soap', alt_units: [{ unit: 'BOX', factor: 12 }], selling_prices: [{ from: '2026-04-01', rate: 60 }] }));
  setTable('purchases', [{ id: 'b1', kind: 'PURCHASE', vendor_name: 'Acme', bill_number: 'A/1', date: '2026-05-01', category: 'Purchases', lines: [{ id: 'l', name: 'Soap', unit: 'BOX', quantity: 2, rate: 600, tax_rate: 18, item_id: 'soap', unit_factor: 12 }], taxable: 1200, cgst: 108, sgst: 108, igst: 0, itc_eligible: true, total: 1416, amount_paid: 0 }]);
  setTable('invoices', [
    { id: 'i1', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-05-03', invoice_number: 'INV/1', client: { name: 'Asha' }, items: [{ id: 'x', name: 'Soap', type: 'p', quantity: 5, rate: 70, amount: 350 }] },
    { id: 'so', doc_type: 'SALES_ORDER', status: 'Sent', issue_date: '2026-05-04', due_date: '2026-05-06', invoice_number: 'SO/1', client: { name: 'Ravi' }, items: [{ id: 'sl', name: 'Soap', type: 'p', unit: 'BOX', quantity: 1, rate: 700, amount: 700, unit_factor: 12 }] },
  ]);
  assert.equal(loadPositions().find((p) => p.item.id === 'soap')?.qty, 19);
  const q = loadStockQuery('soap', '2026-05-10');
  assert.ok(q);
  assert.equal(q.compound, '1 BOX 7 NOS');
  assert.deepEqual(q.lastPurchases.map((r) => [r.qty, r.rate]), [[24, 50]]);
  assert.deepEqual(q.lastSales.map((r) => [r.party, r.qty, r.rate]), [['Asha', 5, 70]]);
  assert.equal(q.pendingSo, 12);
  assert.equal(q.soLines[0].overdueDays, 4);
  assert.equal(q.sellingPrice, 60);
  assert.equal(loadStockQuery('nope', '2026-05-10'), null);
});

test('new master tables survive backup → wipe → restore', () => {
  unitsDb.save({ symbol: 'TIN', uqc: 'CAN', decimals: 0 });
  const g = stockGroupsDb.save({ name: 'Grocery' });
  stockCategoriesDb.save({ name: 'Brand A' });
  stockDb.saveItem(blankStockItem({ id: 'rice', name: 'Rice', unit: 'KG', group_id: g.id, alt_units: [{ unit: 'BAG', factor: 25 }], standard_costs: [{ from: '2026-04-01', rate: 40 }] }));
  const keep = (snap: Record<string, string>) =>
    Object.fromEntries(Object.entries(snap).filter(([k]) => k.startsWith(DB_PREFIX) && !DEVICE_LOCAL_KEYS.includes(k) && k !== `${DB_PREFIX}audit_log`));
  const before = keep(dumpStorage());
  for (const t of ['units', 'stock_groups', 'stock_categories']) assert.ok(before[DB_PREFIX + t], `fixture populates ${t}`);
  const file = JSON.stringify(buildBackup(new Date('2026-05-10T10:00:00Z')));
  wipeAppData();
  applyBackup(parseBackup(file).data);
  assert.deepEqual(keep(dumpStorage()), before);
  assert.deepEqual(stockDb.items()[0].alt_units, [{ unit: 'BAG', factor: 25 }]);
});
