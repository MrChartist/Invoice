import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCatalogDraft, bulkAdjustRates, validateCatalogItem, type CatalogDraft } from '../src/lib/catalog.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';

const item = (over: Partial<InvoiceItem>): InvoiceItem =>
  ({ id: 'a', name: 'Research subscription', type: 'Service', hsn: '998399', unit: 'NOS', quantity: 1, rate: 1000, amount: 0, tax_rate: 18, ...over }) as InvoiceItem;

const draft = (over: Partial<CatalogDraft> = {}): CatalogDraft => ({
  name: 'Consulting', type: 'Service', hsn: '998311', unit: 'HRS', rate: 2500, tax_rate: 18, ...over,
});

test('validate: name is required and unique ignoring case and spaces', () => {
  const existing = [item({ id: 'a' })];
  assert.equal(validateCatalogItem(draft({ name: '  ' }), existing)?.field, 'name');
  assert.equal(validateCatalogItem(draft({ name: ' RESEARCH subscription ' }), existing)?.field, 'name');
  // editing the same row may keep its own name
  assert.equal(validateCatalogItem(draft({ id: 'a', name: 'Research subscription' }), existing), null);
});

test('validate: rate, HSN and GST bounds', () => {
  assert.equal(validateCatalogItem(draft({ rate: -1 }), [])?.field, 'rate');
  assert.equal(validateCatalogItem(draft({ hsn: '12' }), [])?.field, 'hsn');
  assert.equal(validateCatalogItem(draft({ hsn: '' }), []), null);
  assert.equal(validateCatalogItem(draft({ tax_rate: 120 }), [])?.field, 'tax_rate');
});

test('apply: editing keeps the id and untouched fields; adding creates a new id', () => {
  const list = [item({ id: 'a', quantity: 3 })];
  const edited = applyCatalogDraft(list, draft({ id: 'a', name: 'Research plan', rate: 1200.456 }));
  assert.equal(edited.items.length, 1);
  assert.equal(edited.saved.id, 'a');
  assert.equal(edited.saved.rate, 1200.46);
  assert.equal(edited.saved.quantity, 3);
  const added = applyCatalogDraft(list, draft(), () => 'new1');
  assert.equal(added.items.length, 2);
  assert.equal(added.saved.id, 'new1');
});

test('bulk: +10% on selected items only; zero-rate items stay free', () => {
  const list = [item({ id: 'a', rate: 1000 }), item({ id: 'b', name: 'B', rate: 333.33 }), item({ id: 'c', name: 'C', rate: 0 })];
  const out = bulkAdjustRates(list, new Set(['a', 'c']), 10);
  assert.deepEqual(out.map((i) => i.rate), [1100, 333.33, 0]);
});

test('bulk: rounding modes and never below zero', () => {
  const list = [item({ id: 'a', rate: 999 })];
  assert.equal(bulkAdjustRates(list, 'all', 5, 'rupee')[0].rate, 1049); // 1048.95 → 1049
  assert.equal(bulkAdjustRates(list, 'all', 5, 'ten')[0].rate, 1050);
  assert.equal(bulkAdjustRates(list, 'all', -150, 'paise')[0].rate, 0);
  assert.equal(bulkAdjustRates(list, 'all', Number.NaN)[0].rate, 999);
});
