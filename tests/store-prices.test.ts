/**
 * R4-B3 store price lists: the full precedence table of `resolvePrice` with a store, the dated override switch-over,
 * quantity slabs after the store price, MRP-less-% store lists, the POS counter branch and the grid CSV round trip.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { resolvePrice, storeBasis, type PriceLevel } from '../src/lib/pricing.ts';
import {
  POS_BRANCH_KEY, branchContext, branchPricesDb, gridCsv, overrideOn, parseGridCsv, posBranch, priceGrid, readPosBranch, storePricingInUse, writePosBranch,
} from '../src/lib/retail/store-prices.ts';
import { branchesDb, type Branch } from '../src/lib/branch.ts';
import { setActorProvider } from '../src/lib/access.ts';
import type { BranchPrice } from '../src/types/stores-r4.ts';

beforeEach(() => {
  resetStorage();
  setActorProvider(null);
});

const ITEM = { id: 'shirt', rate: 1000, qty_slabs: [{ min_qty: 10, rate: 700 }] };
const WHOLESALE: PriceLevel = { id: 'w', name: 'Wholesale', rates: { shirt: 800 } };
const MALL_LIST: PriceLevel = { id: 'm', name: 'Mall list', percent_off: 0, rates: { shirt: 1100 } };
const OUTLET_LIST: PriceLevel = { id: 'o', name: 'Outlet', percent_off: 10 };
const MALL: Branch = { id: 'b-mall', name: 'Mall', price_level_id: 'm' };
const PRICES: BranchPrice[] = [
  { id: 'p1', branch_id: 'b-mall', item_id: 'shirt', from: '2026-04-01', rate: 1050 },
  { id: 'p2', branch_id: 'b-mall', item_id: 'shirt', from: '2026-06-01', rate: 990 },
];

test('precedence: customer level > store override > store price list > item price list (base) > catalogue', () => {
  const levels = [MALL_LIST, OUTLET_LIST];
  const ctx = (day: string, b: Branch = MALL, prices = PRICES) => branchContext(b, 'shirt', day, prices, levels);
  // 2. the customer's own level wins over everything the store sets
  assert.deepEqual(resolvePrice(ITEM, 1, WHOLESALE, ctx('2026-05-01')), { rate: 800, basis: 'Wholesale', source: 'level' });
  // 3. store's dated override
  assert.deepEqual(resolvePrice(ITEM, 1, null, ctx('2026-05-01')), { rate: 1050, basis: storeBasis('Mall'), source: 'branch' });
  // 4. store's price list (no override in force before 1 April)
  assert.deepEqual(resolvePrice(ITEM, 1, null, ctx('2026-03-01')), { rate: 1100, basis: 'Store price (Mall)', source: 'branch' });
  // 4. % off list on the base (here the item price-list rate the caller passes as `rate`)
  const outlet: Branch = { id: 'b-out', name: 'Outlet', price_level_id: 'o' };
  assert.equal(resolvePrice({ ...ITEM, rate: 900 }, 1, null, ctx('2026-05-01', outlet)).rate, 810);
  // 5 / 6. no store context → base (item price list or catalogue, whichever the caller passed)
  assert.deepEqual(resolvePrice(ITEM, 1, null, null), { rate: 1000, source: 'base' });
  assert.equal(branchContext(null, 'shirt', '2026-05-01', PRICES, levels), null);
  assert.equal(branchContext({ id: 'x', name: 'Plain' }, 'shirt', '2026-05-01', PRICES, levels), null);
});

test('dated override switch-over and quantity slabs below the store price', () => {
  assert.equal(overrideOn(PRICES, 'b-mall', 'shirt', '2026-05-31'), 1050);
  assert.equal(overrideOn(PRICES, 'b-mall', 'shirt', '2026-06-01'), 990);
  assert.equal(overrideOn(PRICES, 'b-mall', 'shirt', '2026-03-31'), undefined);
  const ctx = branchContext(MALL, 'shirt', '2026-06-15', PRICES, [MALL_LIST]);
  assert.deepEqual(resolvePrice(ITEM, 12, null, ctx), { rate: 700, basis: 'Qty ≥ 10', source: 'slab' });
  assert.equal(resolvePrice(ITEM, 2, null, ctx).rate, 990);
});

test('MRP-less-% store list follows the same order', () => {
  const mrpList: PriceLevel = { id: 'mrp', name: 'MRP less 20', percent_off: 20, basis: 'mrp' };
  const b: Branch = { id: 'b', name: 'Highway', price_level_id: 'mrp' };
  assert.equal(resolvePrice({ ...ITEM, mrp: 1500 }, 1, null, branchContext(b, 'shirt', '2026-05-01', [], [mrpList])).rate, 1200);
});

test('POS counter branch: device choice (outside the data prefix), else the business profile’s branch', () => {
  const branches: Branch[] = [{ id: 'a', name: 'A', profile_id: 'p1' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C', inactive: true }];
  assert.equal(posBranch(branches, 'p1', '')?.id, 'a');
  writePosBranch('b');
  assert.equal(readPosBranch(), 'b');
  assert.equal(globalThis.localStorage.getItem(POS_BRANCH_KEY), 'b');
  assert.ok(!POS_BRANCH_KEY.startsWith('mrchartist_inv_'), 'never backed up or synced');
  assert.equal(posBranch(branches, 'p1')?.id, 'b');
  assert.equal(posBranch(branches, 'p1', 'c')?.id, 'a', 'an archived branch is ignored');
  writePosBranch('');
  assert.equal(readPosBranch(), '');
  assert.equal(storePricingInUse(branches, []), false);
  assert.equal(storePricingInUse([...branches, MALL], []), true);
});

test('store: price list on the branch master; grid bulk save and CSV round trip', () => {
  const mall = branchesDb.save({ name: 'Mall', price_level_id: 'm' });
  const high = branchesDb.save({ name: 'High street' });
  assert.equal(branchesDb.get(mall.id)!.price_level_id, 'm');
  assert.equal(branchesDb.get(high.id)!.price_level_id, undefined);
  const items = [{ id: 'shirt', name: 'Shirt' }, { id: 'cap', name: 'Cap, red' }];
  const stores = [{ id: mall.id, name: 'Mall' }, { id: high.id, name: 'High street' }];
  assert.equal(branchPricesDb.bulk([{ branch_id: mall.id, item_id: 'shirt', from: '2026-04-01', rate: 1050 }, { branch_id: high.id, item_id: 'cap', from: '2026-04-01', rate: 250 }]), 2);
  const csv = gridCsv(items, stores, branchPricesDb.all(), '2026-05-01');
  assert.match(csv, /"Cap, red",,250/);
  // Round trip into a fresh table: same grid.
  const parsed = parseGridCsv(csv, items, stores, '2026-04-01');
  assert.deepEqual(parsed.unknown, []);
  resetStorage();
  branchPricesDb.bulk(parsed.cells);
  const g = priceGrid(branchPricesDb.all(), ['shirt', 'cap'], [mall.id, high.id], '2026-05-01');
  assert.equal(g.get('shirt')!.get(mall.id), 1050);
  assert.equal(g.get('cap')!.get(high.id), 250);
  // "-" clears; unknown names are reported.
  const clear = parseGridCsv(`Item,Mall,Nowhere\nShirt,-,5\nGhost,1,`, items, stores, '2026-04-01');
  assert.deepEqual(clear.unknown, ['Nowhere', 'Ghost']);
  branchPricesDb.bulk(clear.cells);
  assert.equal(priceGrid(branchPricesDb.all(), ['shirt'], [mall.id], '2026-05-01').get('shirt')!.size, 0);
  // Viewer cannot edit store prices.
  setActorProvider(() => ({ id: 'v', name: 'V', role: 'viewer' }));
  assert.throws(() => branchPricesDb.set(mall.id, 'shirt', '2026-04-01', 5));
});
