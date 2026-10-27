/** R11 CN-B1 / B5: contract register, header snapshot, delay / LD exposure, EOTs, one contract per BOQ; closure. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupWorks, DEPT } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { saveRaBill } from '../src/lib/works/measurements.ts';
import { cleanContract, contractRules, contractSummary, delayDays, ldExposure, ldFrom, latestCompletion, loadContracts, plusMonths, saveContract } from '../src/lib/construction/cn-contracts.ts';
import { closeContract, closureChecklist, setClosure } from '../src/lib/construction/cn-closure.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { WorksContract } from '../src/types/construction-r11.ts';

let boq: InvoiceRecord;
beforeEach(() => { boq = setupWorks(); });

const base = (over: Partial<WorksContract> = {}) => saveContract({ boq_id: boq.id, client_id: DEPT.id, client_name: DEPT.name, name_of_work: 'Road from A to B', agreement_no: 'EE/12/2026-27', contract_value: 1150000, stipulated_start: '2026-05-01', stipulated_completion: '2026-12-31', ...over });

test('create / edit; derived EOT and JV fields; one contract per BOQ; EOTs in order', () => {
  const c = base({ eots: [{ upto: '2027-03-31', ref: 'EOT-2', with_ld: true }, { upto: '2027-02-28', ref: 'EOT-1' }], jv: { name: 'ABC–XYZ JV', share_pct: 40 } });
  assert.deepEqual(c.eots?.map((e) => e.upto), ['2027-02-28', '2027-03-31'], 'sorted');
  assert.equal(c.extended_completion, '2027-03-31');
  assert.equal(c.jv_note, 'Consortium: ABC–XYZ JV (our share 40%)');
  assert.equal(c.status, 'running');
  const edited = saveContract({ ...c, engineer: 'EE Div 3' });
  assert.equal(loadContracts().length, 1);
  assert.equal(edited.engineer, 'EE Div 3');
  assert.throws(() => saveContract({ ...c, id: undefined }), /already has a contract/);
  assert.throws(() => cleanContract({ name_of_work: 'x', contract_value: 1, stipulated_completion: '2026-12-31', eots: [{ upto: '2026-11-30' }] }), /must be after/);
  assert.throws(() => cleanContract({ name_of_work: '', contract_value: 1 }), /Name of work/);
});

test('header snapshot of an RA bill comes from the contract (agreement, JV note, extended completion)', () => {
  base({ eots: [{ upto: '2027-02-28' }], jv: { name: 'ABC JV', share_pct: 40 }, site: { address: 'NH-48 km 12', state_code: '27' } });
  const inv = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] }).invoice;
  const h = inv.boq_terms?.cn?.header;
  assert.equal(h?.agreement_no, 'EE/12/2026-27');
  assert.equal(h?.name_of_work, 'Road from A to B');
  assert.equal(h?.extended_completion, '2027-02-28');
  assert.match(h?.jv_note ?? '', /ABC JV \(our share 40%\)/);
});

test('delay meter and LD exposure (informational): from the last EOT granted without LD, capped', () => {
  const c = base({ eots: [{ upto: '2027-01-31' }, { upto: '2027-03-31', with_ld: true }], ld: { pct_per_week: 0.5, cap_pct: 10 } });
  assert.equal(latestCompletion(c), '2027-03-31');
  assert.equal(ldFrom(c), '2027-01-31');
  assert.equal(delayDays(c, '2027-03-15'), 0);
  assert.equal(delayDays(c, '2027-04-10'), 10);
  // 70 days = 10 weeks beyond 31 Jan: 11.5 lakh × 0.5% × 10 = ₹57,500
  assert.equal(ldExposure(c, '2027-04-11'), 57500);
  assert.equal(ldExposure(c, '2029-01-01'), 115000, 'capped at 10%');
  assert.equal(ldExposure({ ...c, ld: undefined }, '2027-04-11'), 0);
});

test('contract terms win over the BOQ deduction set (retention, SD, water + electricity) and reach the bill', () => {
  const c = base({ retention_pct: 5, sd_pct: 2.5, water_pct: 1, power_pct: 1 });
  const rules = contractRules([{ kind: 'retention', rate: 10, cap_pct: 5 }], c);
  assert.deepEqual(rules.find((r) => r.kind === 'retention'), { kind: 'retention', rate: 5, cap_pct: 5 });
  assert.equal(rules.find((r) => r.kind === 'water_power')?.rate, 2);
  const inv = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] }).invoice;
  const by = (k: string) => inv.ra_deductions?.find((d) => d.kind === k)?.amount;
  assert.equal(by('retention'), 5000);
  assert.equal(by('security_deposit'), 2500);
  assert.equal(by('water_power'), 2000);
  assert.equal(inv.total, 118000, 'GST on the full value; deductions do not change it');
  const s = contractSummary(c, localDb.invoices.getAll(), getTable<Payment>('transactions'), '2026-07-01');
  assert.equal(s.billed, 100000);
  assert.equal(s.retention, 5000);
});

test('closure checklist: derived, ticked, waived (reason required); closes only when nothing is open', () => {
  assert.equal(plusMonths('2026-08-31', 6), '2027-02-28');
  const c = base({ completed_on: '2026-06-30', dlp_months: 12 });
  saveRaBill(boq.id, { date: '2026-06-30', final: true, lines: [{ line_id: 'l1', cumulative_qty: 1000 }, { line_id: 'l2', cumulative_qty: 200 }] });
  const data = () => ({ invoices: localDb.invoices.getAll(), payments: getTable<Payment>('transactions'), guarantees: [], deposits: [], today: '2026-07-01' });
  const st = () => Object.fromEntries(closureChecklist(loadContracts()[0], data()).map((x) => [x.key, x.state]));
  assert.deepEqual(st(), { final_bill: 'done', completion: 'done', dlp: 'open', retention: 'done', sd: 'done', bgs: 'done', pv_final: 'done', no_claim: 'open', reco: 'open' });
  assert.equal(closureChecklist(c, data()).find((x) => x.key === 'dlp')?.due, '2027-06-30');
  assert.throws(() => closeContract(c.id, data()), /Still open: dlp, no_claim, reco/);
  assert.throws(() => setClosure(c.id, { waived: { dlp: ' ' } }), /reason/);
  setClosure(c.id, { waived: { dlp: 'Client released early' }, ticks: { reco: true }, no_claim_ref: 'NC/7', no_claim_date: '2026-07-01' });
  const closed = closeContract(c.id, data());
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closure?.closed_on, '2026-07-01');
});
