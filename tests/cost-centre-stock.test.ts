/**
 * 7.167 (PENDING 43): cost-centre closing stock — the stock lying in godowns tagged to a cost centre (or inside one),
 * valued like a branch's stock, opening = end of the day before the period, closing = end of the period.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectEvents, computeStock, type StockInputs, type StockItem } from '../src/lib/inventory.ts';
import { centreGodowns, centreOfGodown, costCentreStock, dayBefore } from '../src/lib/ledger/cost-centre-stock.ts';
import type { Godown, StockTransfer } from '../src/types/stock.ts';

const item = (id: string, extra: Partial<StockItem> = {}): StockItem => ({
  id, name: id, unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, ...extra,
});

test('godowns inherit the cost centre of their parent', () => {
  const godowns: Godown[] = [{ id: 'site', name: 'Site A', cost_centre_id: 'pA' }, { id: 'rack', name: 'Rack', parent_id: 'site' }, { id: 'free', name: 'Free' }];
  assert.equal(centreOfGodown('rack', godowns), 'pA');
  assert.equal(centreOfGodown('free', godowns), undefined);
  assert.deepEqual([...centreGodowns(godowns).get('pA')!].sort(), ['rack', 'site']);
  assert.equal(dayBefore('2026-04-01'), '2026-03-31');
  assert.equal(dayBefore('2026-03-01'), '2026-02-28');
});

test('opening and closing stock per cost centre follow transfers into and out of its godowns', () => {
  const items = [item('cement', { opening_qty: 100, opening_rate: 400 })];
  const godowns: Godown[] = [{ id: 'site', name: 'Site A', cost_centre_id: 'pA' }, { id: 'rack', name: 'Rack', parent_id: 'site' }];
  const transfers: StockTransfer[] = [
    { id: 't1', transfer_number: 'ST/1', date: '2026-03-20', from_godown: 'main', to_godown: 'site', lines: [{ id: 'a', item_id: 'cement', qty: 30 }] },
    { id: 't2', transfer_number: 'ST/2', date: '2026-04-10', from_godown: 'main', to_godown: 'rack', lines: [{ id: 'b', item_id: 'cement', qty: 20 }] },
    { id: 't3', transfer_number: 'ST/3', date: '2026-04-20', from_godown: 'site', to_godown: 'main', lines: [{ id: 'c', item_id: 'cement', qty: 10 }] },
  ] as StockTransfer[];
  const inputs: StockInputs = { items, moves: [], invoices: [], transfers };
  const out = costCentreStock(computeStock(inputs), collectEvents({ ...inputs, includeTransfers: true }), godowns, { start: '2026-04-01', end: '2026-04-30' });
  // Opening 30 × ₹400 = ₹12,000; closing (30 + 20 − 10) × ₹400 = ₹16,000 (paise).
  assert.deepEqual(out.get('pA'), { opening: 1200000, closing: 1600000 });
  assert.equal(out.size, 1);
});
