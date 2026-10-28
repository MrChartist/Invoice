/** R5-C1: fee plans, enrolment, the billing run (BOS / tax invoice / both), idempotency, undo, fines, dues, CSV enrol. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { feeCtx, setupR5c } from './helpers/r5c.ts';
import { localDb } from '../src/lib/localDb.ts';
import { equalShares, fineDue, instalmentLines, loadPlans, savePlan, splitByTax, validatePlan } from '../src/lib/institutions/fee-plans.ts';
import { applyConcessions, bulkEnrol, enrol, enrolRowsFromCsv, mapEnrolColumns, recordVisit, studentsOf } from '../src/lib/institutions/enrolments.ts';
import { addFine, issueFeeRun, loadFeeRuns, planFeeRun, undoFeeRun } from '../src/lib/institutions/fee-billing.ts';
import { ageBucket, feeDues, feeNotices, sessionsLeft } from '../src/lib/institutions/fee-dues.ts';
import { buildGstReport, periodForDate } from '../src/lib/gst-reports.ts';
import { buildReceipt } from '../src/lib/receipts.ts';
import type { FeePlan } from '../src/types/institutions-r5.ts';

beforeEach(() => setupR5c());

const plan = (over: Partial<FeePlan> = {}): FeePlan => savePlan({
  name: 'Class 6', year_label: '2026-27', preset: 'education',
  heads: [
    { name: 'Tuition', amount: 48000, tax: 'exempt', frequency: 'per_instalment', sac: '9992' },
    { name: 'Admission kit', amount: 1000, tax: 'exempt', frequency: 'once' },
    { name: 'Coaching', amount: 9000, tax: 'taxable', gst_rate: 18, frequency: 'per_instalment' },
  ],
  instalments: [{ label: 'Q1', due_date: '2026-06-10', share: 33.33 }, { label: 'Q2', due_date: '2026-09-10', share: 33.33 }, { label: 'Q3', due_date: '2026-12-10', share: 33.34 }],
  fine: { kind: 'per_day', amount: 50, grace_days: 5, cap: 500 },
  ...over,
});

const student = (name: string, roll: string, concessions = [] as { kind: 'pct' | 'amount'; value: number; reason: string; head?: string }[], planId = loadPlans()[0].id) =>
  localDb.clients.getById(enrol({ name, roll_no: roll, class_label: '6-A', guardian: { name: 'Parent', phone: '9876543210' } }, { plan_id: planId, from: '2026-04-01', concessions }))!;

test('shares must sum to 100; equal shares round on the last instalment', () => {
  assert.ok(validatePlan({ name: 'X', heads: [{ name: 'T', amount: 1, tax: 'exempt', frequency: 'once' }], instalments: [{ label: 'a', due_date: '2026-05-01', share: 60 }] }).includes('shares'));
  assert.throws(() => savePlan({ name: 'X', year_label: '', heads: [{ name: 'T', amount: 1, tax: 'taxable', frequency: 'once' }], instalments: [{ label: 'a', due_date: '2026-05-01', share: 100 }] }), /rate/);
  const s = equalShares(3);
  assert.equal(Math.round(s.reduce((a, b) => a + b, 0) * 100) / 100, 100);
});

test('once-heads go on the first instalment; per-instalment heads add up to the head exactly', () => {
  const p = plan();
  const lines = [0, 1, 2].map((i) => instalmentLines(p, i));
  assert.ok(lines[0].some((l) => l.head.name === 'Admission kit'));
  assert.ok(!lines[1].some((l) => l.head.name === 'Admission kit'));
  const tuition = lines.flat().filter((l) => l.head.name === 'Tuition').reduce((s, l) => s + l.amount, 0);
  assert.equal(Math.round(tuition * 100) / 100, 48000);
  const split = splitByTax(lines[0]);
  assert.equal(split.bos.length, 2);
  assert.equal(split.tax.length, 1);
  assert.equal(split.exemptKind, 'EXEMPT');
});

test('concessions: pct on a named head, amount over the heads in order, never below zero', () => {
  const p = plan();
  const l = applyConcessions(instalmentLines(p, 0), [{ kind: 'pct', head: 'Tuition', value: 10, reason: 'Sibling' }, { kind: 'amount', value: 99999, reason: 'Staff' }]);
  const t = l.find((x) => x.head.name === 'Tuition')!;
  assert.ok(t.note.includes('Sibling 10%'));
  assert.ok(l.every((x) => x.discount <= x.amount && x.amount - x.discount >= 0));
  assert.ok(l.every((x) => x.amount - x.discount === 0), 'the big amount concession uses everything up');
});

test('billing run: exempt → Bill of Supply, taxable → tax invoice, mixed → two documents; idempotent; undo cancels', () => {
  const p = plan();
  const a = student('Asha', '12', [{ kind: 'pct', head: 'Tuition', value: 10, reason: 'Sibling' }]);
  student('Ravi', '13');
  const coachOnly = savePlan({ name: 'Coaching only', year_label: '', heads: [{ name: 'Coaching', amount: 1000, tax: 'taxable', gst_rate: 18, frequency: 'once' }], instalments: [{ label: 'I', due_date: '2026-06-10', share: 100 }] });
  const k = localDb.clients.getById(enrol({ name: 'Kiran', roll_no: '7', class_label: '6-A' }, { plan_id: coachOnly.id, from: '2026-04-01', concessions: [] }))!;
  const run = planFeeRun(p, 0, studentsOf(p.id, localDb.clients.getAll()), localDb.invoices.getAll(), feeCtx('2026-06-01'));
  assert.equal(run.drafts.length, 4, 'two students × (BOS + tax invoice)');
  const { invoices } = issueFeeRun(p, 0, run, '2026-06-01');
  const bos = invoices.filter((i) => i.doc_type === 'BILL_OF_SUPPLY');
  assert.equal(bos.length, 2);
  assert.ok(bos.every((i) => i.exempt_kind === 'EXEMPT' && i.tax_amount === 0 && i.fee_plan_id === p.id && i.fee_instalment === 0 && /^\S+\/FY26-27\/\d{4}$/.test(i.invoice_number)));
  const tax = invoices.filter((i) => i.doc_type === 'TAX_INVOICE');
  assert.equal(tax.length, 2);
  assert.ok(tax.every((i) => i.tax_amount > 0));
  const asha = bos.find((i) => i.client.id === a.id)!;
  assert.equal(asha.total, 15398.56, '48,000 × 33.33% less 10% sibling concession + the once-head (rate reduced, reason printed)');
  assert.ok(asha.items.some((i) => i.description?.includes('Sibling')));
  assert.equal(asha.client.roll_no, '12');
  // Idempotent: billing again skips both students.
  const again = planFeeRun(p, 0, studentsOf(p.id, localDb.clients.getAll()), localDb.invoices.getAll(), feeCtx('2026-06-02'));
  assert.equal(again.drafts.length, 0);
  assert.equal(again.skipped.filter((s) => s.reason === 'billed').length, 2);
  // Coaching-only plan: one tax invoice.
  const c = planFeeRun(coachOnly, 0, [k], localDb.invoices.getAll(), feeCtx('2026-06-01'));
  assert.deepEqual(c.drafts.map((d) => d.record.doc_type), ['TAX_INVOICE']);
  // The receipt "for" line carries roll no. and class.
  const kDoc = issueFeeRun(coachOnly, 0, c, '2026-06-01').invoices[0];
  const pay = localDb.payments.record({ invoiceId: kDoc.id, amount: 100, method: 'Cash', date: '2026-06-05' });
  assert.match(buildReceipt(localDb.invoices.getById(kDoc.id)!, pay, localDb.payments.getAll()).forLine ?? '', /Roll no\. 7 · Class 6-A/);
  // Undo: issued documents cancelled (never deleted), run marked undone, the instalment can be billed again.
  const r = loadFeeRuns().find((x) => x.plan_id === p.id)!;
  assert.throws(() => undoFeeRun(r.id, ''), /reason/);
  const res = undoFeeRun(r.id, 'Wrong date');
  assert.ok(res.cancelled >= 3);
  assert.ok(loadFeeRuns().find((x) => x.id === r.id)!.undone);
  assert.equal(planFeeRun(p, 0, studentsOf(p.id, localDb.clients.getAll()), localDb.invoices.getAll(), feeCtx('2026-06-03')).drafts.length, 4, 'cancelled documents no longer count');
});

test('GSTR-1 Table 8 shows the fee Bill of Supply as exempt', () => {
  const p = plan({ heads: [{ name: 'Tuition', amount: 30000, tax: 'exempt', frequency: 'per_instalment' }] });
  student('Asha', '1', [], p.id);
  issueFeeRun(p, 0, planFeeRun(p, 0, studentsOf(p.id, localDb.clients.getAll()), [], feeCtx('2026-06-01')), '2026-06-01');
  const g1 = buildGstReport(localDb.invoices.getAll(), [], { period: periodForDate('month', '2026-06-01') }).gstr1;
  const exempt = g1.nil.reduce((s, r) => s + r.exempt, 0);
  assert.equal(exempt, 9999, '30,000 × 33.33%');
});

test('QA6 F13: nil-rated and exempt heads go on two Bills of Supply; GSTR-1 Table 8 splits them; a re-run bills neither again', () => {
  const p = plan({
    heads: [{ name: 'Consultation', amount: 1000, tax: 'exempt', frequency: 'per_instalment' }, { name: 'Fresh produce', amount: 500, tax: 'nil', frequency: 'per_instalment' }],
    instalments: [{ label: 'Visit', due_date: '2026-06-10', share: 100 }], fine: undefined,
  });
  assert.deepEqual(splitByTax(instalmentLines(p, 0)).byKind.map((g) => [g.kind, g.lines.map((l) => l.head.name)]), [['EXEMPT', ['Consultation']], ['NIL', ['Fresh produce']]]);
  student('Pat', 'P1', [], p.id);
  const res = issueFeeRun(p, 0, planFeeRun(p, 0, studentsOf(p.id, localDb.clients.getAll()), [], feeCtx('2026-06-01')), '2026-06-01');
  assert.deepEqual(res.invoices.map((i) => [i.doc_type, i.exempt_kind, i.total]).sort(), [['BILL_OF_SUPPLY', 'EXEMPT', 1000], ['BILL_OF_SUPPLY', 'NIL', 500]]);
  const g1 = buildGstReport(localDb.invoices.getAll(), [], { period: periodForDate('month', '2026-06-01') }).gstr1;
  assert.equal(g1.nil.reduce((s, r) => s + r.exempt, 0), 1000);
  assert.equal(g1.nil.reduce((s, r) => s + r.nil, 0), 500);
  const again = planFeeRun(p, 0, studentsOf(p.id, localDb.clients.getAll()), localDb.invoices.getAll(), feeCtx('2026-06-02'));
  assert.equal(again.drafts.length, 0, 'idempotent per kind');
});

test('QA6 F13: a student billed before the split (one EXEMPT bill holding the nil head) is not billed the nil head again', () => {
  const p = plan({
    heads: [{ name: 'Consultation', amount: 1000, tax: 'exempt', frequency: 'per_instalment' }, { name: 'Fresh produce', amount: 500, tax: 'nil', frequency: 'per_instalment' }],
    instalments: [{ label: 'Visit', due_date: '2026-06-10', share: 100 }], fine: undefined,
  });
  const s = student('Pat', 'P1', [], p.id);
  const legacy = { id: 'old', invoice_number: 'BOS/1', doc_type: 'BILL_OF_SUPPLY', status: 'Sent', exempt_kind: 'EXEMPT', fee_plan_id: p.id, fee_instalment: 0, client: s, items: [{ name: 'Consultation' }, { name: 'Fresh produce' }] };
  assert.equal(planFeeRun(p, 0, [s], [legacy as never], feeCtx('2026-06-02')).drafts.length, 0);
});

test('fines: grace days, per day, cap; shown in dues, added only on click (once)', () => {
  const p = plan();
  assert.equal(fineDue(p.fine, '2026-06-10', '2026-06-15'), 0, 'inside grace');
  assert.equal(fineDue(p.fine, '2026-06-10', '2026-06-18'), 150);
  assert.equal(fineDue(p.fine, '2026-06-10', '2026-09-01'), 500, 'capped');
  assert.equal(fineDue({ kind: 'flat', amount: 200, grace_days: 0 }, '2026-06-10', '2026-06-11'), 200);
  const s = student('Asha', '12');
  issueFeeRun(p, 0, planFeeRun(p, 0, [s], [], feeCtx('2026-06-01')), '2026-06-01');
  const dues = feeDues(localDb.invoices.getAll(), localDb.clients.getAll(), loadPlans(), '2026-07-20');
  assert.equal(dues.length, 1);
  assert.equal(dues[0].days, 40);
  assert.equal(dues[0].fine, 500);
  assert.equal(ageBucket(dues[0].days), 1);
  assert.equal(localDb.invoices.getAll().filter((i) => i.late_fee_for).length, 0, 'never added silently');
  const fine = addFine(p, 0, s, dues[0].against!, feeCtx('2026-07-20'), localDb.invoices.getAll());
  assert.equal(fine.late_fee_for, dues[0].against!.id);
  assert.throws(() => addFine(p, 0, s, dues[0].against!, feeCtx('2026-07-21'), localDb.invoices.getAll()));
  assert.equal(feeDues(localDb.invoices.getAll(), localDb.clients.getAll(), loadPlans(), '2026-07-20')[0].fine, 0);
  assert.equal(feeNotices(loadPlans(), localDb.clients.getAll(), localDb.invoices.getAll(), '2026-07-20').overdue, 1);
});

test('bulk enrol from CSV (header synonyms) and clinic package sessions', () => {
  const p = plan({ heads: [{ name: 'Physio package', amount: 5000, tax: 'exempt', frequency: 'once', sessions: 2 }], instalments: [{ label: 'Pkg', due_date: '2026-06-10', share: 100 }] });
  const headers = ['Student Name', 'Roll No', 'Class', 'Father Name', 'Mobile'];
  assert.deepEqual(mapEnrolColumns(headers), { name: 0, roll_no: 1, class_label: 2, guardian: 3, phone: 4 });
  const n = bulkEnrol(enrolRowsFromCsv(headers, [['Meera', '21', '7-B', 'Suresh', '9000000001'], ['', 'x'], ['Om', '22', '7-B', 'Raj', '9000000002']]), { plan_id: p.id, from: '2026-04-01' });
  assert.equal(n, 2);
  const meera = localDb.clients.getAll().find((c) => c.name === 'Meera')!;
  assert.equal(meera.guardian?.phone, '9000000001');
  assert.equal(studentsOf(p.id, localDb.clients.getAll(), '7-b').length, 2);
  assert.equal(recordVisit(meera.id!, p.id, '2026-06-02', 2), 1);
  assert.deepEqual(sessionsLeft(localDb.clients.getById(meera.id!)!, p), { total: 2, left: 1 });
  recordVisit(meera.id!, p.id, '2026-06-09', 2);
  assert.throws(() => recordVisit(meera.id!, p.id, '2026-06-16', 2), /noSessions/);
});
