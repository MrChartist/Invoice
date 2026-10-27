/** MF-B4 moulding runs: expected output and efficiency, material balance to the gram, regrind warning, one journal per run, mould life. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { stockDb, computeStock } from '../src/lib/inventory.ts';
import { liveTrackingInputs as liveStockInputs } from '../src/lib/stock-tracking.ts';
import { manufacturingDb } from '../src/lib/manufacturing.ts';
import { getTable } from '../src/lib/storage.ts';
import { expectedOutput, loadMoulds, loadRuns, mouldLife, partGrams, regrindWarning, removeRun, runBalance, saveMould, saveRun } from '../src/lib/mfg/mf-runs.ts';
import type { ProcessRun } from '../src/types/mfg-r13.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
});

const run: ProcessRun = {
  id: 'r', date: '2026-10-27', item_id: 'cap', hours: 10, cycle_s: 22, cavities: 4, part_g: 15,
  inputs: [{ item_id: 'pp', kind: 'virgin', kg: 95 }, { item_id: 'mb', kind: 'masterbatch', kg: 4 }, { item_id: 'rg', kind: 'regrind', kg: 12 }],
  good_qty: 6380, reject_qty: 140, runner_kg: 3.1, purge_kg: 0.5, regrind_out_kg: 5.2, regrind_item_id: 'rg',
};

test('expected output = hours × 3600 ÷ cycle × cavities; efficiency; balance closes to the gram', () => {
  assert.equal(expectedOutput(10, 22, 4), 6544); // 1636 shots
  const b = runBalance(run);
  assert.equal(b.expected, 6544);
  assert.equal(b.efficiency_pct, 97.49);
  assert.deepEqual([b.input_kg, b.good_kg, b.reject_kg], [111, 95.7, 2.1]);
  assert.equal(b.loss_kg, 9.6); // 111 − 95.7 − 2.1 − 3.1 − 0.5
  assert.equal(Math.round((b.good_kg + b.reject_kg + b.runner_kg + b.purge_kg + b.loss_kg) * 1000), 111000, 'to the gram');
  assert.equal(b.yield_pct, 86.22);
  assert.equal(b.regrind_pct, 10.81);
  assert.match(regrindWarning(b, { name: 'Cap', mf_max_regrind_pct: 10 }), /above the 10%/);
  assert.equal(regrindWarning(b, { name: 'Cap', mf_max_regrind_pct: 15 }), '');
  assert.equal(partGrams({}, { shot_g: 70, runner_g: 10, cavities: 4 }), 15, 'part weight from the mould');
});

test('one manufacturing journal per run (stock once); edit keeps it; delete removes both and the run is not restored alone; mould life from runs', async () => {
  for (const [id, name] of [['cap', 'PP cap'], ['pp', 'PP virgin'], ['mb', 'Masterbatch'], ['rg', 'PP regrind']]) {
    stockDb.saveItem({ id, name, unit: id === 'cap' ? 'NOS' : 'KG', track_stock: true, opening_qty: id === 'cap' ? 0 : 200, opening_rate: 100, reorder_level: 0 } as never);
  }
  const m = saveMould({ name: 'M-14', item_id: 'cap', cavities: 4, cycle_s: 22, shot_g: 70, runner_g: 10, life_shots: 1800, shots_done: 0 });
  const r = saveRun({ ...run, id: undefined, mould_id: m.id, cycle_s: undefined, cavities: undefined } as never, stockDb.items(), liveStockInputs());
  assert.equal(r.shots, 1636);
  assert.equal(manufacturingDb.all().length, 1);
  const v = manufacturingDb.all()[0];
  assert.equal(v.qty, 6380);
  assert.deepEqual(v.components.map((c) => [c.item_id, c.qty]), [['pp', 95], ['mb', 4], ['rg', 12]]);
  assert.deepEqual(v.outputs.map((o) => [o.item_id, o.qty, o.kind]), [['rg', 5.2, 'scrap']]);
  const qty = (id: string) => computeStock(liveStockInputs()).find((p) => p.item.id === id)?.qty;
  assert.equal(qty('cap'), 6380);
  assert.equal(qty('rg'), 193.2, '200 − 12 consumed + 5.2 made');
  saveRun({ ...r, good_qty: 6000 }, stockDb.items(), liveStockInputs());
  assert.equal(manufacturingDb.all().length, 1, 'an edit rewrites the same journal');
  assert.equal(qty('cap'), 6000);
  const life = mouldLife(loadMoulds()[0], loadRuns());
  assert.deepEqual([life.shots, life.warn], [1636, true], '1636 of 1800 shots ≥ 90%');
  removeRun(r.id);
  assert.equal(loadRuns().length, 0);
  assert.equal(manufacturingDb.all().length, 0);
  const { restoreEntry } = await import('../src/lib/trust/recycle-bin.ts');
  const bin = getTable<{ id: string; table: string; row_id: string }>('recycle_bin');
  assert.throws(() => restoreEntry(bin.find((e) => e.table === 'process_runs' && e.row_id === r.id)!.id), /journal of this run is gone/, 'a run never comes back without its stock journal');
  assert.equal(loadRuns().length, 0);
});
