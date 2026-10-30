/** R15-B3 regimes: rates / SAC / ITC / sentence by date, the snapshot, the mixing warning, the exempt column. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regimeMix, regimeRule, tvSnapshot } from '../src/lib/travel/tv-regime.ts';
import { tripLines } from '../src/lib/travel/tv-bill.ts';
import { PURE_AGENT_CHARGE, isPureAgentLine } from '../src/lib/trade/pure-agent.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';

test('rates, SAC, ITC and the printed sentence before and after 22 Sep 2025', () => {
  for (const d of ['2025-09-21', '2025-09-22', '2026-11-01']) {
    assert.deepEqual([regimeRule('to5', d).rate, regimeRule('to5', d).itc, regimeRule('to5', d).sac], [5, 'blocked', '998555'], d);
    assert.equal(regimeRule('to18', d).rate, 18);
    assert.equal(regimeRule('agent', d).rate, 18);
    assert.equal(regimeRule('exempt_outside', d).rate, 0);
  }
  assert.match(regimeRule('to5', '2026-01-01').decl, /gross amount charged including accommodation and transportation; GST 5 % without ITC \(N 11\/2017-CT\(R\) Sl\. 23\(ii\)\)\. Verify with your CA\./);
  assert.match(regimeRule('agent').decl, /pure agent \(Rule 33\)/);
  assert.equal(regimeRule('to18').decl, '');
});

test('one regime per invoice: 5 % mixed with other taxed lines warns; pure-agent recoveries never count', () => {
  const pkg = { tax_rate: 5, quantity: 1, rate: 60000 };
  const fee = { tax_rate: 18, quantity: 1, rate: 2500 };
  const pass = { tax_rate: 0, quantity: 1, rate: 9000, charge_head_id: 'rule33', description: PURE_AGENT_CHARGE };
  assert.equal(regimeMix([pkg], 'to5'), false);
  assert.equal(regimeMix([pkg, fee], 'to5'), true);
  assert.equal(regimeMix([pkg, fee]), true, 'without a regime too');
  assert.equal(regimeMix([fee, pass], 'agent'), false);
  assert.equal(regimeMix([fee], 'to5'), true);
});

test('lines: to5 one gross package line at 5 %; agent a fee line + pure-agent lines at cost; exempt in the exempt column', () => {
  const bk = (id: string, cost: number, sell: number, pure = false) => ({ id, trip_id: 't', component: 'hotel' as const, start: '2026-11-10', cost, sell, status: 'confirmed' as const, created_at: '', ...(pure ? { pure_agent: true } : {}) });
  const to5 = tripLines('Goa (2611-001)', 'to5', '2026-11-10', [bk('a', 42000, 50000), bk('b', 6000, 10000)]);
  assert.deepEqual(to5.items.map((l) => [l.name, l.rate, l.tax_rate, l.hsn]), [['Tour package: Goa (2611-001)', 60000, 5, '998555']]);
  assert.deepEqual([...to5.refs.values()], [to5.items[0].id, to5.items[0].id]);
  const ag = tripLines('Goa', 'agent', '2026-11-10', [bk('h', 9000, 9000, true), bk('f', 0, 2500)]);
  assert.deepEqual(ag.items.map((l) => [l.rate, l.tax_rate, isPureAgentLine(l)]), [[2500, 18, false], [9000, 0, true]]);
  assert.equal(ag.refs.get('h'), ag.items[1].id);
  const ex = tripLines('Bali', 'exempt_outside', '2026-11-10', [bk('x', 1000, 2000)]);
  assert.deepEqual([ex.items[0].tax_rate, ex.items[0].sv?.exempt], [0, 'EXEMPT']);
});

test('the snapshot: trip header, regime, sentence; survives normalizeRecord', () => {
  const trip = { id: 't', name: 'Goa', kind: 'project' as const, active: true, created_at: '', tv: { code: '2611-001', kind: 'trip' as const, scope: 'domestic' as const, destination: 'Goa', start: '2026-11-10', end: '2026-11-15', regime: 'to5' as const, status: 'confirmed' as const, pax: [{ name: 'Ravi Mehta', type: 'adult' as const }, { name: 'Asha', type: 'adult' as const }] } };
  const tv = tvSnapshot(trip, 'to5', '2026-11-01');
  assert.deepEqual(tv.trip, { id: 't', code: '2611-001', kind: 'trip', pax: 2, destination: 'Goa', start: '2026-11-10', end: '2026-11-15', lead: 'Ravi Mehta' });
  assert.equal(tv.regime, 'to5');
  assert.match(tv.decl!, /GST 5 % without ITC/);
  assert.equal('decl' in tvSnapshot(trip, 'to18', '2026-11-01'), false);
  assert.deepEqual(normalizeRecord({ id: 'x', items: [], tv } as never).tv, tv);
});
