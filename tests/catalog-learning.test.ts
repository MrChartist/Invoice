import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('saving an invoice teaches the catalogue a new item', () => {
  createViaStore({ date: '2026-06-10', due: '2026-06-24', lines: [{ qty: 1, rate: 5000, name: 'Webinar' }] });
  const item = localDb.items.getAll().find((i) => i.name === 'Webinar');
  assert.equal(item?.rate, 5000);
});

test('a one-off price on a later invoice does NOT overwrite the saved default rate', () => {
  localDb.items.upsert({ name: 'Webinar', type: 'Service', rate: 5000, hsn: '999299', unit: 'NOS', tax_rate: 18 });
  createViaStore({ date: '2026-06-10', due: '2026-06-24', lines: [{ qty: 1, rate: 3500, name: 'webinar' }] });
  const items = localDb.items.getAll();
  assert.equal(items.length, 1);
  assert.equal(items[0].rate, 5000, 'default rate must survive a discounted sale');
  assert.equal(items[0].hsn, '999299');
});

test('learning still fills details the catalogue was missing', () => {
  localDb.items.upsert({ name: 'Webinar', type: 'Service', rate: 5000 } as never);
  localDb.items.upsert({ name: 'Webinar', hsn: '999299', unit: 'NOS', rate: 1 }, { fillOnly: true });
  const item = localDb.items.getAll()[0];
  assert.equal(item.rate, 5000);
  assert.equal(item.hsn, '999299');
  assert.equal(item.unit, 'NOS');
});

test('an explicit upsert (e.g. editing in the catalogue) still replaces the rate', () => {
  localDb.items.upsert({ name: 'Webinar', type: 'Service', rate: 5000 } as never);
  localDb.items.upsert({ name: 'Webinar', rate: 6000 });
  assert.equal(localDb.items.getAll()[0].rate, 6000);
});

test('a many-line save writes the catalogue once, and an unchanged re-save not at all', () => {
  const lines = Array.from({ length: 20 }, (_, i) => ({ qty: 1, rate: 100 + i, name: `Item ${i}` }));
  const original = localStorage.setItem.bind(localStorage);
  let catalogWrites = 0;
  localStorage.setItem = (k: string, v: string) => {
    if (k === 'mrchartist_inv_items_catalog') catalogWrites++;
    original(k, v);
  };
  try {
    const inv = createViaStore({ date: '2026-06-10', lines });
    assert.equal(localDb.items.getAll().length, 20);
    assert.equal(catalogWrites, 1);
    catalogWrites = 0;
    localDb.invoices.save(inv);
    assert.equal(catalogWrites, 0);
  } finally {
    localStorage.setItem = original;
  }
});
