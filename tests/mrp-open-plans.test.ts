/**
 * 7.167 (PENDING 43): open production plans in the dated MRP — another open plan is netted first (its finished items as
 * demand at its due date, its materials exploded), less what it already put on released production orders; closed plans,
 * this plan itself and draft / cancelled orders are handled as described in `openPlanDemand`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openPlanDemand, runDatedMrp } from '../src/lib/mfg/mf-mrp-dated.ts';
import type { StockItem } from '../src/lib/inventory.ts';
import type { Bom, ProductionPlan } from '../src/types/manufacturing.ts';

const plan = (id: string, extra: Partial<ProductionPlan> = {}): ProductionPlan => ({
  id, number: `PP/${id}`, date: '2026-05-01', due_date: '2026-05-20', lines: [{ id: `${id}l`, item_id: 'table', qty: 10 }], ...extra,
});

test('open plans become dated demand, net of released orders made from them', () => {
  const plans = [plan('A'), plan('B', { closed: true }), plan('C', { due_date: undefined, date: '2026-05-05' }), plan('ME')];
  const orders = [
    { plan_id: 'A', item_id: 'table', planned_qty: 4, status: 'released' as const },
    { plan_id: 'A', item_id: 'table', planned_qty: 6, status: 'planned' as const },
    { plan_id: 'C', item_id: 'table', planned_qty: 10, status: 'cancelled' as const },
  ];
  assert.deepEqual(openPlanDemand(plans, orders, 'ME'), [
    { item_id: 'table', date: '2026-05-20', qty: 6, source: 'PP/A' },
    { item_id: 'table', date: '2026-05-05', qty: 10, source: 'PP/C' },
  ]);
});

test('another plan uses the shared component first: this plan buys the shortfall', () => {
  const items: StockItem[] = [
    { id: 'table', name: 'Table', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 },
    { id: 'leg', name: 'Leg', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 },
  ];
  const boms: Bom[] = [{ id: 'b', item_id: 'table', name: 'Std', batch_qty: 1, is_default: true, components: [{ id: 'c', item_id: 'leg', qty: 4 }] }];
  const mine = [{ item_id: 'table', date: '2026-05-25', qty: 5, source: 'Plan' }];
  const others = openPlanDemand([plan('A')], [], 'ME');
  const run = (demand: typeof mine) => runDatedMrp({ items, boms, stock: new Map([['leg', 50]]), demand, start: '2026-05-01', by: 'week', count: 6 })
    .find((r) => r.item.id === 'leg')!.suggested;
  assert.equal(run(mine), 0, 'alone, 50 legs cover 20');
  assert.equal(run([...mine, ...others]), 10, 'plan A takes 40 legs first: 60 needed, 10 to buy');
});
