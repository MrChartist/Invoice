/**
 * Phase 7M, pure logic: job work through the stock engine (Material Out stays our stock at the job worker's godown,
 * Material In consumes / produces at pooled cost, returned / supplied goods move back, losses), Sec 143 return
 * clocks and deemed-supply alerts, BOM consumption, principal's register, ITC-04 periods / tables, Rejections In
 * (stock back, challan balance), and alternate units on stock moves, transfers and stock journals.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectEvents, computeStock, stockVoucherInputs, type InvoiceLike, type StockInputs, type StockItem } from '../src/lib/inventory.ts';
import { computeTracking } from '../src/lib/stock-tracking.ts';
import {
  addYears, bomConsumption, challanBalances, findJobWorkerGodown, jobChargesLine, jobWorkAlerts, principalBalances,
  returnDeadline, stockWithJobWorkers, validateMaterialIn, validateMaterialOut,
} from '../src/lib/job-work.ts';
import { challanMovesStock } from '../src/lib/events-job-work.ts';
import { buildItc04, itc04Csv, itc04Frequency, itc04Periods } from '../src/lib/itc04.ts';
import { challanBalance, invoicedFrom, openChallans, rejectedByLine, validateRejectionIn } from '../src/lib/rejections-in.ts';
import { buildConvertedDraft } from '../src/lib/documents.ts';
import { roundTypedQty } from '../src/lib/units.ts';
import type { MaterialIn, MaterialOut, PrincipalMovement, RejectionIn } from '../src/types/job-work.ts';
import type { Godown } from '../src/types/stock.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { StockJournal } from '../src/types/manufacturing.ts';

const item = (id: string, name: string, extra: Partial<StockItem> = {}): StockItem => ({
  id, name, unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, ...extra,
});
const ITEMS = [
  item('rod', 'Steel rod', { opening_qty: 100, opening_rate: 50, unit: 'KG', alt_units: [{ unit: 'BAG', factor: 25 }] }),
  item('shaft', 'Machined shaft'),
  item('scrap', 'Steel scrap', { unit: 'KG' }),
  item('die', 'Press die', { opening_qty: 1, opening_rate: 10000 }),
];
const GODOWNS: Godown[] = [{ id: 'main', name: 'Main' }, { id: 'jw1', name: 'Acme (job worker)', job_worker: true, vendor_id: 'v1' }];

const out = (o: Partial<MaterialOut> = {}): MaterialOut => ({
  id: 'o1', number: 'JWC/FY26-27/0001', date: '2026-05-01', party_name: 'Acme', party_gstin: '29AABCT1332L1ZX', vendor_id: 'v1', job_worker_godown: 'jw1',
  lines: [{ id: 'ol1', item_id: 'rod', qty: 40, rate: 50, tax_rate: 18, hsn: '7214' }], ...o,
});
const inn = (v: Partial<MaterialIn> = {}): MaterialIn => ({
  id: 'i1', number: 'JWR/FY26-27/0001', date: '2026-05-20', party_name: 'Acme', job_worker_godown: 'jw1', jw_challan_no: 'AC/77', jw_challan_date: '2026-05-19',
  consumed: [{ id: 'c1', item_id: 'rod', qty: 30 }],
  received: [{ id: 'r1', item_id: 'shaft', qty: 10, kind: 'processed' }, { id: 'r2', item_id: 'scrap', qty: 2, kind: 'scrap', rate: 20 }],
  charges: 500, ...v,
});
const inputs = (outs: MaterialOut[], ins: MaterialIn[], extra: Partial<StockInputs> = {}): StockInputs => ({
  items: ITEMS, moves: [], invoices: [], jobWorkDocs: { outs, ins, rejections: [] }, ...extra,
});

test('Material Out: still our stock (company-wide unchanged), shown at the job worker godown', () => {
  const pos = new Map(computeStock(inputs([out()], [])).map((p) => [p.item.id, p]));
  assert.equal(pos.get('rod')!.qty, 100, 'goods with a job worker are still ours');
  assert.equal(pos.get('rod')!.value, 5000);
  const t = computeTracking({ ...inputs([out()], []), includeTransfers: true }).get('rod')!;
  assert.deepEqual(t.byGodown, { main: 60, jw1: 40 });
  // Without godown detail (as for stock transfers) the move is not listed at all.
  assert.equal((collectEvents(inputs([out()], [])).get('rod') ?? []).filter((e) => e.refType === 'job_work_out').length, 0);
});

test('Material In: inputs consumed at the job worker, processed goods at inputs + charges − scrap', () => {
  const pos = new Map(computeStock(inputs([out()], [inn()])).map((p) => [p.item.id, p]));
  assert.equal(pos.get('rod')!.qty, 70);
  assert.equal(pos.get('rod')!.consumedQty, 30, 'consumption, not a sale');
  assert.equal(pos.get('rod')!.soldQty, 0);
  assert.equal(pos.get('scrap')!.value, 40, 'scrap at its fixed value');
  // 30 kg × ₹50 = 1500 + 500 charges − 40 scrap = 1960 for 10 shafts.
  assert.deepEqual([pos.get('shaft')!.qty, pos.get('shaft')!.value], [10, 1960]);
  const t = computeTracking({ ...inputs([out()], [inn()]), includeTransfers: true });
  assert.deepEqual(t.get('rod')!.byGodown, { main: 60, jw1: 10 }, '10 kg still at the job worker');
  assert.deepEqual(t.get('shaft')!.byGodown, { main: 10 });
});

test('returned inputs move back; supplied from premises moves back for the invoice; losses leave stock', () => {
  const back = inn({ id: 'i2', number: 'JWR/FY26-27/0002', consumed: [], received: [{ id: 'r', item_id: 'rod', qty: 4, kind: 'returned' }], charges: undefined, losses: [{ id: 'l', item_id: 'rod', qty: 1 }], supplied: [{ id: 's', item_id: 'rod', qty: 5 }], supply_invoice_no: 'INV/FY26-27/0009' });
  const ins = [inn(), back];
  const t = computeTracking({ ...inputs([out()], ins), includeTransfers: true }).get('rod')!;
  assert.deepEqual(t.byGodown, { main: 69, jw1: 0 });
  const p = computeStock(inputs([out()], ins)).find((x) => x.item.id === 'rod')!;
  assert.equal(p.qty, 69);
  assert.equal(p.adjustedOutQty, 1, 'a loss is an adjustment, not a sale');
  const b = challanBalances([out()], ins, '2026-06-01');
  assert.deepEqual([b.lines[0].consumed, b.lines[0].returned, b.lines[0].supplied, b.lines[0].lost, b.lines[0].pending, b.lines[0].status], [30, 4, 5, 1, 0, 'settled']);
});

test('alternate units on job work lines: 2 BAG = 50 KG', () => {
  const o = out({ lines: [{ id: 'ol1', item_id: 'rod', qty: 2, unit: 'BAG', unit_factor: 25, rate: 1250 }] });
  const t = computeTracking({ ...inputs([o], []), includeTransfers: true }).get('rod')!;
  assert.deepEqual(t.byGodown, { main: 50, jw1: 50 });
  const b = challanBalances([o], [], '2026-05-02');
  assert.deepEqual([b.lines[0].sent, b.lines[0].pendingValue], [50, 2500]);
});

test('Sec 143 clocks: inputs 1 year, capital goods 3 years, tools none; extension; alerts and deemed supply', () => {
  assert.equal(returnDeadline('2026-05-01', 'input'), '2027-04-30');
  assert.equal(returnDeadline('2026-05-01', 'capital_goods'), '2029-04-30');
  assert.equal(returnDeadline('2026-05-01', 'mould_tool'), '');
  assert.equal(returnDeadline('2026-05-01', 'input', '2028-04-30'), '2028-04-30');
  assert.equal(addYears('2028-02-29', 1), '2029-02-28');
  const o = out({ lines: [{ id: 'a', item_id: 'rod', qty: 10, rate: 50 }, { id: 'b', item_id: 'die', qty: 1, rate: 10000, goods_kind: 'mould_tool' }] });
  const soon = challanBalances([o], [], '2027-04-10');
  assert.deepEqual(soon.lines.map((l) => l.status), ['due_soon', 'no_limit']);
  assert.equal(jobWorkAlerts(soon)[0].level, 'warning');
  const late = challanBalances([o], [], '2027-05-01');
  const a = jobWorkAlerts(late);
  assert.equal(a.length, 1);
  assert.equal(a[0].level, 'danger');
  assert.match(a[0].message, /deemed supply on 2026-05-01/);
  assert.match(a[0].message, /CA/);
  // Coming back after the clock is flagged late.
  const lateIn = challanBalances([o], [inn({ date: '2027-06-01', consumed: [], received: [{ id: 'r', item_id: 'rod', qty: 10, kind: 'returned' }] })], '2027-06-02');
  assert.deepEqual([lateIn.lines[0].status, lateIn.lines[0].late], ['settled', true]);
});

test('settlement: named challan line first, else FIFO oldest; excess is unmatched and refused', () => {
  const o1 = out();
  const o2 = out({ id: 'o2', number: 'JWC/FY26-27/0002', date: '2026-05-05', lines: [{ id: 'ol2', item_id: 'rod', qty: 20, rate: 50 }] });
  const fifo = challanBalances([o2, o1], [inn({ consumed: [{ id: 'c', item_id: 'rod', qty: 50 }] })], '2026-06-01');
  assert.deepEqual(fifo.lines.map((l) => l.pending), [0, 10]);
  const named = challanBalances([o1, o2], [inn({ consumed: [{ id: 'c', item_id: 'rod', qty: 15, out_line_id: 'ol2' }] })], '2026-06-01');
  assert.deepEqual(named.lines.map((l) => l.pending), [40, 5]);
  const v = inn({ id: '', consumed: [{ id: 'c', item_id: 'rod', qty: 45 }] });
  assert.match(validateMaterialIn(v, ITEMS, [o1], [], '2026-06-01'), /5 more than is pending/);
  assert.equal(validateMaterialIn(inn({ id: '' }), ITEMS, [o1], [], '2026-06-01'), '');
  assert.match(validateMaterialIn(inn({ id: '', consumed: [] }), ITEMS, [o1], [], '2026-06-01'), /inputs consumed/);
  assert.deepEqual(stockWithJobWorkers(fifo), [{ godown: 'jw1', party: 'Acme', item_id: 'rod', pending: 10, value: 500 }]);
});

test('Material Out validation: job worker godown, own source godown, batches, serials', () => {
  assert.equal(validateMaterialOut(out(), ITEMS, GODOWNS), '');
  assert.match(validateMaterialOut(out({ job_worker_godown: 'main' }), ITEMS, GODOWNS), /not a job worker/);
  assert.match(validateMaterialOut(out({ lines: [{ id: 'x', item_id: 'rod', qty: 1, godown_id: 'jw1' }] }), ITEMS, GODOWNS), /own godowns/);
  assert.match(validateMaterialOut(out({ lines: [{ id: 'x', item_id: 'rod', qty: 0 }] }), ITEMS, GODOWNS), /above zero/);
  assert.match(validateMaterialOut(out({ lines: [] }), ITEMS, GODOWNS), /at least one/);
  const serial = [...ITEMS, item('phone', 'Phone', { track_serials: true })];
  // 7S: serial-tracked items go by serial — one per unit.
  assert.match(validateMaterialOut(out({ lines: [{ id: 'x', item_id: 'phone', qty: 1 }] }), serial, GODOWNS), /serial number/);
  assert.equal(validateMaterialOut(out({ lines: [{ id: 'x', item_id: 'phone', qty: 1, serials: ['IMEI1'] }] }), serial, GODOWNS), '');
  assert.equal(findJobWorkerGodown(GODOWNS, { vendor_id: 'v1', name: 'Other' })?.id, 'jw1');
  assert.equal(findJobWorkerGodown(GODOWNS, { name: 'acme' })?.id, 'jw1');
  assert.equal(findJobWorkerGodown(GODOWNS, { name: 'Nobody' }), undefined);
});

test('BOM consumption, principal register and the job-charges service line', () => {
  let n = 0;
  const lines = bomConsumption({ batch_qty: 2, components: [{ id: 'c', item_id: 'rod', qty: 5, scrap_pct: 10 }] }, 10, () => `x${++n}`);
  assert.deepEqual(lines, [{ id: 'x1', item_id: 'rod', qty: 27.5 }]);
  const rows: PrincipalMovement[] = [
    { id: 'a', number: 'JWP/FY26-27/0001', date: '2026-05-01', kind: 'receipt', party_name: 'Big Co', lines: [{ id: 'l', name: 'Fabric', qty: 100, unit: 'MTR' }] },
    { id: 'b', number: 'JWP/FY26-27/0002', date: '2026-05-09', kind: 'return', party_name: 'big co', lines: [{ id: 'l', name: 'fabric', qty: 60 }] },
  ];
  assert.deepEqual(principalBalances(rows).map((b) => [b.name, b.received, b.returned, b.pending]), [['Fabric', 100, 60, 40]]);
  const line = jobChargesLine({ process: 'Dyeing', rate: 12, number: 'JWO/FY26-27/0001' }, 60, 5);
  assert.equal(line.hsn, '9988');
  assert.equal(line.type, 'Service');
  assert.equal(line.amount, 720);
});

test('ITC-04: frequency by turnover and FY (date-keyed), periods and due dates', () => {
  assert.equal(itc04Frequency(1e8, '2020-04-01'), 'Q', 'quarterly up to FY 2020-21');
  assert.equal(itc04Frequency(6e7, '2026-04-01'), 'H', 'above ₹5 crore: half-yearly');
  assert.equal(itc04Frequency(5e7, '2026-04-01'), 'A', 'up to ₹5 crore: annual');
  assert.deepEqual(itc04Periods(2026, 'H').map((p) => [p.from, p.to, p.due]), [['2026-04-01', '2026-09-30', '2026-10-25'], ['2026-10-01', '2027-03-31', '2027-04-25']]);
  assert.deepEqual(itc04Periods(2026, 'A').map((p) => [p.key, p.due]), [['FY26-27-Y', '2027-04-25']]);
  assert.deepEqual(itc04Periods(2019, 'Q').map((p) => p.due), ['2019-07-25', '2019-10-25', '2020-01-25', '2020-04-25']);
});

test('ITC-04 tables: 4 sent (IGST inter-state), 5A received back, 5B via another worker, 5C supplied', () => {
  const v2 = inn({ id: 'i2', number: 'JWR/FY26-27/0002', date: '2026-06-02', consumed: [], received: [{ id: 'r', item_id: 'rod', qty: 4, kind: 'returned' }], charges: undefined, via_party_name: 'Beta Works', via_party_gstin: '24AAACS1234A1ZQ', losses: [{ id: 'l', item_id: 'rod', qty: 1 }] });
  const v3 = inn({ id: 'i3', number: 'JWR/FY26-27/0003', date: '2026-06-03', consumed: [], received: [], charges: undefined, supplied: [{ id: 's', item_id: 'rod', qty: 5 }], supply_invoice_no: 'INV/9' });
  const r = buildItc04([out()], [inn(), v2, v3], '2026-04-01', '2026-09-30', { items: ITEMS, ourStateCode: '27', orderProcess: {} });
  assert.equal(r.table4.length, 1);
  assert.deepEqual([r.table4[0].qty, r.table4[0].uqc, r.table4[0].taxable_value, r.table4[0].igst, r.table4[0].cgst, r.table4[0].jw_state], [40, 'KGS', 2000, 360, 0, '29']);
  assert.deepEqual(r.table5.map((x) => [x.table, x.qty, x.loss_qty, x.original_challan_no]), [
    ['5A', 30, 0, 'JWC/FY26-27/0001'], ['5B', 4, 1, 'JWC/FY26-27/0001'], ['5C', 5, 0, 'JWC/FY26-27/0001'],
  ]);
  assert.equal(r.table5[0].nature, 'Processed into Machined shaft');
  assert.equal(r.table5[1].jw_state, '24');
  assert.equal(r.table5[2].jw_challan_no, 'INV/9');
  assert.match(r.notes[0], /verify with your CA/);
  const csv = itc04Csv(r);
  assert.match(csv, /Table 4/);
  assert.match(csv, /5C/);
  // Intra-state job worker: CGST + SGST; other periods are empty.
  const local = buildItc04([out({ party_gstin: '27AABCU9603R1ZM' })], [], '2026-04-01', '2026-09-30', { items: ITEMS, ourStateCode: '27' });
  assert.deepEqual([local.table4[0].cgst, local.table4[0].sgst, local.table4[0].igst], [180, 180, 0]);
  assert.equal(buildItc04([out()], [inn()], '2026-10-01', '2027-03-31', { items: ITEMS }).table4.length, 0);
});

/* ── Rejections In ────────────────────────────────────────────── */

