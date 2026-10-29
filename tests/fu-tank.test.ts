/** R21-A2 tanks and nozzles: chart interpolation and its refusals, chart parsing, nozzle product = tank product, deletes to the recycle bin. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { chartIssue, dipToLitres, nozzleIssue, parseChart, readNozzles, removeNozzle, saveNozzle } from '../src/lib/fuel/fu-tank.ts';
import { getTable } from '../src/lib/storage.ts';
import type { FuTank } from '../src/types/fuel-r21.ts';

const chart: FuTank['chart'] = [[0, 0], [500, 2000], [1000, 5200], [1500, 8900]];
const tanks = [{ id: 't1', name: 'Tank 1', fu: { product_item_id: 'ms', capacity_l: 9000, chart } }, { id: 't2', name: 'Tank 2', fu: { product_item_id: 'hsd', capacity_l: 15000, chart } }];

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('dip → litres: exact at chart points, linear between them, refused outside the chart', () => {
  assert.equal(dipToLitres(chart, 500), 2000);
  assert.equal(dipToLitres(chart, 0), 0);
  assert.equal(dipToLitres(chart, 1500), 8900);
  assert.equal(dipToLitres(chart, 1200), 6680, '5200 + 200/500 × 3700');
  assert.equal(dipToLitres(chart, 333), 1332);
  assert.equal(dipToLitres(chart, 1234.5), 6935.3);
  assert.throws(() => dipToLitres(chart, 1501), /outside the chart/);
  assert.throws(() => dipToLitres(chart, -1), /outside the chart/);
  assert.throws(() => dipToLitres([], 10), /no chart/);
});

test('a chart must rise in both columns; parsing a pasted sheet', () => {
  assert.equal(chartIssue(chart), '');
  assert.equal(chartIssue([]), '', 'a CNG cascade has no chart');
  assert.match(chartIssue([[0, 0], [500, 2000], [400, 2500]]), /row 3/);
  assert.match(chartIssue([[0, 0], [500, 2000], [600, 2000]]), /rise/);
  assert.throws(() => dipToLitres([[0, 0], [500, 2000], [400, 2500]], 450), /rise/);
  assert.deepEqual(parseChart('Dip mm,Litres\n0,0\n500\t2000\n1000; 5200\n\n'), [[0, 0], [500, 2000], [1000, 5200]]);
});

test('nozzles: the product is the tank product; a nozzle of another product is refused; labels unique; delete goes through setTable', () => {
  const base = { du_no: '2', nozzle_no: 'B', tank_id: 't1', item_id: 'ms', totaliser_start: 1000, active: true };
  assert.equal(nozzleIssue(base, tanks, []), '');
  assert.match(nozzleIssue({ ...base, item_id: 'hsd' }, tanks, []), /tank/);
  assert.match(nozzleIssue({ ...base, tank_id: 'nope' }, tanks, []), /tank/);
  assert.match(nozzleIssue({ ...base, du_no: ' ' }, tanks, []), /dispensing unit/);
  const n = saveNozzle({ du_no: '2', nozzle_no: 'b', tank_id: 't2', totaliser_start: 50 }, tanks);
  assert.equal(n.item_id, 'hsd', 'the tank product');
  assert.equal(n.nozzle_no, 'B');
  assert.throws(() => saveNozzle({ du_no: '2', nozzle_no: 'B', tank_id: 't1', totaliser_start: 0 }, tanks), /exists/);
  const e = saveNozzle({ id: n.id, du_no: '2', nozzle_no: 'B', tank_id: 't2', totaliser_start: 75, wm_due: '2027-03-31' }, tanks);
  assert.equal(readNozzles().length, 1);
  assert.equal(e.totaliser_start, 75);
  removeNozzle(n.id);
  assert.equal(readNozzles().length, 0);
  assert.ok(getTable<{ table?: string; row_id?: string }>('recycle_bin').some((r) => r.table === 'fuel_nozzles' && r.row_id === n.id), 'in the recycle bin');
});
