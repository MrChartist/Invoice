/**
 * R18-A3 tariff engine: each basis, cycle multiplication, non-occupancy only for let units, State defaults by date (MH
 * cap 21 → 12, minimum funds, KA rows inactive until confirmed, TN undivided %, other States none), the PRD §7 seed
 * numbers (A-101 ₹5,510 + ₹1,200; A-102 ₹5,810 + ₹1,200; A-901 ₹9,010 + ₹3,000), periods and SACs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStateDefaults, chargeTotals, newHead, pendingStateRule, periodOf, periodRange, sacFor, stateRule, tariffHints, unitCharges } from '../src/lib/society/hs-tariff.ts';
import type { HsHead, SocietyUnit } from '../src/types/society-r18.ts';

const H = (id: string, kind: HsHead['kind'], basis: HsHead['basis'], rate: number, o: Partial<HsHead> = {}): HsHead => ({ id, name: id, kind, basis, rate, active: true, ...o });
const SEED: HsHead[] = [H('svc', 'service', 'per_unit', 3000), H('snk', 'sinking', 'cost_pct_pa', 0.25), H('rep', 'repair', 'cost_pct_pa', 0.75), H('ptx', 'statutory', 'typed', 0), H('prk', 'parking', 'per_slot', 500), H('noc', 'non_occupancy', 'pct_of_head', 10), H('edu', 'education', 'fixed_member', 10)];
const U = (o: Partial<SocietyUnit>): SocietyUnit => ({ id: 'u', code: 'A-101', use: 'residential', occupancy: 'owner', parking: [], status: 'active', updated_at: '', ...o });
const A101 = U({ carpet_area: 600, construction_cost: 2400000, parking: [{ slot: 'P1', kind: 'covered' }], typed: { ptx: 1200 } });
const A102 = { ...A101, code: 'A-102', occupancy: 'tenant' as const };
const A901 = U({ code: 'A-901', carpet_area: 1500, construction_cost: 6000000, parking: [{ slot: 'P1', kind: 'covered' }, { slot: 'P2', kind: 'covered' }], typed: { ptx: 3000 } });

test('PRD §7 seed: A-101 5,510 + 1,200; A-102 + non-occupancy 300 = 5,810; A-901 9,010 + 3,000', () => {
  assert.deepEqual(chargeTotals(unitCharges(A101, SEED, '2026-10')), { member: 5510, statutory: 1200, outsider: 0, total: 6710 });
  assert.deepEqual(unitCharges(A101, SEED, '2026-10').map((r) => [r.head_id, r.amount]), [['svc', 3000], ['snk', 500], ['rep', 1500], ['ptx', 1200], ['prk', 500], ['edu', 10]], 'no non-occupancy for an owner-occupied flat');
  assert.deepEqual(chargeTotals(unitCharges(A102, SEED, '2026-10')), { member: 5810, statutory: 1200, outsider: 0, total: 7010 });
  assert.deepEqual(chargeTotals(unitCharges(A901, SEED, '2026-10')), { member: 9010, statutory: 3000, outsider: 0, total: 12010 });
  assert.equal(unitCharges(A101, SEED, '2026-10').find((r) => r.head_id === 'snk')?.basis, '0.25 % a year of cost');
});

test('each basis; cycle × months; paise rounding per head; inactive / out-of-date heads and zero amounts left out', () => {
  const u = U({ carpet_area: 600, super_area: 750, undivided_pct: 1.25, parking: [{ slot: 'P1', kind: 'two_wheeler' }, { slot: 'P2', kind: 'covered' }] });
  const rows = (h: HsHead, p = '2026-10', o = {}) => unitCharges(u, [h], p, o).map((r) => r.amount);
  assert.deepEqual(rows(H('a', 'service', 'area_carpet', 2.5)), [1500]);
  assert.deepEqual(rows(H('a', 'service', 'area_super', 2)), [1500]);
  assert.deepEqual(rows(H('a', 'service', 'undivided_pct', 100000)), [1250]);
  assert.deepEqual(rows(H('a', 'parking', 'per_slot', 500, { slot_rates: { two_wheeler: 100 } })), [600]);
  assert.deepEqual(rows(H('a', 'education', 'fixed_member', 10), '2026-10', { member: false }), [], 'a member\'s second unit');
  assert.deepEqual(rows(H('a', 'service', 'per_unit', 1000.005)), [1000.01]);
  assert.deepEqual(rows(H('a', 'service', 'per_unit', 3000), '2026-Q3'), [9000], 'quarterly × 3');
  assert.deepEqual(rows(H('a', 'service', 'per_unit', 3000), '2026-H2'), [18000], 'half-yearly × 6');
  assert.match(unitCharges(u, [H('a', 'service', 'per_unit', 3000)], '2026-Q3')[0].basis, /× 3 months/);
  assert.deepEqual(rows(H('a', 'service', 'per_unit', 3000, { active: false })), []);
  assert.deepEqual(rows(H('a', 'service', 'per_unit', 3000, { from: '2026-11-01' })), []);
  assert.deepEqual(rows(H('a', 'service', 'per_unit', 3000, { to: '2026-09-30' })), []);
  assert.deepEqual(rows(H('a', 'statutory', 'typed', 0)), [], 'nothing typed');
  assert.deepEqual(unitCharges(u, SEED, '2026-13'), [], 'malformed period');
});

test('periods: FY quarters and halves; the period of a day', () => {
  assert.deepEqual(periodRange('2026-02'), { from: '2026-02-01', to: '2026-02-28', months: 1 });
  assert.deepEqual(periodRange('2026-Q1'), { from: '2026-04-01', to: '2026-06-30', months: 3 });
  assert.deepEqual(periodRange('2026-Q4'), { from: '2027-01-01', to: '2027-03-31', months: 3 });
  assert.deepEqual(periodRange('2026-H2'), { from: '2026-10-01', to: '2027-03-31', months: 6 });
  assert.equal(periodRange('2026-Q5'), null);
  assert.deepEqual(['2026-11-05', '2027-01-10', '2026-04-01'].map((d) => periodOf(d, 'quarterly')), ['2026-Q3', '2026-Q4', '2026-Q1']);
  assert.deepEqual(['2026-09-30', '2026-10-01', '2027-03-31'].map((d) => periodOf(d, 'half_yearly')), ['2026-H1', '2026-H2', '2026-H2']);
  assert.equal(periodOf('2026-11-05'), '2026-11');
});

test('State defaults by date: MH tariff with fund minimums, NOC 10 %, education 10; typed rates kept; zero rates filled', () => {
  const mh = stateRule('27', '2026-11-01');
  let n = 0;
  const heads = applyStateDefaults([], mh, '2026-11-01', () => `h${n++}`);
  assert.equal(heads.length, 7);
  assert.deepEqual(heads.map((h) => [h.kind, h.basis, h.rate]), [['service', 'per_unit', 0], ['sinking', 'cost_pct_pa', 0.25], ['repair', 'cost_pct_pa', 0.75], ['statutory', 'typed', 0], ['parking', 'per_slot', 0], ['non_occupancy', 'pct_of_head', 10], ['education', 'fixed_member', 10]]);
  assert.deepEqual([heads[0].sac, heads[3].sac], ['999598', undefined], 'member heads 999598; statutory dues no SAC');
  const typed = applyStateDefaults([{ ...heads[1], rate: 0.5, basis: 'per_unit' }, { ...heads[2], rate: 0 }], mh, '2026-11-01', () => 'x');
  assert.deepEqual(typed.map((h) => [h.basis, h.rate]), [['per_unit', 0.5], ['cost_pct_pa', 0.75]], 'a typed basis / rate is kept; a zero rate filled');
  const old = stateRule('27', '2026-06-21');
  assert.deepEqual([old?.interest_cap_pct, old?.fund_min, mh?.interest_cap_pct], [21, null, 12]);
  assert.equal(newHead('outsider', 'Tower rent', mh, '2026-11-01', 'o').sac, '997212');
  assert.equal(sacFor('statutory', '2026-11-01'), undefined);
});

test('hints never block: sinking below the MH minimum, NOC above the cap; KA proposed until confirmed; TN undivided %; others none', () => {
  const mh = stateRule('27', '2026-11-01');
  assert.deepEqual(tariffHints(SEED, mh), []);
  const low = tariffHints(SEED.map((h) => (h.id === 'snk' ? { ...h, rate: 0.2 } : h.id === 'noc' ? { ...h, rate: 15 } : h)), mh);
  assert.deepEqual(low.map((h) => [h.code, h.ca, h.value, h.limit]), [['fundLow', 'HS27', 0.2, 0.25], ['nocHigh', 'HS19', 15, 10]]);
  assert.deepEqual(tariffHints(SEED.map((h) => (h.id === 'snk' ? { ...h, rate: 0.2 } : h)), stateRule('27', '2026-06-21')), [], 'no minimum before the 2026 Rules');
  assert.equal(stateRule('29', '2026-11-01'), null);
  assert.ok(pendingStateRule('29', '2026-11-01'));
  assert.deepEqual(tariffHints(SEED, null, true).map((h) => h.code), ['proposed']);
  assert.equal(stateRule('29', '2026-11-01', ['29'])?.default_bases.service, 'area_super');
  assert.equal(applyStateDefaults([], stateRule('33', '2026-11-01'), '2026-11-01', () => 't')[0].basis, 'undivided_pct');
  assert.equal(stateRule('19', '2026-11-01'), null, 'no rows for other States');
});