const challan = (extra: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id: 'dc1', doc_type: 'DELIVERY_CHALLAN', status: 'Sent', invoice_number: 'DC/FY26-27/0001', issue_date: '2026-05-02',
  client: { name: 'Kumar Traders' }, items: [{ id: 'L1', name: 'Machined shaft', quantity: 8, rate: 300, unit: 'NOS' }], ...extra,
} as unknown as InvoiceRecord);
const rej = (extra: Partial<RejectionIn> = {}): RejectionIn => ({
  id: 'rj1', number: 'RJI/FY26-27/0001', date: '2026-05-04', challan_id: 'dc1', challan_number: 'DC/FY26-27/0001', client_name: 'Kumar Traders',
  lines: [{ id: 'x', challan_line_id: 'L1', name: 'Machined shaft', quantity: 3 }], ...extra,
});

test('Rejections In: stock back only while the challan moves stock; challan balance reduced', () => {
  const items = [item('shaft', 'Machined shaft', { opening_qty: 10, opening_rate: 100 })];
  const base = { items, moves: [], invoices: [challan() as InvoiceLike], includeChallans: true };
  assert.equal(computeStock(base)[0].qty, 2);
  const withRej = computeStock({ ...base, jobWorkDocs: { outs: [], ins: [], rejections: [rej()] } })[0];
  assert.equal(withRej.qty, 5, '3 rejected units are back in stock');
  assert.equal(withRej.soldQty, 5, 'the rejection reverses the challan issue');
  assert.equal(withRej.value, 500);
  // Challans not moving stock: the rejection moves nothing either.
  assert.equal(computeStock({ ...base, includeChallans: false, jobWorkDocs: { outs: [], ins: [], rejections: [rej()] } })[0].qty, 10);
  assert.equal(challanMovesStock(challan({ status: 'Cancelled' }), { invoices: [], includeChallans: true }), false);
  assert.deepEqual(challanBalance(challan(), [rej()]).map((b) => [b.sent, b.rejected, b.balance]), [[8, 3, 5]]);
  assert.deepEqual(rejectedByLine([rej(), rej({ id: 'rj2', lines: [{ id: 'y', challan_line_id: 'L1', name: 'x', quantity: 2 }] })], 'dc1'), { L1: 5 });
});

