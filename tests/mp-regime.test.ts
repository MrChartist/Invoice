/**
 * R17-A3 GST regime engine: entry 14 RCM by date, firm form and client (registered / unregistered / TDS-only /
 * composition), the school exemption, manual exemption, mixed posts → split, a typed rate wins; and the existing readers
 * (GSTR-1 B2B reverse charge Y, e-Invoice RegRev Y, Table 8 exempt) read the patch unchanged.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { BUYER_MH, clientMH, clientRetail, createViaStore, installSettings } from './helpers/world.ts';
import { forcedRegime, mpRegime, mpRegimePatch, postRegime, splitPosts } from '../src/lib/manpower/mp-regime.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { buildEInvoice } from '../src/lib/einvoice.ts';
import { receivableTotal } from '../src/lib/rcm.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
const reg = { gstin: BUYER_MH };
const D = '2026-10-31';

test('entry 14: from 2019-01-01, security SAC, not a body corporate, registered client', () => {
  assert.equal(postRegime('998525', { date: '2018-12-31', client: reg }).regime, 'fwd');
  const r = postRegime('998525', { date: '2019-01-01', client: reg });
  assert.deepEqual([r.regime, r.rate], ['rcm', 18]);
  assert.match(r.decl, /entry 14.*N 29\/2018-CT\(R\).*Verify with your CA/);
  for (const e of ['proprietorship', 'partnership', undefined]) assert.equal(postRegime('998525', { date: D, entityType: e, client: reg }).regime, 'rcm', String(e));
  for (const e of ['company', 'llp']) assert.equal(postRegime('998525', { date: D, entityType: e, client: reg }).regime, 'fwd', e);
  assert.equal(postRegime('998525', { date: D, client: { gstin: '' } }).regime, 'fwd', 'unregistered client (an RWA without GSTIN)');
  assert.equal(postRegime('998525', { date: D, client: { ...reg, mp: { gst_tds_only: true } } }).regime, 'fwd', 'TDS-only Government registration');
  assert.equal(postRegime('998525', { date: D, client: { ...reg, mp: { composition: true } } }).regime, 'fwd', 'composition recipient');
  assert.equal(postRegime('998533', { date: D, client: reg }).regime, 'fwd', 'housekeeping is not entry 14');
});

test('school exemption, manual exemption, mixed posts split, forced choices', () => {
  const school = { ...reg, mp: { school: true } };
  assert.deepEqual([postRegime('998533', { date: D, client: school }).regime, postRegime('998525', { date: D, client: school }).regime], ['exempt66', 'exempt66']);
  assert.equal(postRegime('998513', { date: D, client: school }).regime, 'fwd', 'staffing is not Sl. 66');
  assert.match(postRegime('998525', { date: D, client: school }).decl, /Sl\. 66\(b\)\(iii\)/);
  const m = postRegime('998525', { date: D, client: reg, manual: 'Sl. 3 — municipal office' });
  assert.deepEqual([m.regime, m.rate, m.decl], ['manual_exempt', 0, 'Exempt — Sl. 3 — municipal office. Verify with your CA.']);
  const mixed = mpRegime({ date: D, client: reg }, ['998525', '998533']);
  assert.equal(mixed.split, true);
  const g = splitPosts([{ sac: '998525', n: 1 }, { sac: '998533', n: 2 }, { sac: '998525', n: 3 }], { date: D, client: reg });
  assert.deepEqual([g.rcm?.map((p) => p.n), g.fwd?.map((p) => p.n)], [[1, 3], [2]]);
  assert.equal(mpRegime({ date: D, client: reg }, ['998525', '998525']).split, undefined);
  assert.equal(forcedRegime('rcm', D).regime, 'rcm');
  assert.equal(forcedRegime('manual_exempt', D, 'x').decl, 'Exempt — x. Verify with your CA.');
});

test('patch: rcm flags, exempt marks, a typed rate wins, an earlier exempt mark is undone; other mp keys kept', () => {
  const items = [{ id: 'a', name: 'Guard', hsn: '998525', quantity: 1, rate: 100, tax_rate: 12, discount_percent: 0, amount: 100, type: 'Service' }, { id: 'b', name: 'Sup', hsn: '998525', quantity: 1, rate: 100, tax_rate: 0, discount_percent: 0, amount: 100, type: 'Service' }] as InvoiceRecord['items'];
  const rcm = mpRegimePatch({ items, mp: { month: '2026-10', muster_id: 'm1' } }, postRegime('998525', { date: D, client: reg }));
  assert.deepEqual([rcm.reverse_charge, rcm.rcm_tax_excluded, rcm.items!.map((l) => l.tax_rate), rcm.mp!.muster_id, rcm.mp!.regime], [true, true, [12, 18], 'm1', 'rcm']);
  const ex = mpRegimePatch({ items }, forcedRegime('exempt66', D), 'school');
  assert.deepEqual([ex.reverse_charge, ex.items!.map((l) => [l.tax_rate, l.sv?.exempt]), ex.mp!.regime_note], [false, [[0, 'EXEMPT'], [0, 'EXEMPT']], 'school']);
  const back = mpRegimePatch({ items: ex.items!, mp: ex.mp }, forcedRegime('fwd', D));
  assert.deepEqual([back.items!.map((l) => [l.tax_rate, l.sv?.exempt]), back.mp!.regime_note, back.mp!.decl], [[[18, undefined], [18, undefined]], undefined, undefined]);
});

test('readers unchanged: an rcm bill is B2B reverse charge Y and RegRev Y; an exempt66 line lands in Table 8 exempt', () => {
  const r = postRegime('998525', { date: D, client: clientMH });
  const inv = createViaStore({ client: { ...clientMH, gstin: BUYER_MH }, docType: 'TAX_INVOICE', date: D, lines: [{ name: 'Guard (12 h)', hsn: '998525', qty: 122, rate: 800, tax: 18 }], reverseCharge: r.regime === 'rcm' });
  assert.equal(receivableTotal(inv), 97600, 'no tax added for the client to pay');
  const g = buildGstReport([inv], [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  assert.deepEqual(g.gstr1.b2b.map((d: { rchrg: string }) => d.rchrg), ['Y']);
  assert.equal(buildEInvoice(inv).payload.TranDtls.RegRev, 'Y');
  const ex = createViaStore({ client: clientRetail, docType: 'TAX_INVOICE', date: D, lines: [{ name: 'Housekeeping', hsn: '998533', qty: 1, rate: 30000, tax: 18 }] });
  const p = mpRegimePatch(ex, postRegime('998533', { date: D, client: { mp: { school: true } } }));
  localDb.invoices.save({ ...ex, ...p } as InvoiceRecord);
  const t8 = buildGstReport([localDb.invoices.getById(ex.id) as InvoiceRecord], [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  assert.equal(t8.gstr1.nil.reduce((s: number, n: { exempt: number }) => s + n.exempt, 0), 30000);
});
