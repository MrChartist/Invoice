/**
 * R19-C1 / C3 disbursements on the client's behalf: the expense row (no ITC, pure agent, billable, `lg.on_behalf`), the
 * Rule 33 checklist (warns), billed state derived from live invoices (cancel frees), ageing, write-off, the Rule 33
 * bill lines (B's seam) and the printed schedule.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { clientMH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { loadJobs, saveJob } from '../src/lib/logistics/lg-save.ts';
import { ageBuckets, billedBy, disbCharges, disbRecord, disbRows, disbSchedule, rule33Gaps, unrecovered, validateDisb, type LgDisbRow } from '../src/lib/logistics/lg-disb.ts';
import { addDisbursement, importDocRefs, loadDisb, writeOffDisb } from '../src/lib/logistics/lg-recv-io.ts';
import { billJob } from '../src/lib/logistics/lg-issue-io.ts';
import { addDefaultHeads } from '../src/lib/logistics/lg-settings.ts';
import { defaultHeads } from '../src/lib/logistics/lg-heads.ts';
import { isPureAgentLine } from '../src/lib/trade/pure-agent.ts';
import type { LgJob } from '../src/types/logistics-r19.ts';

const D = '2026-11-05';
let job: LgJob;
beforeEach(() => {
  resetStorage();
  freezeDate(`${D}T12:00:00`);
  installSettings({ business_type: 'transport', logistics_kind: 'cha', industry_packs: ['logistics', 'customs'] } as never);
  localDb.clients.upsert(clientMH);
  job = saveJob({ date: D, status: 'arrived', dir: 'import', mode: 'sea_fcl', origin: 'NSA', destination: 'BOM', client_id: clientMH.id!, refs: { boe_no: '7654321', boe_date: D } }).job;
});
afterEach(() => thawDate());

test('the expense row: 0 %, no ITC, pure agent, billable to the job client, lg on behalf; validation', () => {
  const r = disbRecord({ job, kind: 'duty', payee: 'Customs (ICEGATE)', ref: '1234567', amount: 185430, date: D, in_client_name: true });
  assert.deepEqual([r.kind, r.total, r.taxable, r.cgst + r.sgst + r.igst, r.itc_eligible, r.pure_agent, r.billable_to_client_id, r.bill_number], ['EXPENSE', 185430, 185430, 0, false, true, clientMH.id, '1234567']);
  assert.deepEqual(r.lg, { job_id: job.id, disb: 'duty', on_behalf: true, ref: '1234567', in_client_name: true });
  assert.equal(r.lines[0].tax_rate, 0);
  assert.equal(disbRecord({ job, kind: 'cfs', payee: 'CFS', amount: 1, date: D }).bill_number, job.number, 'no ref: the job number');
  assert.equal(validateDisb({ job, kind: 'duty', payee: '', amount: 0, date: '' }).length, 3);
  assert.deepEqual(validateDisb({ job, kind: 'duty', payee: 'x', amount: 1, date: D }), []);
});

test('Rule 33 checklist: limbs (i), (iii), (iv) warn; (ii) is automatic', () => {
  assert.deepEqual(rule33Gaps({ extra: true, inName: true }), [1]);
  assert.deepEqual(rule33Gaps({ auth: { ref: 'Letter 12' }, extra: false, inName: false }), [3, 4]);
  assert.deepEqual(rule33Gaps({ auth: { date: D }, extra: true, inName: true }), []);
});

test('saved with its payment; billed by a live invoice line, freed when it is cancelled; write-off leaves the list', () => {
  const duty = addDisbursement({ job, kind: 'duty', payee: 'Customs (ICEGATE)', ref: '1234567', amount: 185430, date: D, in_client_name: true }, { method: 'Bank transfer' });
  const cfs = addDisbursement({ job, kind: 'cfs', payee: 'Demo CFS', ref: 'CFS/77', amount: 12000, date: D, in_client_name: true });
  assert.equal(purchasesDb.get(duty.id)?.amount_paid, 185430, 'paid from our account');
  assert.equal(purchasesDb.get(cfs.id)?.amount_paid, 0);
  assert.deepEqual(unrecovered(loadDisb(D)).map((r) => [r.kind, r.amount]), [['duty', 185430], ['cfs', 12000]]);
  addDefaultHeads(D);
  const j2 = saveJob({ ...job, charges: [{ head_id: 'lg-clearance', qty: 1, rate: 6000, currency: 'INR', amount: 6000 }] }).job;
  const r = billJob(j2.id, { date: D });
  assert.deepEqual(r.errors, []);
  assert.equal(r.invoices.length, 1, 'R19-B bills the job: agency charges and both recoveries on the domestic document');
  const inv = r.invoices[0];
  const pa = inv.items.filter((l) => isPureAgentLine(l));
  assert.ok(pa.length === 2 && pa.every((l) => l.tax_rate === 0 && l.charge_head_id === 'rule33'));
  assert.deepEqual(pa.map((l) => l.bill_refs), [[duty.id], [cfs.id]]);
  assert.deepEqual(inv.lg?.disb?.map((d) => [d.kind, d.ref, d.payee, d.amount]), [['duty', '1234567', 'Customs (ICEGATE)', 185430], ['cfs', 'CFS/77', 'Demo CFS', 12000]]);
  assert.equal(inv.total, 204510, 'agency ₹6,000 + GST ₹1,080 + ₹1,97,430 at actual');
  assert.deepEqual(unrecovered(loadDisb(D)), [], 'billed');
  assert.equal(billJob(j2.id, { date: D }).invoices.length, 0, 'bill again: nothing left');
  const d3 = addDisbursement({ job, kind: 'duty', payee: 'Customs (ICEGATE)', ref: '7777777', amount: 1000, date: D, in_client_name: true });
  const again = billJob(j2.id, { date: D }).invoices;
  assert.deepEqual(again.flatMap((i) => i.items.map((l) => l.bill_refs)), [[d3.id]], 'a later duty payment bills although the duty head is already on a bill');
  localDb.invoices.setStatus(again[0].id, 'Cancelled');
  localDb.invoices.setStatus(inv.id, 'Cancelled');
  assert.equal(unrecovered(loadDisb(D)).length, 3, 'cancelling frees the rows');
  writeOffDisb(cfs.id, D, 'Client wound up');
  assert.deepEqual(unrecovered(loadDisb(D)).map((r) => r.kind), ['duty', 'duty']);
  assert.throws(() => writeOffDisb(cfs.id, D, 'again'));
  assert.throws(() => writeOffDisb(duty.id, D, ' '), /reason/);
});

test('ageing buckets and the printed schedule', () => {
  const row = (age: number, amount: number) => ({ age, amount });
  assert.deepEqual(ageBuckets([row(0, 1), row(30, 2), row(31, 4), row(90, 8), row(91, 16)]), [3, 4, 8, 16]);
  const src = [{ id: 'a', lg: { job_id: 'j', disb: 'port' as const, on_behalf: true }, client_id: 'c', date: '2026-08-01', total: 100, payee: 'JNPA', void: false }, { id: 'v', lg: { job_id: 'j', disb: 'port' as const, on_behalf: true }, date: D, total: 5, payee: '', void: true }, { id: 'n', date: D, total: 5, payee: '', void: false }];
  const rows: LgDisbRow[] = disbRows(src, () => false, D);
  assert.deepEqual(rows.map((r) => [r.id, r.age]), [['a', 96]], 'void and untagged rows are left out');
  const ch = disbCharges(rows, defaultHeads(D));
  assert.deepEqual(ch.map((c) => [c.head_id, c.amount, c.disb_id, c.note]), [['lg-port', 100, 'a', 'JNPA']]);
  assert.deepEqual(disbCharges(rows, []), [], 'no pure-agent head: stays unrecovered');
  const s = disbSchedule({ disb: ch.map((c) => c.disb!) });
  assert.deepEqual(s, { rows: [['01/08/2026', 'Port charges', '', 'JNPA', 100]], total: 100 });
  assert.deepEqual(disbSchedule({}), { rows: [], total: 0 });
});

test('SB / BOE import writes the job refs (all or nothing)', () => {
  const r = importDocRefs(`Job No,BOE No,BOE Date,IGM\n${job.number},8889990,04/11/2026,2345\nJOB/FY26-27/0099,1,,\n`);
  assert.deepEqual([r.updated, r.errors], [1, ['Row 3: job not found']]);
  assert.deepEqual(loadJobs()[0].refs, { boe_no: '8889990', boe_date: '2026-11-04', igm: '2345' });
});

test('billed test: a live line naming the row, or a live rebilled_in invoice without bill_refs; cancelled frees', () => {
  const inv = (id: string, status: string, refs?: string[]) => ({ id, status, items: [{ bill_refs: refs }] }) as never;
  const billed = billedBy([inv('i1', 'Sent', ['a']), inv('i2', 'Cancelled', ['b']), inv('i3', 'Sent'), inv('i4', 'Sent', ['z'])], new Map([['c', 'i3'], ['d', 'i4'], ['e', 'gone']]));
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map(billed), [true, false, true, false, false]);
});
