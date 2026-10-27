/**
 * MF-C2 lots and bundles: bundles from the cut, the `<lot>/<no>` ticket code, scan steps (default good = live pieces,
 * rejects leave the bundle with a reason), lot status sums, and finished bundles reported as one R4-A output journal per
 * variant child (output by variant equals the finished bundles).
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { loadPositions, stockDb } from '../src/lib/inventory.ts';
import { liveTrackingInputs } from '../src/lib/stock-tracking.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { loadOrderDocs, orderProgress, productionOrdersDb } from '../src/lib/production/orders.ts';
import { bundleId, finishedByVariant, lotStatus, makeBundles, parseBundleId, recordStep, reportFinished, saveBundles, scanStep } from '../src/lib/mfg/mf-bundles.ts';
import { cutPlanOf } from '../src/lib/mfg/mf-cutplans.ts';
import { lotWithOrder, SIZES } from './helpers/garments.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-10-12T10:00:00');
});
afterEach(() => thawDate());

test('bundles from the cut: 360 pieces in 12s → 30 bundles, sizes in the style order; ticket codes parse', () => {
  const b = makeBundles({ cut: { XL: 60, S: 60, M: 120, L: 120 }, colour: 'Blue' }, 12, SIZES);
  assert.equal(b.length, 30);
  assert.deepEqual([b[0].size, b[5].size, b.at(-1)!.size, b.at(-1)!.no], ['S', 'M', 'XL', 30]);
  assert.equal(makeBundles({ cut: { S: 25 }, colour: 'Blue' }, 12).map((x) => x.pieces).join(','), '12,12,1');
  assert.deepEqual(parseBundleId('cut/fy26-27/0014/7'), { lot: 'CUT/FY26-27/0014', no: 7 });
  assert.equal(parseBundleId('INV/FY26-27/0014/7'), null);
  assert.equal(bundleId('CUT/FY26-27/0014', 3), 'CUT/FY26-27/0014/3');
});

test('scan steps: default good, rejects need a reason and leave the bundle, over-count refused; lot status sums', () => {
  const { plan } = lotWithOrder();
  saveBundles(plan.id, 12, SIZES);
  const code = bundleId(plan.number, 1);
  let r = scanStep(code, { date: '2026-10-13', op: 'Stitching', by: 'k1' });
  assert.deepEqual([r.bundle.history[0].good, r.bundle.at.where], [12, 'floor']);
  assert.throws(() => scanStep(code, { date: '2026-10-13', op: 'Finishing', rejected: 2 }), /reason/);
  assert.throws(() => scanStep(code, { date: '2026-10-13', op: 'Finishing', good: 12, rejected: 1, reason: 'Hole' }), /holds 12/);
  r = scanStep(code, { date: '2026-10-14', op: 'Finishing', rejected: 2, reason: 'Hole', last: true });
  assert.deepEqual([r.bundle.history[1].good, r.bundle.rejected, r.bundle.at.where], [10, 2, 'finished']);
  assert.throws(() => scanStep(code, { date: '2026-10-14', op: 'Packing' }), /finished/);
  assert.throws(() => saveBundles(plan.id, 10), /being worked on/);
  let p = cutPlanOf(plan.id)!;
  p = recordStep(p, 2, { date: '2026-10-14', op: 'Cutting check', rejected: 12, reason: 'Shade' });
  assert.equal(p.bundles![1].at.where, 'rejected');
  const s = lotStatus(p);
  assert.deepEqual([s.cut, s.bundled, s.rejected, s.finishedBySize.S, s.wipBySize.S], [360, 360, 14, 10, 36]);
  assert.equal(s.open, 360 - 10 - 14, 'cut − finished − rejected');
  assert.equal(Object.values(s.byPlace).reduce((a, q) => a + q, 0) + s.rejected, 360);
});

test('finished bundles → one output journal per variant child, tagged with the order; reported once', () => {
  const { plan, orderId } = lotWithOrder();
  saveBundles(plan.id, 12, SIZES);
  for (const no of [1, 6, 7]) scanStep(bundleId(plan.number, no), { date: '2026-10-14', op: 'Packing', last: true });
  const p = cutPlanOf(plan.id)!;
  const rows = finishedByVariant(p, stockDb.items().find((i) => i.id === 'kt')!, stockDb.items());
  assert.deepEqual(rows.map((r) => [r.item_id, r.qty]), [['kt-S-Blue', 12], ['kt-M-Blue', 24]]);
  const ids = reportFinished(plan.id, '2026-10-14', stockDb.items(), liveTrackingInputs());
  assert.equal(ids.length, 2);
  const pos = new Map(loadPositions().map((x) => [x.item.id, x.qty]));
  assert.deepEqual([pos.get('kt-S-Blue'), pos.get('kt-M-Blue'), pos.get('kt') ?? 0], [12, 24, 0], 'variants produced, not the parent');
  const o = productionOrdersDb.get(orderId)!;
  assert.equal(orderProgress(o, loadOrderDocs()).output, 36);
  assert.throws(() => reportFinished(plan.id, '2026-10-14', stockDb.items(), liveTrackingInputs()), /No finished/);
});

test('demo garments block: a style with 15 variants, one lot of 300 pieces in 10 bundles, 2 karigars — only with the garments pack', async () => {
  const { mfgExtras } = await import('../src/lib/demo/profile-mfg.ts');
  const t = mfgExtras({ today: '2026-10-27', base: {} as never, packs: ['shopfloor', 'garments'] }).tables as Record<string, { id: string; variant_of?: string }[]>;
  assert.equal(t.stock_items.filter((i) => i.variant_of === 'demo-style-kt22').length, 15);
  const lot = t.cut_plans[0] as never;
  assert.deepEqual([lotStatus(lot).cut, lotStatus(lot).bundled, (lot as { bundles: unknown[] }).bundles.length], [300, 300, 10]);
  assert.equal(t.vendors.length, 2);
  assert.equal(mfgExtras({ today: '2026-10-27', base: {} as never, packs: ['shopfloor'] }).tables?.cut_plans, undefined);
});
