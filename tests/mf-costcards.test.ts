/** MF-D1 cost cards: yield, cost per pack with packing, margin by price level, what-if, versions by effective_from. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { cardAt, cardCost, costCardsDb, latestPurchaseRates, linesFromBom, standardRate, validateCard, whatIf, type CostCard } from '../src/lib/mfg/mf-costcards.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ industry_packs: ['shopfloor', 'foodmfg'] } as never);
});

const card = (over: Partial<CostCard> = {}): CostCard => ({
  id: 'c1', item_id: 'bhujia', name: 'Aloo bhujia', effective_from: '2026-04-01',
  lines: [
    { item_id: 'besan', name: 'Besan', qty: 40, unit: 'KG', rate: 80 },
    { item_id: 'potato', name: 'Potato', qty: 60, unit: 'KG', rate: 20 },
    { item_id: 'oil', name: 'Oil', qty: 22, unit: 'LTR', rate: 140 },
    { item_id: 'spice', name: 'Spices', qty: 3, unit: 'KG', rate: 300 },
  ],
  output_kg: 98, conversion_per_kg: 12, overhead_pct: 5,
  packs: [{ id: 'p200', label: '200 g', pack_kg: 0.2, packing: [{ label: 'Film', cost: 1.2 }, { label: 'Carton share', cost: 0.4 }], prices: { distributor: 30, retailer: 34, mrp: 40 } }],
  ...over,
});

test('yield, batch cost, cost per kg and per pack with packing, margins at each price', () => {
  const c = cardCost(card());
  assert.equal(c.inputWeight, 125);
  assert.equal(c.yieldPct, 78.4);
  assert.equal(c.inputCost, 8380); // 3200 + 1200 + 3080 + 900
  assert.equal(c.conversion, 1176); // 12 × 98
  assert.equal(c.overhead, 477.8); // 5% of 9556
  assert.equal(c.batchCost, 10033.8);
  assert.equal(c.perKg, 102.39);
  const [p] = c.packs;
  assert.deepEqual([p.product, p.packing, p.perPack], [20.48, 1.6, 22.08]);
  assert.deepEqual(p.margins.map((m) => [m.level, m.margin, m.pct]), [['distributor', 7.92, 26.4], ['retailer', 11.92, 35.06], ['mrp', 17.92, 44.8]]);
});

test('what-if at the latest purchase rate (base units, void bills skipped)', () => {
  const bill = (id: string, date: string, rate: number, extra = {}) => ({ id, kind: 'PURCHASE', vendor_name: 'V', bill_number: id, date, lines: [{ id: 'l', name: 'Besan', quantity: 2, rate, unit: 'BAG', unit_factor: 50, item_id: 'besan' }], taxable: 2 * rate, total: 2 * rate, ...extra });
  const rates = latestPurchaseRates([bill('a', '2026-04-05', 4000), bill('b', '2026-05-05', 4500), bill('c', '2026-06-05', 9000, { status: 'void' })], [{ id: 'besan', name: 'Besan' }], '2026-06-30');
  assert.equal(rates.get('besan'), 90);
  const w = whatIf(card(), rates);
  assert.deepEqual(w.rows.map((r) => [r.name, r.standard, r.latest, r.delta]), [['Besan', 80, 90, 400]]);
  assert.ok(w.current.batchCost > w.standard.batchCost);
});

test('recipe from the BOM at standard cost; versions by effective_from; validation; store', () => {
  const items = [{ id: 'besan', name: 'Besan', unit: 'KG', standard_costs: [{ from: '2026-01-01', rate: 75 }, { from: '2026-05-01', rate: 82 }], opening_rate: 70 }];
  assert.equal(standardRate(items[0], '2026-04-15'), 75);
  assert.deepEqual(linesFromBom({ batch_qty: 1, components: [{ item_id: 'besan', qty: 10, scrap_pct: 2 }] }, items, '2026-06-01')[0], { item_id: 'besan', name: 'Besan', qty: 10.2, unit: 'KG', rate: 82 });
  assert.match(validateCard({ ...card(), output_kg: 0 }), /output/);
  const a = costCardsDb.save({ ...card(), id: undefined });
  costCardsDb.save({ ...card(), id: undefined, effective_from: '2026-07-01', conversion_per_kg: 14 });
  costCardsDb.save({ ...card(), id: undefined, conversion_per_kg: 13 });
  assert.equal(costCardsDb.all().length, 2, 'same item + same date replaces that version');
  assert.equal(cardAt(costCardsDb.all(), 'bhujia', '2026-06-30')!.conversion_per_kg, 13);
  assert.equal(cardAt(costCardsDb.all(), 'bhujia', '2026-07-01')!.conversion_per_kg, 14);
  assert.equal(cardAt(costCardsDb.all(), 'bhujia', '2026-03-31'), undefined);
  costCardsDb.remove(a.id);
  assert.equal(costCardsDb.all().length, 1);
});
