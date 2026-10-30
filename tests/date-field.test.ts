/** Pickers: typed date / month / time entry of DateField / TimeField (docs/theme/IOS-UI.md, Pickers). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clampDay, isWholeDate, localDate, parseDateInput, parseMonthInput, parseTimeInput } from '../src/lib/date-input.ts';

const today = new Date(2026, 9, 30); // 30 Oct 2026, local
const p = (s: string, o: { min?: string; max?: string } = {}) => parseDateInput(s, { today, ...o });

test('Indian day-first formats', () => {
  assert.equal(p('30/10/2026'), '2026-10-30');
  assert.equal(p('30-10-26'), '2026-10-30');
  assert.equal(p('30.10.2026'), '2026-10-30');
  assert.equal(p('3/4/2026'), '2026-04-03'); // 3 April, never 4 March
  assert.equal(p('30 oct'), '2026-10-30');
  assert.equal(p('30 Oct 2026'), '2026-10-30');
  assert.equal(p('1st April 2027'), '2027-04-01');
  assert.equal(p('Oct 30, 2026'), '2026-10-30');
  assert.equal(p('301026'), '2026-10-30');
  assert.equal(p('30/10'), '2026-10-30');
  assert.equal(p('15'), '2026-10-15');
});

test('ISO and relative entries', () => {
  assert.equal(p('2026-10-30'), '2026-10-30');
  assert.equal(p('2026/4/1'), '2026-04-01');
  assert.equal(p('today'), '2026-10-30');
  assert.equal(p('yesterday'), '2026-10-29');
  assert.equal(p('tomorrow'), '2026-10-31');
  assert.equal(p('+7'), '2026-11-06');
  assert.equal(p('-30'), '2026-09-30');
  assert.equal(p('+2w'), '2026-11-13');
  assert.equal(p('+1m'), '2026-11-30');
  assert.equal(parseDateInput('+1m', { today: new Date(2027, 0, 31) }), '2027-02-28'); // month end clamps
});

test('FY edges and leap years', () => {
  assert.equal(p('31/3/2026'), '2026-03-31');
  assert.equal(p('1/4/2026'), '2026-04-01');
  assert.equal(p('29/2/2028'), '2028-02-29');
  assert.equal(p('29/2/2027'), null);
  assert.equal(p('31/4/2026'), null);
  assert.equal(p('0/4/2026'), null);
  assert.equal(p('12/13/2026'), null);
  assert.equal(p('banana'), null);
  assert.equal(p(''), null);
});

test('local days, never UTC parsing (AGENTS.md rule 8)', () => {
  const d = localDate('2026-04-01')!;
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 3);
  assert.equal(d.getDate(), 1);
  assert.equal(localDate('2026-02-30'), null);
  const src = readFileSync(join(import.meta.dirname, '../src/lib/date-input.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /new Date\(\s*(str|s|text|iso|value)\s*\)/);
});

test('min / max clamp', () => {
  assert.equal(p('1/1/2026', { min: '2026-04-01' }), '2026-04-01');
  assert.equal(p('1/1/2030', { max: '2027-03-31' }), '2027-03-31');
  assert.equal(clampDay('2026-05-01', '2026-04-01', '2027-03-31'), '2026-05-01');
});

test('whole dates commit while typing; short forms wait for blur', () => {
  assert.ok(isWholeDate('2026-10-30'));
  assert.ok(isWholeDate('30/10/2026'));
  assert.ok(!isWholeDate('30/10/20'));
  assert.ok(!isWholeDate('30 oct'));
  assert.ok(!isWholeDate('+7'));
});

test('months and times', () => {
  assert.equal(parseMonthInput('10/2026', { today }), '2026-10');
  assert.equal(parseMonthInput('oct 2026', { today }), '2026-10');
  assert.equal(parseMonthInput('2026-04', { today }), '2026-04');
  assert.equal(parseMonthInput('mar', { today }), '2026-03');
  assert.equal(parseMonthInput('13/2026', { today }), null);
  assert.equal(parseTimeInput('9:30'), '09:30');
  assert.equal(parseTimeInput('930'), '09:30');
  assert.equal(parseTimeInput('9.30 pm'), '21:30');
  assert.equal(parseTimeInput('12 am'), '00:00');
  assert.equal(parseTimeInput('12pm'), '12:00');
  assert.equal(parseTimeInput('21:30'), '21:30');
  assert.equal(parseTimeInput('25:00'), null);
  assert.equal(parseTimeInput('13 pm'), null);
});

test('the week starts on Monday (Indian business default)', () => {
  const src = readFileSync(join(import.meta.dirname, '../src/components/ui/pickers/PickerPopup.tsx'), 'utf8');
  assert.match(src, /export const WEEK_START = 1;/);
});
