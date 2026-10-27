/** CN-A4: the abstract inside the document — sections, deviation split, substituted items, snapshot stability. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupWorks } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { cancelDocument } from '../src/lib/documents.ts';
import { saveRaBill } from '../src/lib/works/measurements.ts';
import { abstractGrand, abstractSections, deviationSplit, deviationWarnings, itemKind } from '../src/lib/construction/cn-abstract.ts';
import { recomputeDraftSnapshot } from '../src/lib/construction/cn-snapshot.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

let boq: InvoiceRecord;
beforeEach(() => { boq = setupWorks(); });

const cnOf = (id: string) => localDb.invoices.getById(id)!.boq_terms!.cn!;

test('deviation split at the limit (cumulative, never counted twice)', () => {
  assert.deepEqual(deviationSplit(1000, 900, 1100, 25), { within: 200, deviation: 0, limit: 1250 });
  assert.deepEqual(deviationSplit(1000, 900, 1300, 25), { within: 350, deviation: 50, limit: 1250 });
  assert.deepEqual(deviationSplit(1000, 1300, 1400, 25), { within: 0, deviation: 100, limit: 1250 }, 'limit crossed on an earlier bill');
  const w = deviationWarnings(boq, [{ line_id: 'l1', cumulative_qty: 1300 }, { line_id: 'l2', cumulative_qty: 240 }], 25);
  assert.deepEqual(w.map((x) => [x.line_id, x.limit]), [['l1', 1250]], 'l2 at 240 / limit 250 is fine');
});

test('sections and sub-totals equal the bill; quantity beyond 25% becomes its own deviation line', () => {
  const r = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 1300, extra_reason: 'VO-3', mb_ref: '112/45-47' }, { line_id: 'l2', cumulative_qty: 50 }] });
  const items = r.invoice.items.map((i) => [i.name, i.quantity, itemKind(i, r.invoice.boq_terms!.cn!.lines)]);
  assert.deepEqual(items, [['Earthwork excavation', 1000, 'boq'], ['Extra item — Earthwork excavation', 250, 'extra'], ['Deviation — Earthwork excavation', 50, 'deviation'], ['PCC 1:4:8', 50, 'boq']]);
  const cn = cnOf(r.invoice.id);
  const secs = abstractSections(cn.abstract!);
  assert.deepEqual(secs.map((s) => s.kind), ['boq', 'extra', 'deviation']);
  assert.equal(abstractGrand(cn.abstract!).this, r.invoice.taxable_value, 'this-bill column = taxable value');
  assert.equal(secs.reduce((s, x) => s + x.this, 0), r.invoice.taxable_value);
  const dev = cn.abstract!.find((x) => x.kind === 'deviation')!;
  assert.equal(dev.this_qty, 50);
  assert.equal(dev.mb, '112/45-47');
  assert.equal(cn.deviation_pct, 25);
});

test('a substituted item replaces its BOQ line in the "previous" maths', () => {
  saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l2', cumulative_qty: 40 }] });
  const r2 = saveRaBill(boq.id, { date: '2026-07-31', lines: [{ line_id: 'l2', cumulative_qty: 90, kind: 'substituted', approval: 'SE/77', substitutes: '2.2' }] });
  const rows = cnOf(r2.invoice.id).abstract!;
  assert.equal(rows.some((x) => x.id === 'l2'), false, 'the BOQ row moved to section C');
  const sub = rows.find((x) => x.kind === 'substituted')!;
  assert.deepEqual([sub.prev_qty, sub.this_qty, sub.cum_qty, sub.approval], [40, 50, 90, 'SE/77']);
  assert.match(sub.description, /substituted/);
});

test('the abstract is a snapshot: cancelling another bill never changes an issued bill', () => {
  const r1 = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] });
  const r2 = saveRaBill(boq.id, { date: '2026-07-31', lines: [{ line_id: 'l1', cumulative_qty: 700 }] });
  const r3 = saveRaBill(boq.id, { date: '2026-08-31', lines: [{ line_id: 'l1', cumulative_qty: 900 }] });
  const before = JSON.stringify(cnOf(r2.invoice.id));
  cancelDocument(localDb.invoices.getById(r3.invoice.id)!, 'Revised'); // a later bill
  assert.equal(JSON.stringify(cnOf(r2.invoice.id)), before);
  cancelDocument(localDb.invoices.getById(r1.invoice.id)!, 'Revised'); // even an earlier one
  assert.equal(JSON.stringify(cnOf(r2.invoice.id)), before, 'issued bill prints as certified');
  const row = cnOf(r2.invoice.id).abstract!.find((x) => x.id === 'l1')!;
  assert.deepEqual([row.prev_qty, row.this_qty, row.cum_qty, row.pct], [400, 300, 700, 70]);
  assert.throws(() => recomputeDraftSnapshot(r2.invoice.id), /draft/);
});

test('"Recompute" re-snapshots a draft RA bill only', () => {
  const r1 = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] });
  const d = saveRaBill(boq.id, { date: '2026-07-31', draft: true, lines: [{ line_id: 'l1', cumulative_qty: 700 }] });
  cancelDocument(localDb.invoices.getById(r1.invoice.id)!, 'Revised');
  const again = recomputeDraftSnapshot(d.invoice.id);
  const row = again.boq_terms!.cn!.abstract!.find((x) => x.id === 'l1')!;
  assert.deepEqual([row.prev_qty, row.cum_qty], [0, 300]);
  assert.equal(again.boq_terms!.cn!.lines![d.invoice.items[0].id].prev_qty, 0);
});
