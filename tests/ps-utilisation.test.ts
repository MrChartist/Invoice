/** PS-A4 utilisation and timekeepers: capacity, leave from payroll attendance, targets; dated rates; the rate card's timekeeper level. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import type { ServiceStaff } from '../src/types/services-r10.ts';
import type { TimeEntry } from '../src/types/time.ts';
import { daysIn, leaveDaysFrom, utilisation } from '../src/lib/prof/ps-utilisation.ts';
import { addTimekeeper, cleanStaffPs, defaultStaffFor, rateAt, saveStaffPs } from '../src/lib/prof/ps-staff.ts';
import { loadStaff } from '../src/lib/services/sv-staff.ts';
import { resolveRate } from '../src/lib/rate-cards.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const s = (id: string, cap: number, extra: Partial<ServiceStaff> = {}): ServiceStaff => ({ id, name: id, role: 'other', employment: 'employee', created_at: '', ps: { capacity_hours_week: cap, target_pct: 70 }, ...extra });
const te = (staff: string, date: string, minutes: number, billable = true, wt?: string): TimeEntry => ({ id: `${staff}${date}${minutes}`, client_name: 'A', description: '', date, minutes, hourly_rate: 1000, billable, staff_id: staff, ...(wt ? { work_type_id: wt } : {}) });

test('available = capacity × weeks − leave; billable ÷ available against the target', () => {
  assert.equal(daysIn('2026-06-01', '2026-06-28'), 28);
  const rows = utilisation([s('asha', 40), s('ravi', 40, { employee_id: 'e2' }), s('idle', 0)], [te('asha', '2026-06-02', 6000), te('ravi', '2026-06-03', 3000), te('ravi', '2026-06-04', 600, false, 'admin')], { from: '2026-06-01', to: '2026-06-28', leaveDays: leaveDaysFrom([{ employee_id: 'e2', month: '2026-06', lop: 5 }, { employee_id: 'e2', month: '2026-04', lop: 9 }], '2026-06-01', '2026-06-28') });
  assert.deepEqual(rows.map((r) => [r.name, r.available, r.billable, r.pct, r.under]), [['asha', 160, 100, 62.5, true], ['ravi', 120, 50, 41.67, true]]);
  assert.deepEqual(rows[1].nonBillable, { admin: 10 });
});

test('dated standard / cost rates; the timekeeper level sits after the task and before the project', () => {
  const k = addTimekeeper('Asha', { capacity_hours_week: 40, rates: [{ from: '2026-04-01', standard_rate: 3000, cost_rate: 1000 }] });
  saveStaffPs(k.id, { ...k.ps, rates: [...k.ps!.rates!, { from: '2026-07-01', standard_rate: 3500, cost_rate: 1100 }], user_hint: 'u1' });
  const row = loadStaff()[0];
  assert.equal(rateAt(row, '2026-06-30')?.standard_rate, 3000);
  assert.equal(rateAt(row, '2026-07-01')?.standard_rate, 3500);
  assert.equal(defaultStaffFor('u1', loadStaff())?.id, k.id);
  assert.equal(cleanStaffPs({ capacity_hours_week: -2, target_pct: 0 }), undefined);
  const ctx = { task: null, project: { hourly_rate: 2500 }, client: null, workType: null, defaultRate: 100 };
  assert.deepEqual(resolveRate(ctx), { rate: 2500, source: 'project' }, 'without the argument: unchanged');
  assert.deepEqual(resolveRate(ctx, { staffRate: 3000 }), { rate: 3000, source: 'staff' });
  assert.deepEqual(resolveRate({ ...ctx, task: { rate: 4000 } }, { staffRate: 3000 }), { rate: 4000, source: 'task' });
  assert.deepEqual(resolveRate(ctx, { currency: 'USD' }), { rate: 2500, source: 'project', currency: 'USD' });
});
