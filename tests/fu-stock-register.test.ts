/** R21-C3 daily stock register: the book formula (meter − test, receipts, totaliser wrap), cumulative variation, the MDG band and its 600 KL step, the monthly posting (idempotent, the stock summary agrees). */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { dueList, fyStartOf, mdgBand, meterSales, monthClose, registerRows } from '../src/lib/fuel/fu-register.ts';
import { postedFor, postVariation, stockBook } from '../src/lib/fuel/fu-stock-io.ts';
import { physicalStockDb } from '../src/lib/manufacturing.ts';
import { blankStockItem, stockDb } from '../src/lib/inventory.ts';
import { setTable } from '../src/lib/storage.ts';
import type { FuelShift, FuelTankLog, FuTank } from '../src/types/fuel-r21.ts';

const dip = (date: string, litres: number, time = '06:00'): FuelTankLog => ({ id: `d${date}${time}`, date, time, kind: 'dip', tank_id: 't1', litres });
const shift = (date: string, opening: number, closing: number, test_l = 5): FuelShift => ({ id: `s${date}`, date, shift_no: 1, opened_at: '', attendants: [], collections: [], status: 'closed', readings: [{ nozzle_id: 'A', opening, closing, test_l, test_returned: true }, { nozzle_id: 'X', opening: 0, closing: 999, test_l: 0, test_returned: true }] });
const A = new Set(['A']);

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('meter litres net of test; a wrapped totaliser; other tanks\' nozzles left out', () => {
  assert.deepEqual(meterSales([shift('2026-10-01', 1000, 1250)], A, '2026-10-01'), { sales: 245, test: 5 });
  assert.deepEqual(meterSales([shift('2026-10-01', 9_999_900, 150)], A, '2026-10-01'), { sales: 245, test: 5 }, 'wraps at 10⁷');
  assert.equal(fyStartOf('2027-02-10'), '2026-04-01');
});

test('book = opening dip + receipts − (meter − test); physical = the next morning\'s dip; month / year to date', () => {
  const logs = [dip('2026-10-01', 6000), { id: 'r', date: '2026-10-01', kind: 'receipt', tank_id: 't1', compartments: [{ invoice_l: 4000 }, { invoice_l: 4000 }] } as FuelTankLog, dip('2026-10-02', 13740), dip('2026-10-03', 13500)];
  const rows = registerRows('t1', A, logs, [shift('2026-10-01', 1000, 1250), shift('2026-10-02', 1250, 1500)], '2026-10-03');
  assert.equal(rows[0].day, '2026-10-01');
  assert.deepEqual([rows[0].opening, rows[0].receipts, rows[0].sales, rows[0].book, rows[0].physical, rows[0].variation], [6000, 8000, 245, 13755, 13740, -15]);
  assert.deepEqual([rows[1].book, rows[1].physical, rows[1].variation, rows[1].mtd, rows[1].ytd], [13495, 13500, 5, -10, -10]);
  assert.equal(rows[2].physical, null, 'no next dip yet');
  assert.equal(monthClose(rows, '2026-10')?.day, '2026-10-02');
});

test('the MDG band: MS 0.75 % of sales up to 600 KL a year, 0.60 % beyond; plus 4 % of stock; HSD 0.25 / 0.20; none for CNG', () => {
  const row = { day: '2026-09-30', physical: 10000, mtd: -500, mtdSales: 40000, ytdSales: 240000 }; // 240 KL in 183 days ≈ 479 KL a year
  assert.deepEqual(mdgBand('ms', row), { rate: 0.75, evap: 300, band: 400, outside: false });
  assert.deepEqual(mdgBand('ms', { ...row, ytdSales: 400000 }), { rate: 0.6, evap: 240, band: 400, outside: false }, '≈ 798 KL a year');
  assert.equal(mdgBand('ms', row, 700)?.rate, 0.6, 'a typed annual figure wins');
  assert.equal(mdgBand('hsd_branded', { ...row, mtd: -600 })?.outside, true, '0.25 % → 100 + 400 < 600');
  assert.equal(mdgBand('cng', row), null);
});

test('due dates: licences, active nozzles\' W&M stamping, tank calibration — soonest first, flagged within 30 days or past', () => {
  const nz = (id: string, wm_due: string | undefined, active = true) => ({ id, du_no: '1', nozzle_no: id, tank_id: 't1', item_id: 'ms', totaliser_start: 0, active, wm_due });
  const rows = dueList('2026-10-29', {
    licences: [{ kind: 'peso', ref: 'P/1', valid_to: '2027-03-31' }, { kind: 'fire', ref: 'F/9', valid_to: '2026-10-20' }],
    nozzles: [nz('A', '2026-11-15'), nz('B', undefined), nz('C', '2026-11-01', false)],
    tanks: [{ name: 'Tank 1', fu: { product_item_id: 'ms', capacity_l: 1, chart: [], calibration_due: '2026-12-31' } }, { name: 'Tank 2' }],
  });
  assert.deepEqual(rows.map((r) => [r.k, r.name, r.left, r.soon]), [['lic', 'F/9', -9, true], ['wm', '1-A', 17, true], ['cal', 'Tank 1', 63, false], ['lic', 'P/1', 153, false]]);
  assert.deepEqual([rows[0].kind, rows[0].i], ['fire', 1]);
});

test('posting the month: one Physical Stock voucher per tank per month (re-posting edits it); the stock summary then agrees with the register', () => {
  const item = blankStockItem({ id: 'ms', name: 'Petrol', unit: 'LTR', fu: { product: 'ms', unit: 'L' } });
  stockDb.saveItem(item);
  const tank = { id: 't1', name: 'Tank 1', fu: { product_item_id: 'ms', capacity_l: 15000, chart: [[0, 0], [2000, 15000]] as FuTank['chart'] } };
  setTable('godowns', [tank]);
  const v = postVariation(tank, '2026-10', '2026-10-02', 13740);
  assert.equal(stockBook(tank, '2026-10-02'), 13740);
  assert.match(v.narration ?? '', /Normal loss — evaporation \/ handling: Tank 1, 2026-10/);
  const again = postVariation(tank, '2026-10', '2026-10-02', 13700);
  assert.equal(again.id, v.id);
  assert.equal(again.number, v.number);
  assert.equal(physicalStockDb.all().length, 1, 'idempotent per tank per month');
  assert.equal(stockBook(tank, '2026-10-02'), 13700);
  assert.equal(postedFor('t1', '2026-10')?.id, v.id);
  assert.equal(postedFor('t1', '2026-11'), undefined);
});
