/**
 * R4-A1 production orders: required quantities (scrap %, alternate units), issue → partial output ×2 → completed,
 * consumption limited to the issued batches, close refused with WIP / after write-off, cancel and delete rules,
 * MRP → orders, sales-order pending lines → orders, WO numbering across the FY and the deleted-latest rule.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { blankStockItem, stockDb } from '../src/lib/inventory.ts';
import { computeTracking, liveTrackingInputs } from '../src/lib/stock-tracking.ts';
import { bomsDb } from '../src/lib/manufacturing.ts';
import { godownsDb } from '../src/lib/godowns.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import {
  buildIssueLines, buildOutputVoucher, cancelIssue, closeIssue, deleteIssue, explodeOrder, loadOrderDocs, materialRows,
  orderProgress, orderStatus, ordersFromSo, productionOrdersDb,
} from '../src/lib/production/orders.ts';
import { ordersFromMrp, runMrp } from '../src/lib/mrp.ts';
import { orderFulfilment } from '../src/lib/sales-orders.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-05-10T10:00:00');
});
afterEach(() => thawDate());

let seq = 0;
const nid = () => `id${++seq}`;

function setup() {
  stockDb.saveItem(blankStockItem({ id: 'cloth', name: 'Cloth', unit: 'MTR', track_batches: true }));
  stockDb.saveItem(blankStockItem({ id: 'thread', name: 'Thread', unit: 'NOS', opening_qty: 500, opening_rate: 1, alt_units: [{ unit: 'BOX', factor: 10 }] }));
  stockDb.saveItem(blankStockItem({ id: 'shirt', name: 'Shirt' }));
  stockDb.addMove({ id: 'm1', item_id: 'cloth', date: '2026-04-05', qty: 150, rate: 100, kind: 'purchase', batch_no: 'B1', expiry_date: '2027-01-01' });
  stockDb.addMove({ id: 'm2', item_id: 'cloth', date: '2026-04-06', qty: 150, rate: 110, kind: 'purchase', batch_no: 'B2', expiry_date: '2027-06-01' });
  const bom = bomsDb.save({ item_id: 'shirt', name: 'Standard', batch_qty: 1, components: [{ id: 'c1', item_id: 'cloth', qty: 2, scrap_pct: 5 }, { id: 'c2', item_id: 'thread', qty: 1 }] }, stockDb.items());
  return { bom };
}

const newOrder = (date = '2026-05-10', qty = 100) => productionOrdersDb.save({ date, item_id: 'shirt', planned_qty: qty }, stockDb.items(), bomsDb.all());
const tracking = (date: string) => computeTracking({ ...liveTrackingInputs(), asOf: date });

test('explode: scrap % grosses up, quantities in base units, per-unit standard kept', () => {
  const { bom } = setup();
  const m = explodeOrder(bom, 100, nid);
  assert.deepEqual(m.map((x) => [x.item_id, x.qty, x.scrap ?? 0, x.per_unit]), [['cloth', 210, 10, 2.1], ['thread', 100, 0, 1]]);
});

test('issue → partial output ×2 → completed; alternate-unit issue lines count in base units', () => {
  setup();
  let o = newOrder();
  assert.equal(o.number, 'WO/FY26-27/0001');
  assert.equal(o.status, 'planned');
  o = productionOrdersDb.release(o.id, bomsDb.all());
  const wip = godownsDb.list().find((g) => g.id === o.wip_godown_id);
  assert.equal(wip?.kind, 'wip', 'release creates the Shop floor (WIP) godown');
  assert.equal(o.status, 'released');
  // Cloth FEFO from Main: B1 (earlier expiry) first, then B2. Thread typed as 10 BOX = 100 NOS.
  const rows = materialRows(o, orderProgress(o, loadOrderDocs()));
  const lines = buildIssueLines(rows, stockDb.items(), tracking('2026-05-10'), '2026-05-10', 'main', new Map([['cloth', 210]]), nid);
  assert.deepEqual(lines.map((l) => [l.item_id, l.qty, l.batch_no]), [['cloth', 150, 'B1'], ['cloth', 60, 'B2']]);
  lines.push({ id: nid(), item_id: 'thread', qty: 10, unit: 'BOX', unit_factor: 10 });
  const { transfer, warnings } = productionOrdersDb.issue(o.id, { date: '2026-05-10', from: 'main', lines }, stockDb.items(), liveTrackingInputs());
  assert.match(transfer.transfer_number, /^STR\/FY26-27\//);
  assert.equal(transfer.production_order_id, o.id);
  assert.deepEqual(warnings, []);
  let p = orderProgress(o, loadOrderDocs());
  assert.deepEqual([p.issued.get('cloth'), p.issued.get('thread')], [210, 100]);
  assert.deepEqual(materialRows(o, p).map((r) => r.balance), [0, 0]);

  const out1 = buildOutputVoucher(o, p, bomsDb.all()[0], { qty: 60, date: '2026-05-11', batch_no: 'S1' }, nid);
  assert.deepEqual(out1.components.map((c) => [c.item_id, c.qty, c.batch_no ?? '', c.godown_id]), [['cloth', 126, 'B1', o.wip_godown_id], ['thread', 60, '', o.wip_godown_id]]);
  const v1 = productionOrdersDb.reportOutput(o.id, out1, stockDb.items(), liveTrackingInputs());
  assert.equal(v1.production_order_id, o.id);
  assert.equal(productionOrdersDb.get(o.id)?.status, 'in_progress');
  p = orderProgress(o, loadOrderDocs());
  const out2 = buildOutputVoucher(o, p, bomsDb.all()[0], { qty: 40, date: '2026-05-17' }, nid);
  assert.deepEqual(out2.components.map((c) => [c.item_id, c.qty, c.batch_no ?? '']), [['cloth', 24, 'B1'], ['cloth', 60, 'B2'], ['thread', 40, '']]);
  productionOrdersDb.reportOutput(o.id, out2, stockDb.items(), liveTrackingInputs());
  p = orderProgress(o, loadOrderDocs());
  assert.equal(p.output, 100);
  assert.equal(productionOrdersDb.get(o.id)?.status, 'completed');
  assert.equal([...p.held.values()].filter((q) => q > 0).length, 0, 'nothing left on the shop floor');
  assert.equal(closeIssue(productionOrdersDb.get(o.id)!, p, false), '');
  const closed = productionOrdersDb.close(o.id, { date: '2026-05-18' }, stockDb.items(), liveTrackingInputs());
  assert.equal(closed.status, 'closed');
  assert.ok(closed.log.some((r) => r.action === 'close'));
  assert.throws(() => productionOrdersDb.issue(o.id, { date: '2026-05-19', from: 'main', lines: [{ id: 'x', item_id: 'thread', qty: 1 }] }, stockDb.items(), liveTrackingInputs()), /closed/);
  const reopened = productionOrdersDb.reopen(o.id, 'late rework');
  assert.equal(reopened.status, 'completed', 'reopening derives the status again');
  assert.equal(reopened.log.at(-1)?.note, 'late rework');
});

test('consumption is limited to what was issued, and to the issued batches', () => {
  setup();
  const o = productionOrdersDb.release(newOrder().id, bomsDb.all());
  productionOrdersDb.issue(o.id, { date: '2026-05-10', from: 'main', lines: [{ id: 'a', item_id: 'cloth', qty: 100, batch_no: 'B2' }, { id: 'b', item_id: 'thread', qty: 100 }] }, stockDb.items(), liveTrackingInputs());
  const p = orderProgress(o, loadOrderDocs());
  const out = buildOutputVoucher(o, p, undefined, { qty: 60, date: '2026-05-11' }, nid);
  assert.deepEqual(out.components.map((c) => [c.item_id, c.qty, c.batch_no ?? '']), [['cloth', 100, 'B2'], ['thread', 60, '']]);
  assert.equal(orderStatus(o, p), 'released');
});

test('close is refused while the shop floor holds material; write-off as scrap closes it (consume-only stock journal)', () => {
  setup();
  const o = productionOrdersDb.release(newOrder().id, bomsDb.all());
  productionOrdersDb.issue(o.id, { date: '2026-05-10', from: 'main', lines: [{ id: 'a', item_id: 'thread', qty: 100 }] }, stockDb.items(), liveTrackingInputs());
  assert.match(closeIssue(o, orderProgress(o, loadOrderDocs()), false), /still holds/);
  assert.throws(() => productionOrdersDb.close(o.id, { date: '2026-05-12' }, stockDb.items(), liveTrackingInputs()), /still holds/);
  const closed = productionOrdersDb.close(o.id, { date: '2026-05-12', writeOff: true }, stockDb.items(), liveTrackingInputs());
  assert.equal(closed.status, 'closed');
  const p = orderProgress(o, loadOrderDocs());
  assert.equal(p.writeOffs.length, 1);
  assert.match(p.writeOffs[0].number, /^SJ\/FY26-27\//);
  assert.deepEqual(p.writeOffs[0].produce, []);
  assert.equal(p.writtenOff.get('thread'), 100);
  assert.equal(p.held.size, 0);
});

test('cancel and delete rules', () => {
  setup();
  const fresh = newOrder();
  assert.equal(deleteIssue(orderProgress(fresh, loadOrderDocs())), '');
  productionOrdersDb.remove(fresh.id);
  assert.equal(productionOrdersDb.all().length, 0);
  const o = productionOrdersDb.release(newOrder().id, bomsDb.all());
  productionOrdersDb.issue(o.id, { date: '2026-05-10', from: 'main', lines: [{ id: 'a', item_id: 'thread', qty: 30 }] }, stockDb.items(), liveTrackingInputs());
  assert.match(deleteIssue(orderProgress(o, loadOrderDocs())), /only be cancelled/);
  assert.throws(() => productionOrdersDb.remove(o.id), /only be cancelled/);
  assert.match(cancelIssue(o, orderProgress(o, loadOrderDocs())), /Return or write off/);
  productionOrdersDb.returnUnused(o.id, { date: '2026-05-11' }, liveTrackingInputs());
  assert.equal(productionOrdersDb.cancel(o.id).status, 'cancelled');
  // An order with output cannot be cancelled.
  const o2 = productionOrdersDb.release(newOrder('2026-05-12', 10).id, bomsDb.all());
  productionOrdersDb.issue(o2.id, { date: '2026-05-12', from: 'main', lines: [{ id: 'c', item_id: 'cloth', qty: 21, batch_no: 'B1' }, { id: 'd', item_id: 'thread', qty: 10 }] }, stockDb.items(), liveTrackingInputs());
  const p2 = orderProgress(o2, loadOrderDocs());
  productionOrdersDb.reportOutput(o2.id, buildOutputVoucher(o2, p2, undefined, { qty: 10, date: '2026-05-12', batch_no: 'S9' }, nid), stockDb.items(), liveTrackingInputs());
  assert.match(cancelIssue(o2, orderProgress(o2, loadOrderDocs())), /Close it instead/);
});

test('MRP make rows become production orders (one per row)', () => {
  const { bom } = setup();
  const rows = runMrp({ plan: [{ item_id: 'shirt', qty: 50 }], items: stockDb.items(), boms: [bom], stock: new Map([['cloth', 300], ['thread', 500]]) });
  const drafts = ordersFromMrp(rows, { id: 'pp1', number: 'PP/FY26-27/0001', due_date: '2026-06-01' });
  assert.deepEqual(drafts, [{ item_id: 'shirt', bom_id: bom.id, planned_qty: 50, plan_id: 'pp1', due_date: '2026-06-01', narration: 'From production plan PP/FY26-27/0001' }]);
  const saved = drafts.map((d) => productionOrdersDb.save({ date: '2026-05-10', ...d }, stockDb.items(), bomsDb.all()));
  assert.equal(saved[0].plan_id, 'pp1');
});

test('sales-order pending lines become orders (items with a BOM only, net of live orders, base units)', () => {
  const { bom } = setup();
  stockDb.saveItem(blankStockItem({ id: 'cap', name: 'Cap' }));
  stockDb.saveItem({ ...stockDb.items().find((i) => i.id === 'shirt')!, alt_units: [{ unit: 'DOZ', factor: 12 }] });
  const so = {
    id: 'so1', invoice_number: 'SO/FY26-27/0001', doc_type: 'SALES_ORDER', status: 'Sent', issue_date: '2026-05-01', due_date: '2026-05-31',
    items: [
      { id: 'L1', name: 'Shirt', quantity: 10, rate: 1000, unit: 'DOZ', unit_factor: 12 },
      { id: 'L2', name: 'Cap', quantity: 5, rate: 100 },
    ],
  } as unknown as InvoiceRecord;
  const f = orderFulfilment(so, [so], []);
  const drafts = ordersFromSo(so, f, stockDb.items(), [bom], [{ so_id: 'so1', so_line_id: 'L1', planned_qty: 20, status: 'released' }, { so_id: 'so1', so_line_id: 'L1', planned_qty: 99, status: 'cancelled' }]);
  assert.deepEqual(drafts.map((d) => [d.item_id, d.planned_qty, d.so_line_id, d.due_date]), [['shirt', 100, 'L1', '2026-05-31']]);
});

test('WO numbering follows the Indian FY and never reissues a deleted latest number', () => {
  setup();
  const a = newOrder('2026-03-30', 1);
  const b = newOrder('2026-04-02', 1);
  assert.deepEqual([a.number, b.number], ['WO/FY25-26/0001', 'WO/FY26-27/0001']);
  productionOrdersDb.remove(b.id);
  assert.equal(newOrder('2026-04-03', 1).number, 'WO/FY26-27/0002');
});
