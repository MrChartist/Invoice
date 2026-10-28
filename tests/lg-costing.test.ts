/**
 * R19-B3 job costing: the seed (revenue ₹94,500, cost ₹69,700 — co-loader ₹67,200 with ITC + trucker ₹2,500 under RCM —
 * margin ₹24,800, 26.2 %; the ₹1,800 recovery outside both), FX documents, credit notes (financial ones left out),
 * a bill split over jobs by line, GST not taken as credit in cost, disbursements on behalf out, flags, groups, and the
 * job index (a job reads only its own documents) over 10,000 jobs.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { BUYER_MH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setTable } from '../src/lib/storage.ts';
import { inrValue } from '../src/lib/fx.ts';
import { recoveryValue } from '../src/lib/trade/pure-agent.ts';
import { addDefaultHeads } from '../src/lib/logistics/lg-settings.ts';
import { saveJob } from '../src/lib/logistics/lg-save.ts';
import { billJob } from '../src/lib/logistics/lg-issue-io.ts';
import { costAlloc, groupPnl, pnlRows, type CostBill } from '../src/lib/logistics/lg-costing.ts';
import { costBills, jobPnls } from '../src/lib/logistics/lg-books-io.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import type { LgJob } from '../src/types/logistics-r19.ts';

const DAY = '2026-11-05';
let job: LgJob;
const bill = (o: Partial<PurchaseRecord>): PurchaseRecord => ({ id: 'b', kind: 'PURCHASE', vendor_name: 'Co-loader', bill_number: 'CL/1', date: DAY, category: 'Freight', lines: [{ id: 'l1', name: 'Air freight', hsn: '996531', quantity: 1, rate: 67200, tax_rate: 18 }], taxable: 67200, cgst: 0, sgst: 0, igst: 12096, itc_eligible: true, total: 79296, amount_paid: 0, ...o });

beforeEach(() => {
  resetStorage();
  installSettings();
  const client = localDb.clients.upsert({ name: 'Demo Exports Pvt Ltd', email: '', address: '', city: '', zip: '', gstin: BUYER_MH, state_code: '27' });
  addDefaultHeads(DAY);
  setTable('currency_rates', [{ id: 'r', currency: 'USD', date: DAY, rate: 84, source: 'manual' }]);
  job = saveJob({ date: DAY, status: 'delivered', dir: 'export', mode: 'air', origin: 'BOM', destination: 'SIN', dest_country: 'SG', client_id: client, refs: {}, chargeable_kg: 500, charges: [
    { head_id: 'lg-freight_air', qty: 500, rate: 2, currency: 'USD', amount: 1000 }, { head_id: 'lg-origin', qty: 1, rate: 5000, currency: 'INR', amount: 5000 },
    { head_id: 'lg-documentation', qty: 1, rate: 2000, currency: 'INR', amount: 2000 }, { head_id: 'lg-clearance', qty: 1, rate: 3500, currency: 'INR', amount: 3500 }, { head_id: 'lg-port', qty: 1, rate: 1800, currency: 'INR', amount: 1800 },
  ] }).job;
});

test('the seed: revenue ₹94,500, cost ₹69,700, margin ₹24,800 (26.2 %); the recovery outside both', () => {
  billJob(job.id, { date: DAY });
  setTable('purchases', [
    bill({ id: 'p1', lg: { job_id: job.id } }),
    bill({ id: 'p2', vendor_name: 'Trucker', bill_number: 'T/9', lines: [{ id: 't', name: 'GTA', hsn: '996791', quantity: 1, rate: 2500, tax_rate: 5 }], taxable: 2500, igst: 0, cgst: 62.5, sgst: 62.5, total: 2625, reverse_charge: true, lg: { job_id: job.id } }),
    bill({ id: 'p3', lg: { job_id: job.id, on_behalf: true, disb: 'port' } }), // C1: a disbursement on the client's behalf — not a cost
    bill({ id: 'p4' }), // untagged
    bill({ id: 'p5', status: 'void', lg: { job_id: job.id } } as never),
  ]);
  const [r] = jobPnls([job], 20);
  assert.deepEqual([r.revenue, r.cost, r.margin, r.pct, r.docs, r.unbilled, r.uncosted, r.low], [94500, 69700, 24800, 26.2, 2, false, false, false]);
  assert.equal(jobPnls([job], 30)[0].low, true, 'below the margin alert');
});

test('flags: delivered and unbilled; billed and uncosted', () => {
  assert.equal(jobPnls([job])[0].unbilled, true);
  billJob(job.id, { date: DAY });
  const [r] = jobPnls([job]);
  assert.deepEqual([r.unbilled, r.uncosted, r.cost], [false, true, 0]);
});

test('credit notes subtract, financial notes and cancelled documents are left out; FX documents in rupees', () => {
  const f = { inr: inrValue, recovery: recoveryValue };
  const doc = (o: Partial<InvoiceRecord>) => ({ id: 'x', doc_type: 'TAX_INVOICE', status: 'Sent', currency: 'INR', taxable_value: 1000, items: [], lg: { job_id: 'j' }, ...o }) as InvoiceRecord;
  const j = { ...job, id: 'j' };
  const rows = pnlRows([j], [doc({}), doc({ currency: 'USD', exchange_rate: 84, taxable_value: 100 }), doc({ doc_type: 'CREDIT_NOTE', taxable_value: 200 }), doc({ doc_type: 'CREDIT_NOTE', note_kind: 'financial', taxable_value: 500 }), doc({ status: 'Cancelled' }), doc({ lg: { job_id: 'other' } })], [], f);
  assert.deepEqual([rows[0].revenue, rows[0].docs], [1000 + 8400 - 200, 2]);
});

test('a bill split over jobs by line; GST not taken as credit is cost', () => {
  const b: CostBill = { id: 'b', taxable: 1000, tax: 180, itc: false, void: false, lg: { job_id: 'a', lines: { l2: 'b' } }, lines: [{ id: 'l1', value: 600 }, { id: 'l2', value: 400 }] };
  assert.deepEqual([...costAlloc(b)].sort(), [['a', 708], ['b', 472]]);
  assert.deepEqual([...costAlloc({ ...b, itc: true, lg: { job_id: 'a' } })], [['a', 1000]]);
  assert.equal(costAlloc({ ...b, void: true }).size, 0);
});

test('costBills reads the real bill shape through readPurchase (purchase contract)', () => {
  const c = costBills([bill({ lg: { job_id: 'j', lines: { l1: 'k' } } }), bill({ id: 'q' }), null, 'junk']);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].taxable, c[0].tax, c[0].itc, c[0].void, c[0].lines], [67200, 12096, true, false, [{ id: 'l1', value: 67200 }]]);
});

test('groups by client / lane / month; 10,000 jobs index their documents once', () => {
  const jobs: LgJob[] = Array.from({ length: 10_000 }, (_, i) => ({ ...job, id: `j${i}`, client_id: i % 2 ? 'c1' : 'c2', destination: i % 3 ? 'SIN' : 'DXB' }));
  const docs = jobs.map((j) => ({ id: `d${j.id}`, doc_type: 'TAX_INVOICE', status: 'Sent', currency: 'INR', taxable_value: 100, items: [], lg: { job_id: j.id } }) as unknown as InvoiceRecord);
  const t0 = performance.now();
  const rows = pnlRows(jobs, docs, [], { inr: inrValue, recovery: recoveryValue });
  assert.ok(performance.now() - t0 < 1000);
  assert.ok(rows.every((r) => r.revenue === 100));
  assert.deepEqual(groupPnl(rows, 'client').map((g) => [g.key, g.jobs, g.revenue]), [['c2', 5000, 500000], ['c1', 5000, 500000]]);
  assert.equal(groupPnl(rows, 'lane').length, 2);
  assert.deepEqual(groupPnl(rows, 'month').map((g) => g.key), ['2026-11']);
});
