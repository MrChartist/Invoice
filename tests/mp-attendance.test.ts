/**
 * R17-B2 muster → payroll attendance: sums across sites, the LOP floor, extra duties, untouched employees, other units
 * kept, the finalised-run refusal, deploy / release; the bridge is the only Round 17 importer of the payroll store.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { OCT_ROWS, world } from './helpers/mp-world.ts';
import { attendancePush, unlockedSites } from '../src/lib/manpower/mp-attendance.ts';
import { saveMuster, setMusterLock } from '../src/lib/manpower/mp-muster-save.ts';
import { loadMusters, monthEnd } from '../src/lib/manpower/mp-muster.ts';
import { deployEmployee, previewPush, pushAttendance } from '../src/lib/manpower/mp-payroll-io.ts';
import { loadAttendance, loadEmployees } from '../src/lib/payroll/store.ts';
import { saveManpowerSettings } from '../src/lib/manpower/mp-settings.ts';
import { loadSites } from '../src/lib/manpower/mp-sites.ts';
import { setTable } from '../src/lib/storage.ts';
import type { SiteMuster } from '../src/types/manpower-r17.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('per person across all locked musters: LOP floor, OT, extra duties; drafts ignored; other units kept', () => {
  const m = (site: string, rows: SiteMuster['rows'], status: SiteMuster['status'] = 'locked'): SiteMuster => ({ id: site, site_id: site, month: '2026-10', date: '2026-10-31', rows, status, updated_at: '' });
  const out = attendancePush('2026-10', [m('a', [{ employee_id: 'x', post_id: 'g', duties: 20, ot_hours: 4 }]), m('b', [{ employee_id: 'x', post_id: 'g', duties: 15, ot_hours: 2 }, { employee_id: 'y', post_id: 'g', duties: 28 }]), m('c', [{ employee_id: 'z', post_id: 'g', duties: 31 }], 'draft')], [{ employee_id: 'y', month: '2026-10', lop: 9, units: { pcs: 5, ot_hours: 8 } }], 'xd');
  assert.deepEqual(out.map((r) => [r.employee_id, r.duties, r.lop, r.units]), [['x', 35, 0, { ot_hours: 6, xd: 4 }], ['y', 28, 3, { pcs: 5 }]]);
  assert.equal(out[1].cur?.lop, 9);
  assert.deepEqual(attendancePush('2026-10', [m('a', [{ employee_id: 'x', post_id: 'g', duties: 35 }])], []).map((r) => r.units), [{}], 'no extra-duty type: no unit');
});

test('push writes only the people in the musters; refused while nothing is locked and once the run is final', () => {
  const { sunrise, green } = world();
  setTable('attendance', [{ id: 'a0', employee_id: 'e9', month: '2026-10', lop: 2 }, { id: 'a1', employee_id: 'e1', month: '2026-09', lop: 1 }]);
  const mu = saveMuster(sunrise, '2026-10', OCT_ROWS);
  assert.throws(() => pushAttendance('2026-10'), /No locked muster/);
  assert.deepEqual(unlockedSites(loadSites(), '2026-10', loadMusters()).map((s) => s.mp.code), ['S-001', 'S-002']);
  setMusterLock(mu.id, true);
  assert.deepEqual(unlockedSites(loadSites(), '2026-10', loadMusters()).map((s) => s.id), [green.id]);
  saveManpowerSettings({ extra_duty_type_id: 'extra' });
  assert.equal(previewPush('2026-10').length, 6);
  assert.equal(pushAttendance('2026-10'), 6);
  const a = loadAttendance();
  const of = (e: string, mo = '2026-10') => a.find((x) => x.employee_id === e && x.month === mo);
  assert.deepEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((e) => of(e)?.lop), [1, 1, 0, 3, 0, 28]);
  assert.deepEqual(of('e6')?.units, { ot_hours: 12 });
  assert.equal(of('e9')?.lop, 2, 'someone outside the musters is untouched');
  assert.equal(of('e1', '2026-09')?.lop, 1, 'another month is untouched');
  setTable('payroll_runs', [{ id: 'r', month: '2026-10', date: monthEnd('2026-10'), status: 'final', lines: [], created_at: '' }]);
  assert.throws(() => pushAttendance('2026-10'), /finalized/);
});

test('deploy / release an employee at a site (cost centre + post)', () => {
  const { green } = world();
  const e6 = loadEmployees().find((e) => e.id === 'e6')!;
  const d = deployEmployee(e6, green.id, 'h');
  assert.deepEqual([d.cost_centre_id, d.mp?.post_id], [green.id, 'h']);
  const r = deployEmployee(d, '');
  assert.deepEqual([r.cost_centre_id, r.mp], [undefined, undefined]);
});

test('the payroll bridge is the only Round 17 module importing the payroll store', () => {
  const dirs = ['src/lib/manpower/', 'src/components/manpower/'];
  for (const d of dirs) for (const f of readdirSync(new URL(`../${d}`, import.meta.url))) {
    const s = readFileSync(new URL(`../${d}${f}`, import.meta.url), 'utf8');
    if (/from '[^']*payroll\/store'/.test(s)) assert.equal(f, 'mp-payroll-io.ts', f);
  }
});
