/** AG-B5 dairy products: starter BOMs are valid, carry classes, class rates move on 22 Sep 2025; fat memo. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { stockDb } from '../src/lib/inventory.ts';
import { bomsDb, validateBom } from '../src/lib/manufacturing.ts';
import { addStarter, DAIRY_STARTERS, fatMemo, starterRate } from '../src/lib/agri/ag-dairy-products.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('every starter makes a valid BOM from milk, with its by-product and agri class', () => {
  for (const s of DAIRY_STARTERS) {
    const b = addStarter(s.key, 'buffalo', '2026-11-01');
    assert.equal(validateBom(b, stockDb.items(), bomsDb.all().filter((x) => x.id !== b.id)), '');
    const item = stockDb.items().find((i) => i.id === b.item_id)!;
    assert.equal(item.ag_class, s.cls);
    assert.equal(b.components[0].item_id, stockDb.items().find((i) => i.name === 'Buffalo milk')?.id);
    assert.equal(b.outputs?.length ?? 0, s.by ? 1 : 0);
  }
  assert.equal(stockDb.items().find((i) => i.name === 'Paneer')?.tax_rate, 0, 'paneer nil after 22 Sep 2025');
  assert.equal(stockDb.items().find((i) => i.name === 'Ghee')?.tax_rate, 5);
  assert.throws(() => addStarter('paneer'), /already has a BOM/);
});

test('class rates by date (AG4): paneer 5% → nil, ghee 12% → 5% on 22 Sep 2025', () => {
  const paneer = DAIRY_STARTERS.find((s) => s.key === 'paneer')!;
  const ghee = DAIRY_STARTERS.find((s) => s.key === 'ghee')!;
  assert.equal(starterRate(paneer, '2025-09-21')?.rate, 5);
  assert.equal(starterRate(paneer, '2025-09-22')?.rate, 0);
  assert.equal(starterRate(ghee, '2025-09-21')?.rate, 12);
  assert.equal(starterRate(ghee, '2025-09-22')?.rate, 5);
});

test('fat memo: kg fat in milk vs in products', () => {
  const m = fatMemo(200, 6, [{ qty: 40, fatPct: 22 }]);
  assert.equal(m.fatIn, 12.336, '200 L × 1.028 × 6%');
  assert.equal(m.fatOut, 8.8);
  assert.equal(m.loss, 3.536);
  assert.equal(m.lossPct, 28.66);
});
