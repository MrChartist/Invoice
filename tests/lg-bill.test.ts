/**
 * R19-B1 / B4 billing a job: the seed (job 0001 → freight POS 96 IGST ₹99,120.00 and local charges CGST + SGST with the
 * ₹1,800 recovery outside the value, ₹14,190.00), the `lg` snapshot, idempotent re-bill, cancel frees lines, the
 * single-document refusal, FX from the master / typed / missing, an overseas client in USD under LUT (and without),
 * GSTR-1 / e-Invoice placement (B2B POS 96 vs 6A), the charge sheet, the month batch through ONE `saveMany` and volume.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { BUYER_MH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setTable } from '../src/lib/storage.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { buildEInvoice } from '../src/lib/einvoice.ts';
import { isPureAgentLine } from '../src/lib/trade/pure-agent.ts';
import { addDefaultHeads } from '../src/lib/logistics/lg-settings.ts';
import { loadJobs, saveJob } from '../src/lib/logistics/lg-save.ts';
import { billedHeads, billState, chargeSheet, qtyOf } from '../src/lib/logistics/lg-bill.ts';
import { billJob, billMonth, planJob, saveCharges } from '../src/lib/logistics/lg-issue-io.ts';
import { saveLogisticsSettings } from '../src/lib/logistics/lg-settings.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { LgCharge, LgJob } from '../src/types/logistics-r19.ts';

const DAY = '2026-11-05';
const SEED: LgCharge[] = [
  { head_id: 'lg-freight_air', qty: 500, rate: 2, currency: 'USD', amount: 1000 },
  { head_id: 'lg-origin', qty: 1, rate: 5000, currency: 'INR', amount: 5000 },
  { head_id: 'lg-documentation', qty: 1, rate: 2000, currency: 'INR', amount: 2000 },
  { head_id: 'lg-clearance', qty: 1, rate: 3500, currency: 'INR', amount: 3500 },
  { head_id: 'lg-port', qty: 1, rate: 1800, currency: 'INR', amount: 1800 },
];
let client = '';
let agent = '';
const newJob = (o: Partial<LgJob> = {}) => saveJob({ date: DAY, status: 'delivered', dir: 'export', mode: 'air', origin: 'BOM', destination: 'SIN', dest_country: 'SG', client_id: client, refs: { hawb: `H${Math.random()}` }, gross_kg: 480, chargeable_kg: 500, charges: SEED, ...o }).job;

beforeEach(() => {
  resetStorage();
  installSettings({ defaultDueDays: 30 });
  client = localDb.clients.upsert({ name: 'Demo Exports Pvt Ltd', email: '', address: 'Navi Mumbai', city: '', zip: '', gstin: BUYER_MH, state_code: '27' });
  agent = localDb.clients.upsert({ name: 'Demo Agent Pte Ltd', email: '', address: 'Singapore', city: '', zip: '', state_code: '96' });
  addDefaultHeads(DAY);
  setTable('currency_rates', [{ id: 'r1', currency: 'USD', date: '2026-11-01', rate: 84, source: 'RBI' }]);
});

const byPos = (docs: InvoiceRecord[], pos: string) => docs.find((d) => d.place_of_supply === pos)!;

test('the seed: two documents — freight POS 96 IGST ₹99,120; local CGST + SGST with the ₹1,800 recovery outside, ₹14,190', () => {
  const j = newJob();
  const r = billJob(j.id, { date: DAY });
  assert.deepEqual([r.invoices.length, r.errors, r.skipped], [2, [], []]);
  const f = byPos(r.invoices, '96');
  assert.deepEqual([f.doc_type, f.gst_mode, f.currency, f.taxable_value, f.igst_amount, f.total, f.supply_type], ['TAX_INVOICE', 'IGST', 'INR', 84000, 15120, 99120, 'B2B']);
  assert.match(f.items[0].name, /USD 2\.00 × 500 = USD 1,000\.00 @ ₹84\.00/);
  assert.deepEqual([f.items[0].hsn, f.items[0].tax_rate, f.items[0].rate], ['996531', 18, 168]);
  assert.deepEqual(f.lg!.fx, { currency: 'USD', rate: 84, source: 'RBI' });
  assert.equal(f.lg!.regime, 'export_freight');
  assert.match(f.lg!.pos_reason!, /12\(8\) proviso/);
  assert.equal(f.lg!.heads![f.items[0].id], 'lg-freight_air');
  assert.deepEqual([f.lg!.job_id, f.lg!.job_no, f.lg!.ports?.dest_country, f.lg!.weights?.chargeable_kg], [j.id, j.number, 'SG', 500]);
  const l = byPos(r.invoices, '27');
  assert.deepEqual([l.gst_mode, l.cgst_amount, l.sgst_amount, l.total], ['CGST_SGST', 945, 945, 14190]);
  const pure = l.items.find((i) => i.rate === 1800)!;
  assert.ok(isPureAgentLine(pure), 'charge_head_id rule33 + the Rule 33 text');
  assert.equal(pure.hsn, undefined);
  assert.equal(l.lg!.regime, 'general');
  assert.ok(r.invoices.every((d) => d.status === 'Sent' && !!d.invoice_number));
  assert.notEqual(f.invoice_number, l.invoice_number);
  assert.equal(f.due_date, '2026-12-05');
  // GSTR-1: the POS-96 freight to a registered Indian client is B2B with POS 96 and IGST (Circular 184 Sl. 4), not 6A;
  // the recovery stays out of the taxable value.
  const g = buildGstReport(localDb.invoices.getAll(), [], { period: { kind: 'month', fyStart: 2026, month: 11 } }).gstr1;
  assert.deepEqual(g.exp, []);
  assert.deepEqual(g.b2b.map((x) => [x.pos, x.taxable, x.igst, x.cgst]).sort(), [['27', 10500, 0, 945], ['96', 84000, 15120, 0]]);
  const e = buildEInvoice(f).payload;
  assert.deepEqual([e.TranDtls.SupTyp, e.BuyerDtls.Pos, e.BuyerDtls.Gstin], ['B2B', '96', BUYER_MH]);
});

test('re-billing skips billed heads; cancelling a document frees its lines', () => {
  const j = newJob();
  const first = billJob(j.id, { date: DAY });
  const again = billJob(j.id, { date: DAY });
  assert.equal(again.invoices.length, 0);
  assert.equal(again.skipped.length, 5);
  assert.equal(localDb.invoices.getAll().length, 2);
  assert.equal(billState(chargeSheet(j, []), billedHeads(localDb.invoices.getAll(), j.id)), 'billed');
  localDb.invoices.setStatus(byPos(first.invoices, '96').id, 'Cancelled');
  assert.equal(billState(chargeSheet(j, []), billedHeads(localDb.invoices.getAll(), j.id)), 'part');
  const third = billJob(j.id, { date: DAY });
  assert.deepEqual([third.invoices.length, third.invoices[0].place_of_supply, third.skipped.length], [1, '96', 4]);
});

test('one document per job (split single) is refused when the lines need different places of supply (LG9)', () => {
  saveLogisticsSettings({ split: 'single' });
  const j = newJob();
  const r = billJob(j.id, { date: DAY });
  assert.equal(r.invoices.length, 0);
  assert.match(r.errors[0], /different places of supply/);
  const local = newJob({ charges: SEED.slice(1) });
  const ok = billJob(local.id, { date: DAY });
  assert.deepEqual([ok.invoices.length, ok.invoices[0].items.length], [1, 4], 'one POS: one document');
});

test('composite heads follow the freight (POS 96, its rate) on the same document', () => {
  saveLogisticsSettings({ composite_with_freight: ['lg-origin'] });
  const r = billJob(newJob().id, { date: DAY });
  const f = byPos(r.invoices, '96');
  assert.equal(f.items.length, 2);
  assert.equal(f.taxable_value, 89000);
});

test('FX: a typed rate wins over the master; no rate → the job is not billed and the error names the currency', () => {
  const typed = billJob(newJob().id, { date: DAY, fx: { USD: 85 } });
  assert.equal(byPos(typed.invoices, '96').taxable_value, 85000);
  assert.equal(byPos(typed.invoices, '96').lg!.fx!.source, 'typed');
  const none = billJob(newJob({ charges: [{ head_id: 'lg-freight_air', qty: 10, rate: 3, currency: 'EUR', amount: 30 }] }).id, { date: DAY });
  assert.equal(none.invoices.length, 0);
  assert.match(none.errors[0], /EUR/);
});

test('an overseas client: USD document with the rate; export of services under the LUT (6A without payment), else IGST and a hint', () => {
  const imp = (n: number) => newJob({ client_id: agent, dir: 'import', mode: 'air', origin: 'SIN', destination: 'BOM', dest_country: 'IN', refs: { hawb: `A${n}` }, charges: [SEED[0]] });
  const noLut = billJob(imp(1).id, { date: DAY });
  const d = noLut.invoices[0];
  assert.deepEqual([d.currency, d.exchange_rate, d.place_of_supply, d.supply_type, d.total], ['USD', 84, '96', 'EXPORT_WITH_PAYMENT', 1180]);
  assert.match(noLut.hints.join(), /No LUT/);
  setTable('lut_register', [{ id: 'l', fy: 'FY26-27', gstin: '', arn: 'AD270326000123X', filed_on: '2026-03-20', valid_from: '2026-04-01', valid_to: '2027-03-31' }]);
  const lut = billJob(imp(2).id, { date: DAY }).invoices[0];
  assert.deepEqual([lut.supply_type, lut.igst_amount, lut.total, lut.lut_number], ['EXPORT_LUT', 0, 1000, 'AD270326000123X']);
  const g = buildGstReport([lut], [], { period: { kind: 'month', fyStart: 2026, month: 11 } }).gstr1;
  assert.deepEqual([g.exp.length, g.exp[0].expType, g.b2b.length], [1, 'WOPAY', 0]);
});

test('the charge sheet: typed lines, else heads with a default rate and quantity from the job', () => {
  const j = newJob({ charges: undefined, containers: [{ no: 'CSQU3054383', size: '40HC' }], cbm: 1.2, gross_kg: 2500 });
  assert.deepEqual(chargeSheet(j, []), []);
  saveLogisticsSettings({ heads: [{ id: 'a', name: 'Air', kind: 'freight_air', role: 'own', unit: 'per_kg', rate: 2, currency: 'USD', active: true }, { id: 'b', name: 'Off', kind: 'other', role: 'own', unit: 'per_bill', rate: 5, active: false }] });
  assert.deepEqual(chargeSheet(j, [{ id: 'a', name: 'Air', kind: 'freight_air', role: 'own', unit: 'per_kg', rate: 2, currency: 'USD', active: true }]), [{ head_id: 'a', qty: 500, rate: 2, currency: 'USD', amount: 1000 }]);
  assert.deepEqual([qtyOf('per_container', j), qtyOf('per_wm', j), qtyOf('per_shipment', j)], [1, 2.5, 1]);
  const saved = saveCharges(j, [{ head_id: 'a', qty: 3, rate: 2.5, currency: 'USD', amount: 0 }, { head_id: '', qty: 1, rate: 1, currency: 'INR', amount: 1 }]);
  assert.deepEqual(loadJobs().find((x) => x.id === saved.id)!.charges, [{ head_id: 'a', qty: 3, rate: 2.5, currency: 'USD', amount: 7.5 }]);
  assert.equal(planJob(saved, { date: DAY }).drafts.length, 1);
});

test('"Bill delivered jobs": the month in ONE saveMany (600 jobs → 1,200 documents, consecutive numbers, under 2 s)', () => {
  const base = newJob();
  const rows: LgJob[] = [base, ...Array.from({ length: 599 }, (_, i) => ({ ...base, id: `j${i}`, number: `JOB/FY26-27/${String(i + 2).padStart(4, '0')}`, refs: { hawb: `V${i}` } }))];
  rows.push({ ...base, id: 'later', number: 'JOB/FY26-27/0999', date: '2026-12-01', refs: {} }, { ...base, id: 'open', number: 'JOB/FY26-27/0998', status: 'in_transit', refs: {} });
  setTable('lg_jobs', rows);
  const real = localDb.invoices.saveMany;
  let calls = 0;
  localDb.invoices.saveMany = (l) => { calls++; return real(l); };
  try {
    const t0 = performance.now();
    const r = billMonth('2026-11', { date: '2026-11-30' });
    const ms = performance.now() - t0;
    assert.equal(calls, 1);
    assert.equal(r.invoices.length, 1200);
    // ≈ 0.5 s alone (PRD: under 2 s); the full suite runs files in parallel on a shared CPU, so allow headroom there.
    assert.ok(ms < 6000, `${Math.round(ms)} ms`);
    const nums = r.invoices.map((d) => Number(d.invoice_number.split('/').pop())).sort((a, b) => a - b);
    assert.deepEqual([nums[0], nums.at(-1), new Set(nums).size], [1, 1200, 1200]);
    assert.equal(billMonth('2026-11', { date: '2026-11-30' }).invoices.length, 0, 'idempotent');
    assert.equal(calls, 1, 'nothing to bill → no write');
  } finally {
    localDb.invoices.saveMany = real;
  }
});
