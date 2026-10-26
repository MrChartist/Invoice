/**
 * R3-A4 · Modifiers and "86": min / max validation, child line tax follows the parent, a mapped option
 * uses its own item, 86 clears on the next local day, group toggle, auto-86 at zero stock with
 * alternate units (lineFactor).
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setTable } from '../src/lib/storage.ts';
import {
  autoUnavailable, groupsFor, idsInGroup, isUnavailable, modifierLines, set86, validateGroup, validatePicks,
} from '../src/lib/restaurant/modifiers.ts';
import { addToOrder, openOrder, ordersDb, previewBill, set86Items } from '../src/lib/restaurant/orders-store.ts';
import { localDay } from '../src/lib/restaurant/tables.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';
import type { ModifierGroup } from '../src/types/restaurant.ts';

const PIZZA: InvoiceItem = { id: 'i-pizza', name: 'Margherita', type: 'Product', hsn: '996331', unit: 'NOS', quantity: 1, rate: 300, tax_rate: 5, amount: 0, group_id: 'g-pizza' };
const DIP: InvoiceItem = { id: 'i-dip', name: 'Cheese Dip (packed)', type: 'Product', hsn: '0406', unit: 'NOS', quantity: 1, rate: 50, tax_rate: 12, amount: 0 };
const SIZE: ModifierGroup = { id: 'm-size', name: 'Size', min: 1, max: 1, options: [{ id: 'reg', name: 'Regular', price: 0 }, { id: 'lg', name: 'Large', price: 120 }], group_ids: ['g-pizza'] };
const ADD: ModifierGroup = {
  id: 'm-add', name: 'Add-ons', min: 0, max: 2,
  options: [{ id: 'cheese', name: 'Extra cheese', price: 40 }, { id: 'jain', name: 'Jain', price: 0 }, { id: 'dip', name: 'Dip', price: 50, item_id: 'i-dip' }],
  item_ids: ['i-pizza'],
};
let n = 0;
const newId = () => `id${++n}`;

beforeEach(() => {
  resetStorage();
  installSettings();
  setTable('items_catalog', [PIZZA, DIP]);
  freezeDate('2026-09-05T19:00:00');
});
afterEach(() => thawDate());

test('min / max validation and the group master check', () => {
  assert.deepEqual(groupsFor(PIZZA, [SIZE, ADD]).map((g) => g.id), ['m-size', 'm-add']);
  assert.deepEqual(groupsFor(DIP, [SIZE, ADD]), []);
  assert.match(validatePicks([SIZE, ADD], {})[0], /Pick one Size/);
  assert.match(validatePicks([SIZE, ADD], { 'm-size': ['lg'], 'm-add': ['cheese', 'jain', 'dip'] })[0], /At most 2 in Add-ons/);
  assert.deepEqual(validatePicks([SIZE, ADD], { 'm-size': ['reg'], 'm-add': ['jain'] }), []);
  assert.deepEqual(validateGroup(SIZE), []);
  assert.ok(validateGroup({ ...SIZE, min: 3 }).length);
  assert.ok(validateGroup({ ...SIZE, options: [{ id: 'x', name: 'Bad', price: -5 }] }).length);
});

test('priced options become child lines with the parent HSN / GST; a mapped option uses its own item; free → note', () => {
  const parent = { hsn: '996331', tax_rate: 5, quantity: 2, type: 'Product', unit: 'NOS' };
  const r = modifierLines(parent, [SIZE, ADD], { 'm-size': ['lg'], 'm-add': ['cheese', 'jain'] }, [PIZZA, DIP], newId);
  assert.deepEqual(r.children.map((c) => [c.name, c.quantity, c.rate, c.hsn, c.tax_rate]), [['Large', 2, 120, '996331', 5], ['Extra cheese', 2, 40, '996331', 5]]);
  assert.equal(r.note, 'Jain');
  const m = modifierLines(parent, [ADD], { 'm-add': ['dip'] }, [PIZZA, DIP], newId);
  assert.deepEqual([m.children[0].name, m.children[0].hsn, m.children[0].tax_rate, m.children[0].item_id], ['Cheese Dip (packed)', '0406', 12, 'i-dip']);

  // On an order and its bill: the child lines are taxed per line.
  const o = openOrder({ channel: 'dine_in', table_id: 'tbl_1' });
  const kids = modifierLines({ ...parent, quantity: 1 }, [SIZE, ADD], { 'm-size': ['lg'], 'm-add': ['jain', 'dip'] }, [PIZZA, DIP], newId);
  addToOrder(o.id, PIZZA, { children: kids.children, note: kids.note });
  const ord = ordersDb.get(o.id)!;
  assert.equal(ord.lines.length, 3);
  assert.ok(ord.lines.slice(1).every((l) => l.modifier_of === ord.lines[0].id));
  assert.equal(ord.lines[0].note, 'Jain');
  const bill = previewBill(ord);
  assert.equal(bill.items[0].description, 'Jain');
  assert.equal(bill.tax_amount, 27, '5% on 300 + 120, 12% on 50');
});

test('86 clears itself on the next local day; group toggle marks many at once', () => {
  const today = localDay();
  set86Items(['i-pizza'], true);
  assert.ok(isUnavailable(localDb.items.getAll().find((i) => i.id === 'i-pizza'), today));
  freezeDate('2026-09-06T08:00:00');
  assert.equal(isUnavailable(localDb.items.getAll().find((i) => i.id === 'i-pizza'), localDay()), false, 'a new day');
  const stock = [{ name: 'Margherita', group_id: 'g-pizza' }, { name: 'Cheese Dip (packed)', group_id: 'g-sides' }];
  const groups = [{ id: 'g-food' }, { id: 'g-pizza', parent_id: 'g-food' }, { id: 'g-sides', parent_id: 'g-food' }];
  assert.deepEqual(idsInGroup([PIZZA, DIP], stock, 'g-food', groups).sort(), ['i-dip', 'i-pizza']);
  assert.deepEqual(idsInGroup([PIZZA, DIP], stock, 'g-pizza', groups), ['i-pizza']);
  const off = set86([PIZZA, DIP], ['i-pizza', 'i-dip'], true, '2026-09-06');
  assert.ok(off.every((i) => i.unavailable_on === '2026-09-06'));
  assert.ok(set86(off, ['i-dip'], false, '2026-09-06').find((i) => i.id === 'i-dip')!.unavailable_on === undefined);
});

test('auto-86 at zero stock counts live order lines in base units (lineFactor)', () => {
  assert.equal(autoUnavailable(null, []), false, 'untracked items never auto-86');
  assert.equal(autoUnavailable(24, [{ quantity: 1, unit_factor: 12 }]), false);
  assert.equal(autoUnavailable(24, [{ quantity: 2, unit_factor: 12 }]), true, '2 boxes of 12 use all 24');
  assert.equal(autoUnavailable(5, [{ quantity: 4 }]), false);
  assert.equal(autoUnavailable(0, []), true);
});
