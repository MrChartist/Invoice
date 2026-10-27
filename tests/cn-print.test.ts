/** CN-A5: deductions grouping, net payable maths and words, notes only when rows exist, certificate defaults. */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupWorks } from './helpers/transport-works.ts';
import { saveBoqTerms } from '../src/lib/works/boq.ts';
import { saveRaBill } from '../src/lib/works/measurements.ts';
import { DEDUCTION_GROUP, deductionNotes, deductionsTotal, defaultCertificateFor, groupDeductions, netPayableOf, netPayableWords } from '../src/lib/construction/cn-print.ts';
import { DEDUCTION_LABELS } from '../src/lib/works/deductions.ts';
import { certificateOf } from '../src/lib/construction/cn-snapshot.ts';
import { DEFAULT_CERTIFICATE } from '../src/lib/construction-rules.ts';
import type { RaDeduction } from '../src/types/transport-works-r5.ts';

const money = (n: number) => `₹${n.toFixed(2)}`;

test('every deduction kind (the six CN-B kinds included) has a group and a label', () => {
  assert.deepEqual(Object.keys(DEDUCTION_GROUP).sort(), Object.keys(DEDUCTION_LABELS).sort());
  const deds: RaDeduction[] = Object.keys(DEDUCTION_GROUP).map((k, i) => ({ kind: k as RaDeduction['kind'], label: k, base: 1000, amount: i + 1 }));
  const g = groupDeductions(deds);
  assert.deepEqual(g.map((x) => x.group), ['statutory', 'recoveries', 'held', 'other']);
  assert.deepEqual(g.find((x) => x.group === 'statutory')!.rows.map((r) => r.kind), ['it_tds', 'gst_tds', 'labour_cess']);
  assert.deepEqual(g.find((x) => x.group === 'held')!.rows.map((r) => r.kind).sort(), ['retention', 'security_deposit', 'withheld']);
  assert.equal(g.reduce((s, x) => s + x.total, 0), deductionsTotal(deds));
});

test('net payable = total − Σ deductions = the stored ra_net_payable; words in the Indian system', () => {
  const boq = setupWorks();
  saveBoqTerms(boq.id, { deductions: [{ kind: 'retention', rate: 5 }, { kind: 'it_tds', section: '194C-2' }, { kind: 'gst_tds' }, { kind: 'labour_cess' }, { kind: 'security_deposit', amount: 5000 }] });
  const r = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] });
  const inv = r.invoice;
  const total = deductionsTotal(inv.ra_deductions);
  assert.equal(netPayableOf(inv), inv.ra_net_payable);
  assert.equal(netPayableOf(inv), Math.round((inv.total - total) * 100) / 100);
  assert.equal(netPayableOf({ total: 1000, ra_deductions: [{ kind: 'retention', label: 'R', base: 1000, amount: 50 }] }), 950, 'fallback without a stored figure');
  assert.equal(netPayableWords(876400), 'Rupees Eight Lakh Seventy Six Thousand Four Hundred Only');
  const notes = deductionNotes(inv.ra_deductions, money);
  assert.equal(notes[0], 'GST is charged on the full bill value; deductions do not reduce it.');
  assert.ok(notes.some((n) => /GST TDS u\/s 51 \(₹2000\.00\).*GSTR-7/.test(n)), notes.join('|'));
  assert.ok(notes.some((n) => /Labour cess deducted at source \(₹1000\.00\)/.test(n)));
});

test('notes only when the rows exist; nothing for a bill without deductions', () => {
  assert.deepEqual(deductionNotes(undefined, money), []);
  assert.deepEqual(deductionNotes([{ kind: 'retention', label: 'Retention 5%', base: 100, amount: 5 }], money), ['GST is charged on the full bill value; deductions do not reduce it.']);
});

test('certificate defaults by kind and settings', () => {
  assert.deepEqual(defaultCertificateFor('civil', true), { text: DEFAULT_CERTIFICATE, boxes: true });
  assert.deepEqual(defaultCertificateFor('builder', false), { boxes: false });
  assert.deepEqual(certificateOf({}), { text: DEFAULT_CERTIFICATE });
  assert.deepEqual(certificateOf({ signoff_boxes: true, certificate_text: 'Own text' }), { text: 'Own text', boxes: true });
  assert.equal(certificateOf({ certificate: false }), undefined);
});
