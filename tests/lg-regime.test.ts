/**
 * R19-B2 place of supply and rate per head (pure), by the document date: Sec 12(8) and its proviso (2019-01-31 / 02-01),
 * 13(9) → 13(2) (2023-09-30 / 10-01), multimodal 12 % → 5 % / 18 % (2025-09-21 / 22, with and without an air leg; an
 * international job takes its legs' rate), the intermediary rule (2026-03-29 / 30), registered vs unregistered,
 * agri storage exempt, pure agent, GTA leg, the ocean-freight RCM hint and the chip.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { lgRegime, regimeChip, regimeHints, type RegimeCtx } from '../src/lib/logistics/lg-regime.ts';
import { defaultHeads } from '../src/lib/logistics/lg-heads.ts';
import type { LgHead, LgHeadKind, LgJob } from '../src/types/logistics-r19.ts';

const H = defaultHeads('2026-11-05');
const head = (kind: LgHeadKind, o: Partial<LgHead> = {}): LgHead => ({ ...(H.find((h) => h.kind === kind) ?? { id: `lg-${kind}`, name: kind, kind, role: 'own', unit: 'per_shipment', pos_rule: 'auto', active: true }), ...o });
const job = (o: Partial<LgJob> = {}): LgJob => ({ id: 'j', number: 'JOB/FY26-27/0001', date: '2026-11-05', status: 'delivered', dir: 'export', mode: 'air', origin: 'BOM', destination: 'SIN', dest_country: 'SG', client_id: 'c', refs: {}, updated_at: '', ...o });
const ctx = (date: string, o: Partial<RegimeCtx> = {}): RegimeCtx => ({ date, sender: { state: '27', registered: true }, recipient: { state: '27', registered: true, foreign: false }, inter: date >= '2026-03-30' ? 'recipient' : 'supplier', gta: 5, ...o });
const KA = { state: '29', registered: true, foreign: false };
const ABROAD = { state: '96', registered: false, foreign: true };

test('export freight to an Indian client: POS 96, IGST from 1 Feb 2019 (12(8) proviso); before, 12(8)', () => {
  const g = lgRegime(head('freight_air'), job(), ctx('2026-11-05'));
  assert.deepEqual([g.key, g.pos, g.mode, g.rate, g.ca], ['export_freight', '96', 'IGST', 18, 'LG2']);
  assert.match(g.reason, /12\(8\) proviso.*Circular 184\/16\/2022/);
  const before = lgRegime(head('freight_air'), job(), ctx('2019-01-31'));
  assert.deepEqual([before.key, before.pos, before.mode], ['domestic', '27', 'CGST_SGST']);
  assert.equal(lgRegime(head('freight_air'), job(), ctx('2019-02-01')).pos, '96');
  assert.equal(lgRegime(head('courier'), job({ mode: 'courier' }), ctx('2026-11-05')).pos, '96', 'outbound courier to an Indian shipper (LG18)');
});

test('domestic transport: registered recipient → its State (IGST across States); unregistered → where handed over (ours)', () => {
  const d = job({ dir: 'domestic', dest_country: 'IN', mode: 'road' });
  const reg = lgRegime(head('freight_sea'), d, ctx('2026-11-05', { recipient: KA }));
  assert.deepEqual([reg.key, reg.pos, reg.mode, reg.rate, reg.reason], ['domestic', '29', 'IGST', 5, 'Sec 12(8) IGST Act']);
  assert.equal(reg.itc_note, 'ITC on goods other than ships not taken', 'vessel: the ITC note is for the editor');
  const un = lgRegime(head('freight_sea'), d, ctx('2026-11-05', { recipient: { state: '29', registered: false, foreign: false } }));
  assert.deepEqual([un.pos, un.mode], ['27', 'CGST_SGST']);
});

test('other heads: Sec 12(2), the recipient\'s State; local charges of an export job stay local (LG9)', () => {
  for (const k of ['origin', 'documentation', 'clearance'] as const) {
    const g = lgRegime(head(k), job(), ctx('2026-11-05'));
    assert.deepEqual([g.key, g.pos, g.mode, g.rate], ['general', '27', 'CGST_SGST', 18], k);
  }
  assert.equal(lgRegime(head('clearance'), job(), ctx('2026-11-05', { recipient: KA })).mode, 'IGST');
});

test('recipient outside India: 13(9) destination to 30 Sep 2023, 13(2) from 1 Oct 2023; LUT when 2(6) holds', () => {
  const imp = job({ dir: 'import', dest_country: 'IN', mode: 'sea_fcl', origin: 'SIN', destination: 'INNSA' });
  const old = lgRegime(head('freight_sea'), imp, ctx('2023-09-30', { recipient: ABROAD }));
  assert.deepEqual([old.pos, old.mode], ['27', 'CGST_SGST'], '13(9): an import to India, the destination is in India');
  assert.match(old.reason, /13\(9\)/);
  const now = lgRegime(head('freight_sea'), imp, ctx('2023-10-01', { recipient: ABROAD, exportOk: true, lut: true }));
  assert.deepEqual([now.pos, now.supply, now.ca], ['96', 'EXPORT_LUT', 'LG3']);
  assert.match(now.reason, /13\(2\).*Circular 203\/15\/2023.*LUT/);
  const noLut = lgRegime(head('freight_sea'), imp, ctx('2023-10-01', { recipient: ABROAD, exportOk: true }));
  assert.deepEqual([noLut.supply, noLut.mode], ['EXPORT_WITH_PAYMENT', 'IGST']);
  assert.equal(lgRegime(head('courier'), imp, ctx('2023-09-30', { recipient: ABROAD })).pos, '96', 'mail / courier: always 13(2)');
  assert.equal(regimeChip(now), 'POS 96 · LUT 0 %');
});

test('intermediary (commission): our location until 29 Mar 2026, 13(2) from 30 Mar 2026 (LG4)', () => {
  const c = head('commission');
  const a = lgRegime(c, job(), ctx('2026-03-29', { recipient: ABROAD }));
  assert.deepEqual([a.key, a.pos, a.mode], ['intermediary', '27', 'CGST_SGST']);
  const b = lgRegime(c, job(), ctx('2026-03-30', { recipient: ABROAD, exportOk: true, lut: true }));
  assert.deepEqual([b.key, b.pos, b.supply], ['cross_border', '96', 'EXPORT_LUT']);
});

test('multimodal: 12 % to 21 Sep 2025; then 5 % without an air leg, 18 % with one, domestic only; international takes the leg rate', () => {
  const mm = head('freight_multimodal', { id: 'mm' });
  const dom = job({ dir: 'domestic', mode: 'multimodal', dest_country: 'IN', legs: ['road', 'rail'] });
  assert.equal(lgRegime(mm, dom, ctx('2025-09-21')).rate, 12);
  assert.equal(lgRegime(mm, dom, ctx('2025-09-22')).rate, 5);
  assert.equal(lgRegime(mm, { ...dom, legs: ['road', 'air'] }, ctx('2025-09-22')).rate, 18);
  assert.equal(lgRegime(mm, job({ mode: 'multimodal', legs: ['road', 'sea'] }), ctx('2025-09-22')).rate, 5, 'international: sea leg rate');
  assert.equal(lgRegime(mm, job({ mode: 'multimodal', legs: ['road', 'air'] }), ctx('2025-09-22')).rate, 18, 'international: air leg rate');
});

test('pure agent, exempt agri storage, GTA leg, unregistered sender, composite heads untouched here', () => {
  const p = lgRegime(head('port'), job(), ctx('2026-11-05'));
  assert.deepEqual([p.key, p.pos, p.mode, p.rate, regimeChip(p)], ['pure_agent', '27', 'NONE', 0, 'POS 27 · Rule 33']);
  const agri = lgRegime(head('storage', { exempt_if: 'agri_produce' }), job({ dir: 'domestic', dest_country: 'IN' }), ctx('2026-11-05'));
  assert.deepEqual([agri.key, agri.rate, agri.mode, agri.ca], ['exempt', 0, 'NONE', 'LG21']);
  assert.match(agri.reason, /Sl\. 54\(e\)/);
  assert.equal(lgRegime(head('storage', { exempt_if: 'rice' }), job(), ctx('2026-11-05')).reason, 'Exempt: N 12/2017-CT(R) Sl. 24');
  assert.equal(lgRegime(head('gta'), job({ dir: 'domestic', dest_country: 'IN', mode: 'road' }), ctx('2026-11-05', { gta: 18 })).rate, 18, 'GTA option rate from the context (LG8)');
  const un = lgRegime(head('freight_air'), job(), ctx('2026-11-05', { sender: { state: '27', registered: false } }));
  assert.deepEqual([un.mode, un.rate], ['NONE', 0]);
  assert.equal(lgRegime(head('clearance', { pos_rule: 'transport' }), job(), ctx('2026-11-05')).pos, '96', 'a user pos_rule wins');
});

test('ocean freight RCM hint: CIF import by sea from 1 Oct 2023 only (LG16)', () => {
  const imp = job({ dir: 'import', mode: 'sea_fcl', incoterm: 'CIF', dest_country: 'IN' });
  assert.equal(regimeHints(imp, '2023-10-01').length, 1);
  assert.equal(regimeHints(imp, '2023-09-30').length, 0);
  assert.equal(regimeHints({ ...imp, incoterm: 'FOB' }, '2026-11-05').length, 0);
});
