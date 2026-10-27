/** MF-D1 food batches: dates from shelf life, actual yield, FSSAI warning / validation / licence expiry, class rates by date. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { actualYield, bestBefore, FOOD_CLASSES, foodClassRate, foodOutputDefaults, foodRateNotice, fssaiLicences, fssaiWarning, validateFssai } from '../src/lib/mfg/mf-food.ts';
import { FOOD_CLASS_RULES } from '../src/lib/mfg-rules.ts';

test('batch dates: packed + shelf life; the order\'s typed best-before / use-by wins; no food and no shelf life = nothing', () => {
  assert.equal(bestBefore('2026-10-12', 90), '2027-01-10');
  assert.deepEqual(foodOutputDefaults({ mf: { food: { batch_no: 'NK2610', packed_on: '2026-10-12' } } }, { shelf_life_days: 90 }, '2026-10-15'), { batch_no: 'NK2610', mfg_date: '2026-10-12', expiry_date: '2027-01-10' });
  assert.deepEqual(foodOutputDefaults({ mf: { food: { shelf_life_days: 30, best_before: '2026-11-01' } } }, undefined, '2026-10-15'), { mfg_date: '2026-10-15', expiry_date: '2026-11-01' });
  assert.deepEqual(foodOutputDefaults({}, { shelf_life_days: 10 }, '2026-10-15'), { mfg_date: '2026-10-15', expiry_date: '2026-10-25' });
  assert.deepEqual(foodOutputDefaults({}, {}, '2026-10-15'), {});
});

test('actual yield: finished kg ÷ weight consumed; packing (counted units) left out', () => {
  const units: Record<string, string> = { besan: 'KG', oil: 'LTR', film: 'NOS', pouch: 'NOS' };
  const y = actualYield([{ qty: 98, components: [{ item_id: 'besan', qty: 100 }, { item_id: 'oil', qty: 25 }, { item_id: 'film', qty: 400 }] }], (id) => units[id], 'KG');
  assert.equal(y, 78.4);
  assert.equal(actualYield([], (id) => units[id], 'KG'), null);
  assert.equal(actualYield([{ qty: 5, components: [] }], (id) => units[id], 'NOS'), null);
});

test('FSSAI: soft warning only with the pack on; 14 digits; licence expiry read from the R12 register', () => {
  assert.equal(fssaiWarning({}, false), '');
  assert.match(fssaiWarning({}, true), /FSSAI/);
  assert.equal(fssaiWarning({ fssai_no: '12345678901234' }, true), '');
  assert.match(validateFssai('1234'), /14 digits/);
  const l = fssaiLicences([{ kind: 'fssai', number: '12345678901234', valid_to: '2026-11-20' }, { kind: 'seed', number: 'S1' }], '2026-10-27');
  assert.deepEqual(l.map((x) => [x.number, x.days, x.soon, x.expired]), [['12345678901234', 24, true, false]]);
});

test('food classes: 22 Sep 2025 rows, unverified; typed rate wins with a notice', () => {
  assert.equal(FOOD_CLASSES.length, 9);
  for (const rows of Object.values(FOOD_CLASS_RULES)) for (const r of rows) assert.equal(r.verified, false);
  assert.equal(foodClassRate('namkeen', '2025-09-21')!.rate, 12);
  assert.equal(foodClassRate('namkeen', '2025-09-22')!.rate, 5);
  assert.equal(foodClassRate('nothing', '2025-09-22'), undefined);
  assert.equal(foodRateNotice('biscuits', 5, '2026-01-01').notice, '');
  assert.match(foodRateNotice('biscuits', 18, '2026-01-01').notice, /MF6/);
});
