/** CN-C3 plans and stage demands: plan sums, one demand per booking on a certificate, land one-third maths (1% / 5%)
 * to the paisa, affordable vs other, after-CC non-GST bill of supply, interest days and GST on it, advance adjustment,
 * an idempotent run, DMD numbering. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { thawDate } from './helpers/shim.ts';
import { book, realtyWorld } from './helpers/realty.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { loadAdvances, advanceBalance } from '../src/lib/advances.ts';
import { certifyStage, parseStages, planTotal, savePlan } from '../src/lib/construction/cn-plans.ts';
import { candidates, delayInterest, demandAgeing, raiseDemands } from '../src/lib/construction/cn-demands.ts';
import { recordReceipt, setInterestWaived } from '../src/lib/construction/cn-bookings.ts';
import { saveProject } from '../src/lib/construction/cn-realty-projects.ts';
import { addUnits, loadUnits } from '../src/lib/construction/cn-units.ts';
import { createBooking, defaultCostSheet } from '../src/lib/construction/cn-bookings.ts';
import { BUYER } from './helpers/realty.ts';

afterEach(() => thawDate());

const cert = (w: ReturnType<typeof realtyWorld>, label: string, on: string) => certifyStage({ project_id: w.project.id, tower_id: w.tower.id, stage_id: w.plan.stages.find((s) => s.label === label)!.id, stage_label: label, certified_on: on, by: 'Architect', ref: 'SC/1' });

test('plans: stages must sum to 100; parse "Plinth 15" lines', () => {
  const st = parseStages('Booking 10\nAgreement: 10\nPlinth 80%');
  assert.deepEqual(st.map((s) => [s.label, s.pct, s.trigger]), [['Booking', 10, 'booking'], ['Agreement', 10, 'agreement'], ['Plinth', 80, 'stage']]);
  assert.equal(planTotal(st), 100);
  realtyWorld();
  assert.throws(() => savePlan({ name: 'Bad', kind: 'clp', stages: parseStages('A 50, B 40') }), /90%, not 100%/);
});

test('a certified stage raises one tax invoice per booking: 5% effective on two-thirds, advance adjusted, run once', () => {
  const w = realtyWorld();
  const b = book(w);
  recordReceipt(b.id, { date: '2026-05-02', amount: 750000, method: 'Bank transfer', bankAccountId: 'rera' });
  const c = cert(w, 'Plinth', '2026-06-01');
  assert.equal(candidates(c).length, 1);
  const [inv] = raiseDemands(c.id, '2026-06-01');
  const d = inv.boq_terms!.cn!.demand!;
  assert.equal(inv.doc_type, 'TAX_INVOICE');
  assert.equal(d.number, 'DMD/FY26-27/0001');
  assert.deepEqual(d.land, { value: 1125000, land: 375000, taxable: 750000, notif: 7.5, effective: 5 });
  assert.equal(inv.taxable_value, 1125000);
  assert.equal(inv.tax_amount, 56250, '7.5% of ₹7,50,000 = 5% of ₹11,25,000');
  assert.equal(inv.cgst_amount, 28125);
  assert.equal(inv.total, 1181250);
  assert.deepEqual([d.unit, d.tower, d.rera_no, d.pct, d.agreement_value, d.demanded, d.previously_received], ['A-101', 'A', 'P52100012345', 15, 7500000, 1125000, 750000]);
  assert.equal(d.account?.name, 'RERA account');
  assert.equal(inv.amount_paid, 750000, 'the booking advance is adjusted');
  assert.equal(advanceBalance(loadAdvances()[0], getTable('transactions'), localDb.invoices.getAll()).open, 0);
  assert.equal(inv.due_date, '2026-06-16');
  assert.throws(() => raiseDemands(c.id, '2026-06-02'), /No booking is left/, 'a stage is demanded once per booking');
  assert.equal(candidates(c)[0].done, true);
});

test('interest on delay: owed on earlier demands × rate × days, a taxable line at the unit rate; waivable', () => {
  assert.equal(delayInterest([{ total: 1181250, due_date: '2026-06-16' }], 750000, '2026-08-01', 10.85)?.amount, Math.round(431250 * 10.85 * 46 / 365) / 100);
  assert.equal(delayInterest([{ total: 100, due_date: '2026-06-16' }], 100, '2026-08-01', 10.85), undefined, 'nothing owed');
  const w = realtyWorld();
  const b = book(w);
  recordReceipt(b.id, { date: '2026-05-02', amount: 750000, method: 'Bank transfer' });
  raiseDemands(cert(w, 'Plinth', '2026-06-01').id, '2026-06-01');
  const [inv] = raiseDemands(cert(w, '1st slab', '2026-08-01').id, '2026-08-01');
  const d = inv.boq_terms!.cn!.demand!;
  assert.deepEqual([d.interest?.days, d.interest?.rate], [46, 10.85]);
  assert.equal(d.interest?.amount, 5896.9);
  assert.equal(inv.items.length, 2);
  assert.equal(inv.items[1].tax_rate, 5, 'interest at the unit rate (Sec 15(2)(d))');
  assert.equal(d.previously_demanded, 1125000);
  assert.equal(d.number, 'DMD/FY26-27/0002');
  setInterestWaived(b.id, true);
  const [inv3] = raiseDemands(cert(w, '2nd slab', '2026-09-01').id, '2026-09-01');
  assert.equal(inv3.boq_terms!.cn!.demand!.interest, undefined, 'waived');
  assert.ok(demandAgeing(localDb.invoices.getAll(), '2026-10-27').length === 1);
});

test('affordable unit: 1% effective (1.5% on two-thirds) to the paisa', () => {
  const w = realtyWorld();
  addUnits({ project_id: w.project.id, tower_id: w.tower.id, tower: 'A', floors: 1, from: 2, perFloor: 1, type: 'residential', carpet_sqm: 55, base_rate: 4000, saleable_sqft: 750 });
  const u = loadUnits().find((x) => x.unit_no === 'A-201')!;
  const b = createBooking({ date: '2026-05-01', unit_id: u.id, client_id: BUYER.id, client_name: BUYER.name, cost_sheet: defaultCostSheet(u).map((h) => (h.head === 'Basic' ? { ...h, amount: 3333333.33 } : h)), plan_id: w.plan.id });
  assert.equal(b.cls, 'realty_affordable');
  const [inv] = raiseDemands(cert(w, 'Plinth', '2026-06-01').id, '2026-06-01');
  const d = inv.boq_terms!.cn!.demand!;
  assert.deepEqual(d.land, { value: 500000, land: 166666.67, taxable: 333333.33, notif: 1.5, effective: 1 });
  assert.equal(inv.tax_amount, 5000);
});

test('after the completion certificate: a non-GST bill of supply "not a supply" (Sch III para 5(b))', () => {
  const w = realtyWorld();
  book(w);
  raiseDemands(cert(w, 'Plinth', '2026-06-01').id, '2026-06-01');
  saveProject({ ...w.project, cc_date: '2026-07-01' });
  const [inv] = raiseDemands(cert(w, '1st slab', '2026-07-01').id, '2026-07-02');
  assert.equal(inv.doc_type, 'BILL_OF_SUPPLY');
  assert.equal(inv.exempt_kind, 'NON_GST');
  assert.equal(inv.tax_amount, 0);
  assert.equal(inv.boq_terms!.cn!.demand!.cc_after, true);
  assert.equal(inv.boq_terms!.cn!.demand!.land, undefined);
  assert.match(inv.notes, /not a supply/);
});
