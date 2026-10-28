/**
 * R4-A2 order costing. Hand-computed order: 2 components (A: 1 per unit + 5% scrap, standard ₹10; B: 2 per unit,
 * standard ₹4), bought at ₹11 / ₹4, standard conversion ₹2 per unit, ₹100 labour on each of two outputs, 95 of 100
 * made, the shop-floor balance written off on closing.
 *
 *   standard unit = 1.05 × 10 + 2 × 4 + 2 = ₹20.50   standard (planned) = ₹2,050   standard (95 made) = ₹1,947.50
 *   actual = 105 × 11 + 200 × 4 + 200 = ₹2,155
 *   price = (11 − 10) × 105 = ₹105   yield = (100 − 95) × 20.50 = ₹102.50   usage = conversion = ₹0
 *   105 + 0 + 102.50 + 0 = 207.50 = 2,155 − 1,947.50
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { blankStockItem, computeStock, computeStockDetailed, stockDb } from '../src/lib/inventory.ts';
import { liveTrackingInputs } from '../src/lib/stock-tracking.ts';
import { bomsDb, manufacturingDb } from '../src/lib/manufacturing.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { buildOutputVoucher, loadOrderDocs, orderProgress, productionOrdersDb } from '../src/lib/production/orders.ts';
import { materialsByCostCentre, orderCost, soMargins, varianceTone, type CostingContext } from '../src/lib/production/costing.ts';
import { getTable } from '../src/lib/storage.ts';
import type { ManufacturingVoucher, StockJournal } from '../src/types/manufacturing.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-05-20T10:00:00');
});
afterEach(() => thawDate());

function ctx(): CostingContext {
  const inputs = liveTrackingInputs();
  return {
    items: stockDb.items(),
    mfg: getTable<ManufacturingVoucher>('manufacturing_vouchers'),
    journals: getTable<StockJournal>('stock_journals'),
    computation: computeStockDetailed(inputs),
    wacOn: (id, day) => computeStock({ ...inputs, asOf: day }).find((p) => p.item.id === id)?.avgCost ?? 0,
  };
}

function scenario(standards = true) {
  const std = (rate: number) => (standards ? { standard_costs: [{ from: '2026-04-01', rate }] } : {});
  stockDb.saveItem(blankStockItem({ id: 'A', name: 'Fabric', unit: 'MTR', ...std(10) }));
  stockDb.saveItem(blankStockItem({ id: 'B', name: 'Button', opening_qty: 500, opening_rate: 4, ...std(4) }));
  stockDb.saveItem(blankStockItem({ id: 'F', name: 'Kurta' }));
  stockDb.addMove({ id: 'm1', item_id: 'A', date: '2026-04-10', qty: 200, rate: 11, kind: 'purchase' });
  bomsDb.save({ item_id: 'F', name: 'Standard', batch_qty: 1, components: [{ id: 'c1', item_id: 'A', qty: 1, scrap_pct: 5 }, { id: 'c2', item_id: 'B', qty: 2 }] }, stockDb.items());
  let o = productionOrdersDb.save({ date: '2026-05-01', item_id: 'F', planned_qty: 100, standard_conversion: 2, cost_centre_id: 'cc1', so_id: 'so1', so_line_id: 'L1' }, stockDb.items(), bomsDb.all());
  o = productionOrdersDb.release(o.id, bomsDb.all());
  productionOrdersDb.issue(o.id, { date: '2026-05-02', from: 'main', lines: [{ id: 'i1', item_id: 'A', qty: 105 }, { id: 'i2', item_id: 'B', qty: 200 }] }, stockDb.items(), liveTrackingInputs());
  const report = (qty: number, date: string) => {
    const draft = buildOutputVoucher(o, orderProgress(o, loadOrderDocs()), undefined, { qty, date });
    return productionOrdersDb.reportOutput(o.id, { ...draft, costs: [{ id: `k${qty}`, label: 'Labour', mode: 'amount', value: 100 }] }, stockDb.items(), liveTrackingInputs());
  };
  report(60, '2026-05-05');
  const second = report(35, '2026-05-08');
  return { o, second };
}

test('open order: price, usage and conversion add up to actual − standard of the output', () => {
  const { o } = scenario();
  const c = orderCost(productionOrdersDb.get(o.id)!, ctx());
  assert.equal(c.output, 95);
  assert.equal(c.std_unit, 20.5);
  assert.equal(c.standard, 2050);
  assert.equal(c.standard_for_output, 1947.5);
  assert.equal(c.actual_material, 1857.25); // 99.75 × 11 + 190 × 4
  assert.equal(c.actual_additional, 200);
  assert.equal(c.actual, 2057.25);
  assert.deepEqual([c.price, c.usage, c.yield, c.conversion], [99.75, 0, 0, 10]);
  assert.equal(c.variance, 109.75);
  assert.equal(c.favourable, false);
});

test('closed order (95 of 100, balance written off): each variance to the paisa, summing to actual − standard', () => {
  const { o } = scenario();
  productionOrdersDb.close(o.id, { date: '2026-05-09', writeOff: true }, stockDb.items(), liveTrackingInputs());
  const c = orderCost(productionOrdersDb.get(o.id)!, ctx());
  assert.equal(c.closed, true);
  assert.equal(c.actual_material, 1955);
  assert.equal(c.written_off, 97.75); // 5.25 × 11 + 10 × 4
  assert.equal(c.actual, 2155);
  assert.deepEqual([c.price, c.usage, c.yield, c.conversion], [105, 0, 102.5, 0]);
  assert.equal(c.variance, 207.5);
  assert.equal(Math.round((c.price + c.usage + c.yield + c.conversion - c.by_products) * 100) / 100, Math.round((c.actual - c.standard_for_output) * 100) / 100);
  assert.equal(c.yield_pct, 95);
  const a = c.components.find((x) => x.item_id === 'A')!;
  assert.deepEqual([a.actual_qty, a.actual_rate, a.std_rate, a.price, a.usage, a.yield], [105, 11, 10, 105, 0, 52.5]);
  assert.equal(varianceTone(c.price), 'adverse');
  assert.equal(varianceTone(-5), 'favourable');
  // Cost-centre memo: materials consumed in the period.
  const memo = materialsByCostCentre(productionOrdersDb.all(), ctx(), { start: '2026-04-01', end: '2027-03-31' });
  assert.equal(memo.get('cc1'), 1955);
});

test('an order without standards uses the weighted-average cost on the order date (flagged)', () => {
  const { o } = scenario(false);
  const c = orderCost(productionOrdersDb.get(o.id)!, ctx());
  const a = c.components.find((x) => x.item_id === 'A')!;
  assert.equal(a.no_standard, true);
  assert.equal(a.std_rate, 11, 'WAC of fabric on 1 May = ₹11');
  assert.equal(c.price, 0);
});

test('sales-order margin with a foreign-currency invoice (revenue in ₹ through the exchange rate)', () => {
  const { o } = scenario();
  productionOrdersDb.close(o.id, { date: '2026-05-09', writeOff: true }, stockDb.items(), liveTrackingInputs());
  const so = { id: 'so1', doc_type: 'SALES_ORDER', status: 'Sent', invoice_number: 'SO/FY26-27/0001', issue_date: '2026-04-28', items: [{ id: 'L1', name: 'Kurta', quantity: 100, rate: 30 }] };
  const inv = { id: 'i1', doc_type: 'TAX_INVOICE', status: 'Sent', sales_order_id: 'so1', currency: 'USD', exchange_rate: 80, items: [{ id: 'x', name: 'Kurta', quantity: 95, rate: 30, order_line_id: 'L1' }] };
  const [m] = soMargins([orderCost(productionOrdersDb.get(o.id)!, ctx())], [so, inv] as never, []);
  assert.equal(m.revenue, 228000);
  assert.equal(m.cost, 2155);
  assert.equal(m.margin, 225845);
  assert.equal(m.margin_pct, 99.1);
});

test('deleting an output journal recomputes the order and its costing', () => {
  const { o, second } = scenario();
  manufacturingDb.remove(second.id);
  const c = orderCost(productionOrdersDb.get(o.id)!, ctx());
  assert.equal(c.output, 60);
  assert.equal(orderProgress(o, loadOrderDocs()).held.get('A'), 42); // 105 − 63
});
