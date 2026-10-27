/**
 * MF-C1 styles and cut plans: pieces from lays, consumption and variance, the ratio suggestion (never more than ordered,
 * sums to the order), the order grid summing to the planned quantity, the CUT series, and the stock documents (fabric
 * issue / end-bit return / waste journal) moving stock once through R4-A.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { loadPositions, stockDb } from '../src/lib/inventory.ts';
import { liveTrackingInputs } from '../src/lib/stock-tracking.ts';
import { bomsDb } from '../src/lib/manufacturing.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { loadOrderDocs, orderProgress, productionOrdersDb } from '../src/lib/production/orders.ts';
import { consumption, issueCutFabric, laidMetres, loadCutPlans, piecesFromLays, removeCutPlan, returnEndBits, saveCutPlan, suggestLays, writeCutWaste } from '../src/lib/mfg/mf-cutplans.ts';
import { fabricFor, gridChildren, gridTotal, styleAxes, styleOf } from '../src/lib/mfg/mf-styles.ts';
import { SIZES, kurta } from './helpers/garments.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-10-12T10:00:00');
});
afterEach(() => thawDate());

const lays = [{ plies: 60, marker_ratio: { S: 1, M: 2, L: 2, XL: 1 }, marker_length_m: 7.2 }];

test('pieces from lays, laid metres, consumption and variance against the standard', () => {
  assert.deepEqual(piecesFromLays(lays), { S: 60, M: 120, L: 120, XL: 60 });
  assert.equal(laidMetres(lays), 432);
  const c = consumption({ lays, cut: piecesFromLays(lays), fabric_issued_m: 434.4, end_bits_m: 2.4 }, 1.25);
  assert.deepEqual([c.pieces, c.used_m, c.per_piece_m, c.standard_m, c.variance_m, c.variance_pct], [360, 432, 1.2, 450, -18, -4]);
});

test('ratio suggestion never cuts more than ordered and sums to the order', () => {
  const order = { S: 62, M: 125, L: 118, XL: 61 };
  const s = suggestLays(order, 6, 80);
  const cut = piecesFromLays(s);
  for (const k of Object.keys(order)) assert.equal(cut[k], order[k as keyof typeof order], k);
  assert.ok(s.every((l) => Object.values(l.marker_ratio).reduce((a, b) => a + b, 0) <= 6), 'marker capacity kept');
  assert.equal(s[0].plies, 61, 'plies = ⌈366 ÷ 6⌉ on the first (largest) lay');
  assert.deepEqual(piecesFromLays(suggestLays({ S: 3 }, 6, 1)), { S: 3 }, 'plies cap');
});

test('style axes, fabric by colour and the order grid summing to the planned quantity', () => {
  const p = kurta();
  assert.deepEqual(styleAxes(p).sizes, SIZES);
  assert.equal(styleOf(p)?.fabric_items[0].per_piece_m, 1.25);
  assert.deepEqual(fabricFor(styleOf(p), 'green'), { item_id: 'fab-g', per_piece_m: 1.25 });
  assert.equal(fabricFor(styleOf(p), 'Blue')?.item_id, 'fab');
  const grid = [{ colour: 'Blue', qty: [10, 20, 20, 10] }, { colour: 'Green', qty: [0, 5, 5, 0] }];
  assert.equal(gridTotal(grid), 70);
  assert.equal(gridChildren(p, stockDb.items(), grid, 70).length, 6);
  assert.throws(() => gridChildren(p, stockDb.items(), grid, 80), /70 pieces/);
});

test('CUT numbering, issue / end bits / waste journal move stock once through R4-A', () => {
  kurta();
  bomsDb.save({ item_id: 'kt', name: 'Std', batch_qty: 1, components: [{ id: 'c', item_id: 'fab', qty: 1.25 }] }, stockDb.items());
  const o = productionOrdersDb.release(productionOrdersDb.save({ date: '2026-10-12', item_id: 'kt', planned_qty: 360 }, stockDb.items(), bomsDb.all()).id, bomsDb.all());
  const p = saveCutPlan({ date: '2026-10-12', order_id: o.id, style_id: 'kt', colour: 'Blue', fabric_item_id: 'fab', lays, fabric_issued_m: 434.4, end_bits_m: 2.4, cut_waste_kg: 3, waste_item_id: 'waste' });
  assert.equal(p.number, 'CUT/FY26-27/0001');
  assert.equal(saveCutPlan({ ...p, lays }).number, p.number, 'an edit keeps the number');
  issueCutFabric(p.id, { date: '2026-10-12' }, stockDb.items(), liveTrackingInputs());
  returnEndBits(p.id, { date: '2026-10-12' }, liveTrackingInputs());
  writeCutWaste(p.id, { date: '2026-10-12', waste_m: 5, rate: 10 }, stockDb.items(), liveTrackingInputs());
  const prog = orderProgress(o, loadOrderDocs());
  assert.equal(prog.held.get('fab'), 427, 'issued 434.4 − end bits 2.4 − waste 5');
  const pos = new Map(loadPositions().map((x) => [x.item.id, x.qty]));
  assert.equal(pos.get('fab'), 595, 'only the waste metres left the books (transfers move, they do not consume)');
  assert.equal(pos.get('waste'), 3, 'cut waste kg in stock once');
  assert.throws(() => writeCutWaste(p.id, { date: '2026-10-12', waste_m: 5 }, stockDb.items(), liveTrackingInputs()), /already/);
  assert.throws(() => removeCutPlan(p.id), /delete them first/);
  const q = saveCutPlan({ date: '2026-10-13', style_id: 'kt', colour: 'Green', fabric_item_id: 'fab', lays, fabric_issued_m: 0 });
  assert.equal(q.number, 'CUT/FY26-27/0002');
  removeCutPlan(q.id);
  assert.equal(saveCutPlan({ date: '2026-10-13', style_id: 'kt', colour: 'Green', fabric_item_id: 'fab', lays, fabric_issued_m: 0 }).number, 'CUT/FY26-27/0003', 'a deleted number is never reused');
  assert.equal(loadCutPlans().length, 2);
  assert.throws(() => saveCutPlan({ date: '2026-10-13', style_id: 'kt', colour: 'Green', fabric_item_id: 'fab', lays: [], fabric_issued_m: 0 }), /lay/);
});
