/**
 * R17-C1 client compliance pack: shares of the finalised run apportioned by duties across two sites (totals equal the
 * run's), proved needs the TRRN (and the challan when ESI is due), UAN masked, no bank fields, the client's hold, the
 * writer (one row per site × month, period lock) and the run reader (final runs only).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { line } from './helpers/mp-world.ts';
import { SHARE_KEYS, employerCost, holdOf, proofError, siteShares, sumShares, uan4, type RunLine } from '../src/lib/manpower/mp-compliance.ts';
import { loadCompliance, saveCompliance } from '../src/lib/manpower/mp-comp-save.ts';
import { readRunForMonth } from '../src/lib/manpower/mp-payroll-io.ts';
import { setTable } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { SiteMuster } from '../src/types/manpower-r17.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const mu = (site: string, rows: SiteMuster['rows']): SiteMuster => ({ id: site, site_id: site, month: '2026-10', date: '2026-10-31', rows, status: 'locked', updated_at: '' });

test('shares by duties across two sites; the two sites add up to the run', () => {
  const a = mu('a', [{ employee_id: 'x', post_id: 'g', duties: 20 }, { employee_id: 'y', post_id: 'g', duties: 31 }]);
  const b = mu('b', [{ employee_id: 'x', post_id: 'g', duties: 10, relief: true }]);
  const lines = [line('x', 30000, { esi_ee: 225, esi_er: 975 }), line('y', 18000), line('z', 9999)];
  const sa = siteShares(a, [a, b], lines);
  const sb = siteShares(b, [a, b], lines);
  assert.deepEqual(sa.map((s) => [s.code, s.gross, s.pf_ee, s.esi_er]), [['X', 20000, 1200, 650], ['Y', 18000, 1800, 0]]);
  assert.deepEqual(sb.map((s) => [s.code, s.gross, s.relief, s.esi_ee]), [['X', 10000, true, 75]]);
  const both = sumShares([...sa, ...sb]);
  const run = sumShares([lines[0], lines[1]]);
  for (const k of SHARE_KEYS) assert.equal(both[k], run[k], k);
  assert.equal(employerCost(sumShares(sa)), 3900, 'Y in full, two thirds of X, and X\'s ESI share');
});

test('the annexure data: UAN last four only, never bank fields', () => {
  const m = mu('a', [{ employee_id: 'x', post_id: 'g', duties: 31 }]);
  const s = siteShares(m, [m], [{ ...line('x', 1000), bank_account: '999' } as RunLine]);
  assert.equal(uan4('100200300456'), '••••0456');
  assert.equal(s[0].uan, '••••0456');
  assert.ok(!JSON.stringify(s).includes('999') && !('bank_account' in s[0]));
  assert.equal(uan4(undefined), '');
});

test('proved needs the TRRN, and the ESI challan when ESI is due; the hold is shown, never posted', () => {
  const t = sumShares([line('x', 1000, { esi_ee: 8, esi_er: 33 })]);
  assert.equal(proofError({ status: 'proved', pf: {}, esi: {} }, t), 'pf');
  assert.equal(proofError({ status: 'proved', pf: { trrn: 'T1' }, esi: {} }, t), 'esi');
  assert.equal(proofError({ status: 'proved', pf: { trrn: 'T1' }, esi: {} }, sumShares([line('x', 1000)])), '', 'no ESI due');
  assert.equal(proofError({ status: 'pending', pf: {}, esi: {} }, t), '');
  assert.equal(holdOf({ pct: 10 }, 128600), 12860);
  assert.equal(holdOf({ amount: 5000, pct: 10 }, 128600), 5000);
});

test('writer: one row per site × month, refused when proved without refs; reader: final runs only', () => {
  const t = sumShares([line('x', 1000, { esi_ee: 8, esi_er: 33 })]);
  assert.throws(() => saveCompliance('a', '2026-10', { status: 'proved', pf: { trrn: 'T1' } }, t), /ESI challan/);
  const r = saveCompliance('a', '2026-10', { pf: { trrn: 'T1' }, hold: { pct: 10 } }, t);
  assert.deepEqual([r.status, r.date, r.pf.trrn], ['pending', '2026-10-31', 'T1']);
  const p = saveCompliance('a', '2026-10', { status: 'proved', esi: { challan: 'C9' } }, t);
  assert.equal(p.id, r.id);
  assert.deepEqual(loadCompliance('2026-10').map((c) => [c.status, c.pf.trrn, c.esi.challan, c.hold?.pct]), [['proved', 'T1', 'C9', 10]]);
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-10-31' } as never);
  assert.throws(() => saveCompliance('a', '2026-10', { status: 'pending' }, t));
  setTable('payroll_runs', [{ id: 'd', month: '2026-10', status: 'draft', lines: [line('x', 1)] }]);
  assert.equal(readRunForMonth('2026-10'), null, 'a draft run is not a source');
  setTable('payroll_runs', [{ id: 'f', month: '2026-10', status: 'final', number: 'PRL/1', lines: [line('x', 1)] }]);
  assert.equal(readRunForMonth('2026-10')?.lines.length, 1);
});

test('the compliance view never reads bank fields; the annexure goes through escHtml', () => {
  const v = readFileSync(new URL('../src/components/manpower/ComplianceView.tsx', import.meta.url), 'utf8');
  assert.ok(!/bank_/.test(v));
  assert.match(v, /escHtml as esc/);
});
