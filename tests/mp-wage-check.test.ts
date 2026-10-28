/**
 * R17-C3 minimum-wage and Labour Code checks: revision selection by date / post / zone, shortfall maths (OT left out,
 * duties across sites), each hint before / after 2025-11-21, the contract-labour threshold and its licence.
 */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { info, line, post } from './helpers/mp-world.ts';
import { labourHints, minPerDuty, otPay, revisionFor, shortfalls } from '../src/lib/manpower/mp-wage-check.ts';
import type { Site } from '../src/lib/manpower/mp-sites.ts';
import type { SiteMuster, WageRevision } from '../src/types/manpower-r17.ts';

const rev = (o: Partial<WageRevision>): WageRevision => ({ id: o.ref ?? 'r', from: '2026-04-01', ref: 'r', ...o });
const site: Site = { id: 's', name: 'Sunrise', mp: info({ posts: [post({ zone: 'A', skill: 'unskilled' }), post({ id: 's', name: 'Supervisor', rate: 1000 })] }) };
const mu = (month: string, rows: SiteMuster['rows'], id = 's'): SiteMuster => ({ id: `${id}${month}`, site_id: id, month, date: '', status: 'locked', updated_at: '', rows });

test('revision: latest from ≤ the month start, matching post / zone / skill, most specific first', () => {
  const revs = [rev({ ref: 'old', wage_day: 700, from: '2026-04-01' }), rev({ ref: 'oct', wage_day: 760, from: '2026-10-01' }), rev({ ref: 'oct-z', wage_day: 780, from: '2026-10-01', zone: 'a' }), rev({ ref: 'zb', wage_day: 999, from: '2026-10-01', zone: 'B' }), rev({ ref: 'nov', wage_day: 800, from: '2026-11-01' })];
  const g = site.mp.posts[0];
  assert.equal(revisionFor(revs, g, '2026-09')?.ref, 'old');
  assert.equal(revisionFor(revs, g, '2026-10')?.ref, 'oct-z');
  assert.equal(revisionFor(revs, site.mp.posts[1], '2026-10')?.ref, 'oct');
  assert.equal(revisionFor(revs, g, '2026-03'), undefined);
  assert.equal(minPerDuty(rev({ wage_month: 20800 })), 800, 'a monthly wage counts per 26 days');
});

test('shortfall: (gross − OT) ÷ all duties against the minimum; arrears on this site\'s duties', () => {
  const a = mu('2026-10', [{ employee_id: 'x', post_id: 'g', duties: 20 }, { employee_id: 'y', post_id: 'g', duties: 30 }]);
  const b = mu('2026-10', [{ employee_id: 'x', post_id: 'g', duties: 10 }], 'other');
  const lines = [line('x', 24000, { earnings: [{ pay_head_id: 'ph_ot', name: 'Overtime', amount: 1500, account_id: '' }] }), line('y', 27000)];
  assert.equal(otPay(lines[0]), 1500);
  const s = shortfalls(site, a, [a, b], lines, [rev({ wage_day: 800 })]);
  assert.deepEqual(s.map((r) => [r.employee_id, r.paid, r.min, r.arrears]), [['x', 750, 800, 1000]]);
  assert.deepEqual(shortfalls(site, a, [a, b], lines, []), [], 'no revision typed, no check');
});

test('hints from 21 Nov 2025: OT below 2×, PF wages under half, fixed-term past a year; contract-labour licence', () => {
  const lines = [line('x', 26000, { pf_wages: 9000, units: { ot_hours: 10 }, payable_days: 25, earnings: [{ pay_head_id: 'ph_ot', name: 'Overtime', amount: 1000, account_id: '' }] })];
  const staff = [{ id: 'f', code: 'F', name: 'Fixed', doj: '2025-09-01', dol: '2026-12-31' }, { id: 'p', code: 'P', name: 'Perm', doj: '2020-01-01' }];
  const base = { lines, staff, sites: [site], musters: [] as SiteMuster[], licences: [] };
  assert.deepEqual(labourHints({ ...base, month: '2025-10' }).map((h) => h.k), [], 'before the codes');
  assert.deepEqual(labourHints({ ...base, month: '2026-10' }).map((h) => [h.k, h.who, h.ca]), [['ot', 'N x', 'MP20'], ['wage', 'N x', 'MP16'], ['fte', 'Fixed', 'MP19']]);
  assert.deepEqual(labourHints({ ...base, month: '2026-08' }).map((h) => h.k), ['ot', 'wage'], 'fixed-term not yet a year');
  const big = mu('2026-10', Array.from({ length: 50 }, (_, i) => ({ employee_id: `e${i}`, post_id: 'g', duties: 30 })));
  const h = (month: string, m: SiteMuster, licences: { id: string; kind: 'osh' | 'psara'; no: string; valid_till: string }[] = []) => labourHints({ month, lines: [], staff: [], sites: [site], musters: [m], licences }).map((x) => x.k);
  assert.deepEqual(h('2026-10', big), ['clra']);
  assert.deepEqual(h('2026-10', { ...big, rows: big.rows.slice(0, 49) }), [], '49 workers: under the OSH threshold');
  assert.deepEqual(h('2025-10', { ...big, month: '2025-10', rows: big.rows.slice(0, 20) }), ['clra'], '20 before the OSH Code');
  assert.deepEqual(h('2026-10', big, [{ id: 'l', kind: 'osh', no: '1', valid_till: '2027-03-31' }]), [], 'licence on file');
  assert.deepEqual(h('2026-10', big, [{ id: 'l', kind: 'psara', no: '1', valid_till: '2027-03-31' }]), ['clra'], 'a PSARA licence is not one');
});
