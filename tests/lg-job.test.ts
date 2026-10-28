/** R19-A2 job files: validation, JOB numbering (FY, branch prefix), house-bill uniqueness, ISO 6346, chargeable weight, filters / totals, writers, volume. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { chargeableWeight, volumeCm3 } from '../src/lib/logistics/lg-weight.ts';
import { containerCheck, duplicateJob, filterJobs, jobPrefix, jobTotals, nextJobNumber, validateJob } from '../src/lib/logistics/lg-job.ts';
import { deleteJob, loadJobs, saveJob, setJobStatus } from '../src/lib/logistics/lg-save.ts';
import type { LgJob } from '../src/types/logistics-r19.ts';

let client = '';
beforeEach(() => {
  resetStorage();
  installSettings();
  client = localDb.clients.upsert({ name: 'Demo Exports Pvt Ltd', email: '', address: '', city: '', zip: '' });
});

const base = (o: Partial<LgJob> = {}): LgJob => ({ id: 'j', number: 'JOB/FY26-27/0001', date: '2026-11-05', status: 'booked', dir: 'export', mode: 'air', origin: 'BOM', destination: 'SIN', dest_country: 'SG', client_id: 'c', refs: {}, updated_at: '', ...o });

test('chargeable weight: air ÷ 6000 (the seed: 5 × 120 × 100 × 50 cm, 480 kg → 500 kg), courier ÷ 5000 and 0.5 kg steps, LCL W/M', () => {
  const dims = [{ l: 120, w: 100, h: 50, n: 5 }];
  assert.equal(volumeCm3(dims), 3_000_000);
  assert.deepEqual(chargeableWeight({ gross_kg: 480, dims, mode: 'air' }), { value: 500, unit: 'kg', basis: 'volumetric', cbm: 3 });
  assert.equal(chargeableWeight({ gross_kg: 520, dims, mode: 'air' }).basis, 'gross');
  assert.equal(chargeableWeight({ gross_kg: 3, dims: [{ l: 40, w: 30, h: 20, n: 1 }], mode: 'courier' }).value, 5, '24,000 cm³ ÷ 5000 = 4.8 → 5 kg');
  assert.equal(chargeableWeight({ gross_kg: 1.2, mode: 'courier' }).value, 1.5);
  assert.deepEqual(chargeableWeight({ gross_kg: 2500, cbm: 1.8, mode: 'sea_lcl' }), { value: 2.5, unit: 'W/M', basis: 'gross', cbm: 1.8 });
  assert.equal(chargeableWeight({ gross_kg: 900, cbm: 1.234, mode: 'sea_lcl' }).value, 1.24);
  assert.equal(chargeableWeight({ gross_kg: 480, dims, mode: 'air', settings: { volumetric: { air: 5000, courier: 5000, sea_kg_per_cbm: 1000 } } }).value, 600, 'divisors are settings');
  assert.equal(chargeableWeight({ gross_kg: 7000, mode: 'sea_fcl' }).value, 7000);
});

test('ISO 6346 container check digit', () => {
  assert.deepEqual(containerCheck('CSQU3054383'), { shape: true, digit: true });
  assert.deepEqual(containerCheck('CSQU3054384'), { shape: true, digit: false });
  assert.deepEqual(containerCheck('CSQ3054383'), { shape: false, digit: false });
});

test('validation: errors block, hints never do', () => {
  assert.deepEqual(validateJob(base(), []), { errors: [], hints: [] });
  assert.equal(validateJob(base({ client_id: '' }), []).errors.length, 1);
  assert.equal(validateJob(base({ dest_country: undefined }), []).errors.length, 1, 'an export by air needs the country');
  assert.equal(validateJob(base({ dest_country: undefined, mode: 'road', dir: 'domestic' }), []).errors.length, 0);
  assert.equal(validateJob(base({ mode: 'sea_fcl', containers: [{ no: 'BAD1', size: '20' }] }), []).errors.length, 1);
  assert.deepEqual(validateJob(base({ mode: 'sea_fcl', containers: [{ no: 'CSQU3054384', size: '40HC' }] }), []).errors, []);
  assert.equal(validateJob(base({ mode: 'sea_fcl', containers: [{ no: 'CSQU3054384', size: '40HC' }] }), []).hints.length, 1);
  assert.equal(validateJob(base({ refs: { sb_date: '2026-09-01' } }), []).hints.length, 1, 'SB date more than 30 days before the job');
  assert.equal(validateJob(base({ refs: { sb_date: '2026-10-10' } }), []).hints.length, 0);
  const other = base({ id: 'k', number: 'JOB/FY26-27/0002', refs: { hawb: 'sbl-1' } });
  assert.match(validateJob(base({ refs: { hawb: 'SBL-1' } }), [other]).errors[0], /JOB\/FY26-27\/0002/, 'house bills unique per company');
  assert.equal(validateJob(base({ gross_kg: -1 }), []).errors.length, 1);
});

test('JOB numbering: Indian FY, branch prefix, never reused', () => {
  assert.equal(nextJobNumber('2026-11-05', []), 'JOB/FY26-27/0001');
  assert.equal(nextJobNumber('2027-03-31', [{ number: 'JOB/FY26-27/0007' }]), 'JOB/FY26-27/0008');
  assert.equal(nextJobNumber('2027-04-01', [{ number: 'JOB/FY26-27/0007' }]), 'JOB/FY27-28/0001');
  assert.equal(jobPrefix(' job-bom '), 'JOB-BOM');
  assert.equal(nextJobNumber('2026-11-05', [], 'JOB-BOM'), 'JOB-BOM/FY26-27/0001');
  const a = saveJob({ ...duplicateJob(base({ client_id: client }), '2026-11-05'), status: 'booked' });
  assert.equal(a.job.number, 'JOB/FY26-27/0001');
  const b = saveJob({ ...duplicateJob(base({ client_id: client }), '2026-11-06') });
  assert.equal(b.job.number, 'JOB/FY26-27/0002');
  deleteJob(b.job.id);
  assert.equal(saveJob({ ...duplicateJob(base({ client_id: client }), '2026-11-07') }).job.number, 'JOB/FY26-27/0003', 'a deleted number stays used');
  assert.ok(getTable<{ table: string }>('recycle_bin').some((r) => r.table === 'lg_jobs'), 'the deleted job went to the recycle bin');
});

test('writers: clean refs, close / re-open, a billed job is not deleted', () => {
  const { job } = saveJob({ ...duplicateJob(base({ client_id: client }), '2026-11-05'), origin: ' bom ', refs: { hawb: ' SBL-0001 ', mawb: '' }, containers: [{ no: 'csqu 3054383', size: '40HC' }] });
  assert.deepEqual([job.origin, job.refs, job.containers?.[0].no], ['BOM', { hawb: 'SBL-0001' }, 'CSQU3054383']);
  assert.throws(() => saveJob({ ...duplicateJob(base({ client_id: client }), '2026-11-05'), refs: { hawb: 'sbl-0001' } }), /already on job/);
  assert.equal(setJobStatus(job.id, 'closed', '2026-12-01').closed_on, '2026-12-01');
  assert.equal(setJobStatus(job.id, 'delivered', '2026-12-02').closed_on, undefined, 're-opened');
  setTable('invoices', [{ id: 'i', status: 'Draft', lg: { job_id: job.id } }]);
  assert.throws(() => deleteJob(job.id), /live/);
  assert.equal(loadJobs().length, 1);
});

test('filters, totals (kg, TEU) and duplicate', () => {
  const jobs = [base(), base({ id: 'k', number: 'JOB/FY26-27/0002', mode: 'sea_fcl', containers: [{ no: 'A', size: '20' }, { no: 'B', size: '40HC' }], chargeable_kg: 9000 }), base({ id: 'm', number: 'JOB/FY25-26/0009', date: '2026-03-01', chargeable_kg: 10 })];
  assert.deepEqual(filterJobs(jobs, { fy: '26-27' }).map((j) => j.id), ['k', 'j']);
  assert.deepEqual(filterJobs(jobs, { mode: 'sea_fcl' }).map((j) => j.id), ['k']);
  assert.deepEqual(jobTotals(jobs), { count: 3, kg: 9010, teu: 3 });
  const d = duplicateJob(jobs[1], '2026-12-01');
  assert.deepEqual([d.status, d.refs, 'containers' in d, d.mode], ['enquiry', {}, false, 'sea_fcl']);
});

test('volume: 10,000 jobs — one FY filtered and totalled fast; numbering reads the list once', () => {
  const many = Array.from({ length: 10_000 }, (_, i) => base({ id: `j${i}`, number: `JOB/FY${i % 2 ? '26-27' : '25-26'}/${String(i).padStart(5, '0')}`, date: i % 2 ? '2026-11-05' : '2026-01-05', chargeable_kg: 1 }));
  const t = performance.now();
  const fy = filterJobs(many, { fy: '26-27' });
  assert.equal(fy.length, 5000);
  assert.equal(jobTotals(fy).kg, 5000);
  assert.equal(nextJobNumber('2026-11-05', many), 'JOB/FY26-27/10000');
  assert.ok(performance.now() - t < 2000);
});
