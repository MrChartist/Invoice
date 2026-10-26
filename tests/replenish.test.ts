/**
 * R4-B5 store replenishment: the warehouse's free stock respects its own reorder level, pending requests and goods in
 * transit are netted, the remainder goes to a purchase suggestion with the MOQ, and several stores competing for one
 * source are served in godown-name order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replenishPlan, type ReorderRow } from '../src/lib/reorder.ts';
import type { StockItem } from '../src/lib/inventory.ts';
import type { TrackingMap } from '../src/lib/stock-tracking.ts';

const item = (id: string, extra: Partial<StockItem> = {}): StockItem => ({ id, name: id.toUpperCase(), unit: 'PCS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, ...extra } as StockItem);
const row = (it: StockItem, godown: string, closing: number, level: number, moq = 0): ReorderRow => ({
  item: it, godown, closing, reorderLevel: level, shortfall: Math.max(level - closing, 0), pendingPo: 0, minOrderQty: moq, suggested: 0, below: closing <= level, rate: 100, vendor: 'Mill',
});
const tracking = (byGodown: Record<string, Record<string, number>>): TrackingMap =>
  new Map(Object.entries(byGodown).map(([id, g]) => [id, { item: item(id), qty: 0, byGodown: g, batches: [], serials: [] }])) as unknown as TrackingMap;
const none = { pending: new Map<string, number>(), transit: new Map<string, number>() };
const GODOWNS = [
  { id: 'wh', name: 'Warehouse' },
  { id: 'mall', name: 'Mall', replenish_from: 'wh' },
  { id: 'high', name: 'High street', replenish_from: 'wh' },
  { id: 'solo', name: 'Solo' },
];

test('warehouse free stock respects its own reorder level; the rest becomes a purchase with the MOQ', () => {
  const shirt = item('shirt', { reorder_by_godown: { wh: 30, mall: 50 }, min_order_qty: 25 });
  const plan = replenishPlan([row(shirt, 'mall', 10, 50, 25)], GODOWNS, tracking({ shirt: { wh: 50 } }), none);
  assert.equal(plan.length, 1);
  assert.deepEqual([plan[0].source, plan[0].shortfall, plan[0].transfer, plan[0].purchase], ['wh', 40, 20, 25]);
});

test('pending requests and goods in transit are netted before anything is moved or bought', () => {
  const shirt = item('shirt');
  const open = { pending: new Map([['mall|shirt', 15]]), transit: new Map([['mall|shirt', 10]]) };
  const [r] = replenishPlan([row(shirt, 'mall', 0, 40)], GODOWNS, tracking({ shirt: { wh: 100 } }), open);
  assert.deepEqual([r.pendingRequests, r.inTransit, r.transfer, r.purchase], [15, 10, 15, 0]);
  // Fully covered: no row.
  assert.equal(replenishPlan([row(shirt, 'mall', 0, 20)], GODOWNS, tracking({ shirt: { wh: 100 } }), open).length, 0);
});

test('several stores compete for one source in godown-name order; godowns without a source are skipped', () => {
  const cap = item('cap');
  const rows = [row(cap, 'mall', 0, 30), row(cap, 'high', 0, 30), row(cap, 'solo', 0, 30), row(cap, 'wh', 0, 0)];
  const plan = replenishPlan(rows, GODOWNS, tracking({ cap: { wh: 40 } }), none);
  assert.deepEqual(plan.map((r) => [r.store, r.transfer, r.purchase]), [['high', 30, 0], ['mall', 10, 20]]);
  // No reorder row for a company-wide level (no godown): never replenished from a godown.
  assert.equal(replenishPlan([{ ...row(cap, 'mall', 0, 30), godown: undefined }], GODOWNS, tracking({ cap: { wh: 40 } }), none).length, 0);
});