test('Rejections In validation and invoicing the balance', () => {
  const dc = challan();
  assert.equal(validateRejectionIn(rej({ id: '' }), dc, [], [dc], [], dc.issue_date), '');
  assert.match(validateRejectionIn(rej({ id: '', lines: [{ id: 'x', challan_line_id: 'L1', name: 'Machined shaft', quantity: 9 }] }), dc, [], [dc], [], dc.issue_date), /only 8/);
  assert.match(validateRejectionIn(rej({ id: '', date: '2026-05-01' }), dc, [], [dc], [], dc.issue_date), /before its challan/);
  const inv = { id: 'inv1', doc_type: 'TAX_INVOICE', status: 'Sent', invoice_number: 'INV/1' } as InvoiceRecord;
  const links = [{ from_id: 'dc1', to_id: 'inv1', relation: 'converted' }];
  assert.equal(invoicedFrom('dc1', [dc, inv], links), 'INV/1');
  assert.match(validateRejectionIn(rej({ id: '' }), dc, [], [dc, inv], links, dc.issue_date), /already invoiced/);
  assert.deepEqual(openChallans([dc, inv], links), []);
  assert.deepEqual(openChallans([dc], []).map((d) => d.id), ['dc1']);
  // Converting the challan bills only the balance.
  const draft = buildConvertedDraft(dc, 'TAX_INVOICE', { id: 'n', invoice_number: 'INV/2', today: '2026-05-06', dueDays: 14, rejected: { L1: 3 } });
  assert.deepEqual(draft.items.map((l) => l.quantity), [5]);
  assert.throws(() => buildConvertedDraft(dc, 'TAX_INVOICE', { id: 'n', invoice_number: 'INV/2', today: '2026-05-06', dueDays: 14, rejected: { L1: 8 } }), /nothing to invoice/);
});

