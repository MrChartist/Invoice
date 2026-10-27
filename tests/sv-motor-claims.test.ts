/** SV-D3 motor insurance claims: depreciation by category and age, excess, totals, reimbursement mode, insurer B2B, short payment. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { BUYER_MH, SELLER, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';
import { loadJobs } from '../src/lib/retail/rt-service-jobs.ts';
import { ageMonths, saveAsset, saveWorkshopSettings } from '../src/lib/services/sv-assets.ts';
import { openJob } from '../src/lib/services/sv-jobs-workshop.ts';
import { approveEstimate, billWorkshopJob, makeEstimate } from '../src/lib/services/sv-estimates.ts';
import { billMotorClaim, depreciationPct, motorBuckets, motorSplit, openMotorClaim } from '../src/lib/services/sv-motor-claims.ts';
import { loadClaims, writeOffShort } from '../src/lib/services/sv-claims.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';

const DAY = '2026-10-20';
beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'services', service_kind: 'workshop', industry_packs: ['workshop'] } as never);
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

const l = (id: string, type: 'Product' | 'Service', rate: number, tax = 18): InvoiceItem => ({ id, name: id, type, hsn: type === 'Product' ? '8708' : '998714', unit: 'NOS', quantity: 1, rate, tax_rate: tax, discount_percent: 0, amount: rate });

test('depreciation by category and vehicle age; the user table wins', () => {
  assert.deepEqual(['plastic', 'rubber', 'fibre', 'glass'].map((c) => depreciationPct(c as never, 30, {})), [50, 50, 30, 0]);
  assert.deepEqual([3, 10, 20, 30, 40, 55, 100, 200].map((m) => depreciationPct('metal', m, {})), [0, 5, 10, 15, 25, 35, 40, 50]);
  assert.equal(depreciationPct('plastic', 30, { depreciation: [{ category: 'plastic', pct: 40 }] }), 40);
  assert.equal(ageMonths({ year: 2023 }, '2026-10-20'), 45);
});

test('motor split: depreciation on approved parts, excess, non-covered lines; insurer + owner = the job', () => {
  const lines = [l('bumper', 'Product', 10000), l('door', 'Product', 20000), l('polish', 'Service', 2000), l('labour', 'Service', 8000)];
  const a = motorSplit(lines, { approved: { bumper: 10000, door: 18000, labour: 8000 }, category: { bumper: 'plastic', door: 'metal' }, excess: 1000, ageMonths: 30 }, {});
  assert.equal(a.depreciation, 5000 + 2700);
  assert.equal(a.excess, 1000);
  assert.deepEqual(a.perLine, { bumper: 5000, door: 15300, polish: 0, labour: 7000 });
  assert.deepEqual(a.parts, { bumper: 'depreciation', door: 'depreciation', polish: 'non_covered', labour: 'excess' });
  const insurer = Object.values(a.perLine!).reduce((s, v) => s + v, 0);
  assert.equal(insurer, 36000 - 7700 - 1000);
});

function claimJob(mode: 'cashless' | 'reimbursement', insurerInvoice?: 'insurer') {
  const insurer = localDb.clients.upsert({ name: 'ACKO General', gstin: BUYER_MH, state_code: '27', ...(insurerInvoice ? { sv_insurer_invoice: insurerInvoice } : {}) });
  const owner = localDb.clients.upsert({ name: 'Mr Patil', state_code: '27' });
  const asset = saveAsset({ kind: 'vehicle', reg_no: 'MH12AB1234', make: 'Maruti', model: 'Swift', owner_name: 'Mr Patil', client_id: owner, year: 2024 });
  const { job } = openJob({ date: DAY, asset, odometer: 20000, complaints: ['Accident repair'] });
  const q = makeEstimate(job.id, [l('Bumper', 'Product', 20000), l('Labour', 'Service', 22372.88)], DAY);
  approveEstimate(job.id, { quote_id: q.id, by: 'Surveyor', how: 'in person' });
  const c = openMotorClaim(loadJobs()[0], { date: DAY, payer_id: insurer, payer_name: 'ACKO General', policy_no: 'POL-1', claim_no: 'CL-77', surveyor: 'S. Kulkarni', survey_date: DAY, mode, estimate: 50000, approved: 42000, salvage: 'Old bumper kept by insurer' });
  return { c, job: loadJobs()[0] };
}

test('cashless: the job bill is a draft; per head split → insurer (GSTIN, B2B) + owner = the job; short payment written off', () => {
  const { c, job } = claimJob('cashless');
  assert.deepEqual([c.kind, c.status, c.source?.id, job.claim_id, c.notes], ['motor', 'approved', job.id, c.id, 'Salvage: Old bumper kept by insurer']);
  const draft = billWorkshopJob(job.id, DAY);
  assert.equal(draft.status, 'Draft');
  const { payer, beneficiary } = billMotorClaim(job.id, { approved: 42000 }, {}, DAY);
  assert.ok(payer && beneficiary);
  assert.equal(beneficiary!.id, draft.id, 'the job draft becomes the owner\'s bill');
  assert.equal(payer!.client.gstin, BUYER_MH, 'insurer\'s invoice in its own name and GSTIN');
  assert.ok(Math.abs(Number(payer!.total) - 42000) <= 1);
  assert.ok(Math.abs(Number(payer!.total) + Number(beneficiary!.total) - Number(draft.total)) <= 1, 'the two invoices total the job');
  for (const inv of [payer!, beneficiary!]) localDb.invoices.save({ ...inv, status: 'Sent' });
  const rep = buildGstReport(getTable<InvoiceRecord>('invoices'), [], { period: { kind: 'month', fyStart: 2026, month: 10 }, gstin: SELLER.companyGstin });
  assert.equal(rep.gstr1.b2b.length, 1);
  writeOffShort(c.id, DAY);
  assert.equal(loadClaims()[0].status, 'short_paid');
  assert.equal(motorBuckets(loadClaims(), loadJobs(), getTable<InvoiceRecord>('invoices'), DAY).short, 1);
});

test('per line with depreciation: the owner pays depreciation + excess', () => {
  const { job } = claimJob('cashless');
  saveWorkshopSettings({ depreciation: [{ category: 'plastic', pct: 50 }] });
  const draft = billWorkshopJob(job.id, DAY);
  const [bumper, labour] = draft.items;
  const { payer, beneficiary } = billMotorClaim(job.id, { motor: { approved: { [bumper.id]: 20000, [labour.id]: 22372.88 }, category: { [bumper.id]: 'plastic' }, excess: 1000, ageMonths: 30 } }, { depreciation: [{ category: 'plastic', pct: 50 }] }, DAY);
  assert.deepEqual(beneficiary!.items.map((x) => [x.sv?.claim_part, x.rate]), [['depreciation', 10000], ['excess', 1000]]);
  assert.deepEqual(payer!.items.map((x) => x.rate), [10000, 21372.88]);
});

test('reimbursement: one invoice to the owner (claim noted), unless the insurer asks for its own', () => {
  const { job } = claimJob('reimbursement');
  const inv = billWorkshopJob(job.id, DAY);
  assert.equal(inv.status, 'Sent');
  assert.equal(inv.client.name, 'Mr Patil');
  assert.match(inv.notes, /Claim with ACKO General \(claim no\. CL-77\)/);
  assert.throws(() => billMotorClaim(job.id, { approved: 1 }, {}, DAY), /Only a draft|already/);
  resetStorage();
  installSettings();
  const two = claimJob('reimbursement', 'insurer');
  assert.equal(billWorkshopJob(two.job.id, DAY).status, 'Draft', 'insurer set to "invoice to insurer"');
  const b = motorBuckets(loadClaims(), loadJobs(), getTable<InvoiceRecord>('invoices'), DAY);
  assert.deepEqual([b.survey, b.approval, b.unpaid], [0, 0, 0]);
});
