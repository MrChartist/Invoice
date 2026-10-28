/** R17-B1 duty register: one muster per site × month, warnings, copy last month, lock, import mapping, volume. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { OCT_ROWS, world } from './helpers/mp-world.ts';
import { copyRows, daysIn, loadMusters, loadStaff, monthEnd, musterWarnings, postTotals, prevMonth } from '../src/lib/manpower/mp-muster.ts';
import { logMusterImport, saveMuster, setMusterLock } from '../src/lib/manpower/mp-muster-save.ts';
import { mapMusterTable } from '../src/lib/manpower/mp-muster-import.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import type { SiteMuster } from '../src/types/manpower-r17.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('month helpers by local day', () => {
  assert.deepEqual([daysIn('2026-10'), daysIn('2028-02'), monthEnd('2026-09'), prevMonth('2026-01'), prevMonth('2026-10')], [31, 29, '2026-09-30', '2025-12', '2026-09']);
});

test('one muster per site × month, dated by the month end; locked = read-only until unlocked; audited table', () => {
  const { sunrise } = world();
  const m = saveMuster(sunrise, '2026-10', OCT_ROWS);
  assert.deepEqual([m.date, m.status, m.rows.length, m.rows[4].relief, m.rows[4].ot_hours], ['2026-10-31', 'draft', 6, true, 12]);
  assert.throws(() => saveMuster(sunrise, '2026-10', OCT_ROWS), /already has a muster/);
  assert.throws(() => saveMuster(sunrise, '2026-10', [{ employee_id: 'e1', post_id: 'g', duties: 30.25 }], m.id), /0\.5/);
  assert.throws(() => saveMuster(sunrise, '2026-10', [{ employee_id: 'e1', post_id: 'x', duties: 3 }], m.id), /post of this site/);
  saveMuster(sunrise, '2026-10', OCT_ROWS.slice(0, 2), m.id);
  assert.equal(loadMusters('2026-10')[0].rows.length, 2, 'the draft is edited in place');
  assert.equal(setMusterLock(m.id, true).status, 'locked');
  assert.ok(loadMusters()[0].locked_at);
  assert.throws(() => saveMuster(sunrise, '2026-10', OCT_ROWS, m.id), /locked/);
  assert.equal(setMusterLock(m.id, false).status, 'draft');
  assert.equal(loadMusters()[0].locked_at, undefined);
  assert.equal(WATCHED_TABLES.site_musters?.label, 'Site muster');
});

test('totals per post against heads × days and the warnings (never blocking)', () => {
  const { sunrise, green } = world();
  const t = postTotals(sunrise, OCT_ROWS, 31);
  assert.deepEqual(t.map((x) => [x.post.id, x.duties, x.full, x.ot]), [['g', 122, 124, 12], ['s', 31, 31, 0]]);
  saveMuster(green, '2026-10', [{ employee_id: 'e1', post_id: 'g', duties: 5 }]);
  setTable('employees', getTable<{ id: string }>('employees').map((e) => (e.id === 'e4' ? { ...e, dol: '2026-09-15' } : e)));
  const w = musterWarnings({ site_id: sunrise.id, month: '2026-10', rows: [...OCT_ROWS, { employee_id: 'e2', post_id: 's', duties: 40 }] }, loadMusters('2026-10'), loadStaff());
  const txt = w.map((x) => x.text).join(' | ');
  assert.match(txt, /Ramesh: 35 duties across all sites/);
  assert.match(txt, /Mahesh: 70 duties across all sites/);
  assert.match(txt, /Naresh left on 2026-09-15/);
  assert.ok(!/Dinesh/.test(txt), '31 is not over 31');
  assert.equal(musterWarnings({ site_id: sunrise.id, month: '2026-10', rows: [{ employee_id: 'e1', post_id: 'g', duties: 63 }] }, [], loadStaff())[0].text, 'Ramesh: 63 duties is more than 62 (two a day).');
});

test('copy last month: the previous muster, else deployed people at full duties on their post', () => {
  const { sunrise } = world();
  const fresh = copyRows(sunrise, '2026-10', [], loadStaff());
  assert.deepEqual(fresh.map((r) => [r.employee_id, r.post_id, r.duties]), [['e1', 'g', 31], ['e2', 'g', 31], ['e3', 'g', 31], ['e4', 'g', 31], ['e5', 's', 31]]);
  saveMuster(sunrise, '2026-09', OCT_ROWS);
  assert.deepEqual(copyRows(sunrise, '2026-10', loadMusters(), loadStaff()), OCT_ROWS.map((r) => ({ ...r })));
  setTable('employees', getTable<{ id: string }>('employees').map((e) => (e.id === 'e1' ? { ...e, dol: '2026-09-30' } : e)));
  assert.equal(copyRows(sunrise, '2026-11', [], loadStaff()).length, 4, 'a leaver is not deployed');
});

test('import: fixed template and day-wise sheet; unknown codes listed; the run logged (kind muster)', () => {
  const { sunrise } = world();
  const a = mapMusterTable({ headers: ['Employee Code', 'Duties', 'OT Hours', 'Post'], rows: [['G01', '30', '4', 'Guard (12 h)'], ['S01', '31', '', 'supervisor'], ['X99', '3', '', ''], ['R01', '3', '', '']] }, sunrise, loadStaff());
  assert.deepEqual(a.unknown, ['X99']);
  assert.deepEqual(a.rows, [{ employee_id: 'e1', post_id: 'g', duties: 30, ot_hours: 4 }, { employee_id: 'e5', post_id: 's', duties: 31 }, { employee_id: 'e6', post_id: 'g', duties: 3, relief: true }]);
  const b = mapMusterTable({ headers: ['code', '1', '2', '3', '4', 'OT1', 'OT2'], rows: [['G02', 'P', 'A', 'HD', 'DD', '2', '1.5']] }, sunrise, loadStaff());
  assert.deepEqual(b.rows, [{ employee_id: 'e2', post_id: 'g', duties: 3.5, ot_hours: 3.5 }]);
  assert.throws(() => mapMusterTable({ headers: ['name'], rows: [] }, sunrise, loadStaff()), /employee_code/);
  logMusterImport('oct.csv', 3, 1);
  assert.deepEqual(getTable<{ kind: string; created: number; skipped: number }>('import_runs').map((r) => [r.kind, r.created, r.skipped]), [['muster', 3, 1]]);
});

test('volume: a year of 60 sites — a month reads only its own musters', () => {
  const rows: SiteMuster[] = [];
  for (let m = 1; m <= 12; m++) for (let s = 0; s < 60; s++) {
    const month = `2026-${String(m).padStart(2, '0')}`;
    rows.push({ id: `${month}-${s}`, site_id: `site-${s}`, month, date: monthEnd(month), status: 'locked', updated_at: '', rows: Array.from({ length: 10 + (s * 5) % 291 }, (_, i) => ({ employee_id: `e${s}-${i}`, post_id: 'g', duties: 26 })) });
  }
  setTable('site_musters', rows);
  const oct = loadMusters('2026-10');
  assert.equal(oct.length, 60);
  assert.ok(oct.every((m) => m.month === '2026-10'));
  assert.ok(Math.max(...rows.map((r) => r.rows.length)) <= 300);
});
