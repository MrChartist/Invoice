/**
 * PENDING #21 (SV-A / SV-C): class bookings per occurrence (appointments with `class_id`, capacity per day), "products
 * used per service" on the stock-item form (kit + default BOM), and the POS "staff required" block.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setTable } from '../src/lib/storage.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';
import { saveClass } from '../src/lib/services/sv-classes.ts';
import { loadAppointments } from '../src/lib/services/sv-appointments.ts';
import { bookingsOf, bookOccurrence, cancelBooking, placesLeft } from '../src/lib/services/sv-class-bookings.ts';
import { recipeOf, recipeProblem, saveRecipe } from '../src/lib/services/sv-recipe-form.ts';
import { linesWithoutStaff } from '../src/lib/services/sv-pos.ts';
import { bomsDb } from '../src/lib/manufacturing.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('class bookings: one meeting day, capacity per day, cancel frees the place', () => {
  // 2026-06-01 is a Monday (weekday 0).
  const c = saveClass({ name: 'Yoga 7am', kind: 'class', days: [0, 2], start: '07:00', minutes: 60, capacity: 2, holidays: ['2026-06-03'] });
  assert.throws(() => bookOccurrence(c.id, '2026-06-02', { name: 'Asha' }), /does not meet/);
  assert.throws(() => bookOccurrence(c.id, '2026-06-03', { name: 'Asha' }), /does not meet/, 'holiday');
  const a = bookOccurrence(c.id, '2026-06-01', { id: 'c1', name: 'Asha' });
  assert.deepEqual([a.class_id, a.start, a.minutes, a.services.length, a.status], [c.id, '07:00', 60, 0, 'booked']);
  assert.throws(() => bookOccurrence(c.id, '2026-06-01', { id: 'c1', name: 'Asha' }), /already booked/);
  bookOccurrence(c.id, '2026-06-01', { name: 'Ravi' });
  assert.throws(() => bookOccurrence(c.id, '2026-06-01', { name: 'Meena' }), /full/);
  assert.equal(placesLeft(c, loadAppointments(), '2026-06-08'), 2, 'another meeting day has its own places');
  cancelBooking(a.id);
  assert.equal(bookingsOf(loadAppointments(), c.id, '2026-06-01').length, 1);
  bookOccurrence(c.id, '2026-06-01', { name: 'Meena' });
});

test('products used per service: lines checked, written as the default BOM, round trip', () => {
  setTable('stock_items', [
    { id: 'svc', name: 'Hair spa', unit: 'NOS', track_stock: false, opening_qty: 0, opening_rate: 0, reorder_level: 0 },
    { id: 'cream', name: 'Spa cream', unit: 'ML', track_stock: true, opening_qty: 1000, opening_rate: 1, reorder_level: 0 },
  ]);
  assert.match(recipeProblem([{ item_id: '', qty: 1 }], 'svc'), /Pick the product/);
  assert.match(recipeProblem([{ item_id: 'cream', qty: 0 }], 'svc'), /quantity/);
  assert.match(recipeProblem([{ item_id: 'svc', qty: 1 }], 'svc'), /itself/);
  assert.equal(recipeProblem([{ item_id: 'cream', qty: 30 }], 'svc'), '');
  saveRecipe('svc', [{ item_id: 'cream', qty: 30 }]);
  const [b] = bomsDb.forItem('svc');
  assert.deepEqual([b.is_default, b.batch_qty, b.components.map((x) => [x.item_id, x.qty])], [true, 1, [['cream', 30]]]);
  saveRecipe('svc', [{ item_id: 'cream', qty: 25 }]);
  assert.equal(bomsDb.forItem('svc').length, 1, 'the default BOM is updated, not duplicated');
  assert.deepEqual(recipeOf('svc'), [{ item_id: 'cream', qty: 25 }]);
  const form = readFileSync(new URL('../src/components/inventory/ItemFormModal.tsx', import.meta.url), 'utf8');
  assert.match(form, /lazy\(\(\) => import\('\.\.\/services-r10\/ServiceRecipeRow'\)\)/);
  assert.match(form, /recipe\.lines\.length \? \{ kit: true, track_stock: false \}/);
});

test('staff required: service lines without staff block the POS save', () => {
  const l = (over: Partial<InvoiceItem>) => ({ id: Math.random().toString(), name: 'x', type: 'Service', quantity: 1, rate: 1, amount: 1, tax_rate: 0, ...over }) as InvoiceItem;
  const items = [l({ name: 'Cut' }), l({ name: 'Colour', sv: { staff_id: 's1' } }), l({ name: 'Shampoo', type: 'Product' }), l({ name: 'Tip', sv: { tip: true } }), l({ name: 'Free', free_of: 'x' } as never)];
  assert.deepEqual(linesWithoutStaff(items).map((x) => x.name), ['Cut']);
  const pos = readFileSync(new URL('../src/pages/Pos.tsx', import.meta.url), 'utf8');
  assert.match(pos, /if \(svBlock\.length\) return setErrors\(svBlock\)/);
  assert.match(pos, /<PosStaff items=\{items\} setItems=\{setItems\} onBlock=\{setSvBlock\} \/>/);
  assert.match(readFileSync(new URL('../src/components/services-r10/PosStaff.tsx', import.meta.url), 'utf8'), /settings\.staff_required && staff\.length \? linesWithoutStaff\(items\)/);
});

test('camera check-in reuses the BarcodeDetector scanner (no new dependency)', () => {
  const desk = readFileSync(new URL('../src/components/services-r10/MembersDesk.tsx', import.meta.url), 'utf8');
  assert.match(desk, /import\('\.\.\/scan\/CameraScanner'\)/);
  assert.match(desk, /if \(h\.length === 1\) go\(h\[0\]\)/);
});
