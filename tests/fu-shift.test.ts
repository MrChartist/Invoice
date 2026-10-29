/** R21-B1 shift entry: opening carried, meter rollover, negative sale refused, test litres never sold, mid-shift price split (FU9). */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { carriedOpening, meterDiff, priceReading, readingIssue, shiftSales, soldLitres } from '../src/lib/fuel/fu-shift.ts';
import { openShift, readShifts, removeShift, saveShift } from '../src/lib/fuel/fu-dayclose.ts';
import type { FuelNozzle, FuelPrice, FuReading } from '../src/types/fuel-r21.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const NZ: FuelNozzle[] = [
  { id: 'n1', du_no: '1', nozzle_no: 'A', tank_id: 't1', item_id: 'ms', totaliser_start: 1000, active: true },
  { id: 'n2', du_no: '1', nozzle_no: 'B', tank_id: 't2', item_id: 'hsd', totaliser_start: 500, active: true },
];
const P: FuelPrice[] = [
  { id: 'p0', item_id: 'ms', date: '2026-10-28', time: '06:00', rsp: 94 },
  { id: 'p1', item_id: 'ms', date: '2026-10-29', time: '06:00', rsp: 100 },
  { id: 'p2', item_id: 'ms', date: '2026-10-29', time: '10:00', rsp: 110 },
  { id: 'h1', item_id: 'hsd', date: '2026-10-29', time: '06:00', rsp: 90 },
];
const rd = (o: Partial<FuReading>): FuReading => ({ nozzle_id: 'n1', opening: 1000, test_l: 5, test_returned: true, ...o });

test('meter litres: closing − opening − test; rollover at 10⁷ (or the typed maximum); negative sale refused', () => {
  assert.equal(soldLitres(rd({ closing: 1250 })), 245, 'test litres go back to the tank, never sold');
  assert.equal(meterDiff(9_999_900, 100), 200, 'wraps at 10⁷');
  assert.equal(meterDiff(99_990, 10, 100_000), 20, 'typed maximum');
  assert.ok(Number.isNaN(meterDiff(5000, 4000)), 'a closing below the opening is not a wrap');
  assert.match(readingIssue(rd({ closing: 900 }), '1-A'), /below the opening/);
  assert.match(readingIssue(rd({ closing: 1003 }), '1-A'), /test litres/);
  assert.match(readingIssue(rd({}), '1-A'), /closing/);
  assert.equal(soldLitres(rd({ closing: 900 })), 0);
});

test('price: all at the opening price without a typed split; split by the reading at the change (test off the first part)', () => {
  const r = rd({ closing: 1250 });
  assert.deepEqual(priceReading(r, 'ms', P, '2026-10-29 06:00', '2026-10-29 14:00').map((s) => [s.rsp, s.litres]), [[100, 245]]);
  const s = priceReading({ ...r, splits: [1100] }, 'ms', P, '2026-10-29 06:00', '2026-10-29 14:00');
  assert.deepEqual(s.map((x) => [x.price_id, x.litres]), [['p1', 95], ['p2', 150]]);
  assert.throws(() => priceReading({ ...r, splits: [1300] }, 'ms', P, '2026-10-29 06:00', '2026-10-29 14:00'), /between the opening and the closing/);
  assert.throws(() => priceReading(r, 'cng', P, '2026-10-29 06:00', '2026-10-29 14:00'), /no price in force/);
  const sales = shiftSales({ id: 's', date: '2026-10-29', shift_no: 1, opened_at: '2026-10-29 06:00', closed_at: '2026-10-29 14:00', attendants: [], readings: [{ ...r, splits: [1100] }], collections: [], status: 'closed' }, NZ, P);
  assert.equal(sales[0].value, 95 * 100 + 150 * 110);
  assert.equal(sales[0].tank_id, 't1');
});

test('open / close: the opening is carried from the last closed shift; an edit needs a reason; one shift per day × number', () => {
  const s1 = openShift({ date: '2026-10-29', shift_no: 1, start: '06:00', test_l: 5, attendants: [{ name: 'Ravi', nozzle_ids: ['n1', 'n2'] }] }, NZ);
  assert.deepEqual(s1.readings.map((r) => r.opening), [1000, 500], 'first shift: the nozzle start');
  assert.throws(() => openShift({ date: '2026-10-29', shift_no: 1, start: '06:00', test_l: 5, attendants: [{ name: 'X', nozzle_ids: ['n1'] }] }, NZ), /already open/);
  assert.throws(() => openShift({ date: '2026-10-29', shift_no: 2, start: '14:00', test_l: 5, attendants: [{ name: 'A', nozzle_ids: ['n1'] }, { name: 'B', nozzle_ids: ['n1'] }] }, NZ), /one attendant/);
  assert.throws(() => saveShift(s1.id, { readings: s1.readings.map((r) => ({ ...r, closing: r.opening + 100 })) }, NZ, '2026-10-29 05:00'), /after the shift opened/);
  assert.throws(() => saveShift(s1.id, { readings: s1.readings }, NZ, '2026-10-29 14:00'), /closing/);
  saveShift(s1.id, { readings: s1.readings.map((r) => ({ ...r, closing: r.opening + 100 })) }, NZ, '2026-10-29 14:00');
  assert.equal(readShifts()[0].status, 'closed');
  assert.equal(carriedOpening(NZ[0], readShifts(), '2026-10-29', 2), 1100);
  const s2 = openShift({ date: '2026-10-29', shift_no: 2, start: '14:00', test_l: 0, attendants: [{ name: 'Sita', nozzle_ids: ['n1'] }] }, NZ);
  assert.equal(s2.readings[0].opening, 1100);
  assert.throws(() => saveShift(s2.id, { readings: [{ ...s2.readings[0], opening: 1090 }] }, NZ), /reason/);
  saveShift(s2.id, { readings: [{ ...s2.readings[0], opening: 1090, reason: 'meter repaired' }] }, NZ);
  assert.equal(readShifts().find((s) => s.id === s2.id)?.readings[0].opening, 1090);
  removeShift(s2.id);
  assert.throws(() => removeShift(s1.id), /open shift/);
  assert.equal(readShifts().length, 1);
});
