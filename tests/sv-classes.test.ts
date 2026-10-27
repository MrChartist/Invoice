/** SV-C3 classes, batches, PT sessions and coaching refunds. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { FeePlan } from '../src/types/institutions-r5.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import { dropMember, enrolMember, feeIncreaseWarning, loadClasses, occurrences, saveClass, setBatch, studentsOfBatch } from '../src/lib/services/sv-classes.ts';
import { coachingRefund, issueCoachingRefund, markRefundPaid, refundBasis } from '../src/lib/services/sv-coaching-refund.ts';
import { redeemPatch, saveMemberPlan } from '../src/lib/services/sv-members.ts';
import { sellPlan } from '../src/lib/services/sv-memberships.ts';
import { commissionFor } from '../src/lib/services/sv-commission.ts';
import { savePlan } from '../src/lib/institutions/fee-plans.ts';
import { enrol } from '../src/lib/institutions/enrolments.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('occurrences over weekdays inside the dates, holidays skipped', () => {
  const c = { days: [0, 2, 4], from: '2026-06-03', to: '2026-06-12', holidays: ['2026-06-05'] };
  assert.deepEqual(occurrences(c, '2026-06-01', '2026-06-30'), ['2026-06-03', '2026-06-08', '2026-06-10', '2026-06-12']);
});

test('capacity and wait-list: the first waiting member moves up when a place frees', () => {
  const c = saveClass({ name: 'Morning Hatha', kind: 'class', days: [0, 1, 2, 3, 4], start: '06:30', minutes: 60, capacity: 2 });
  assert.equal(enrolMember(c.id, 'a'), 'member');
  assert.equal(enrolMember(c.id, 'b'), 'member');
  assert.equal(enrolMember(c.id, 'c'), 'waitlist');
  assert.equal(enrolMember(c.id, 'd'), 'waitlist');
  assert.throws(() => enrolMember(c.id, 'a'), /Already/);
  dropMember(c.id, 'a');
  const after = loadClasses()[0];
  assert.deepEqual([after.members, after.waitlist], [['b', 'c'], ['d']]);
  dropMember(c.id, 'd');
  assert.deepEqual(loadClasses()[0].waitlist, []);
  assert.throws(() => saveClass({ name: 'x', kind: 'class', days: [], start: '06:30', minutes: 60 }), /days/);
});

test('PT sessions: a trainer package; each redeemed session earns the trainer commission on price ÷ sessions', () => {
  const plan = saveMemberPlan({ name: 'PT 12', kind: 'package', sessions: 12, price: 12000, trainer_id: 't1' });
  const m = sellPlan({ plan_id: plan.id, client_name: 'Ravi', start: '2026-05-01' });
  assert.equal(m.trainer_id, 't1');
  const base = localDb.invoices.getById(m.invoice_ids[0])!;
  const line = { ...base.items[0], id: 'l1', name: 'PT session', sv: { staff_id: 't1' } };
  const bill = { ...base, id: 'b1', invoice_number: 'INV/1', sv: undefined, items: [{ ...line, ...redeemPatch(m, line, '2026-05-02', 0) }] } as InvoiceRecord;
  const st = commissionFor({ id: 't1', plan_id: 'cp' }, '2026-05', { invoices: [bill], payments: [], plans: [{ id: 'cp', name: 'PT', basis: 'invoice', rules: [{ kind: 'package_redemption', pct: 20 }], created_at: '' }] });
  assert.equal(st.total, 200, '20% of ₹1,000 a session');
});

const feePlan = (): FeePlan => savePlan({
  name: 'JEE 2027', year_label: '2026-27', preset: 'coaching',
  heads: [{ name: 'Registration', amount: 2000, tax: 'taxable', gst_rate: 18, frequency: 'once' }, { name: 'Tuition', amount: 100000, tax: 'taxable', gst_rate: 18, frequency: 'per_instalment' }, { name: 'Hostel', amount: 50000, tax: 'exempt', frequency: 'per_instalment' }],
  instalments: [{ label: 'Full', due_date: '2026-06-01', share: 100 }],
});

test('refund by days and by months; non-refundable heads; 10-day due date', () => {
  const byMonths = coachingRefund({ from: '2026-06-01', to: '2027-03-31', leave: '2026-08-31', request: '2026-09-02', course: 150000, paid: 150000, basis: 'months' });
  assert.deepEqual(byMonths, { used: 3, total: 10, amount: 105000, due: '2026-09-12', basis: 'months' });
  const byDays = coachingRefund({ from: '2026-06-01', to: '2026-06-30', leave: '2026-06-10', request: '2026-06-11', course: 3000, paid: 3000 });
  assert.equal(byDays.amount, 2000);
  assert.equal(coachingRefund({ from: '2026-06-01', to: '2027-03-31', leave: '2026-08-31', request: '2026-09-02', course: 150000, paid: 30000, basis: 'months' }).amount, 0, 'paid only for the used months');
});

test('credit note reverses tax on the refundable taxable part only; recorded on the enrolment; fee-increase warning', () => {
  const plan = feePlan();
  const sid = enrol({ name: 'Kiran' }, { plan_id: plan.id, from: '2026-06-01', concessions: [] });
  const s = localDb.clients.getById(sid)!;
  const bill = localDb.invoices.save({
    ...localDb.invoices.getAll()[0], id: 'fee1', invoice_number: '', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-06-01', due_date: '2026-06-01', fee_plan_id: plan.id, fee_instalment: 0,
    client: { ...s, email: '', address: '', city: '', zip: '' }, sender: localDb.settings.activeProfile() ?? null, gst_mode: 'CGST_SGST', currency: 'INR', discount_type: 'PERCENT', discount_rate: 0, shipping: 0, other_charges: 0, amount_paid: 0, tax_rate: 0,
    items: [
      { id: 'r', name: 'Registration', type: 'Service', quantity: 1, rate: 2000, tax_rate: 18, amount: 2000 },
      { id: 't', name: 'Tuition', type: 'Service', quantity: 1, rate: 100000, tax_rate: 18, amount: 100000 },
    ],
  } as InvoiceRecord);
  const b = refundBasis(s, plan, localDb.invoices.getAll());
  assert.deepEqual([b.course, b.paid, b.bills.length], [150000, 100000, 1], 'course: tuition + hostel; paid: tuition (registration kept)');
  const c = saveClass({ name: 'Batch B', kind: 'batch', days: [0, 2, 4], start: '17:00', minutes: 120, fee_plan_id: plan.id, from: '2026-06-01', to: '2027-03-31' });
  setBatch(sid, plan.id, c.id);
  assert.deepEqual(studentsOfBatch(c, localDb.clients.getAll()).map((x) => x.name), ['Kiran']);
  const r = issueCoachingRefund(sid, plan, { from: '2026-06-01', to: '2027-03-31', leave: '2026-06-30', request: '2026-07-01', basis: 'months' });
  assert.equal(r.calc.amount, 85000, '100,000 − 150,000 × 1/10');
  assert.equal(r.notes.length, 1);
  const note = r.notes[0];
  assert.deepEqual(note.items.map((l) => [l.name, l.rate]), [['Tuition', 85000]]);
  assert.equal(Number(note.tax_amount), 15300, '18% reversed on the refunded tuition only');
  assert.equal(note.fee_plan_id, undefined);
  const e = localDb.clients.getById(sid)!.enrolments![0];
  assert.deepEqual([e.refund?.amount, e.refund?.due, e.class_id], [85000, '2026-07-11', c.id]);
  assert.throws(() => issueCoachingRefund(sid, plan, { from: '2026-06-01', to: '2027-03-31', leave: '2026-06-30', request: '2026-07-01' }), /already/);
  markRefundPaid(sid, plan.id, '2026-07-05');
  assert.equal(localDb.clients.getById(sid)!.enrolments![0].refund?.paid_on, '2026-07-05');
  assert.equal(bill.invoice_number.length > 0, true);
  const other = enrol({ name: 'Meena' }, { plan_id: plan.id, from: '2026-06-01', concessions: [] });
  assert.ok(other);
  assert.equal(feeIncreaseWarning(plan, { ...plan, heads: plan.heads.map((h) => ({ ...h, amount: h.amount + 1 })) }, localDb.clients.getAll()), 1, 'one open enrolment (the refunded one is out)');
  assert.equal(feeIncreaseWarning(plan, plan, localDb.clients.getAll()), 0);
});
