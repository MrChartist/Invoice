/** R21-C1 dips and density: litres from the chart, the water dip (subtracted by default, shown only for a product-only chart, FU16), refusals, the morning checklist. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { dipLitres, morningChecklist, readLogs, removeLog, saveLog } from '../src/lib/fuel/fu-dips.ts';
import { getTable } from '../src/lib/storage.ts';
import type { FuelNozzle, FuelShift, FuTank } from '../src/types/fuel-r21.ts';

const chart: FuTank['chart'] = [[0, 0], [500, 2000], [1000, 5200], [1500, 8900]];
const ms = { id: 't1', name: 'Tank 1', fu: { product_item_id: 'ms', capacity_l: 9000, chart } };
const cng = { id: 't2', name: 'Cascade', fu: { product_item_id: 'cng', capacity_l: 1000, chart: [] as FuTank['chart'] } };
const noz = (id: string, tank: string, item: string): FuelNozzle => ({ id, du_no: '1', nozzle_no: id, tank_id: tank, item_id: item, totaliser_start: 0, active: true });

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('litres from the chart; the water dip is subtracted unless the chart is product-only', () => {
  assert.deepEqual(dipLitres(chart, 1200), { litres: 6680, water_l: 0 });
  assert.deepEqual(dipLitres(chart, 1200, 50), { litres: 6480, water_l: 200 }, 'water 50 mm = 200 L');
  assert.deepEqual(dipLitres(chart, 1200, 50, false), { litres: 6680, water_l: 200 }, 'shown, not deducted');
  const r = saveLog({ date: '2026-10-29', time: '06:00', kind: 'dip', tank_id: 't1', mm: 1200, water_mm: 50 }, ms);
  assert.equal(r.litres, 6480);
  assert.equal(r.water_l, 200);
  assert.equal(getTable('fuel_tank_logs').length, 1);
});

test('refusals: no tank, a fractional or out-of-chart dip, a bad density, a receipt without litres; a cascade takes typed stock', () => {
  assert.throws(() => saveLog({ date: '2026-10-29', kind: 'dip', mm: 10 }), /tank/);
  assert.throws(() => saveLog({ date: '2026-10-29', kind: 'dip', tank_id: 't1', mm: 10.5 }, ms), /whole mm/);
  assert.throws(() => saveLog({ date: '2026-10-29', kind: 'dip', tank_id: 't1', mm: 1600 }, ms), /outside the chart/);
  assert.throws(() => saveLog({ date: '2026-10-29', kind: 'density', tank_id: 't1', density_15: 74.5 }), /kg\/m³/);
  assert.throws(() => saveLog({ date: '2026-10-29', kind: 'receipt', tank_id: 't1', compartments: [{ invoice_l: 0 }] }, ms), /invoice litres/);
  assert.throws(() => saveLog({ date: '2026-10-29', kind: 'dip', tank_id: 't2' }, cng), /type the stock/);
  assert.equal(saveLog({ date: '2026-10-29', kind: 'dip', tank_id: 't2', litres: 412.5 }, cng).litres, 412.5);
  const r = saveLog({ date: '2026-10-29', kind: 'receipt', tank_id: 't1', before_mm: 500, after_mm: 1000, compartments: [{ invoice_l: 3200 }] }, ms);
  assert.deepEqual([r.before_l, r.after_l], [2000, 5200]);
  removeLog(r.id);
  assert.equal(readLogs().length, 1, 'deleted through setTable');
});

test('the morning checklist lists what is missing, never blocks', () => {
  const nozzles = [noz('A', 't1', 'ms'), noz('B', 't1', 'ms'), { ...noz('C', 't1', 'ms'), active: false }];
  const opts = { tanks: [ms, cng], nozzles, logs: [] as ReturnType<typeof readLogs>, shifts: [] as FuelShift[], itemName: (id: string) => id.toUpperCase(), label: (n: FuelNozzle) => n.nozzle_no };
  assert.deepEqual(morningChecklist('2026-10-29', opts).map((m) => `${m.k}:${m.name}`), ['dip:Tank 1', 'dip:Cascade', 'test:A', 'test:B', 'density:MS', 'density:CNG']);
  saveLog({ date: '2026-10-29', kind: 'dip', tank_id: 't1', mm: 1000 }, ms);
  saveLog({ date: '2026-10-29', kind: 'density', nozzle_id: 'A', density_15: 745.2 });
  const shift: FuelShift = { id: 's', date: '2026-10-29', shift_no: 1, opened_at: '', attendants: [], collections: [], status: 'open', readings: [{ nozzle_id: 'A', opening: 0, test_l: 5, test_returned: true }, { nozzle_id: 'B', opening: 0, test_l: 0, test_returned: true }] };
  assert.deepEqual(morningChecklist('2026-10-29', { ...opts, logs: readLogs(), shifts: [shift] }).map((m) => `${m.k}:${m.name}`), ['dip:Cascade', 'test:B', 'density:CNG']);
  assert.equal(morningChecklist('2026-10-30', { ...opts, logs: readLogs(), shifts: [shift] }).length, 6, 'another day starts afresh');
});
