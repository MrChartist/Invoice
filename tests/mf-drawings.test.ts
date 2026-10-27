/** MF-B1 drawings and inspection reports: revision status, superseded warning, hold blocks release, tolerance result, heat carried. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import {
  addRevision, currentRev, docRevWarnings, heatsForBatch, holdBlock, loadDrawings, overrideHold, releaseHold, removeDrawing, revWarning, saveDrawing, setHold,
} from '../src/lib/mfg/mf-drawings.ts';
import { attachToInvoice, evaluate, inTol, inspectionSnap, loadReports, removeReport, reportHtml, saveReport } from '../src/lib/mfg/mf-inspection.ts';
import { mfSnapshot } from '../src/lib/mfg/mf-snapshot.ts';
import { clientOf, mfDraft, mfLine, saveDraft } from '../src/lib/mfg/mf-b-docs.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
});

const chars = [
  { id: 'od', name: 'OD', nominal: 300, tol_minus: 0.2, tol_plus: 0.2, unit: 'mm', critical: true },
  { id: 'th', name: 'Thickness', nominal: 20, tol_minus: 0, tol_plus: 0.5, unit: 'mm' },
];

test('revisions: a new one supersedes the current; warnings for superseded / unknown / hold', () => {
  let d = saveDrawing({ number: '1145-B', title: 'Bracket', item_id: 'br', rev: 'B', rev_date: '2026-06-01', characteristics: chars });
  assert.equal(currentRev(d)!.rev, 'B');
  d = addRevision(d.id, { rev: 'c', date: '2026-10-01', note: 'Hole moved' });
  assert.deepEqual(d.revisions.map((r) => [r.rev, r.status]), [['B', 'superseded'], ['C', 'current']]);
  assert.throws(() => addRevision(d.id, { rev: 'C', date: '2026-10-02' }), /already/);
  assert.equal(revWarning(d, 'B'), 'Drawing 1145-B: PO says rev B; current is rev C.');
  assert.equal(revWarning(d, 'C'), '');
  assert.match(revWarning(d, 'Z'), /not in the register/);
  const mf = mfSnapshot('drawing', { lines: { l1: { drawing: '1145-b', rev: 'B' }, l2: { drawing: '1145-B', rev: 'B' } } });
  assert.deepEqual(docRevWarnings(mf, loadDrawings()), ['Drawing 1145-B: PO says rev B; current is rev C.'], 'once per drawing / rev');
  d = setHold(d.id, true);
  assert.equal(currentRev(d)!.status, 'hold');
  assert.match(revWarning(d, 'C'), /on hold/);
});

test('a hold revision blocks the release of an order of its item (fabrication pack only) until released or overridden', () => {
  const d = setHold(saveDrawing({ number: 'D-9', title: 'Shaft', item_id: 'sh' }).id, true);
  assert.match(holdBlock('sh', loadDrawings()), /D-9 rev A is on hold/);
  assert.equal(holdBlock('other', loadDrawings()), '');
  assert.equal(releaseHold('sh'), '', 'pack off: nothing read, nothing blocked');
  localDb.settings.save({ ...localDb.settings.get(), industry_packs: ['shopfloor', 'fabrication'] });
  assert.match(releaseHold('sh'), /on hold/);
  overrideHold(d.id);
  assert.equal(releaseHold('sh'), '', 'owner override for this revision');
  setHold(d.id, false);
  assert.equal(loadDrawings()[0].release_override, undefined, 'released: the override is cleared');
});

test('inspection: readings against tolerance → pass / deviation / fail; FAI numbering; annexure snapshot; delete', () => {
  const d = saveDrawing({ number: '1145-B', title: 'Bracket', characteristics: chars });
  assert.equal(inTol(chars[0], 300.2), true);
  assert.equal(inTol(chars[1], 19.99), false);
  assert.equal(evaluate([{ char_id: 'od', values: [300.1, 299.9] }, { char_id: 'th', values: [20.2] }], chars).suggested, 'pass');
  assert.equal(evaluate([{ char_id: 'od', values: [300.1] }, { char_id: 'th', values: [20.6] }], chars).suggested, 'deviation');
  const ev = evaluate([{ char_id: 'od', values: [300.3, 300] }], chars);
  assert.deepEqual([ev.suggested, ev.outCount, ev.rows[0].out], ['fail', 1, [300.3]]);
  const r = saveReport({ date: '2026-10-27', kind: 'first_article', drawing_id: d.id, rev: 'A', sample: 5, inspector: 'Ravi', readings: [{ char_id: 'od', values: [300.1, 300.3] }] }, d);
  assert.equal(r.number, 'FAI/FY26-27/0001');
  assert.equal(r.result, 'fail');
  assert.equal(saveReport({ date: '2026-10-27', kind: 'lot', drawing_id: d.id, rev: 'A', sample: 5, inspector: 'Ravi', readings: [{ char_id: 'od', values: [300] }], result: 'pass' }, d).number, 'FAI/FY26-27/0002');
  assert.match(reportHtml(r, d, { name: 'Acme' }), /FIRST ARTICLE[\s\S]*300\.3✗[\s\S]*Result: FAIL/);
  const snap = inspectionSnap(r, d);
  assert.equal(snap.report_no, 'FAI/FY26-27/0001 · 1145-B rev A · sample 5');
  assert.deepEqual(snap.rows[0], { label: 'OD (300 ±0.2 mm)', value: '300.1 – 300.3 · 1 out' });
  const inv = saveDraft(mfDraft('INVOICE', '2026-10-27', clientOf(undefined, 'Buyer'), [mfLine({ name: 'Bracket', quantity: 1, rate: 10 })], {}));
  const out = attachToInvoice(r.id, inv.id, d);
  assert.equal(out.mf?.drawing?.inspection?.result, 'fail');
  assert.throws(() => removeDrawing(d.id, loadReports().map((x) => x.drawing_id)), /inspection reports/);
  removeReport(r.id);
  assert.equal(loadReports().length, 1);
  assert.ok(getTable<{ table?: string }>('recycle_bin').length >= 1, 'the deleted report is in the recycle bin');
});

test('heat no. on a bill line reaches the output batch through the order issues', () => {
  const purchases = [
    { id: 'p', kind: 'PURCHASE', date: '2026-10-01', vendor_name: 'Steel Co', taxable: 100, total: 118, lines: [{ id: 'a', name: 'MS bar', item_id: 'ms', batch_no: 'L1', quantity: 10, rate: 10, mf_heat: 'H2231' }, { id: 'b', name: 'MS bar', item_id: 'ms', batch_no: 'L2', quantity: 10, rate: 10, mf_heat: 'H9999' }] },
    { id: 'v', kind: 'PURCHASE', status: 'void', date: '2026-10-01', taxable: 1, total: 1, lines: [{ id: 'c', name: 'MS bar', item_id: 'ms', batch_no: 'L1', quantity: 1, rate: 1, mf_heat: 'VOID' }] },
  ];
  const docs = {
    mfg: [{ item_id: 'br', batch_no: 'WO1-1', production_order_id: 'o1', components: [] }],
    transfers: [{ production_order_id: 'o1', lines: [{ id: 't', item_id: 'ms', qty: 5, batch_no: 'L1' }] }, { production_order_id: 'o2', lines: [{ id: 'u', item_id: 'ms', qty: 5, batch_no: 'L2' }] }],
    purchases,
  };
  assert.deepEqual(heatsForBatch('br', 'wo1-1', docs as never), ['H2231']);
  assert.deepEqual(heatsForBatch('br', 'X', docs as never), []);
});
