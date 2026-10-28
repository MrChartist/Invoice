/** R16-A3: shared day maths — FY edges, leap years, month-end clamps, local days with no DST drift. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, daysBetween, fyBounds, fyStartYear, monthEnd } from '../src/lib/day-math.ts';

test('financial year edges: 31 Mar is the old year, 1 Apr the new one (Indian FY, local days)', () => {
  assert.equal(fyStartYear('2026-03-31'), 2025);
  assert.equal(fyStartYear('2026-04-01'), 2026);
  assert.equal(fyStartYear('2026-01-15'), 2025);
  assert.equal(fyStartYear('2026-12-31'), 2026);
  assert.deepEqual(fyBounds('2026-03-31'), { start: '2025-04-01', end: '2026-03-31' });
  assert.deepEqual(fyBounds('2026-04-01'), { start: '2026-04-01', end: '2027-03-31' });
  assert.equal(fyStartYear(new Date(2026, 3, 1)), 2026, 'a Date is read on its local calendar');
});

test('daysBetween: calendar days, signed, across months, years and leap days', () => {
  assert.equal(daysBetween('2026-03-31', '2026-04-01'), 1);
  assert.equal(daysBetween('2026-04-01', '2026-03-31'), -1);
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2, 'leap year');
  assert.equal(daysBetween('2025-02-28', '2025-03-01'), 1);
  assert.equal(daysBetween('2025-04-01', '2026-04-01'), 365);
  assert.equal(daysBetween('2023-04-01', '2024-04-01'), 366);
  assert.equal(daysBetween('2026-10-28', '2026-10-28'), 0);
});

test('daysBetween does not drift by a DST hour (whatever the machine zone)', () => {
  // Spring-forward / fall-back weeks in the US and EU: still whole days.
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
});

test('addDays: month, year and leap-day roll-over; negative steps', () => {
  assert.equal(addDays('2026-03-31', 1), '2026-04-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
  assert.equal(addDays('2026-04-01', -1), '2026-03-31');
  assert.equal(addDays('2026-03-07', 2), '2026-03-09', 'no DST drift');
});

test('monthEnd and addMonths (clamped by default)', () => {
  assert.equal(monthEnd('2024-02-10'), '2024-02-29');
  assert.equal(monthEnd('2025-02-10'), '2025-02-28');
  assert.equal(monthEnd('2026-04-30'), '2026-04-30');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-03-31', 1), '2026-04-30');
  assert.equal(addMonths('2026-01-31', 1, { clamp: false }), '2026-03-03');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2026-04-01', 12), '2027-04-01');
});
