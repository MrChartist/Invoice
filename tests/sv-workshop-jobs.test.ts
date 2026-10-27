/** SV-D1 vehicle / appliance job cards over RT-D4: registration no., odometer, history, workshop statuses, site visit, pack gate. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { visiblePackTabs } from '../src/lib/industry-packs.ts';
import { TIME_TABS } from '../src/pages/page-tabs.ts';
import { canMove, loadJobs, nextServiceStatus } from '../src/lib/retail/rt-service-jobs.ts';
import { assetJobs, deleteAsset, lastKm, lastService, loadAssets, normReg, odometerIssue, saveAsset } from '../src/lib/services/sv-assets.ts';
import { approvalIssue, board, movesFrom, moveWorkshopJob, openJob, patchJob } from '../src/lib/services/sv-jobs-workshop.ts';
import { loadAppointments } from '../src/lib/services/sv-appointments.ts';
import { amcDb } from '../src/lib/amc.ts';

const DAY = '2026-10-20';
beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'services', service_kind: 'workshop', industry_packs: ['workshop'] } as never);
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

const swift = () => saveAsset({ kind: 'vehicle', reg_no: 'mh 12 ab-1234', make: 'Maruti', model: 'Swift', variant: 'VXi', owner_name: 'Mr Patil', phone: '9800000011', year: 2021, vclass: 'hatch' });

test('registration no. normalised and unique; delete refused while a job uses it', () => {
  const a = swift();
  assert.equal(a.reg_no, 'MH12AB1234');
  assert.equal(normReg(' mh-12 ab 1234 '), 'MH12AB1234');
  assert.throws(() => saveAsset({ kind: 'vehicle', reg_no: 'MH12AB1234', model: 'X', owner_name: 'Y' }), /already on file/);
  assert.throws(() => saveAsset({ kind: 'vehicle', model: 'X', owner_name: 'Y' }), /registration/);
  saveAsset({ kind: 'appliance', model: 'Split AC 1.5T', make: 'Voltas', serial: 'VS-99', owner_name: 'Mrs Rao', site: 'Flat 4, Baner' });
  assert.equal(loadAssets().length, 2);
  openJob({ date: DAY, asset: a, complaints: ['50,000 km service'] });
  assert.throws(() => deleteAsset(a.id, loadJobs()), /use this/);
});

test('job with asset: SVC number, SV-D fields, odometer kept and a lower reading warns; history order and last service', () => {
  const a = swift();
  const { job, warning } = openJob({ date: '2026-10-01', asset: a, odometer: 48210, fuel: '1/4', complaints: ['50,000 km service', 'Brake noise', ' '], checklist: ['Lights'], technicians: ['t1', 't2'], bay: 'b1', promised: '2026-10-01T18:00' });
  assert.equal(warning, '');
  assert.match(job.number, /^SVC\/FY26-27\/0001$/);
  assert.deepEqual([job.kind, job.asset_id, job.odometer_in, job.fuel, job.complaints, job.technicians, job.asset.reg_no, job.due], ['vehicle', a.id, 48210, '1/4', ['50,000 km service', 'Brake noise'], ['t1', 't2'], 'MH12AB1234', '2026-10-01']);
  assert.equal(lastKm(loadAssets()[0]), 48210);
  assert.match(odometerIssue(loadAssets()[0], 48000), /below the last reading/);
  moveWorkshopJob(job.id, 'diagnosed', '2026-10-01');
  moveWorkshopJob(job.id, 'approved', '2026-10-01');
  moveWorkshopJob(job.id, 'in_repair', '2026-10-01');
  moveWorkshopJob(job.id, 'ready', '2026-10-02');
  moveWorkshopJob(job.id, 'delivered', '2026-10-02', 48222);
  assert.equal(lastKm(loadAssets()[0]), 48222);
  const two = openJob({ date: DAY, asset: loadAssets()[0], odometer: 48100, complaints: ['Brake noise again'] });
  assert.match(two.warning, /below the last reading/, 'a lower reading warns but is kept');
  assert.equal(two.job.odometer_in, 48100);
  assert.deepEqual(assetJobs(a.id, loadJobs()).map((j) => j.number), [two.job.number, job.number], 'newest first');
  assert.equal(lastService(a.id, loadJobs(), two.job.id)?.number, job.number);
});

test('workshop statuses are accepted by the RT-D4 flow; the phone flow is unchanged', () => {
  assert.ok(canMove('diagnosed', 'estimate_sent') && canMove('estimate_sent', 'approved') && canMove('estimate_sent', 'awaiting_insurer') && canMove('awaiting_insurer', 'approved'));
  assert.ok(canMove('in_repair', 'awaiting_parts') && canMove('awaiting_parts', 'in_repair') && canMove('in_repair', 'quality_check') && canMove('quality_check', 'ready') && canMove('quality_check', 'returned'));
  assert.ok(!canMove('estimate_sent', 'received') && !canMove('awaiting_parts', 'ready') && !canMove('quality_check', 'delivered'));
  assert.ok(canMove('in_repair', 'ready') && canMove('received', 'diagnosed') && !canMove('received', 'ready'));
  assert.deepEqual([nextServiceStatus('estimate_sent'), nextServiceStatus('awaiting_parts'), nextServiceStatus('quality_check'), nextServiceStatus('in_repair')], ['approved', 'in_repair', 'ready', 'ready']);
  assert.deepEqual(movesFrom('in_repair'), ['awaiting_parts', 'quality_check', 'ready']);
  const { job } = openJob({ date: DAY, asset: swift(), complaints: ['x'] });
  moveWorkshopJob(job.id, 'diagnosed', DAY);
  moveWorkshopJob(job.id, 'estimate_sent', DAY);
  moveWorkshopJob(job.id, 'approved', DAY);
  const r = moveWorkshopJob(job.id, 'in_repair', DAY);
  assert.match(r.warning, /No estimate approval/, 'warning, never a block');
  assert.equal(approvalIssue({ approvals: [{ quote_id: 'q', by: 'Mr Patil', how: 'phone', at: '' }] }), '');
  moveWorkshopJob(job.id, 'awaiting_parts', DAY);
  assert.deepEqual(Object.keys(board(loadJobs(), '2026-10-25')), ['awaiting_parts']);
  assert.equal(board(loadJobs(), '2026-10-25').awaiting_parts![0].age, 5);
  assert.throws(() => moveWorkshopJob(job.id, 'delivered', DAY), /cannot move/);
});

test('appliance site visit goes on the appointment book; an AMC job logs the visit on delivery', () => {
  const ac = saveAsset({ kind: 'appliance', make: 'Voltas', model: 'Split AC', serial: 'VS-1', owner_name: 'Mrs Rao', phone: '9800000012', site: 'Flat 4' });
  const c = amcDb.save({ client_name: 'Mrs Rao', title: 'AC AMC', start: '2026-04-01', end: '2027-03-31', value: 3000, visits_per_year: 4, asset_ids: [ac.id] });
  const { job } = openJob({ date: DAY, asset: ac, complaints: ['Not cooling'], technicians: ['t9'], visit_at: '2026-10-21T15:00', site: 'Flat 4', amc_id: c.id });
  const appt = loadAppointments().find((x) => x.id === job.appointment_id)!;
  assert.deepEqual([appt.date, appt.start, appt.kind, appt.staff_id, appt.client_name], ['2026-10-21', '15:00', 'job', 't9', 'Mrs Rao']);
  for (const s of ['diagnosed', 'approved', 'in_repair', 'ready', 'delivered'] as const) moveWorkshopJob(job.id, s, '2026-10-21');
  const v = amcDb.all()[0].visits;
  assert.deepEqual(v.map((x) => [x.date, x.job_id, x.note]), [['2026-10-21', job.id, `Job ${job.number}`]]);
  assert.equal(patchJob(job.id, { fuel: 'full' }).fuel, 'full');
});

test('pack-off gate: no workshop tab without the pack; the desk loads lazily and replaces the stub', () => {
  const s = localDb.settings.get();
  assert.ok(visiblePackTabs(TIME_TABS, s).some((t) => t.id === 'workshop'));
  localDb.settings.save({ ...s, industry_packs: ['salon'] });
  assert.ok(!visiblePackTabs(TIME_TABS, localDb.settings.get()).some((t) => t.id === 'workshop'));
  const time = readFileSync(new URL('../src/pages/Time.tsx', import.meta.url), 'utf8');
  assert.match(time, /const WorkshopDesk = lazy\(\(\) => import\('\.\.\/components\/services-r10\/WorkshopDesk'\)\);/);
  assert.ok(!/tab === 'workshop' && params\.get\('view'\) !== 'claims'/.test(time), 'no stub for the workshop');
});
