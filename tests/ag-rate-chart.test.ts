/** AG-B1 fat / SNF rate charts: each basis, step lookup, below-minimum modes, effective dating, litres ↔ kg, CSV. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import type { MilkRateChart } from '../src/types/agri-r12.ts';
import { chartAt, chartRate, clrOf, deleteChart, loadCharts, matrixCsv, parseMatrix, saveChart, solids, stepIndex, toKg, toL } from '../src/lib/agri/ag-rate-chart.ts';
import { addEntry } from '../src/lib/agri/ag-shifts.ts';
import { cowMatrix } from './helpers/ag-dairy.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const base = { name: 'Cow', milk: 'cow', unit: 'L', effective_from: '2026-11-01', below_min: 'reject' } as const;

test('matrix: nearest lower step by default, nearest on request; below the first step is below the minimum', () => {
  assert.equal(stepIndex([3, 3.5, 4], 3.7), 1);
  assert.equal(stepIndex([3, 3.5, 4], 3.8, 'nearest'), 2);
  assert.equal(stepIndex([3, 3.5, 4], 2.9), -1);
  const c = { id: 'c', ...cowMatrix() } as MilkRateChart;
  const r = chartRate(c, { fat: 3.7, snf: 8.6, qty: 10, unit: 'L' });
  assert.equal(r.rate, 34);
  assert.equal(r.amount, 340);
  assert.equal(chartRate({ ...c, lookup: 'nearest' }, { fat: 3.8, snf: 8.9, qty: 10, unit: 'L' }).rate, 38);
  const low = chartRate(c, { fat: 2.5, snf: 8.6, qty: 10, unit: 'L' });
  assert.equal(low.rejected, true);
  assert.equal(low.amount, 0);
});

test('below-minimum modes: reject, flat rate, deduct', () => {
  const c = { id: 'c', ...cowMatrix({ min_fat: 3.2 }) } as MilkRateChart;
  assert.equal(chartRate(c, { fat: 3.1, snf: 8.6, qty: 1, unit: 'L' }).rejected, true);
  assert.equal(chartRate({ ...c, below_min: 'flat', below_rate: 20 }, { fat: 3.1, snf: 8.6, qty: 2, unit: 'L' }).amount, 40);
  assert.equal(chartRate({ ...c, below_min: 'deduct', below_rate: 5 }, { fat: 3.1, snf: 8.6, qty: 1, unit: 'L' }).rate, 26);
});

test('fat-kg, TS-kg, two-axis and flat bases; incentives by shift and quantity', () => {
  const kgBase = { ...base, unit: 'KG', id: 'k' } as const;
  const sol = solids(10, 'KG', 6, 9, 30);
  assert.deepEqual(sol, { kgFat: 0.6, kgSnf: 0.9 });
  assert.equal(chartRate({ ...kgBase, basis: 'fat_kg', fat_rate: 800 } as MilkRateChart, { fat: 6, snf: 9, qty: 10, unit: 'KG' }).amount, 480);
  assert.equal(chartRate({ ...kgBase, basis: 'ts_kg', ts_rate: 400 } as MilkRateChart, { fat: 6, snf: 9, qty: 10, unit: 'KG' }).amount, 600);
  assert.equal(chartRate({ ...kgBase, basis: 'two_axis', fat_rate: 500, snf_rate: 300 } as MilkRateChart, { fat: 6, snf: 9, qty: 10, unit: 'KG' }).amount, 570);
  const flat = { ...kgBase, basis: 'flat', flat_rate: 50, incentives: [{ kind: 'shift', key: 'M', add: 1 }, { kind: 'quantity', key: '20', add: 0.5 }] } as MilkRateChart;
  assert.equal(chartRate(flat, { fat: 6, snf: 9, qty: 10, unit: 'KG', shift: 'M' }).rate, 51);
  const big = chartRate(flat, { fat: 6, snf: 9, qty: 20, unit: 'KG', shift: 'E' });
  assert.equal(big.rate, 50.5);
  assert.equal(big.incentive, 0.5);
});

test('litres ↔ kg by CLR (default cow 28 / buffalo 30)', () => {
  assert.equal(clrOf('cow'), 28);
  assert.equal(clrOf('buffalo'), 30);
  assert.equal(clrOf('cow', { clr_cow: 29 }), 29);
  assert.equal(toKg(100, 'L', 28), 102.8);
  assert.equal(toL(102.8, 'KG', 28), 100);
  assert.equal(toKg(5, 'KG', 28), 5);
});

test('effective dating: a new chart closes the old one; old milk keeps its stored rate', () => {
  const a = saveChart(cowMatrix());
  const { entry } = addEntry({ centre_id: 'c1', date: '2026-11-05', shift: 'M' }, { farmer_id: 'f1', milk: 'cow', qty: 10, unit: 'L', fat: 3.7, snf: 8.6 });
  assert.equal(entry.chart_id, a.id);
  assert.equal(entry.rate, 34);
  const b = saveChart(cowMatrix({ name: 'Cow Dec', effective_from: '2026-12-01', matrix: { fat_steps: [3], snf_steps: [8], rates: [[40]] } }));
  assert.equal(loadCharts().find((c) => c.id === a.id)?.effective_to, '2026-11-30');
  assert.equal(chartAt(loadCharts(), '2026-11-30', 'cow')?.id, a.id);
  assert.equal(chartAt(loadCharts(), '2026-12-01', 'cow')?.id, b.id);
  assert.throws(() => saveChart({ ...a, name: 'Edited' }), /new chart/);
  assert.throws(() => deleteChart(a.id), /stays/);
  deleteChart(b.id);
  assert.equal(loadCharts().length, 1);
  // buyer charts are separate from farmer charts; centre charts only apply to their centres
  saveChart(cowMatrix({ name: 'Union', buyer_id: 'u1', effective_from: '2026-11-01' }));
  assert.equal(chartAt(loadCharts(), '2026-11-10', 'cow')?.id, a.id);
  assert.equal(chartAt(loadCharts(), '2026-11-10', 'cow', { buyerId: 'u1' })?.name, 'Union');
  assert.equal(chartAt(loadCharts(), '2026-11-10', 'buffalo'), undefined);
});

test('matrix CSV round trip; bad shapes refused', () => {
  const m = cowMatrix().matrix!;
  assert.deepEqual(parseMatrix(matrixCsv(m)), m);
  assert.throws(() => parseMatrix('a'), /header/);
  assert.throws(() => saveChart(cowMatrix({ matrix: { fat_steps: [3, 2], snf_steps: [8], rates: [[1], [2]] } })), /go up/);
  assert.throws(() => saveChart(cowMatrix({ matrix: { fat_steps: [3], snf_steps: [8, 9], rates: [[1]] } })), /cell/);
});
