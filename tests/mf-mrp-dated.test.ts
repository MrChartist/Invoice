/** MF-A4 dated MRP: bucket netting, lead-time offset, past-due / late flags, same totals as mrp.ts over one bucket. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMrp } from '../src/lib/mrp.ts';
import { bucketKeys, runDatedMrp } from '../src/lib/mfg/mf-mrp-dated.ts';
import type { StockItem } from '../src/lib/inventory.ts';
import type { Bom } from '../src/types/manufacturing.ts';

const item = (id: string, x: Partial<StockItem> = {}): StockItem => ({ id, name: id, unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 10, reorder_level: 0, ...x });
const items = [item('fg', { make_days: 2 }), item('sub', { make_days: 1 }), item('raw', { lead_days: 7, min_order_qty: 50 })];
const boms: Bom[] = [
  { id: 'b1', item_id: 'fg', name: 'fg', batch_qty: 1, is_default: true, components: [{ id: 'c1', item_id: 'sub', qty: 2 }, { id: 'c2', item_id: 'raw', qty: 1, scrap_pct: 10 }] } as Bom,
  { id: 'b2', item_id: 'sub', name: 'sub', batch_qty: 1, is_default: true, components: [{ id: 'c3', item_id: 'raw', qty: 3 }] } as Bom,
];

test('week buckets start on Monday; demand netted per bucket in low-level order; lead-time offset; late and past-due flags', () => {
  assert.deepEqual(bucketKeys('2026-11-11', 'week', 3), ['2026-11-09', '2026-11-16', '2026-11-23']);
  const rows = runDatedMrp({
    items, boms, stock: new Map([['fg', 5], ['raw', 20]]), start: '2026-11-11', by: 'week', count: 4,
    demand: [{ item_id: 'fg', date: '2026-11-05', qty: 10, source: 'SO1' }, { item_id: 'fg', date: '2026-11-25', qty: 20, source: 'SO2' }],
    supply: [{ item_id: 'raw', date: '2026-11-18', qty: 100, source: 'PO1' }],
  });
  const fg = rows.find((r) => r.item.id === 'fg')!;
  assert.equal(fg.pastDue, true);
  assert.deepEqual(fg.buckets.map((b) => [b.gross, b.planned, b.poh]), [[10, 5, 0], [0, 0, 0], [20, 20, 0], [0, 0, 0]]);
  assert.deepEqual(fg.orders.map((o) => [o.qty, o.due, o.release, o.late]), [[5, '2026-11-09', '2026-11-07', true], [20, '2026-11-23', '2026-11-21', false]]);
  const sub = rows.find((r) => r.item.id === 'sub')!;
  assert.deepEqual(sub.buckets.map((b) => b.gross), [10, 40, 0, 0], 'components demanded in the bucket of the parent\'s release');
  const raw = rows.find((r) => r.item.id === 'raw')!;
  assert.equal(raw.action, 'buy');
  assert.equal(raw.lead, 7);
  assert.deepEqual(raw.orders.map((o) => [o.due, o.release]).slice(0, 1), [['2026-11-09', '2026-11-02']], 'order by = due − 7 days');
  assert.ok(raw.orders.length > 0 && raw.orders.every((o) => o.qty >= 50), 'minimum order quantity');
});

test('over a single bucket the totals equal runMrp', () => {
  const stock = new Map([['fg', 5], ['sub', 4], ['raw', 30]]);
  const plan = [{ item_id: 'fg', qty: 40 }];
  const flat = runMrp({ plan, items, boms, stock, onOrder: new Map([['raw', 12]]) });
  const dated = runDatedMrp({ items, boms, stock, start: '2026-11-09', by: 'week', count: 1, demand: [{ ...plan[0], date: '2026-11-12', source: 'Plan' }], supply: [{ item_id: 'raw', date: '2026-11-10', qty: 12, source: 'PO' }] });
  for (const r of flat) assert.equal(dated.find((d) => d.item.id === r.item.id)?.suggested, r.suggested, r.item.id);
});
