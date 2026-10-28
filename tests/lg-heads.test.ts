/** R19-A3 charge heads and rate sheets: defaults, SACs, roles, POS rule by kind, mode rates by date; sheet precedence, validity, minimum; quotation → job. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { defaultHeads, headOk, lgRateFor, posRuleOf, sacFor } from '../src/lib/logistics/lg-heads.ts';
import { jobFromQuote, ratesFor, sheetErrors, withMin } from '../src/lib/logistics/lg-rates.ts';
import { loadSheets, saveSheet } from '../src/lib/logistics/lg-save.ts';
import { saveQuote } from '../src/lib/logistics/lg-issue-io.ts';
import type { LgHead, LgRateSheet } from '../src/types/logistics-r19.ts';

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

const heads: LgHead[] = [
  { id: 'air', name: 'Air freight', kind: 'freight_air', role: 'own', unit: 'per_kg', rate: 2.5, currency: 'USD', active: true },
  { id: 'doc', name: 'Documentation', kind: 'documentation', role: 'own', unit: 'per_bill', rate: 2000, currency: 'INR', active: true },
  { id: 'off', name: 'Old head', kind: 'other', role: 'own', unit: 'typed', rate: 1, active: false },
];
const sheet = (o: Partial<LgRateSheet>): LgRateSheet => ({ id: 's', lane: { origin: 'BOM', destination: 'SIN', mode: 'air' }, valid_from: '2026-04-01', rows: [], updated_at: '', ...o });
const job = { client_id: 'c1', origin: 'BOM', destination: 'SIN', mode: 'air' as const, date: '2026-11-05' };

test('rate sheets: client + lane before lane before the head default; validity; minimum', () => {
  assert.deepEqual(ratesFor(job, [], heads), { air: { rate: 2.5, currency: 'USD', unit: 'per_kg', from: 'head' }, doc: { rate: 2000, currency: 'INR', unit: 'per_bill', from: 'head' } }, 'inactive heads left out');
  const lane = sheet({ id: 'l', rows: [{ head_id: 'air', rate: 2.2, currency: 'USD', unit: 'per_kg' }] });
  const own = sheet({ id: 'o', client_id: 'c1', rows: [{ head_id: 'air', rate: 2, currency: 'USD', unit: 'per_kg', min: 75 }] });
  const old = sheet({ id: 'x', client_id: 'c1', valid_from: '2025-04-01', valid_to: '2026-03-31', rows: [{ head_id: 'air', rate: 1, currency: 'USD', unit: 'per_kg' }] });
  const r = ratesFor(job, [lane, own, old], heads);
  assert.deepEqual([r.air.rate, r.air.from, r.air.min, r.doc.from], [2, 'client', 75, 'head']);
  assert.equal(ratesFor({ ...job, client_id: 'c2' }, [lane, own], heads).air.from, 'lane');
  assert.equal(ratesFor({ ...job, destination: 'DXB' }, [lane, own], heads).air.from, 'head');
  assert.equal(withMin(20 * 2, 75), 75);
  assert.equal(withMin(500 * 2, 75), 1000);
  assert.equal(sheetErrors(sheet({ valid_to: '2026-01-01' }), heads).length, 1);
  assert.equal(sheetErrors(sheet({ rows: [{ head_id: 'zz', rate: 1, currency: 'USD', unit: 'per_kg' }] }), heads).length, 1);
  saveSheet({ ...own, lane: { origin: ' bom ', destination: 'sin', mode: 'air' } }, heads);
  assert.deepEqual(loadSheets()[0].lane, { origin: 'BOM', destination: 'SIN', mode: 'air' });
});

test('quotation from a sheet → job (parties, lane, mode); one currency per quotation', () => {
  const c = localDb.clients.upsert({ name: 'Demo Exports Pvt Ltd', email: '', address: '', city: '', zip: '' });
  const s = sheet({ client_id: c, rows: [{ head_id: 'air', rate: 2, currency: 'USD', unit: 'per_kg' }] });
  const q = saveQuote(s, heads, c, '2026-11-05');
  assert.deepEqual([q.doc_type, q.currency, q.lg?.quote, q.lg?.lane, q.items.length, q.items[0].rate, q.items[0].tax_rate], ['QUOTATION', 'USD', true, s.lane, 1, 2, 18]);
  assert.throws(() => saveQuote(sheet({ client_id: c, rows: [...s.rows, { head_id: 'doc', rate: 2000, currency: 'INR', unit: 'per_bill' }] }), heads, c, '2026-11-05'), /One currency/);
  const j = jobFromQuote(q, c)!;
  assert.deepEqual([j.client_id, j.origin, j.destination, j.mode, j.date], [c, 'BOM', 'SIN', 'air', '2026-11-05']);
  assert.equal(jobFromQuote({ ...q, lg: undefined }, c), null, 'a plain quotation makes no job');
});
