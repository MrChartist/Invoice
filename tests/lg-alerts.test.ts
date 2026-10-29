/** R19-D4 logistics notices (each condition, the pack gate) and the disbursements ageing report, on C's disbursement / deposit rows. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setTable } from '../src/lib/storage.ts';
import { lgAlerts, lgNotices } from '../src/lib/logistics/lg-alerts.ts';
import { disbAgeing } from '../src/lib/logistics/lg-reports.ts';
import * as io from '../src/lib/logistics/lg-recv-io.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { LgJob, LgManifest } from '../src/types/logistics-r19.ts';
import type { LgDisbRow } from '../src/lib/logistics/lg-disb.ts';
import type { DepositBal } from '../src/lib/logistics/lg-deposits.ts';

const job = (o: Partial<LgJob>): LgJob => ({ id: 'j1', number: 'JOB/FY26-27/0001', date: '2026-11-01', status: 'booked', dir: 'export', mode: 'air', origin: 'BOM', destination: 'SIN', client_id: 'c1', refs: {}, updated_at: '2026-11-01T10:00:00Z', ...o });
const inv = (o: Partial<InvoiceRecord>): InvoiceRecord => ({ id: 'i1', invoice_number: 'INV/1', doc_type: 'TAX_INVOICE', status: 'Sent', issue_date: '2026-11-10', currency: 'INR', items: [], total: 0, ...o } as InvoiceRecord);
const row = (o: Partial<LgDisbRow>): LgDisbRow => ({ id: 'd', job_id: 'j1', client_id: 'c1', date: '2026-09-01', kind: 'duty', ref: '', payee: 'Customs', amount: 0, in_client_name: true, billed: false, age: 0, ...o });
const dep = (o: Partial<DepositBal>): DepositBal => ({ id: 'a', job_id: 'j1', number: 'ADV/1', date: '2026-09-01', amount: 0, applied: 0, refunded: 0, open: 0, ...o });
const none = { jobs: [], invoices: [], disb: [], deposits: [], manifests: [] };
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

beforeEach(() => { resetStorage(); installSettings(); });

test('delivered over 7 days ago and unbilled; a live bill clears it, a cancelled one does not', () => {
  const j = job({ status: 'delivered', updated_at: '2026-11-01T10:00:00Z' });
  assert.deepEqual(ids(lgAlerts('2026-11-08', { ...none, jobs: [j] })), ['lg:unbilled:j1']);
  assert.deepEqual(ids(lgAlerts('2026-11-07', { ...none, jobs: [j] })), [], 'not yet 7 days');
  assert.deepEqual(ids(lgAlerts('2026-11-08', { ...none, jobs: [j], invoices: [inv({ lg: { job_id: 'j1' } })] })), []);
  assert.deepEqual(ids(lgAlerts('2026-11-08', { ...none, jobs: [j], invoices: [inv({ lg: { job_id: 'j1' }, status: 'Cancelled' })] })), ['lg:unbilled:j1']);
});

test("C's unrecovered disbursements over 30 days; billed or written-off rows do not count; deposit short once the bill of entry is in", () => {
  const j = job({ refs: { boe_no: '1234567' } });
  const duty = row({ id: 'd', amount: 185430, age: 85 }), cfs = row({ id: 'c', kind: 'cfs', amount: 12000, age: 5 });
  const d = { ...none, jobs: [j], disb: [duty, cfs], deposits: [dep({ amount: 200000, open: 200000 })] };
  assert.deepEqual(ids(lgAlerts('2026-11-25', d)), ['lg:disb:j1'], 'only the old duty counts; the deposit covers both');
  assert.deepEqual(ids(lgAlerts('2026-11-25', { ...d, disb: [{ ...duty, billed: true }, cfs] })), [], 'on a live invoice line');
  assert.deepEqual(ids(lgAlerts('2026-11-25', { ...d, disb: [{ ...duty, wo: { date: '2026-11-20', reason: 'x' } }, cfs] })), [], 'written off');
  assert.deepEqual(ids(lgAlerts('2026-11-25', { ...d, deposits: [dep({ amount: 100000, open: 100000 })] })), ['lg:disb:j1', 'lg:deposit:j1']);
  assert.match(lgAlerts('2026-11-25', { ...d, deposits: [] })[1].detail, /1,97,430\.00/, 'short by the unrecovered total');
  assert.deepEqual(ids(lgAlerts('2026-11-25', { ...d, jobs: [job({})], deposits: [] })), ['lg:disb:j1'], 'no bill of entry yet → no deposit notice');
});

test("last month's manifests unbilled after the 5th", () => {
  const m: LgManifest = { id: 'm', client_id: 'c', period: '2026-10', date: '2026-10-31', dockets: [{ no: 'A', date: '2026-10-02', zone: 'L', pcs: 1, kg: 1, chargeable_kg: 1, service: 'standard', charge: 40 }], updated_at: '' };
  assert.deepEqual(ids(lgAlerts('2026-11-06', { ...none, manifests: [m] })), ['lg:manifests:2026-10']);
  assert.deepEqual(ids(lgAlerts('2026-11-05', { ...none, manifests: [m] })), []);
  assert.deepEqual(ids(lgAlerts('2026-11-06', { ...none, manifests: [m], invoices: [inv({ lg: { manifest_id: 'm' } })] })), []);
  assert.deepEqual(ids(lgAlerts('2027-01-06', { ...none, manifests: [{ ...m, period: '2026-12' }] })), ['lg:manifests:2026-12'], 'January looks at December');
});

test("the bell provider reads nothing while the Round 19 packs are off; it reads C's rows through lg-recv-io", () => {
  setTable('lg_jobs', [job({ status: 'delivered' })]);
  const now = new Date(2026, 10, 20, 12);
  assert.deepEqual(lgNotices({ now }, io), []);
  localDb.settings.save({ ...localDb.settings.get(), industry_packs: ['logistics', 'courier'] });
  assert.deepEqual(lgNotices({ now }, io).map((n) => n.id), ['lg:unbilled:j1']);
  assert.ok(lgNotices({ now }, io)[0].at && lgNotices({ now }, io)[0].href === '/time?tab=shipments&view=jobs');
});

test("report: disbursements ageing per job in C's buckets, unrecovered rows only", () => {
  const jobs = [job({}), job({ id: 'j2', number: 'JOB/2' })];
  const rows = [row({ id: 'a', amount: 100, age: 142 }), row({ id: 'b', amount: 50, age: 10 }), row({ id: 'c', amount: 70, age: 10, billed: true }), row({ id: 'e', job_id: 'j2', amount: 5, age: 45 })];
  assert.deepEqual(disbAgeing(jobs, rows), [{ job: 'JOB/FY26-27/0001', b: [50, 0, 0, 100], total: 150 }, { job: 'JOB/2', b: [0, 5, 0, 0], total: 5 }]);
});
