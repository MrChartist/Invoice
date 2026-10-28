/** R19-D4 logistics notices (each condition, the pack gate) and reports (margin by lane / client / salesperson / month, disbursements ageing). */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setTable } from '../src/lib/storage.ts';
import { lgAlerts, lgNotices, recoveredByJob } from '../src/lib/logistics/lg-alerts.ts';
import { disbAgeing, jobPnl, marginBy } from '../src/lib/logistics/lg-reports.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import type { LgJob, LgManifest } from '../src/types/logistics-r19.ts';

const job = (o: Partial<LgJob>): LgJob => ({ id: 'j1', number: 'JOB/FY26-27/0001', date: '2026-11-01', status: 'booked', dir: 'export', mode: 'air', origin: 'BOM', destination: 'SIN', client_id: 'c1', refs: {}, updated_at: '2026-11-01T10:00:00Z', ...o });
const inv = (o: Partial<InvoiceRecord>): InvoiceRecord => ({ id: 'i1', invoice_number: 'INV/1', doc_type: 'TAX_INVOICE', status: 'Sent', issue_date: '2026-11-10', currency: 'INR', items: [], total: 0, ...o } as InvoiceRecord);
const bill = (o: Partial<PurchaseRecord> & { lg: PurchaseRecord['lg'] }): PurchaseRecord => ({ id: 'p1', kind: 'EXPENSE', vendor_name: 'CFS', bill_number: 'X', date: '2026-09-01', category: '', lines: [], taxable: 0, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 0, amount_paid: 0, ...o });
const none = { jobs: [], invoices: [], purchases: [], advances: [], manifests: [] };
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

beforeEach(() => { resetStorage(); installSettings(); });

test('delivered over 7 days ago and unbilled; a live bill clears it, a cancelled one does not', () => {
  const j = job({ status: 'delivered', updated_at: '2026-11-01T10:00:00Z' });
  assert.deepEqual(ids(lgAlerts('2026-11-08', { ...none, jobs: [j] })), ['lg:unbilled:j1']);
  assert.deepEqual(ids(lgAlerts('2026-11-07', { ...none, jobs: [j] })), [], 'not yet 7 days');
  assert.deepEqual(ids(lgAlerts('2026-11-08', { ...none, jobs: [j], invoices: [inv({ lg: { job_id: 'j1' } })] })), []);
  assert.deepEqual(ids(lgAlerts('2026-11-08', { ...none, jobs: [j], invoices: [inv({ lg: { job_id: 'j1' }, status: 'Cancelled' })] })), ['lg:unbilled:j1']);
});

test('disbursements unrecovered over 30 days (recovered by the schedule, else Rule 33 lines); deposit short on a job with a bill of entry', () => {
  const j = job({ refs: { boe_no: '1234567' } });
  const duty = bill({ id: 'd', total: 185430, date: '2026-09-01', lg: { job_id: 'j1', on_behalf: true, disb: 'duty' } });
  const cfs = bill({ id: 'c', total: 12000, date: '2026-11-20', lg: { job_id: 'j1', on_behalf: true, disb: 'cfs' } });
  const d = { ...none, jobs: [j], purchases: [duty, cfs], advances: [{ amount: 200000, lg: { job_id: 'j1' } }] };
  assert.deepEqual(ids(lgAlerts('2026-11-25', d)), ['lg:disb:j1'], 'only the old duty counts; deposits cover the duty');
  const sched = inv({ lg: { job_id: 'j1', disb: [{ date: '2026-09-01', kind: 'duty', amount: 185430 }] } });
  assert.deepEqual(ids(lgAlerts('2026-11-25', { ...d, invoices: [sched] })), []);
  const r33 = inv({ lg: { job_id: 'j1' }, items: [{ id: 'l', name: 'Duty', type: 'Service', quantity: 1, rate: 185430, amount: 0, charge_head_id: 'rule33' }] });
  assert.equal(recoveredByJob([r33]).get('j1'), 185430);
  assert.deepEqual(ids(lgAlerts('2026-11-25', { ...d, invoices: [{ ...sched, status: 'Cancelled' }] })), ['lg:disb:j1'], 'a cancelled reimbursement bill → unrecovered again');
  assert.deepEqual(ids(lgAlerts('2026-11-25', { ...d, advances: [{ amount: 100000, lg: { job_id: 'j1' } }], invoices: [sched] })), ['lg:deposit:j1']);
  assert.deepEqual(ids(lgAlerts('2026-11-25', { ...d, jobs: [job({})], advances: [], invoices: [sched] })), [], 'no bill of entry yet → no deposit notice');
});