/* ── Alternate units on stock moves, transfers, stock journals; decimal rounding ── */

test('alternate units: adjustment, transfer and stock journal lines convert with unit_factor', () => {
  const items = [item('rod', 'Steel rod', { opening_qty: 100, opening_rate: 50, unit: 'KG', alt_units: [{ unit: 'BAG', factor: 25 }] }), item('bar', 'Bar')];
  const moves = [{ id: 'm', item_id: 'rod', date: '2026-05-01', qty: 2, rate: 1250, kind: 'adjustment' as const, unit: 'BAG', unit_factor: 25 }];
  const p = computeStock({ items, moves, invoices: [] }).find((x) => x.item.id === 'rod')!;
  assert.deepEqual([p.qty, p.value], [150, 7500], '2 BAG @ ₹1250 = 50 KG @ ₹50');
  const transfers = [{ id: 't', transfer_number: 'STR/FY26-27/0001', date: '2026-05-02', from_godown: 'main', to_godown: 'g2', lines: [{ id: 'l', item_id: 'rod', qty: 1, unit: 'BAG', unit_factor: 25 }] }];
  const t = computeTracking({ items, moves, invoices: [], transfers, includeTransfers: true }).get('rod')!;
  assert.deepEqual(t.byGodown, { main: 125, g2: 25 });
  const sj: StockJournal = { id: 'j', number: 'SJ/FY26-27/0001', date: '2026-05-03', consume: [{ id: 'c', item_id: 'rod', qty: 1, unit: 'BAG', unit_factor: 25 }], produce: [{ id: 'p', item_id: 'bar', qty: 5 }], costs: [] };
  const v = stockVoucherInputs([], [sj]);
  assert.equal(v[0].consume[0].qty, 25);
  const pos = new Map(computeStock({ items, moves, invoices: [], vouchers: v }).map((x) => [x.item.id, x]));
  assert.equal(pos.get('rod')!.qty, 125);
  assert.deepEqual([pos.get('bar')!.qty, pos.get('bar')!.value], [5, 1250]);
});

test('typed quantities round to the unit master decimals', () => {
  assert.equal(roundTypedQty(2.6, 'NOS', []), 3);
  assert.equal(roundTypedQty(1.23456, 'KG', []), 1.235);
  assert.equal(roundTypedQty(1.239, 'MTR', []), 1.24);
  assert.equal(roundTypedQty(1.5, 'BAG', [{ id: 'u', symbol: 'BAG', decimals: 0 }]), 2);
  assert.equal(roundTypedQty('abc', 'KG', []), 0);
});
