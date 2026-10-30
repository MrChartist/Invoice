/** SV-D4 service reminders and AMC visits: next service by days / km projection, insurance expiry, AMC visit → job → visit logged, texts. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import type { ServiceAsset } from '../src/types/services-r10.ts';
import { amcDb, visitFromJob } from '../src/lib/amc.ts';
import { loadJobs } from '../src/lib/retail/rt-service-jobs.ts';
import { saveAsset } from '../src/lib/services/sv-assets.ts';
import { moveWorkshopJob, openJob } from '../src/lib/services/sv-jobs-workshop.ts';
import { amcDue, dueList, kmPerDay, nextService, reminderText } from '../src/lib/services/sv-reminders.ts';

const DAY = '2026-10-20';
beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'services', service_kind: 'workshop', industry_packs: ['workshop'] } as never);
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

const car = (over: Partial<ServiceAsset> = {}): ServiceAsset => ({ id: 'a1', kind: 'vehicle', reg_no: 'MH12AB1234', make: 'Maruti', model: 'Swift', owner_name: 'Mr Patil', created_at: '', ...over });

test('next service by days, and by km projection when km would come first', () => {
  const slow = car({ odometer: [{ date: '2026-01-01', km: 40000 }, { date: '2026-10-20', km: 42920 }] });
  assert.equal(Math.round(kmPerDay(slow)), 10);
  assert.deepEqual(nextService(slow, [{ interval_days: 180, interval_km: 10000 }], {}, DAY), { date: '2027-04-18', km: 52920 }, '10 km a day: 180 days come first');
  const fast = car({ odometer: [{ date: '2026-01-01', km: 10000 }, { date: '2026-10-20', km: 39200 }] });
  assert.deepEqual(nextService(fast, [{ interval_days: 180, interval_km: 10000 }], {}, DAY), { date: '2027-01-28', km: 49200 }, '100 km a day: 10,000 km in 100 days');
  assert.deepEqual(nextService(car(), [], { default_interval: { days: 90 } }, DAY), { date: '2027-01-18' });
  assert.deepEqual(nextService(car(), [], {}, DAY), {});
  assert.equal(kmPerDay(car({ odometer: [{ date: DAY, km: 1 }, { date: '2026-10-22', km: 500 }] })), 0, 'needs a week of history');
});

test('due list: service in 30 days / overdue, insurance expiry; texts en / hi', () => {
  const rows = dueList([car({ next_service_date: '2026-11-10', next_service_km: 52000, policy_expiry: '2026-10-15' }), car({ id: 'a2', next_service_date: '2027-03-01' })], DAY);
  assert.deepEqual(rows.map((r) => [r.kind, r.date, r.overdue]), [['insurance', '2026-10-15', true], ['service', '2026-11-10', false]]);
  assert.equal(reminderText(rows[1], 'AllWheels'), 'Hello Mr Patil, your MH12AB1234 Maruti Swift is due for service on 2026-11-10 or at 52000 km. Reply to book a slot. AllWheels');
  assert.match(reminderText(rows[0], 'AllWheels', 'hi'), /बीमा 2026-10-15/);
});

test('AMC visit → job → delivered → visit logged with the job; covered assets with an open job are not offered twice', () => {
  const ac = saveAsset({ kind: 'appliance', make: 'Voltas', model: 'Split AC', serial: 'VS-1', owner_name: 'Mrs Rao' });
  const c = amcDb.save({ client_name: 'Mrs Rao', title: 'AC AMC', start: '2026-07-20', end: '2027-07-19', value: 3000, visits_per_year: 4, asset_ids: [ac.id] });
  const due = amcDue(amcDb.all(), loadJobs(), DAY);
  assert.deepEqual(due.map((d) => [d.asset_id, d.date, d.visit, d.of]), [[ac.id, '2026-07-20', 1, 4]]);
  const { job } = openJob({ date: DAY, asset: ac, complaints: [`AMC visit ${due[0].visit} of ${due[0].of}`], amc_id: c.id });
  assert.equal(amcDue(amcDb.all(), loadJobs(), DAY).length, 0, 'an open AMC job is not offered again');
  for (const s of ['diagnosed', 'approved', 'in_repair', 'ready', 'delivered'] as const) moveWorkshopJob(job.id, s, DAY);
  assert.deepEqual(amcDb.all()[0].visits, [visitFromJob(job, DAY)]);
  assert.equal(amcDb.all()[0].visits[0].job_id, job.id);
  assert.deepEqual(amcDue(amcDb.all(), loadJobs(), DAY).map((d) => d.date), ['2026-10-20'], 'the next visit is now due');
});