test("last month's manifests unbilled after the 5th", () => {
  const m: LgManifest = { id: 'm', client_id: 'c', period: '2026-10', date: '2026-10-31', dockets: [{ no: 'A', date: '2026-10-02', zone: 'L', pcs: 1, kg: 1, chargeable_kg: 1, service: 'standard', charge: 40 }], updated_at: '' };
  assert.deepEqual(ids(lgAlerts('2026-11-06', { ...none, manifests: [m] })), ['lg:manifests:2026-10']);
  assert.deepEqual(ids(lgAlerts('2026-11-05', { ...none, manifests: [m] })), []);
  assert.deepEqual(ids(lgAlerts('2026-11-06', { ...none, manifests: [m], invoices: [inv({ lg: { manifest_id: 'm' } })] })), []);
  assert.deepEqual(ids(lgAlerts('2027-01-06', { ...none, manifests: [{ ...m, period: '2026-12' }] })), ['lg:manifests:2026-12'], 'January looks at December');
});

test('the bell provider reads nothing while the Round 19 packs are off', () => {
  setTable('lg_jobs', [job({ status: 'delivered' })]);
  const now = new Date(2026, 10, 20, 12);
  assert.deepEqual(lgNotices({ now }), []);
  localDb.settings.save({ ...localDb.settings.get(), industry_packs: ['logistics', 'courier'] });
  assert.deepEqual(lgNotices({ now }).map((n) => n.id), ['lg:unbilled:j1']);
  assert.ok(lgNotices({ now })[0].at && lgNotices({ now })[0].href === '/time?tab=shipments&view=jobs');
});

test('reports: margin by lane / client / salesperson / month without Rule 33 recoveries or disbursements; USD at the document rate; disbursements ageing', () => {
  const jobs = [job({ salesperson: 'Asha' }), job({ id: 'j2', number: 'JOB/2', origin: 'NSA', destination: 'JEA', client_id: 'c2', date: '2026-12-01' })];
  const invs = [
    inv({ lg: { job_id: 'j1' }, items: [{ id: 'a', name: 'Freight', type: 'Service', quantity: 1, rate: 1000, amount: 0 }], currency: 'USD', exchange_rate: 84 }),
    inv({ id: 'i2', lg: { job_id: 'j1' }, items: [{ id: 'b', name: 'Handling', type: 'Service', quantity: 2, rate: 5000, amount: 0, discount_percent: 5 }, { id: 'c', name: 'Terminal', type: 'Service', quantity: 1, rate: 1800, amount: 0, charge_head_id: 'rule33' }] }),
    inv({ id: 'i3', lg: { job_id: 'j2' }, status: 'Cancelled', items: [{ id: 'd', name: 'X', type: 'Service', quantity: 1, rate: 999, amount: 0 }] }),
  ];
  const purs = [bill({ id: 'p', taxable: 67200, lg: { job_id: 'j1' } }), bill({ id: 'q', taxable: 1800, total: 1800, lg: { job_id: 'j1', on_behalf: true } }), bill({ id: 'r', taxable: 99, status: 'draft', lg: { job_id: 'j1' } })];
  const pnl = jobPnl(invs, purs);
  assert.deepEqual(pnl.get('j1'), { revenue: 93500, cost: 67200 });
  const name = (id: string) => ({ c1: 'Demo Exports', c2: 'Other' })[id] ?? id;
  assert.deepEqual(marginBy('lane', jobs, pnl, name)[0], { key: 'BOM → SIN', jobs: 1, revenue: 93500, cost: 67200, margin: 26300, pct: 28.13 });
  assert.deepEqual(marginBy('client', jobs, pnl, name).map((r) => r.key), ['Demo Exports', 'Other']);
  assert.deepEqual(marginBy('salesperson', jobs, pnl, name).map((r) => r.key), ['Asha', '—']);
  assert.deepEqual(marginBy('month', jobs, pnl, name).map((r) => r.key), ['2026-11', '2026-12']);
  const ag = disbAgeing(jobs, [], [bill({ id: 'a', total: 100, date: '2026-07-01', lg: { job_id: 'j1', on_behalf: true } }), bill({ id: 'b', total: 50, date: '2026-11-10', lg: { job_id: 'j1', on_behalf: true } })], '2026-11-20');
  assert.deepEqual(ag, [{ job: 'JOB/FY26-27/0001', b: [50, 0, 0, 100], total: 150 }]);
  const rec = inv({ lg: { job_id: 'j1', disb: [{ date: '', kind: 'cfs', amount: 120 }] } });
  assert.deepEqual(disbAgeing(jobs, [rec], [bill({ id: 'a', total: 100, date: '2026-07-01', lg: { job_id: 'j1', on_behalf: true } }), bill({ id: 'b', total: 50, date: '2026-11-10', lg: { job_id: 'j1', on_behalf: true } })], '2026-11-20')[0].b, [30, 0, 0, 0], 'recoveries settle the oldest first');
});
