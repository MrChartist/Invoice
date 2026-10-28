/** R19-A3 charge heads: defaults, SACs, roles, POS rule by kind, mode rates by date (the lane rate sheets were cut at the cap, PRD §3 cut 2). */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { defaultHeads, headOk, lgRateFor, posRuleOf, sacFor } from '../src/lib/logistics/lg-heads.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('default heads: SACs (LG5), pure-agent duty / CFS / port / DO / insurance (LG10, LG36, LG37), demurrage own (LG35)', () => {
  const h = defaultHeads('2026-11-05');
  assert.ok(h.length >= 10);
  const by = Object.fromEntries(h.map((x) => [x.kind, x]));
  assert.deepEqual([by.freight_air.sac, by.freight_sea.sac, by.clearance.sac, by.documentation.sac, by.storage.sac, by.gta.sac], ['996531', '996521', '996712', '996713', '996729', '996791']);
  for (const k of ['duty', 'cfs', 'port', 'do_charges', 'insurance']) assert.deepEqual([by[k].role, by[k].sac], ['pure_agent', undefined], k);
  assert.equal(by.demurrage.role, 'own');
  assert.equal(by.freight_air.currency, 'USD');
  assert.ok(h.every(headOk));
  assert.equal(sacFor('courier', '2026-11-05'), '996812');
  assert.equal(sacFor('freight_multimodal', '2026-11-05'), '996799');
});

test('POS rule by kind (auto) and an explicit override', () => {
  assert.equal(posRuleOf({ kind: 'freight_air' }), 'transport');
  assert.equal(posRuleOf({ kind: 'courier', pos_rule: 'auto' }), 'transport');
  assert.equal(posRuleOf({ kind: 'gta' }), 'transport');
  assert.equal(posRuleOf({ kind: 'commission' }), 'intermediary');
  assert.equal(posRuleOf({ kind: 'clearance' }), 'general');
  assert.equal(posRuleOf({ kind: 'origin', pos_rule: 'transport' }), 'transport');
});

test('mode rates by date: vessel 5 % (ITC note), air 18 %, multimodal 12 % then 5 % / 18 % with an air leg, support 18 %, GTA / duty none here', () => {
  assert.deepEqual([lgRateFor('freight_sea', '2026-11-05')?.rate, !!lgRateFor('freight_sea', '2026-11-05')?.itc_note], [5, true]);
  assert.equal(lgRateFor('freight_air', '2026-11-05')?.rate, 18);
  assert.equal(lgRateFor('freight_multimodal', '2025-09-21', ['road', 'air'])?.rate, 12);
  assert.equal(lgRateFor('freight_multimodal', '2025-09-22', ['road', 'sea'])?.rate, 5);
  assert.equal(lgRateFor('freight_multimodal', '2025-09-22', ['road', 'air'])?.rate, 18);
  assert.equal(lgRateFor('courier', '2026-11-05')?.rate, 18);
  assert.equal(lgRateFor('clearance', '2026-11-05')?.rate, 18);
  for (const k of ['gta', 'duty', 'commission'] as const) assert.equal(lgRateFor(k, '2026-11-05'), null, k);
});
