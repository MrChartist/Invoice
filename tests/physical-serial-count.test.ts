/**
 * 7.167 (PENDING 43): serial counts on Physical Stock — a serial-tracked item is counted by serial; missing serials post
 * as shortages from the godown they were in, serials found beyond the books post as an excess under those serials, and
 * the moves are checked like any voucher (a missing serial sold later, a found serial received again later).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { computeStock, stockVoucherInputs, blankStockItem, stockDb, type StockInputs, type StockItem } from '../src/lib/inventory.ts';
import { computeTracking, liveTrackingInputs, serialsInStock } from '../src/lib/stock-tracking.ts';
import { physicalLines, physicalStockDb, physicalSummary, validatePhysical } from '../src/lib/manufacturing.ts';
import type { PhysicalStockVoucher } from '../src/types/manufacturing.ts';
import type { Godown } from '../src/types/stock.ts';

const item = (id: string, extra: Partial<StockItem> = {}): StockItem => ({
  id, name: id.toUpperCase(), unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, ...extra,
});
const PHONES = [item('ph', { track_serials: true, opening_qty: 3, opening_rate: 500, opening_serials: ['S1', 'S2', 'S3'] })];
const inputs = (vouchers: PhysicalStockVoucher[] = []): StockInputs => ({ items: PHONES, moves: [], invoices: [], vouchers: stockVoucherInputs([], [], vouchers) });

test('serial count: S2 missing and X9 found → one shortage and one excess even though the count equals the book', () => {
  const [l] = physicalLines([{ id: 'a', item_id: 'ph', counted: 0, serials: ['S1', 's3', 'X9'] }], '2026-05-10', inputs());
  assert.deepEqual([l.counted, l.book_qty, l.diff], [3, 3, 0]);
  assert.deepEqual([l.serials_short, l.serials_excess, l.serials_short_godowns], [['S2'], ['X9'], ['main']]);
  assert.deepEqual(physicalSummary([l]), { shortageQty: 1, shortageValue: 500, excessQty: 1, excessValue: 500 });
  const v: PhysicalStockVoucher = { id: 'p1', number: 'PHY/1', date: '2026-05-10', lines: [l] };
  const after = inputs([v]);
  assert.deepEqual(serialsInStock(computeTracking(after).get('ph')), ['S1', 'S3', 'X9']);
  assert.equal(computeStock(after)[0].qty, 3);
});

test('a godown count only sees that godown; a company-wide count posts each missing serial from its own godown', () => {
  const godowns: Godown[] = [{ id: 'g2', name: 'Shop' }];
  const base: StockInputs = {
    items: PHONES, invoices: [], godowns,
    moves: [], transfers: [{ id: 't', transfer_number: 'ST/1', date: '2026-05-01', from_godown: 'main', to_godown: 'g2', lines: [{ id: 'x', item_id: 'ph', qty: 1, serials: ['S3'] }] }],
  } as StockInputs;
  const [shop] = physicalLines([{ id: 'a', item_id: 'ph', godown_id: 'g2', counted: 0, serials: [] }], '2026-05-10', base);
  assert.deepEqual([shop.book_qty, shop.serials_short], [1, ['S3']]);
  const [all] = physicalLines([{ id: 'b', item_id: 'ph', counted: 0, serials: ['S1'] }], '2026-05-10', base);
  assert.deepEqual([all.serials_short, all.serials_short_godowns], [['S2', 'S3'], ['main', 'g2']]);
  const adj = stockVoucherInputs([], [], [{ id: 'p', number: 'PHY/2', date: '2026-05-10', lines: [all] }])[0].adjust!;
  assert.deepEqual(adj.map((a) => [a.godown_id, a.qty, a.serials]), [['main', -1, ['S2']], ['g2', -1, ['S3']]]);
});

test('serial items are no longer refused; shape rules (base unit, duplicates, batches) still apply', () => {
  assert.equal(validatePhysical({ date: '2026-05-10', lines: [{ id: 'a', item_id: 'ph', counted: 0, serials: ['S1'] }] }, PHONES), '');
  assert.match(validatePhysical({ date: '2026-05-10', lines: [{ id: 'a', item_id: 'ph', counted: 0, serials: ['S1', 's1'] }] }, PHONES), /listed twice/);
  assert.match(validatePhysical({ date: '2026-05-10', lines: [{ id: 'a', item_id: 'ph', counted: 0, unit: 'BOX', unit_factor: 10 }] }, PHONES), /NOS/);
  const both = [item('ph', { track_serials: true, track_batches: true })];
  assert.match(validatePhysical({ date: '2026-05-10', lines: [{ id: 'a', item_id: 'ph', counted: 0 }] }, both), /batches and serials/);
});

beforeEach(() => {
  resetStorage();
  installSettings();
  freezeDate('2026-05-10T10:00:00');
});

test('saved through storage: posts the moves; a missing serial that is sold later is refused', () => {
  stockDb.saveItem(blankStockItem({ id: 'ph', name: 'Phone', track_serials: true, opening_qty: 3, opening_rate: 500, opening_serials: ['S1', 'S2', 'S3'] }));
  const items = stockDb.items();
  const v = physicalStockDb.save({ date: '2026-05-09', lines: [{ id: 'l', item_id: 'ph', counted: 0, serials: ['S1', 'S3'] }] }, items, liveTrackingInputs());
  assert.deepEqual(v.lines[0].serials_short, ['S2']);
  assert.deepEqual(serialsInStock(computeTracking(liveTrackingInputs()).get('ph')), ['S1', 'S3']);
  const later = { ...liveTrackingInputs() };
  later.moves = [...later.moves, { id: 'm', item_id: 'ph', date: '2026-05-12', qty: -1, rate: 1, kind: 'adjustment', serials: ['S3'] } as never];
  assert.throws(() => physicalStockDb.save({ date: '2026-05-10', lines: [{ id: 'l2', item_id: 'ph', counted: 0, serials: ['S1'] }] }, items, later), /S3 is sold or moved later/);
  // Found again in another godown's books: an excess of a serial already in stock is refused.
  assert.throws(() => physicalStockDb.save({ date: '2026-05-10', lines: [{ id: 'l3', item_id: 'ph', godown_id: 'g9', counted: 0, serials: ['S1'] }] }, items, liveTrackingInputs()), /S1 is already in stock/);
});
