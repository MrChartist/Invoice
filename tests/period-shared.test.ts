/** PENDING 36 (GAP P1-26): GST reports and Inventory share the report period (`period-context.ts`). */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { getPeriodContext, resetPeriodContextForTests, setPeriodRange } from '../src/lib/period-context.ts';
import { reportPeriodOfRange } from '../src/lib/gst-reports.ts';

beforeEach(() => {
  resetStorage();
  localStorage.removeItem('mrchartist_report_period');
  resetPeriodContextForTests();
});

test('a range picked on another screen keeps a rolling preset when it is one, else is custom', () => {
  const today = new Date(2026, 9, 28); // 28 Oct 2026
  assert.equal(setPeriodRange({ start: '2026-09-01', end: '2026-09-30' }, today).preset, 'last_month');
  assert.equal(setPeriodRange({ start: '2026-04-01', end: '2027-03-31' }, today).preset, 'this_fy');
  const c = setPeriodRange({ start: '2026-05-03', end: '2026-06-09' }, today);
  assert.deepEqual([c.preset, c.period.start, c.period.end], ['custom', '2026-05-03', '2026-06-09']);
  resetPeriodContextForTests();
  assert.deepEqual(getPeriodContext().period, { start: '2026-05-03', end: '2026-06-09' }, 'stored for the next screen');
});

test('GST reports read the shared period when it is a return month, quarter or FY', () => {
  assert.deepEqual(reportPeriodOfRange('2026-09-01', '2026-09-30'), { kind: 'month', fyStart: 2026, month: 9 });
  assert.deepEqual(reportPeriodOfRange('2026-01-01', '2026-03-31'), { kind: 'quarter', fyStart: 2025, quarter: 4 });
  assert.deepEqual(reportPeriodOfRange('2025-04-01', '2026-03-31'), { kind: 'fy', fyStart: 2025 });
  assert.equal(reportPeriodOfRange('2026-09-01', '2026-09-29'), null);
});
