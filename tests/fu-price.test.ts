/** R21-A3 dated fuel prices: the price in force at 05:59 vs 06:00, a mid-day revision, no row → none (the POS refuses with the reason), copy yesterday, same-moment replace. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { copyYesterday, readPrices, savePrice } from '../src/lib/fuel/fu-price.ts';
import { priceAt } from '../src/lib/fuel/fu-line.ts';
import { fuDefaultsFor } from '../src/lib/fuel/fu-settings.ts';
import type { FuelPrice } from '../src/types/fuel-r21.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const row = (date: string, time: string, rsp: number, item_id = 'ms'): FuelPrice => ({ id: `${item_id}-${date}-${time}`, item_id, date, time, rsp });

test('price in force: 05:59 takes yesterday, 06:00 today, a mid-day revision from its time; other items and no row', () => {
  const rows = [row('2026-10-28', '06:00', 94.5), row('2026-10-29', '06:00', 94.72), row('2026-10-29', '14:30', 95.1), row('2026-10-29', '06:00', 87.6, 'hsd')];
  assert.equal(priceAt(rows, 'ms', '2026-10-29', '05:59')?.rsp, 94.5);
  assert.equal(priceAt(rows, 'ms', '2026-10-29', '06:00')?.rsp, 94.72);
  assert.equal(priceAt(rows, 'ms', '2026-10-29', '14:29')?.rsp, 94.72);
  assert.equal(priceAt(rows, 'ms', '2026-10-29', '14:30')?.rsp, 95.1);
  assert.equal(priceAt(rows, 'ms', '2026-10-30', '00:00')?.rsp, 95.1);
  assert.equal(priceAt(rows, 'hsd', '2026-10-29', '05:00'), null, 'no row yet → none (the POS strip refuses the save with the reason)');
  assert.equal(priceAt(rows, 'cng', '2026-10-29', '23:59'), null);
});

test('savePrice validates; a second row for the same moment replaces the first; copy yesterday', () => {
  assert.throws(() => savePrice({ item_id: 'ms', date: '2026-10-29', time: '6:00', rsp: 94.72 }), /HH:MM/);
  assert.throws(() => savePrice({ item_id: 'ms', date: '2026-10-29', time: '06:00', rsp: 0 }), /price/);
  assert.throws(() => savePrice({ item_id: '', date: '2026-10-29', time: '06:00', rsp: 9 }), /product/);
  savePrice({ item_id: 'ms', date: '2026-10-28', time: '06:00', rsp: 94.5, build: { excise: 21.9, vat: 15.4 } });
  savePrice({ item_id: 'ms', date: '2026-10-28', time: '06:00', rsp: 94.55 });
  savePrice({ item_id: 'hsd', date: '2026-10-28', time: '06:00', rsp: 87.6 });
  assert.equal(readPrices().length, 2);
  assert.equal(priceAt(readPrices(), 'ms', '2026-10-28', '12:00')?.rsp, 94.55);
  assert.equal(copyYesterday(['ms', 'hsd', 'cng'], '2026-10-29', '2026-10-28', '06:00'), 2, 'cng has no price to copy');
  assert.equal(copyYesterday(['ms', 'hsd'], '2026-10-29', '2026-10-28', '06:00'), 0, 'already copied');
  assert.equal(priceAt(readPrices(), 'hsd', '2026-10-29', '06:00')?.date, '2026-10-29');
});

test('fuel settings defaults: two shifts from 06:00 (an LPG agency one), prices at 06:00, 5 L test; a stored value wins', () => {
  assert.deepEqual(fuDefaultsFor('pump', {}).shift_starts, ['06:00', '14:00']);
  assert.equal(fuDefaultsFor('lpg', {}).shift_count, 1);
  assert.equal(fuDefaultsFor('pump', { test_litres: 10 }).test_litres, 10);
  assert.equal(fuDefaultsFor(undefined, {}).price_time, '06:00');
});
