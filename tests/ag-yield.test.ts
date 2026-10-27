/** AG-C2: mill starters are valid BOMs; outturn, by-product and loss maths; moisture loss; by-product credit = the engine's. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { thawDate } from './helpers/shim.ts';
import { millWorld, runBatch } from './helpers/mill.ts';
import { blankStockItem, stockDb } from '../src/lib/inventory.ts';
import { manufacturingDb, validateBom } from '../src/lib/manufacturing.ts';
import { productionOrdersDb } from '../src/lib/production/orders.ts';
import { MILL_STARTERS, starterBom, starterLoss } from '../src/lib/agri/ag-mill-bom.ts';
import { batchYield, defaultMillMeta, moistureLoss, setMillMeta, yieldOf, ZERO } from '../src/lib/agri/ag-yield.ts';

afterEach(() => thawDate());

test('starters: a valid BOM for each mill kind (main + co-products + by-products + loss = 100)', () => {
  for (const s of Object.values(MILL_STARTERS)) {
    const items = s.lines.map((l) => blankStockItem({ id: l.key, name: l.name, unit: 'QTL' }));
    const ids = Object.fromEntries(s.lines.map((l) => [l.key, l.key]));
    const bom = starterBom(s, ids);
    assert.equal(validateBom(bom, items), '', s.kind);
    assert.ok(starterLoss(s) >= 0 && starterLoss(s) <= 5, `${s.kind} loss ${starterLoss(s)}`);
  }
  assert.deepEqual([starterLoss(MILL_STARTERS.rice), starterLoss(MILL_STARTERS.oil)], [3, 3]);
  const rice = starterBom(MILL_STARTERS.rice, { paddy: 'p', rice: 'r', broken: 'b', bran: 'br', husk: 'h' }, { bran: 1500 });
  assert.deepEqual(rice.outputs?.map((o) => [o.item_id, o.qty, o.kind, o.cost_pct ?? o.rate]), [['b', 4, 'co_product', 5], ['br', 7, 'by_product', 1500], ['h', 22, 'by_product', 0]]);
});

test('moisture loss = in × (m_in − m_out) ÷ (100 − m_out); nothing without both readings or when m_out ≥ m_in', () => {
  assert.equal(moistureLoss(10000, 14, 13), 114.943);
  assert.equal(moistureLoss(10000, 19, 17), 240.964);
  assert.equal(moistureLoss(10000, 14, undefined), 0);
  assert.equal(moistureLoss(10000, 12, 13), 0);
  assert.equal(defaultMillMeta('oil').standard_outturn_pct, 33);
  assert.equal(defaultMillMeta(undefined).standard_outturn_pct, 67);
});

test('100 qtl paddy → 64 rice + 4 broken + 7 bran + 22 husk: outturn 68% vs 67%, loss 3% split into moisture and unexplained', () => {
  millWorld();
  const { order, voucher } = runBatch('2026-10-27', 100, 64, { input_moisture: 14, output_moisture: 13 });
  const y = batchYield(order, manufacturingDb.all(), stockDb.items());
  assert.deepEqual([y.input, y.main, y.co, y.by, y.loss], [10000, 6400, 400, 2900, 300], 'kg (QTL × 100)');
  assert.deepEqual([y.outturnPct, y.byPct, y.lossPct, y.standard, y.variance, y.flag], [68, 29, 3, 67, 1, null]);
  assert.deepEqual([y.moistureLoss, y.unexplained], [114.943, 185.057]);
  // By-product credit and the rice cost per qtl are the engine's own snapshot, not recomputed here.
  assert.equal(y.deductions, voucher.cost_snapshot?.deductions);
  assert.equal(y.deductions, 7 * 1500 + 22 * 400);
  assert.equal(y.unitCost, Math.round(((voucher.cost_snapshot?.finished ?? 0) / 64) * 100) / 100);
  assert.ok(y.unitCost > 0 && y.unitCost < 2300 * 100 / 64, 'after the by-product and co-product credit');
  // Standard 66 → 2 points over the tolerance of 1 → flagged.
  setMillMeta(order.id, { standard_outturn_pct: 66, std_source: 'own' });
  assert.equal(batchYield(productionOrdersDb.get(order.id)!, manufacturingDb.all(), stockDb.items()).flag, 'over');
  assert.equal(yieldOf({ ...ZERO, input: 100, main: 60, co: 4 }, { standard_outturn_pct: 67 }).flag, 'under');
});

test('mill meta: saved on the order (books.edit), validated, refused on a closed order', () => {
  millWorld();
  const { order } = runBatch('2026-10-27', 100, 64);
  assert.equal(order.ag, undefined);
  const o = setMillMeta(order.id, { standard_outturn_pct: 67, std_source: 'cmr', input_moisture: 17 });
  assert.deepEqual(o.ag?.mill, { standard_outturn_pct: 67, std_source: 'cmr', input_moisture: 17 });
  assert.throws(() => setMillMeta(order.id, { standard_outturn_pct: 0, std_source: 'own' }), /between 0 and 100/);
  assert.throws(() => setMillMeta(order.id, { standard_outturn_pct: 67, std_source: 'own', output_moisture: 100 }), /below 100/);
  productionOrdersDb.markCompleted(order.id);
  stockDb.saveItem(blankStockItem({ id: 'x', name: 'x' }));
  productionOrdersDb.close(order.id, { date: '2026-10-28' }, stockDb.items(), { items: stockDb.items() } as never);
  assert.throws(() => setMillMeta(order.id, { standard_outturn_pct: 67, std_source: 'own' }), /closed/);
});
