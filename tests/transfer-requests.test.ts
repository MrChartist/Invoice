/**
 * R4-B4 transfer requests: request → dispatch 18 (FEFO batches, serials) → receive 17 + 1 short → write-off, the transit
 * godown back to zero, own-use e-Way JSON shape, the Rule 55 challan, the Sec 25(4) path untouched, branch-stock
 * attribution of goods in transit, the bell notices, fill rate and the period lock.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { blankStockItem, stockDb } from '../src/lib/inventory.ts';
import { computeTracking, liveTrackingInputs } from '../src/lib/stock-tracking.ts';
import { godownsDb, nonSaleableGodowns } from '../src/lib/godowns.ts';
import { clearOverrides, isPeriodLockedError } from '../src/lib/period-lock.ts';
import { setActorProvider, type Role } from '../src/lib/access.ts';
import {
  buildDispatchLines, fillRates, inTransitRows, loadRequestDocs, openQtyByStore, requestProgress, requestStatus, transferNotices,
  transferRequestsDb, transitGodownFor, unaccounted,
} from '../src/lib/retail/transfer-requests.ts';
import { EWAY_SUB_OWN_USE, buildEwayTransfer } from '../src/lib/eway-transfer.ts';
import { challanRows, transferChallanHtml } from '../src/lib/retail/transfer-challan.ts';
import { transferTaxPair } from '../src/lib/branch-transfer.ts';
import { branchGodownIds } from '../src/lib/ledger/branch-stock.ts';
import { branchesDb } from '../src/lib/branch.ts';
import { getTable } from '../src/lib/storage.ts';
import type { StockJournal } from '../src/types/manufacturing.ts';

const DAY = '2026-05-10';
const as = (role: Role | null) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role }) : null);

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => {
  as(null);
  thawDate();
});

function world() {
  const wh = godownsDb.save({ name: 'Warehouse' });
  const mall = godownsDb.save({ name: 'Mall', address: 'Phoenix Mall, Pune 411014' });
  stockDb.saveItem(blankStockItem({ id: 'shirt', name: 'Shirt', hsn: '6205', unit: 'PCS', tax_rate: 5, track_batches: true }));
  stockDb.saveItem(blankStockItem({ id: 'phone', name: 'Phone', hsn: '8517', unit: 'PCS', tax_rate: 18, track_serials: true }));
  stockDb.addMove({ id: 'm1', item_id: 'shirt', date: '2026-04-05', qty: 10, rate: 300, kind: 'purchase', batch_no: 'OLD', expiry_date: '2027-01-01', godown_id: wh.id });
  stockDb.addMove({ id: 'm2', item_id: 'shirt', date: '2026-04-06', qty: 20, rate: 300, kind: 'purchase', batch_no: 'NEW', expiry_date: '2028-01-01', godown_id: wh.id });
  stockDb.addMove({ id: 'm3', item_id: 'phone', date: '2026-04-06', qty: 3, rate: 10000, kind: 'purchase', godown_id: wh.id, serials: ['P1', 'P2', 'P3'] } as never);
  return { wh, mall };
}
const qtyIn = (item: string, godown: string) => computeTracking(liveTrackingInputs()).get(item)?.byGodown[godown] ?? 0;

test('request → dispatch 18 → receive 17 + 1 short → write-off: transit back to zero, batches kept', () => {
  const { wh, mall } = world();
  const req = transferRequestsDb.save({ date: DAY, from_godown: wh.id, to_godown: mall.id, lines: [{ id: 'l1', item_id: 'shirt', qty: 20 }], needed_by: '2026-05-12' });
  assert.equal(req.number, 'TRQ/FY26-27/0001');
  assert.equal(req.status, 'requested');

  const inputs = liveTrackingInputs();
  const lines = buildDispatchLines(new Map([['shirt', 18]]), stockDb.items(), computeTracking(inputs), DAY, wh.id, () => `x${Math.random()}`);
  assert.deepEqual(lines.map((l) => [l.batch_no, l.qty]), [['OLD', 10], ['NEW', 8]], 'first expiry first');
  const { request: d, transfer } = transferRequestsDb.dispatch(req.id, { date: DAY, lines }, inputs);
  assert.equal(transfer.leg, 'out');
  assert.equal(transfer.request_id, req.id);
  const transit = transitGodownFor(godownsDb.list(), mall.id)!;
  assert.equal(transit.kind, 'transit');
  assert.equal(transit.parent_id, mall.id);
  assert.equal(transit.name, 'In transit → Mall');
  assert.ok(nonSaleableGodowns(godownsDb.list()).has(transit.id), 'goods in transit cannot be sold');
  assert.equal(d.status, 'partly_dispatched');
  assert.equal(qtyIn('shirt', transit.id), 18);
  assert.equal(qtyIn('shirt', wh.id), 12);

  const r = transferRequestsDb.receive(req.id, { date: '2026-05-11', lines: [{ item_id: 'shirt', received: 17, short: 1 }] }, stockDb.items(), liveTrackingInputs());
  assert.equal(r.transfer!.leg, 'in');
  assert.deepEqual(r.transfer!.lines.map((l) => [l.batch_no, l.qty]), [['OLD', 10], ['NEW', 7]]);
  assert.equal(qtyIn('shirt', mall.id), 17);
  assert.equal(qtyIn('shirt', transit.id), 1, 'the short unit stays in transit');
  const ex = r.request.exceptions![0];
  assert.deepEqual([ex.kind, ex.qty, ex.status, ex.batch_no], ['short', 1, 'open', 'NEW']);
  assert.equal(unaccounted(requestProgress(r.request, loadRequestDocs()), r.request.exceptions).size, 0);
  assert.throws(() => transferRequestsDb.close(req.id), /still has goods in transit/);

  const w = transferRequestsDb.writeOff(req.id, ex.id, '2026-05-12', stockDb.items(), liveTrackingInputs());
  assert.equal(w.exceptions![0].status, 'written_off');
  const sj = getTable<StockJournal>('stock_journals')[0];
  assert.equal(sj.request_id, req.id);
  assert.deepEqual(sj.consume.map((l) => [l.godown_id, l.batch_no, l.qty]), [[transit.id, 'NEW', 1]]);
  assert.equal(qtyIn('shirt', transit.id), 0, 'transit godown back to zero');
  const p = requestProgress(w, loadRequestDocs());
  assert.equal(requestStatus(w, p), 'partly_dispatched', '2 were never sent');
  const closed = transferRequestsDb.close(req.id);
  assert.equal(closed.status, 'closed');
  assert.deepEqual(fillRates(transferRequestsDb.all(), loadRequestDocs(), '2026-05-20'), [{ godown: mall.id, requested: 20, received: 17, rate: 85 }]);
});

test('serials move by serial; found after a shortage; alternate units on the request convert with lineFactor', () => {
  const { wh, mall } = world();
  const req = transferRequestsDb.save({ date: DAY, from_godown: wh.id, to_godown: mall.id, lines: [{ id: 'l', item_id: 'phone', qty: 2 }] });
  const lines = buildDispatchLines(new Map([['phone', 2]]), stockDb.items(), computeTracking(liveTrackingInputs()), DAY, wh.id);
  assert.deepEqual(lines[0].serials, ['P1', 'P2']);
  transferRequestsDb.dispatch(req.id, { date: DAY, lines }, liveTrackingInputs());
  const r = transferRequestsDb.receive(req.id, { date: DAY, lines: [{ item_id: 'phone', received: 1, short: 1 }] }, stockDb.items(), liveTrackingInputs());
  assert.deepEqual(r.transfer!.lines[0].serials, ['P1']);
  const t = computeTracking(liveTrackingInputs()).get('phone')!;
  assert.equal(t.serials.find((s) => s.serial === 'P1')!.godown, mall.id);
  const transit = transitGodownFor(godownsDb.list(), mall.id)!;
  assert.equal(t.serials.find((s) => s.serial === 'P2')!.godown, transit.id);
  const found = transferRequestsDb.found(req.id, r.request.exceptions![0].id, '2026-05-13', liveTrackingInputs());
  assert.equal(found.exceptions![0].status, 'found');
  assert.equal(requestStatus(found, requestProgress(found, loadRequestDocs())), 'received');
  // A request typed in boxes of 10 is 30 base units.
  const box = transferRequestsDb.save({ date: DAY, from_godown: wh.id, to_godown: mall.id, lines: [{ id: 'b', item_id: 'shirt', qty: 3, unit: 'BOX', unit_factor: 10 }] });
  assert.equal(requestProgress(box, loadRequestDocs()).requested.get('shirt'), 30);
  assert.equal(openQtyByStore(transferRequestsDb.all(), loadRequestDocs()).pending.get(`${mall.id}|shirt`), 30);
});

test('own-use e-Way JSON and the Rule 55 challan of a dispatch (value at cost, no tax)', () => {
  const { wh, mall } = world();
  const req = transferRequestsDb.save({ date: DAY, from_godown: wh.id, to_godown: mall.id, lines: [{ id: 'l', item_id: 'shirt', qty: 5 }] });
  const lines = buildDispatchLines(new Map([['shirt', 5]]), stockDb.items(), computeTracking(liveTrackingInputs()), DAY, wh.id);
  const { transfer } = transferRequestsDb.dispatch(req.id, { date: DAY, lines }, liveTrackingInputs());
  const p = localDb.settings.activeProfile()!;
  const out = buildEwayTransfer(transfer, { sender: { name: p.companyName, gstin: p.companyGstin, stateCode: p.stateCode }, fromAddress: 'Bhiwandi 421302', toAddress: mall.address, items: stockDb.items(), costOf: () => 300, vehicle: 'mh 12 ab 1234' });
  const b = out.bill;
  assert.equal(b.supplyType, 'O');
  assert.equal(b.subSupplyType, EWAY_SUB_OWN_USE);
  assert.equal(b.docType, 'CHL');
  assert.equal(b.docNo, transfer.transfer_number);
  assert.equal(b.fromGstin, b.toGstin);
  assert.equal(b.totalValue, 1500);
  assert.equal(b.totInvValue, 1500);
  assert.deepEqual([b.cgstValue, b.sgstValue, b.igstValue], [0, 0, 0]);
  assert.equal(b.itemList[0].hsnCode, 6205);
  assert.equal(b.vehicleNo, 'MH12AB1234');
  assert.equal(b.toPincode, 411014);
  assert.equal(out.required, false, '₹1,500 intra-State');
  const html = transferChallanHtml(transfer, { company: { name: p.companyName, gstin: p.companyGstin }, from: { name: 'Warehouse' }, to: { name: 'Mall' }, items: stockDb.items(), costOf: () => 300, requestNumber: req.number });
  assert.match(html, /Rule 55/);
  assert.match(html, /Original for consignee/);
  assert.match(html, /verify with your CA/);
  assert.equal(challanRows(transfer, stockDb.items(), () => 300).reduce((s, r) => s + r.value, 0), 1500);
});

test('Sec 25(4): a dispatch between two GSTINs is flagged for the tax-invoice pair; branch stock counts transit for the receiver', () => {
  const { wh, mall } = world();
  const a = branchesDb.save({ name: 'Maharashtra WH', gstin: '27AABCU9603R1ZX', godown_id: wh.id });
  const b = branchesDb.save({ name: 'Karnataka store', gstin: '29AABCT1332L1ZY', godown_id: mall.id });
  const req = transferRequestsDb.save({ date: DAY, from_godown: wh.id, to_godown: mall.id, lines: [{ id: 'l', item_id: 'shirt', qty: 2 }] });
  const lines = buildDispatchLines(new Map([['shirt', 2]]), stockDb.items(), computeTracking(liveTrackingInputs()), DAY, wh.id);
  const { transfer } = transferRequestsDb.dispatch(req.id, { date: DAY, lines }, liveTrackingInputs());
  const pair = transferTaxPair(transfer, branchesDb.all(), godownsDb.list());
  assert.deepEqual([pair?.from.id, pair?.to.id], [a.id, b.id], 'the existing Sec 25(4) dialog applies to the dispatch STR');
  const transit = transitGodownFor(godownsDb.list(), mall.id)!;
  assert.ok(branchGodownIds(b.id, branchesDb.all(), godownsDb.list()).has(transit.id), 'in a branch view the goods belong to the receiver');
  assert.ok(!branchGodownIds(a.id, branchesDb.all(), godownsDb.list()).has(transit.id));
});

test('views and bell: in transit with age and value; aged transit and late requests noticed', () => {
  const { wh, mall } = world();
  const req = transferRequestsDb.save({ date: DAY, from_godown: wh.id, to_godown: mall.id, lines: [{ id: 'l', item_id: 'shirt', qty: 4 }], needed_by: '2026-05-11' });
  const late = transferRequestsDb.save({ date: DAY, from_godown: wh.id, to_godown: mall.id, lines: [{ id: 'l', item_id: 'shirt', qty: 1 }], needed_by: '2026-05-11' });
  const lines = buildDispatchLines(new Map([['shirt', 4]]), stockDb.items(), computeTracking(liveTrackingInputs()), DAY, wh.id);
  transferRequestsDb.dispatch(req.id, { date: DAY, lines }, liveTrackingInputs());
  const rows = inTransitRows(transferRequestsDb.all(), loadRequestDocs(), () => 300, '2026-05-15');
  assert.deepEqual(rows.map((r) => [r.request.number, r.qty, r.value, r.age]), [[req.number, 4, 1200, 5]]);
  const notes = transferNotices(transferRequestsDb.all(), loadRequestDocs(), '2026-05-15', 3, 'now');
  assert.equal(notes.length, 2);
  assert.match(notes[0].title, /in transit for more than 3 days/);
  assert.match(notes[1].detail, new RegExp(late.number.replace(/\//g, '\\/')));
});

test('roles, approvals and the period lock', () => {
  const { wh, mall } = world();
  as('viewer');
  assert.throws(() => transferRequestsDb.save({ date: DAY, from_godown: wh.id, to_godown: mall.id, lines: [{ id: 'l', item_id: 'shirt', qty: 1 }] }));
  as('clerk');
  const req = transferRequestsDb.save({ date: DAY, from_godown: wh.id, to_godown: mall.id, lines: [{ id: 'l', item_id: 'shirt', qty: 1 }] });
  assert.throws(() => transferRequestsDb.approve(req.id), 'approval is the owner’s');
  as(null);
  assert.equal(transferRequestsDb.approve(req.id).status, 'approved');
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-05-31' });
  let err: unknown;
  try {
    transferRequestsDb.save({ date: DAY, from_godown: wh.id, to_godown: mall.id, lines: [{ id: 'l', item_id: 'shirt', qty: 1 }] });
  } catch (e) {
    err = e;
  }
  assert.ok(isPeriodLockedError(err));
  const lines = buildDispatchLines(new Map([['shirt', 1]]), stockDb.items(), computeTracking(liveTrackingInputs()), DAY, wh.id);
  assert.throws(() => transferRequestsDb.dispatch(req.id, { date: DAY, lines }, liveTrackingInputs()), (e: unknown) => isPeriodLockedError(e));
  assert.equal(getTable('stock_transfers').length, 0, 'nothing half-written');
  assert.throws(() => transferRequestsDb.remove(req.id), (e: unknown) => isPeriodLockedError(e));
});
