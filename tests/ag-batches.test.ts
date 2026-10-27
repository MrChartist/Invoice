/** AG-A1 farm batches: FCR, mortality %, cost per kg; the cost centre is created once. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { addBatchEvent, batchMemo, loadBatches, saveBatch } from '../src/lib/agri/ag-batches.ts';
import { loadCostCentres } from '../src/lib/cost-centres.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('memo: mortality %, feed, FCR = feed ÷ weight gained, cost per kg', () => {
  const m = batchMemo({ placed: 5000, start_weight_kg: 200, events: [
    { date: '2026-10-01', kind: 'feed', qty: 2500, unit: 'KG' }, { date: '2026-10-05', kind: 'mortality', qty: 60, unit: 'NOS' },
    { date: '2026-10-10', kind: 'feed', qty: 4200, unit: 'KG' }, { date: '2026-10-20', kind: 'weight', qty: 9600, unit: 'KG' },
  ] }, 480000);
  assert.deepEqual([m.dead, m.mortalityPct, m.feedKg, m.gainedKg, m.fcr, m.costPerKg], [60, 1.2, 6700, 9400, 0.71, 50]);
  assert.equal(batchMemo({ placed: 10, events: [] }).fcr, null);
});

test('a batch creates its cost centre once; events append', () => {
  const b = saveBatch({ kind: 'flock', name: 'Flock 1', start: '2026-10-01', placed: 1000, unit: 'birds' });
  assert.ok(b.cost_centre_id);
  const again = saveBatch({ ...b, name: 'Flock 1' });
  assert.equal(again.cost_centre_id, b.cost_centre_id);
  assert.equal(loadCostCentres().filter((c) => c.name.startsWith('Flock 1')).length, 1);
  addBatchEvent(b.id, { date: '2026-10-03', kind: 'feed', qty: 100, unit: 'KG' });
  assert.equal(loadBatches()[0].events.length, 1);
  assert.throws(() => saveBatch({ kind: 'pond', name: '', start: '2026-10-01', placed: 1, unit: 'kg' }));
});
