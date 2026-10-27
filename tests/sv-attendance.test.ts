/** SV-C2 check-in and attendance: one row per day, gate, redeem on check-in, churn, attendance %, reminder line, member code. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { CheckinDay } from '../src/types/services-r10.ts';
import { loadCheckins, loadMemberships, saveMemberPlan, sessionsUsed } from '../src/lib/services/sv-members.ts';
import { sellPlan } from '../src/lib/services/sv-memberships.ts';
import { checkIn, findMembers, footfall, gateFor, notSeen, undoCheckin } from '../src/lib/services/sv-checkin.ts';
import { attendanceLine, attendanceOf, loadAttendance, saveAttendance } from '../src/lib/services/sv-attendance.ts';
import { saveClass } from '../src/lib/services/sv-classes.ts';
import { LABEL_LAYOUTS } from '../src/lib/label-sheet.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const member = (name: string, start = '2026-05-01', over = {}) => sellPlan({ plan_id: saveMemberPlan({ name: `Plan ${name}`, kind: 'membership', months: 1, price: 1000, ...over }).id, client_name: name, phone: '98765 43210', start });

test('one row per day; duplicate refused; undo; footfall and peak hours', () => {
  const a = member('Asha');
  const b = member('Bina');
  const ctx = { invoices: localDb.invoices.getAll() };
  checkIn(a, '2026-05-02', '07:10', ctx);
  checkIn(b, '2026-05-02', '07:40', ctx);
  checkIn(a, '2026-05-03', '18:05', ctx);
  assert.equal(loadCheckins().length, 2, 'one row per day');
  assert.throws(() => checkIn(a, '2026-05-02', '09:00', ctx), /already checked in/);
  const f = footfall(loadCheckins(), '2026-05-01', '2026-05-31');
  assert.deepEqual(f.byDay, [['2026-05-02', 2], ['2026-05-03', 1]]);
  assert.deepEqual(f.byHour[0], ['07', 2]);
  undoCheckin('2026-05-03', 0);
  assert.equal(loadCheckins().length, 1, 'an empty day row is removed');
});

test('gate by status: warn lets in, block refuses an expired member', () => {
  const a = member('Asha', '2026-03-01');
  assert.equal(gateFor('active', 'block'), 'ok');
  assert.equal(gateFor('expired', 'warn'), 'warn');
  assert.equal(gateFor('expired', 'off'), 'ok');
  assert.throws(() => checkIn(a, '2026-05-02', '07:00', { gate: 'block', invoices: localDb.invoices.getAll() }), /expired. Renew/);
  assert.equal(checkIn(a, '2026-05-02', '07:00', { gate: 'warn', invoices: localDb.invoices.getAll() }).name, 'Asha');
});

test('a package with redeem_on_checkin redeems a session; used up → no more redemption', () => {
  const p = sellPlan({ plan_id: saveMemberPlan({ name: 'PT 2', kind: 'package', sessions: 2, price: 2000, redeem_on_checkin: true }).id, client_name: 'Ravi', start: '2026-05-01' });
  checkIn(p, '2026-05-02', '07:00', { invoices: localDb.invoices.getAll() });
  checkIn(p, '2026-05-03', '07:00', { invoices: localDb.invoices.getAll() });
  assert.equal(sessionsUsed(p, [], loadCheckins()), 2);
  const e = checkIn(p, '2026-05-04', '07:00', { invoices: localDb.invoices.getAll() });
  assert.equal(e.redeem, undefined);
});

test('find by member code (number / last 4), phone and name; churn list', () => {
  const a = member('Asha Rao');
  member('Bina');
  const all = loadMemberships();
  assert.equal(findMembers(a.number, all)[0].id, a.id);
  assert.equal(findMembers('0001', all)[0].id, a.id);
  assert.equal(findMembers('43210', all).length, 2);
  assert.equal(findMembers('asha', all)[0].id, a.id);
  const day: CheckinDay = { id: 'd', date: '2026-05-20', entries: [{ name: 'Asha Rao', time: '07:00', membership_id: a.id }] };
  assert.deepEqual(notSeen(all, [day], '2026-05-30', 14).map((x) => x.m.client_name), ['Bina']);
  assert.deepEqual(notSeen(all, [day], '2026-05-30', 7).map((x) => x.m.client_name).sort(), ['Asha Rao', 'Bina']);
});

test('attendance % per month with holidays; late counts present; reminder line only with attendance', () => {
  const c = saveClass({ name: 'JEE B', kind: 'batch', days: [0, 2, 4], start: '17:00', minutes: 120, from: '2026-06-01', holidays: ['2026-06-03'] });
  saveAttendance(c.id, '2026-06-01', { s1: 'P', s2: 'A' });
  saveAttendance(c.id, '2026-06-05', { s1: 'L', s2: 'P' });
  saveAttendance(c.id, '2026-06-05', { s1: 'L', s2: 'P' });
  assert.equal(loadAttendance().length, 2, 'one row per class × day');
  assert.deepEqual(attendanceOf('s1', '2026-06', '2026-06-08', [c], loadAttendance()), { present: 2, held: 3 }, 'Mon 1, Fri 5, Mon 8 (Wed 3 holiday)');
  assert.equal(attendanceLine('s1', '2026-06-08'), ' Attendance this month: 2 / 3.');
  assert.equal(attendanceLine('nobody', '2026-06-08'), '');
  assert.equal(getTable('class_attendance').length, 2);
});

test('member card preset on the label sheet; fee reminder hook; pack-off reads nothing', () => {
  assert.ok(LABEL_LAYOUTS.some((l) => l.id === 'member-card' && l.width === 85.6 && l.height === 54));
  assert.match(readFileSync(new URL('../src/components/institutions/DuesPanel.tsx', import.meta.url), 'utf8'), /attendanceLine/);
  const time = readFileSync(new URL('../src/pages/Time.tsx', import.meta.url), 'utf8');
  assert.match(time, /lazy\(\(\) => import\('\.\.\/components\/services-r10\/MembersDesk'\)\)/, 'the members desk is a lazy chunk, mounted only on its tab');
});
