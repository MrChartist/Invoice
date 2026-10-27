/** MF-A3 job cards: totals, flow rule, out-of-sequence, overlap, scrap kg into the output journal once, payroll units, a year of 20 machines. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { blankStockItem, computeStock, stockDb } from '../src/lib/inventory.ts';
import { liveTrackingInputs } from '../src/lib/stock-tracking.ts';
import { bomsDb } from '../src/lib/manufacturing.ts';
import { buildIssueLines, buildOutputVoucher, loadOrderDocs, materialRows, orderProgress, productionOrdersDb } from '../src/lib/production/orders.ts';
import { computeTracking } from '../src/lib/stock-tracking.ts';
import { saveCentre } from '../src/lib/mfg/mf-centres.ts';
import { saveRouting } from '../src/lib/mfg/mf-routings.ts';
import { cardTotals, cardsOfOpenOrders, hoursBetween, loadCards, outputExtras, removeEntry, reportEntry, unitsByEmployee } from '../src/lib/mfg/mf-jobcards.ts';
import { floorDay } from '../src/lib/mfg/mf-floor-report.ts';
import type { JobCard } from '../src/types/mfg-r13.ts';
import type { ProductionOrder } from '../src/types/production-r4.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ industry_packs: ['shopfloor'] } as never);
  freezeDate('2026-05-10T10:00:00');
});
afterEach(() => thawDate());

function setup() {
  stockDb.saveItem(blankStockItem({ id: 'steel', name: 'Steel', unit: 'KG', opening_qty: 1000, opening_rate: 60 }));
  stockDb.saveItem(blankStockItem({ id: 'br', name: 'Bracket' }));
  stockDb.saveItem(blankStockItem({ id: 'scrap', name: 'MS off-cuts', unit: 'KG', sale_rate: 28 }));
  bomsDb.save({ item_id: 'br', name: 'Std', batch_qty: 1, components: [{ id: 'c', item_id: 'steel', qty: 0.5 }] }, stockDb.items());
  const shifts = [{ name: 'S', hours: 8 }];
  const laser = saveCentre({ name: 'Laser', kind: 'machine', hourly_rate: 1800, shifts, days: [1, 2, 3, 4, 5, 6] });
  const brake = saveCentre({ name: 'Brake', kind: 'machine', hourly_rate: 900, shifts, days: [1, 2, 3, 4, 5, 6] });
  saveRouting({ item_id: 'br', name: 'Std', is_default: true, ops: [{ id: 'cut', seq: 10, name: 'Cut', work_centre_id: laser.id, setup_min: 15, run_min_per_unit: 3 }, { id: 'bend', seq: 20, name: 'Bend', work_centre_id: brake.id, setup_min: 15, run_min_per_unit: 2 }] });
  const o = productionOrdersDb.release(productionOrdersDb.save({ date: '2026-05-10', item_id: 'br', planned_qty: 200 }, stockDb.items(), bomsDb.all()).id, bomsDb.all());
  return { o, laser, brake };
}

test('totals, hours from start / stop (past midnight), flow rule, out-of-sequence switch, overlap warning', () => {
  const { o } = setup();
  assert.equal(hoursBetween('09:00', '16:40'), 7.67);
  assert.equal(hoursBetween('22:00', '02:00'), 4);
  const { card } = reportEntry(o.id, 'cut', { date: '2026-05-10', start: '09:00', end: '16:40', good: 118, rejected: 2, reason: 'Burr', scrap_kg: 3.4, scrap_item_id: 'scrap', operator: { kind: 'employee', id: 'e1' } });
  assert.match(card.number, /^JCD\/FY26-27\/0001$/);
  assert.deepEqual(cardTotals(card), { good: 118, rejected: 2, rework: 0, hours: 7.67, scrapKg: 3.4 });
  assert.throws(() => reportEntry(o.id, 'bend', { date: '2026-05-10', hours: 5, good: 120 }), /Only 118/);
  assert.throws(() => reportEntry(o.id, 'cut', { date: '2026-05-10', hours: 1, rejected: 1 }), /reason/);
  reportEntry(o.id, 'bend', { date: '2026-05-10', hours: 5, good: 118 });
  assert.doesNotThrow(() => reportEntry(o.id, 'bend', { date: '2026-05-11', hours: 1, good: 10 }, { allowOutOfSequence: true }));
  const w = reportEntry(o.id, 'cut', { date: '2026-05-10', start: '16:00', end: '18:00', good: 10 }).warnings;
  assert.equal(w.length, 1, 'overlapping spell on the same machine warns');
  assert.equal(loadCards().filter((c) => c.order_id === o.id).length, 2, 'one card per order per operation');
  const c = loadCards().find((x) => x.op_id === 'cut')!;
  removeEntry(c.id, c.entries[1].id);
  assert.equal(loadCards().find((x) => x.op_id === 'cut')!.entries.length, 1);
  const day = floorDay(loadCards(), [], '2026-05-10');
  assert.equal(day.operators.find((x) => x.id === 'e1')?.good, 118);
});

test('scrap kg enters stock once, through the order\'s output journal; deleting nothing posts it twice', () => {
  const { o } = setup();
  reportEntry(o.id, 'cut', { date: '2026-05-10', hours: 4, good: 100, scrap_kg: 0.7, scrap_item_id: 'scrap' });
  reportEntry(o.id, 'cut', { date: '2026-05-11', hours: 4, good: 100, scrap_kg: 0.5, scrap_item_id: 'scrap' });
  reportEntry(o.id, 'bend', { date: '2026-05-11', hours: 6, good: 200 });
  const ord = productionOrdersDb.get(o.id) as ProductionOrder;
  let p = orderProgress(ord, loadOrderDocs());
  const lines = buildIssueLines(materialRows(ord, p), stockDb.items(), computeTracking({ ...liveTrackingInputs(), asOf: '2026-05-11' }), '2026-05-11', 'main', new Map([['steel', 100]]), () => `l${Math.random()}`);
  productionOrdersDb.issue(o.id, { date: '2026-05-11', from: 'main', lines }, stockDb.items(), liveTrackingInputs());
  p = orderProgress(ord, loadOrderDocs());
  const ex = outputExtras(ord, stockDb.items());
  assert.equal(ex.ready, 200);
  assert.deepEqual(ex.scrapLines.map((l) => [l.item_id, l.qty, l.kind, l.rate, l.mf_jc]), [['scrap', 1.2, 'scrap', 28, true]]);
  const draft = buildOutputVoucher(ord, p, bomsDb.all()[0], { qty: 100, date: '2026-05-11' }, undefined, { scrapLines: ex.scrapLines });
  productionOrdersDb.reportOutput(o.id, draft, stockDb.items(), liveTrackingInputs());
  const qty = (id: string) => computeStock(liveTrackingInputs()).find((x) => x.item.id === id)?.qty;
  assert.equal(qty('scrap'), 1.2);
  assert.deepEqual(outputExtras(productionOrdersDb.get(o.id)!, stockDb.items()).scrapLines, [], 'already posted');
  const plain = buildOutputVoucher(ord, p, bomsDb.all()[0], { qty: 1, date: '2026-05-11' });
  assert.equal(plain.outputs.length, 0, 'without the extra argument the journal is as before');
  assert.deepEqual(plain.costs, []);
});

test('production units by employee and month; a year of a 20-machine shop: the week reads only open orders\' cards', () => {
  const cards: JobCard[] = [];
  const orders: Pick<ProductionOrder, 'id' | 'status' | 'date' | 'closed_at'>[] = [];
  for (let i = 0; i < 1500; i++) {
    const m = String((i % 12) + 1).padStart(2, '0');
    const date = `2026-${m}-10`;
    orders.push({ id: `o${i}`, status: i < 1480 ? 'closed' : 'released', date, closed_at: i < 1480 ? `2026-${m}-20` : undefined });
    for (let op = 0; op < 2; op++) {
      cards.push({ id: `c${i}-${op}`, number: `JCD/${i}`, date, order_id: `o${i}`, op_id: `op${op}`, work_centre_id: `wc${(i + op) % 20}`, planned: { qty: 10, hours: 1 }, status: 'running', entries: Array.from({ length: 10 }, (_, k) => ({ id: `e${k}`, date, hours: 1, good: 1, rejected: 0, rework: 0, operator: { kind: 'employee' as const, id: `emp${k % 3}` } })) });
    }
  }
  assert.equal(cards.reduce((s, c) => s + c.entries.length, 0), 30000);
  const week = cardsOfOpenOrders(orders, cards, '2026-12-14', '2026-12-20');
  assert.equal(week.length, 40, '20 open orders × 2 operations');
  assert.ok(week.every((c) => Number(c.order_id.slice(1)) >= 1480));
  assert.deepEqual(unitsByEmployee(cards.slice(0, 2), '2026-01'), { emp0: 8, emp1: 6, emp2: 6 });
  void localDb;
});
