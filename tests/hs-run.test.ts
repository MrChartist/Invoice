/**
 * R18-B1 / B2 / B4 billing run end to end: one document per unit in one batch (PRD §7 seed: A-101 Bill of Supply
 * ₹6,710, A-901 tax invoice ₹13,631.80), idempotent re-run, undo, outsider split, quarterly cycle, a member's second
 * unit, the special levy, line ids for the paper; and the existing readers unchanged — GSTR-1 Table 8 exempt / B2CS
 * 18 % / HSN without the pass-through dues, B2B + e-Invoice (dues in OthChrg), Bill of Supply series. Volume: 2,000 units.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { saveSocietySettings } from '../src/lib/society/hs-settings.ts';
import { issueRun, loadRuns, planRun, undoRun } from '../src/lib/society/hs-issue-io.ts';
import { billKind, levyShares } from '../src/lib/society/hs-run.ts';
import { hsLineText } from '../src/components/templates/paper-helpers.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { buildEInvoice } from '../src/lib/einvoice.ts';
import { isPureAgentLine } from '../src/lib/trade/pure-agent.ts';
import type { HsHead, SocietyUnit } from '../src/types/society-r18.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const H = (id: string, kind: HsHead['kind'], basis: HsHead['basis'], rate: number, o: Partial<HsHead> = {}): HsHead => ({ id, name: id, kind, basis, rate, active: true, ...(kind === 'statutory' ? {} : { sac: '999598' }), ...o });
const SEED: HsHead[] = [H('svc', 'service', 'per_unit', 3000), H('snk', 'sinking', 'cost_pct_pa', 0.25), H('rep', 'repair', 'cost_pct_pa', 0.75), H('ptx', 'statutory', 'typed', 0), H('prk', 'parking', 'per_slot', 500), H('noc', 'non_occupancy', 'pct_of_head', 10), H('edu', 'education', 'fixed_member', 10)];
const U = (id: string, code: string, owner: string, o: Partial<SocietyUnit> = {}): SocietyUnit => ({ id, code, wing: 'A', use: 'residential', occupancy: 'owner', parking: [{ slot: `P${id}`, kind: 'covered' }], carpet_area: 600, construction_cost: 2400000, owner_id: owner, typed: { ptx: 1200 }, status: 'active', updated_at: '', ...o });
const UNITS = [U('u1', 'A-101', 'c1'), U('u2', 'A-102', 'c2', { occupancy: 'tenant' }), U('u3', 'A-901', 'c3', { carpet_area: 1500, construction_cost: 6000000, parking: [{ slot: 'P31', kind: 'covered' }, { slot: 'P32', kind: 'covered' }], typed: { ptx: 3000 } })];
const OCT = { period: '2026-10', date: '2026-10-01', due: '2026-10-20' };
const inv = () => getTable<InvoiceRecord>('invoices');
const of = (code: string) => inv().find((i) => i.hs?.unit?.code === code && i.status !== 'Cancelled')!;

function world(heads = SEED, units = UNITS) {
  localDb.settings.save({ ...localDb.settings.get(), society_kind: 'chs' });
  setTable('clients', [['c1', 'Asha Rao'], ['c2', 'Ravi Shah'], ['c3', 'Meena Kulkarni']].map(([id, name]) => ({ id, name, email: '', address: '', city: '', zip: '' })));
  setTable('society_units', units);
  saveSocietySettings({ state: '27', cycle: 'monthly', due_days: 19, heads });
}

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('PRD §7: A-101 Bill of Supply ₹6,710 with the Sl. 77(c) sentence and the property tax as a pure-agent line; A-901 tax invoice ₹13,631.80', () => {
  world();
  const r = issueRun(OCT);
  assert.equal(r.invoices.length, 3);
  assert.deepEqual(r.run?.counts, { bos: 2, tax: 1, plain: 0, outsider: 0 });
  assert.deepEqual(r.run?.totals, { svc: 9000, snk: 2250, rep: 6750, ptx: 5400, prk: 2000, noc: 300, edu: 30 });
  const a = of('A-101');
  assert.deepEqual([a.doc_type, a.exempt_kind, a.total, a.tax_amount ?? 0, a.status, a.due_date], ['BILL_OF_SUPPLY', 'EXEMPT', 6710, 0, 'Sent', '2026-10-20']);
  assert.match(a.invoice_number, /^BOS\//);
  assert.match(a.hs!.decl!, /Sl\. 77\(c\)/);
  assert.deepEqual([a.hs!.regime, a.hs!.period, a.hs!.run_id, a.hs!.test], ['exempt77c', '2026-10', r.run!.id, { counted: 5510, limit: 7500, months: 1 }]);
  const ptx = a.items.find((l) => l.name === 'ptx')!;
  assert.ok(isPureAgentLine(ptx) && ptx.charge_head_id === 'rule33' && !ptx.hsn && ptx.amount === 1200);
  assert.equal(hsLineText(a.items.find((l) => l.name === 'snk'), a.hs), '0.25 % a year of cost', 'line ids follow the renumbered lines');
  assert.ok(a.hs!.heads!.every((h) => a.items.some((l) => l.id === h.line_id)));
  const c = of('A-901');
  assert.deepEqual([c.doc_type, c.taxable_value, c.tax_amount, c.total, c.hs!.regime], ['TAX_INVOICE', 12010, 1621.8, 13631.8, 'taxable_whole'], 'the 0 % pass-through line sits in the document value; GSTR-1 leaves it out');
  assert.ok(c.items.filter((l) => !l.charge_head_id).every((l) => l.tax_rate === 18 && l.hsn === '999598'));
  assert.equal(of('A-102').total, 7010);
});

test('idempotent: a second run of the period issues nothing ("already billed: 3"); undo cancels with a reason; the period runs again', () => {
  world();
  const first = issueRun(OCT);
  const again = issueRun(OCT);
  assert.equal(again.run, undefined);
  assert.deepEqual(again.plan.skipped.map((s) => [s.code, s.reason]), [['A-101', 'billed'], ['A-102', 'billed'], ['A-901', 'billed']]);
  assert.equal(inv().length, 3);
  assert.throws(() => undoRun(first.run!.id, ' '), /reason/);
  assert.equal(undoRun(first.run!.id, 'Wrong rate').cancelled, 3);
  assert.ok(inv().every((i) => i.status === 'Cancelled'), 'cancelled, never deleted');
  assert.equal(loadRuns()[0].undone?.reason, 'Wrong rate');
  assert.throws(() => undoRun(first.run!.id, 'x'));
  assert.equal(issueRun(OCT).invoices.length, 3);
  assert.equal(inv().length, 6);
  assert.notEqual(of('A-101').invoice_number, inv()[0].invoice_number, 'numbers stay reserved');
});

test('outsider head → its own 18 % document (never mixed); a member\'s second unit pays per-member heads once; quarterly × 3', () => {
  world([...SEED, H('hall', 'outsider', 'per_unit', 1000, { sac: '997212' })], [UNITS[0], { ...UNITS[2], owner_id: 'c1' }]);
  const r = issueRun(OCT);
  assert.deepEqual(r.run?.counts, { bos: 1, tax: 1, plain: 0, outsider: 2 });
  const out = inv().filter((i) => billKind(i.hs) === 'outsider');
  assert.ok(out.every((i) => i.doc_type === 'TAX_INVOICE' && i.items.length === 1 && i.items[0].tax_rate === 18 && i.items[0].hsn === '997212'));
  assert.ok(inv().filter((i) => billKind(i.hs) === 'main').every((i) => !i.items.some((l) => l.name === 'hall')));
  const a901 = inv().find((i) => i.hs?.unit?.code === 'A-901' && billKind(i.hs) === 'main')!;
  assert.ok(!a901.items.some((l) => l.name === 'edu'), 'education once per member (on A-101)');
  assert.equal(a901.hs!.test!.counted, 9000, 'tested per unit, never per member (Circular 109 Q4)');
  resetStorage(); installSettings();
  world();
  saveSocietySettings({ cycle: 'quarterly' });
  issueRun({ period: '2026-Q3', date: '2026-10-01', due: '2026-10-20' });
  assert.deepEqual([of('A-101').hs!.test, of('A-101').doc_type, of('A-901').doc_type], [{ counted: 16530, limit: 7500, months: 3 }, 'BILL_OF_SUPPLY', 'TAX_INVOICE']);
});

test('unregistered society: plain bills without tax; agency: tax invoices; excess setting: exempt + taxable lines on one invoice', () => {
  installSettings({ profiles: [{ ...localDb.settings.activeProfile()!, companyGstin: '' }] });
  world();
  issueRun(OCT);
  assert.ok(inv().every((i) => i.doc_type === 'INVOICE' && !(i.tax_amount ?? 0) && i.hs?.regime === 'unregistered'));
  resetStorage(); installSettings();
  world();
  saveSocietySettings({ gst: { valuation: 'excess' } });
  issueRun(OCT);
  const c = of('A-901');
  assert.deepEqual([c.hs!.regime, c.taxable_value, c.tax_amount], ['taxable_excess', 12010, 271.8]);
  assert.equal(c.items[0].sv?.exempt, 'EXEMPT');
  const g = buildGstReport(inv(), [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  assert.equal(g.gstr1.nil.reduce((s: number, n: { exempt: number }) => s + n.exempt, 0), 5510 + 5810 + 7500);
  resetStorage(); installSettings();
  world();
  localDb.settings.save({ ...localDb.settings.get(), society_kind: 'agency' });
  issueRun(OCT);
  assert.ok(inv().every((i) => i.doc_type === 'TAX_INVOICE' && i.hs?.regime === 'agency'));
});

test('GSTR-1: exempt bills in Table 8 exempt, the large flat in B2CS 18 %, pass-through dues in neither nor the HSN summary; B2B member → e-Invoice OthChrg', () => {
  world();
  issueRun(OCT);
  const g = buildGstReport(inv(), [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  assert.equal(g.gstr1.nil.reduce((s: number, n: { exempt: number }) => s + n.exempt, 0), 11320, 'A-101 5,510 + A-102 5,810');
  assert.deepEqual(g.gstr1.b2cs.map((r: { rate: number; txval: number }) => [r.rate, r.txval]), [[18, 9010]]);
  assert.equal(g.gstr1.b2b.length, 0);
  const hsnVal = g.gstr1.hsn.reduce((s: number, r: { taxable: number }) => s + r.taxable, 0);
  assert.equal(Math.round(hsnVal), 9010 + 11320, 'no property tax in the HSN summary');
  assert.ok(g.gstr1.hsn.every((r: { hsn: string }) => r.hsn === '999598'));
  resetStorage(); installSettings();
  world();
  setTable('clients', localDb.clients.getAll().map((c) => (c.id === 'c3' ? { ...c, gstin: '27AAPFU0939F1ZV', state_code: '27', address: 'Office 1, Pune', city: 'Pune', zip: '411001' } : c)));
  issueRun(OCT);
  const c = of('A-901');
  const g2 = buildGstReport(inv(), [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  assert.equal(g2.gstr1.b2b.length, 1);
  const e = buildEInvoice(c).payload;
  assert.equal(e.ItemList.length, 5, 'five member heads; the property tax is no item');
  assert.equal(e.ValDtls.OthChrg, 3000);
  assert.equal(e.ValDtls.TotInvVal, 13631.8);
});

test('B4 special levy: shared by carpet area, tested with the month\'s regular bill (HS3), once per unit; undo', () => {
  world();
  issueRun(OCT);
  const levy = { name: 'Painting', kind: 'major_repair' as const, basis: 'area_carpet' as const, total: 270000 };
  assert.deepEqual([...levyShares(UNITS, levy).values()], [60000, 60000, 150000]);
  const p = planRun({ period: '2026-10', date: '2026-10-15', due: '2026-10-30', levy });
  assert.deepEqual(p.bills.map((b) => [b.unit.code, b.hs.test!.counted, b.regime.regime]), [['A-101', 65510, 'taxable_whole'], ['A-102', 65810, 'taxable_whole'], ['A-901', 159010, 'taxable_whole']]);
  const small = planRun({ period: '2026-10', date: '2026-10-15', due: '2026-10-30', levy: { ...levy, total: 3000, basis: 'per_unit' } });
  assert.deepEqual(small.bills.map((b) => b.regime.regime), ['exempt77c', 'exempt77c', 'taxable_whole'], '1,000 + the month\'s 5,510 stays within ₹7,500');
  const r = issueRun({ period: '2026-10', date: '2026-10-15', due: '2026-10-30', levy });
  assert.deepEqual([r.invoices.length, r.run?.levy?.name, r.invoices[0].total], [3, 'Painting', 70800]);
  assert.equal(issueRun({ period: '2026-10', date: '2026-10-15', due: '2026-10-30', levy }).run, undefined, 'once per unit');
  assert.equal(undoRun(r.run!.id, 'wrong total').cancelled, 3);
  assert.equal(inv().filter((i) => i.status !== 'Cancelled').length, 3, 'the regular bills stay');
});

// Volume (PRD §4): planning 2,000 units is pure and fast; issuing is bounded by `localDb.invoices.save` re-serialising
// the whole invoices table per document (first-paint storage, O(n²)): 2,000 bills took ≈ 145 s on the R18-B build
// machine, so the test issues 200 in one batch and `run_limit` splits a large society's run (deviation, see the feature doc).
test('volume: 2,000 units planned in one pass; 200 issued in one batch under 3 s; run_limit splits a run', () => {
  localDb.settings.save({ ...localDb.settings.get(), society_kind: 'chs' });
  const mk = (n: number) => {
    setTable('clients', Array.from({ length: n }, (_, k) => ({ id: `m${k}`, name: `Member ${k}`, email: '', address: '', city: '', zip: '' })));
    setTable('society_units', Array.from({ length: n }, (_, k) => U(`v${k}`, `B-${1000 + k}`, `m${k}`, { construction_cost: k % 10 ? 2400000 : 6000000 })));
  };
  mk(2000);
  saveSocietySettings({ state: '27', heads: SEED });
  let t = performance.now();
  const p = planRun(OCT);
  assert.equal(p.bills.length, 2000);
  assert.deepEqual([p.counts.bos, p.counts.tax], [1800, 200]);
  assert.ok(performance.now() - t < 1500, `plan ${Math.round(performance.now() - t)} ms`);
  mk(200);
  t = performance.now();
  const r = issueRun(OCT);
  const ms = performance.now() - t;
  assert.equal(r.invoices.length, 200);
  assert.equal(new Set(r.invoices.map((i) => i.batch_run_id)).size, 1, 'one batch');
  assert.ok(ms < 3000, `${Math.round(ms)} ms`);
  resetStorage(); installSettings();
  localDb.settings.save({ ...localDb.settings.get(), society_kind: 'chs' });
  mk(5);
  saveSocietySettings({ state: '27', heads: SEED, run_limit: 2 });
  assert.deepEqual([issueRun(OCT).invoices.length, issueRun(OCT).invoices.length, issueRun(OCT).invoices.length, issueRun(OCT).run], [2, 2, 1, undefined], 'each run picks up where the last stopped');
});
