/** SV-D2 estimates, approvals, parts issue and the job bill: labour by class, supplementary merge, WIP stock, rates, sublet, efficiency. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { blankStockItem, getStockLevel, stockDb } from '../src/lib/inventory.ts';
import { transfersDb } from '../src/lib/godowns.ts';
import { loadJobs } from '../src/lib/retail/rt-service-jobs.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import { loadAssets, saveAsset, saveWorkshopSettings } from '../src/lib/services/sv-assets.ts';
import { moveWorkshopJob, openJob } from '../src/lib/services/sv-jobs-workshop.ts';
import { approveEstimate, billWorkshopJob, labourLine, makeEstimate, partLine, repairSac, subletLine } from '../src/lib/services/sv-estimates.ts';
import { issuedNet, issueParts, returnParts, wipGodown } from '../src/lib/services/sv-parts-issue.ts';
import { clockIn, clockOut, efficiency, loadLabourOps, logTime, saveLabourOp } from '../src/lib/services/sv-labour.ts';
import { timeDb } from '../src/lib/timesheets.ts';

const DAY = '2026-10-20';
beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'services', service_kind: 'workshop', industry_packs: ['workshop'] } as never);
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

function world() {
  saveWorkshopSettings({ labour_rate: { hatch: 900, suv: 1200, all: 800 }, default_interval: { days: 180, km: 10000 } });
  const pads = blankStockItem({ id: 'pads', name: 'Brake pads (front)', hsn: '8708', opening_qty: 10, opening_rate: 1500, sale_rate: 2150, tax_rate: 18 });
  const oil = blankStockItem({ id: 'oil', name: 'Engine oil 5W30', hsn: '2710', opening_qty: 20, opening_rate: 400, sale_rate: 650, tax_rate: 18, unit: 'LTR' });
  stockDb.saveItem(pads);
  stockDb.saveItem(oil);
  const op = saveLabourOp({ code: 'brk01', name: 'Front brake pad replace', hours: { hatch: 0.8, suv: 1.2 }, interval_km: 10000 });
  const asset = saveAsset({ kind: 'vehicle', reg_no: 'MH12AB1234', make: 'Maruti', model: 'Swift', owner_name: 'Mr Patil', phone: '9800000011', vclass: 'hatch' });
  const { job } = openJob({ date: DAY, asset, odometer: 48210, complaints: ['Brake noise'], technicians: ['tech1'] });
  return { pads, oil, op, asset, job };
}

test('labour hours by vehicle class × rate; flat price; SAC by asset kind; code unique', () => {
  const { op } = world();
  assert.equal(op.code, 'BRK01');
  assert.throws(() => saveLabourOp({ code: 'BRK01', name: 'x' }), /already used/);
  const s = { labour_rate: { hatch: 900, suv: 1200, all: 800 } };
  const h = labourLine(op, { cls: 'hatch', kind: 'vehicle', settings: s, date: DAY });
  assert.deepEqual([h.quantity, h.rate, h.amount, h.unit, h.hsn, h.tax_rate, h.sv?.labour_op_id], [0.8, 900, 720, 'HRS', '998714', 18, op.id]);
  assert.equal(labourLine(op, { cls: 'suv', kind: 'vehicle', settings: s }).amount, 1440);
  assert.equal(labourLine({ ...op, price: 499 }, { kind: 'appliance', settings: s }).amount, 499);
  assert.deepEqual([repairSac('vehicle'), repairSac('appliance'), repairSac('other')], ['998714', '998715', '998729']);
  assert.equal(loadLabourOps().length, 1);
});

test('estimate + supplementary estimate, approvals logged, merged on one bill; parts 18% / 5% and labour 18%; sublet markup', () => {
  const { pads, op, job } = world();
  const disc = { name: 'Disc', hsn: '8708', tax_rate: 5, sale_rate: 1000 };
  const q1 = makeEstimate(job.id, [partLine(pads, 1), labourLine(op, { cls: 'hatch', kind: 'vehicle', settings: { labour_rate: { hatch: 900 } } })], DAY);
  assert.equal(q1.doc_type, 'QUOTATION');
  assert.equal(q1.sv?.job?.number, job.number);
  approveEstimate(job.id, { quote_id: q1.id, by: 'Mr Patil', how: 'phone', note: 'Approved by phone, 11:40' });
  const q2 = makeEstimate(job.id, [partLine(disc, 2), subletLine('Disc skimming', 400, 25, 'vehicle', DAY)], DAY);
  const q3 = makeEstimate(job.id, [partLine(disc, 9)], DAY); // never approved
  approveEstimate(job.id, { quote_id: q2.id, by: 'Mr Patil', how: 'whatsapp' });
  assert.throws(() => approveEstimate(job.id, { quote_id: 'nope', by: 'x', how: 'phone' }), /estimate of this job/);
  assert.equal(localDb.invoices.getById(q1.id)?.quote_status, 'Accepted');
  const j = loadJobs()[0];
  assert.deepEqual([j.quote_ids?.length, j.approvals?.map((a) => a.how)], [3, ['phone', 'whatsapp']]);
  const inv = billWorkshopJob(job.id, DAY);
  assert.equal(inv.status, 'Sent');
  assert.deepEqual(inv.items.map((l) => [l.name, l.quantity, l.rate, l.tax_rate]), [['Brake pads (front)', 1, 2150, 18], ['Front brake pad replace', 0.8, 900, 18], ['Disc', 2, 1000, 5], ['Outside work — Disc skimming', 1, 500, 18]]);
  assert.equal(inv.sv?.job?.number, job.number);
  assert.ok(!inv.items.some((l) => l.quantity === 9), 'the unapproved estimate stays out');
  const links = getTable<{ from_id: string; to_id: string }>('doc_links');
  assert.deepEqual(links.filter((l) => l.to_id === inv.id).map((l) => l.from_id).sort(), [q1.id, q2.id].sort());
  assert.equal(loadJobs()[0].invoice_number, inv.invoice_number);
  assert.throws(() => billWorkshopJob(job.id, DAY), /already billed/);
  void q3;
});

test('parts issue → WIP → sale keeps stock totals; return of unused parts; never more than issued', () => {
  const { pads, op, job } = world();
  const q = makeEstimate(job.id, [partLine(pads, 2), labourLine(op, { cls: 'hatch', kind: 'vehicle', settings: { labour_rate: { hatch: 900 } } })], DAY);
  approveEstimate(job.id, { quote_id: q.id, by: 'Mr Patil', how: 'in person' });
  issueParts(loadJobs()[0], [{ item_id: 'pads', qty: 3 }], DAY);
  const wip = wipGodown();
  assert.equal(wip.kind, 'wip');
  assert.equal(getStockLevel('Brake pads (front)')!.qty, 10, 'an issue moves stock, it does not reduce it');
  assert.equal(issuedNet(loadJobs()[0], transfersDb.all(), wip.id).get('pads'), 3);
  assert.throws(() => returnParts(loadJobs()[0], [{ item_id: 'pads', qty: 4 }], DAY), /no more than/);
  returnParts(loadJobs()[0], [{ item_id: 'pads', qty: 1 }], DAY);
  assert.equal(issuedNet(loadJobs()[0], transfersDb.all(), wip.id).get('pads'), 2);
  billWorkshopJob(job.id, DAY);
  assert.equal(issuedNet(loadJobs()[0], transfersDb.all(), wip.id).get('pads'), 0, 'billing moves the issued parts out of WIP');
  assert.equal(getStockLevel('Brake pads (front)')!.qty, 8, 'the sale takes them out once');
  assert.equal(loadJobs()[0].parts_issue?.length, 3);
});

test('billing sets the next service on the asset; AMC jobs bill parts only', () => {
  const { pads, op, job } = world();
  const q = makeEstimate(job.id, [partLine(pads, 1), labourLine(op, { cls: 'hatch', kind: 'vehicle', settings: { labour_rate: { hatch: 900 } } })], DAY);
  approveEstimate(job.id, { quote_id: q.id, by: 'Mr Patil', how: 'signature' });
  billWorkshopJob(job.id, DAY);
  const a = loadAssets()[0];
  assert.deepEqual([a.next_service_date, a.next_service_km], ['2027-04-18', 58210], 'default 180 days; op interval 10,000 km over the reading');
  const amcJob = openJob({ date: DAY, asset: a, complaints: ['AMC visit'], amc_id: 'amc1' }).job;
  const q2 = makeEstimate(amcJob.id, [partLine(pads, 1), labourLine(op, { kind: 'vehicle', settings: { labour_rate: { all: 800 } } })], DAY);
  approveEstimate(amcJob.id, { quote_id: q2.id, by: 'Mr Patil', how: 'phone' });
  const inv = billWorkshopJob(amcJob.id, DAY);
  assert.deepEqual(inv.items.map((l) => l.name), ['Brake pads (front)'], 'covered labour is not charged; parts are');
  assert.match(inv.notes, /AMC visit/);
});

test('parts warranty note; technician clock and efficiency (billed vs clocked hours)', () => {
  const { pads, op, job } = world();
  saveWorkshopSettings({ parts_warranty_months: 6 });
  const lab = labourLine(op, { cls: 'hatch', kind: 'vehicle', settings: { labour_rate: { hatch: 900 } }, staffId: 'tech1' });
  const q = makeEstimate(job.id, [partLine(pads, 1), lab], DAY);
  approveEstimate(job.id, { quote_id: q.id, by: 'Mr Patil', how: 'phone' });
  clockIn(loadJobs()[0], 'tech1', `${DAY}T10:00:00.000Z`);
  const e = clockOut(loadJobs()[0], { id: 'tech1', name: 'Ravi' }, new Date(`${DAY}T11:00:00.000Z`));
  assert.deepEqual([e.minutes, e.billable, e.job_id, e.staff_id], [60, false, job.id, 'tech1']);
  assert.throws(() => clockOut(loadJobs()[0], { id: 'tech1', name: 'Ravi' }), /not clocked in/);
  logTime(loadJobs()[0], { id: 'tech2', name: 'Anil' }, 30, DAY);
  const inv = billWorkshopJob(job.id, DAY);
  assert.match(inv.notes, /Parts warranty until 2027-04-20/);
  const rows = efficiency(timeDb.all(), getTable<InvoiceRecord>('invoices'));
  assert.deepEqual(rows.find((r) => r.staff_id === 'tech1'), { staff_id: 'tech1', billed: 0.8, clocked: 1, pct: 80 });
  assert.deepEqual(rows.find((r) => r.staff_id === 'tech2'), { staff_id: 'tech2', billed: 0, clocked: 0.5, pct: 0 });
  moveWorkshopJob(job.id, 'diagnosed', DAY);
});
