/**
 * R19-C2 duty deposits (PRD §7 seed): job 0002 — deposit ₹2,00,000 (Receipt Voucher at 0 %, pass-through, no GST),
 * duty ₹1,85,430 + CFS ₹12,000 on behalf, agency ₹6,000 + GST → reimbursement bill ₹2,04,510; applying the deposit
 * leaves ₹4,510 due; the application is an `advance_id` payment every cash reader skips (`movedNoCash`); another job's
 * excess deposit is refunded. Short / excess position and the `deposit_required` hint.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { loadAdvances } from '../src/lib/advances.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import { saveJob } from '../src/lib/logistics/lg-save.ts';
import { applyAmount, depositInput, depositPosition, depositShortfall, DEPOSIT_TEXT } from '../src/lib/logistics/lg-deposits.ts';
import { sumOf, unrecovered } from '../src/lib/logistics/lg-disb.ts';
import { addDeposit, addDisbursement, applyDeposit, jobDisbExtras, jobOpenInvoices, loadDeposits, loadDisb, refundDeposit } from '../src/lib/logistics/lg-recv-io.ts';

const D = '2026-11-05';
const AGENCY = { id: 'ag', type: 'Service', name: 'Agency charges', hsn: '996712', unit: 'NOS', quantity: 1, rate: 6000, tax_rate: 18, discount_percent: 0, amount: 6000 };
const newJob = (n: string) => saveJob({ date: D, status: 'arrived', dir: 'import', mode: 'sea_fcl', origin: 'NSA', destination: 'BOM', client_id: clientMH.id!, refs: { boe_no: n } }).job;
beforeEach(() => {
  resetStorage();
  freezeDate(`${D}T12:00:00`);
  installSettings({ business_type: 'transport', logistics_kind: 'cha', industry_packs: ['logistics', 'customs'] } as never);
  localDb.clients.upsert(clientMH);
});
afterEach(() => thawDate());

test('the deposit input: 0 %, pass-through, the job in lg and the description', () => {
  const i = depositInput({ id: 'j', number: 'JOB/FY26-27/0002' }, { name: 'X' }, '27', { amount: 200000.004, date: D, method: '' });
  assert.deepEqual([i.tax_rate, i.amount, i.method, i.booking, i.lg, i.place_of_supply], [0, 200000, 'Bank transfer', { pass_through: true }, { job_id: 'j' }, '27']);
  assert.equal(i.description, `${DEPOSIT_TEXT} — job JOB/FY26-27/0002`);
  assert.equal(applyAmount(200000, 204510), 200000);
  assert.equal(applyAmount(50000, 4510), 4510);
});

test('seed job 0002: deposit, two disbursements, the reimbursement bill, apply → ₹4,510 due; cash readers skip the application', () => {
  const job = newJob('7654321');
  const adv = addDeposit(job, { amount: 200000, date: D, method: 'Bank transfer', reference: 'UTR 99' });
  assert.deepEqual([adv.tax_rate, adv.pass_through, adv.lg, adv.tax.applies, adv.number], [0, true, { job_id: job.id }, false, 'ADV/FY26-27/0001'], 'no GST on the deposit');
  addDisbursement({ job, kind: 'duty', payee: 'Customs (ICEGATE)', ref: '1234567', amount: 185430, date: D, in_client_name: true }, { method: 'Bank transfer' });
  addDisbursement({ job, kind: 'cfs', payee: 'Demo CFS', ref: 'CFS/77', amount: 12000, date: D, in_client_name: true });
  let pos = depositPosition(loadDeposits(), sumOf(unrecovered(loadDisb(D))));
  assert.deepEqual([pos.received, pos.open, pos.unrecovered, pos.gap, pos.state], [200000, 200000, 197430, 2570, 'excess']);
  const ex = jobDisbExtras(job, D);
  const inv = createViaStore({ date: D, lines: [{ qty: 1, rate: 6000 }], patch: { items: [AGENCY, ...ex.items], lg: { job_id: job.id, job_no: job.number, disb: ex.disb } } });
  assert.equal(inv.total, 204510);
  assert.deepEqual(jobOpenInvoices(job.id).map((i) => i.open), [204510]);
  pos = depositPosition(loadDeposits(), sumOf(unrecovered(loadDisb(D))), 204510);
  assert.deepEqual([pos.unrecovered, pos.gap, pos.state], [0, -4510, 'short'], 'billed: the client has ₹4,510 more to pay');
  const pay = applyDeposit(loadDeposits()[0], inv.id);
  assert.equal(pay.amount, 200000);
  assert.ok(movedNoCash(pay), 'the application moved no money');
  assert.equal(localDb.invoices.getById(inv.id)!.balance_due, 4510);
  assert.deepEqual(jobOpenInvoices(job.id).map((i) => i.open), [4510]);
  assert.equal(loadDeposits()[0].open, 0);
  assert.equal(localDb.payments.getAll().filter((p) => !movedNoCash(p)).length, 0, 'no cash row for the application (the deposit is the receipt)');
  assert.throws(() => applyDeposit({ ...loadDeposits()[0], open: 0 }, 'nope'));
});

test('another job: the excess deposit is refunded with the job in the narration', () => {
  const job = newJob('1111111');
  addDeposit(job, { amount: 50000, date: D, method: 'Cash' });
  addDisbursement({ job, kind: 'duty', payee: 'Customs', amount: 45000, date: D, in_client_name: true });
  const dep = loadDeposits()[0];
  const r = refundDeposit({ ...dep, open: 5000 }, job.number, D, 'Bank transfer');
  assert.deepEqual([r.amount, r.number, r.note], [5000, 'RFV/FY26-27/0001', `Excess duty deposit — job ${job.number}`]);
  assert.deepEqual([loadDeposits()[0].refunded, loadDeposits()[0].open], [5000, 45000]);
  assert.equal(loadAdvances()[0].refunds?.length, 1);
});

test('position chips and the deposit_required hint', () => {
  const d = (open: number) => ({ id: 'a', job_id: 'j', number: 'A', date: D, amount: open, applied: 0, refunded: 0, open });
  assert.equal(depositPosition([d(100)], 100).state, 'even');
  const short = depositPosition([d(100)], 150);
  assert.deepEqual([short.state, short.gap], ['short', -50]);
  assert.equal(depositShortfall({ deposit_required: true }, 'duty', short), 50);
  assert.equal(depositShortfall({ deposit_required: true }, 'cfs', short), 0, 'duty only');
  assert.equal(depositShortfall({}, 'duty', short), 0, 'off by default');
  assert.equal(depositPosition([], 0, 0).state, 'even');
});
