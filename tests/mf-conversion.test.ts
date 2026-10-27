/** MF-D5 WIP with conversion cost: hours × rate, off by default (byte-identical journal), dated switch, AS 2 cap, memo WIP. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { blankStockItem, computeStock, stockDb } from '../src/lib/inventory.ts';
import { computeTracking, liveTrackingInputs } from '../src/lib/stock-tracking.ts';
import { bomsDb, manufacturingDb } from '../src/lib/manufacturing.ts';
import { buildIssueLines, buildOutputVoucher, loadOrderDocs, materialRows, orderProgress, productionOrdersDb } from '../src/lib/production/orders.ts';
import { loadCentres, saveCentre } from '../src/lib/mfg/mf-centres.ts';
import { saveRouting } from '../src/lib/mfg/mf-routings.ts';
import { loadCards, reportEntry } from '../src/lib/mfg/mf-jobcards.ts';
import { readMfgSettings, saveMfgSettings } from '../src/lib/mfg/mf-settings.ts';
import { absorbOn, absorbPatch, centreHoursInFy, conversionLine, liveMemoConversion, orderConversion, outputConversion, overheadFactor } from '../src/lib/mfg/mf-conversion.ts';
import type { ProductionOrder } from '../src/types/production-r4.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ industry_packs: ['shopfloor'] } as never);
  freezeDate('2026-05-12T10:00:00');
});
afterEach(() => thawDate());

function setup(normal?: number) {
  stockDb.saveItem(blankStockItem({ id: 'steel', name: 'Steel', unit: 'KG', opening_qty: 1000, opening_rate: 60 }));
  stockDb.saveItem(blankStockItem({ id: 'br', name: 'Bracket' }));
  bomsDb.save({ item_id: 'br', name: 'Std', batch_qty: 1, components: [{ id: 'c', item_id: 'steel', qty: 0.5 }] }, stockDb.items());
  const shifts = [{ name: 'S', hours: 8 }];
  const weld = saveCentre({ name: 'MIG', kind: 'manual', hourly_rate: 100, labour_rate: 450, power_rate: 120, overhead_rate: 200, shifts, days: [1, 2, 3, 4, 5, 6], ...(normal ? { normal_hours: normal } : {}) });
  saveRouting({ item_id: 'br', name: 'Std', is_default: true, ops: [{ id: 'weld', seq: 10, name: 'Weld', work_centre_id: weld.id, setup_min: 0, run_min_per_unit: 3 }] });
  const o = productionOrdersDb.release(productionOrdersDb.save({ date: '2026-05-10', item_id: 'br', planned_qty: 100 }, stockDb.items(), bomsDb.all()).id, bomsDb.all());
  reportEntry(o.id, 'weld', { date: '2026-05-11', hours: 4, good: 100 });
  const ord = productionOrdersDb.get(o.id) as ProductionOrder;
  const p0 = orderProgress(ord, loadOrderDocs());
  const lines = buildIssueLines(materialRows(ord, p0), stockDb.items(), computeTracking({ ...liveTrackingInputs(), asOf: '2026-05-11' }), '2026-05-11', 'main', new Map([['steel', 50]]), () => `l${Math.random()}`);
  productionOrdersDb.issue(o.id, { date: '2026-05-11', from: 'main', lines }, stockDb.items(), liveTrackingInputs());
  return { ord: productionOrdersDb.get(o.id) as ProductionOrder };
}

test('conversion = hours × the machine-hour rate snapshotted at release (machine + labour + power + overhead)', () => {
  const { ord } = setup();
  assert.equal(ord.mf!.ops![0].rate, 870);
  const c = orderConversion(ord, loadCards(), loadCentres(), '2026-05-12');
  assert.deepEqual([c.ops[0].hours, c.total, c.unabsorbed], [4, 3480, 0]);
});

test('off by default: no conversion line and the output journal is byte-identical to the plain one', () => {
  const { ord } = setup();
  assert.equal(absorbOn(readMfgSettings(), '2026-05-12'), false);
  assert.equal(outputConversion(ord, '2026-05-12'), undefined);
  const p = orderProgress(ord, loadOrderDocs());
  let n = 0;
  const id = () => `x${n++}`;
  const plain = JSON.stringify(buildOutputVoucher(ord, p, bomsDb.all()[0], { qty: 100, date: '2026-05-12' }, id));
  n = 0;
  const conv = outputConversion(ord, '2026-05-12');
  const hooked = JSON.stringify(buildOutputVoucher(ord, p, bomsDb.all()[0], { qty: 100, date: '2026-05-12' }, id, conv ? { conversion: conv } : undefined));
  assert.equal(hooked, plain);
  productionOrdersDb.reportOutput(ord.id, buildOutputVoucher(ord, p, bomsDb.all()[0], { qty: 100, date: '2026-05-12' }), stockDb.items(), liveTrackingInputs());
  assert.equal(computeStock(liveTrackingInputs()).find((x) => x.item.id === 'br')?.value, 3000, 'finished goods at material cost, as today');
});

test('dated switch: on from a date carries the conversion into the journal once; earlier dates stay material-only', () => {
  const { ord } = setup();
  saveMfgSettings(absorbPatch(readMfgSettings(), true, '2026-05-12'));
  assert.equal(absorbOn(readMfgSettings(), '2026-05-11'), false);
  assert.equal(outputConversion(ord, '2026-05-11'), undefined);
  const conv = outputConversion(ord, '2026-05-12')!;
  assert.deepEqual(conv.map((c) => [c.id, c.mode, c.value]), [['mf_conv', 'amount', 3480]]);
  const p = orderProgress(ord, loadOrderDocs());
  productionOrdersDb.reportOutput(ord.id, buildOutputVoucher(ord, p, bomsDb.all()[0], { qty: 100, date: '2026-05-12' }, undefined, { conversion: conv }), stockDb.items(), liveTrackingInputs());
  assert.equal(computeStock(liveTrackingInputs()).find((x) => x.item.id === 'br')?.value, 6480, 'material 3000 + conversion 3480');
  assert.equal(conversionLine(ord, loadCards(), loadCentres(), manufacturingDb.all(), readMfgSettings(), '2026-05-12'), undefined, 'absorbed once');
  saveMfgSettings(absorbPatch(readMfgSettings(), false, '2026-06-01'));
  assert.equal(absorbOn(readMfgSettings(), '2026-06-02'), false);
  assert.equal(absorbOn(readMfgSettings(), '2026-05-20'), true);
  assert.equal(readMfgSettings().absorb!.length, 2, 'append-only history');
});

test('normal-capacity cap (AS 2): overhead absorbed only up to normal hours; the rest is a period cost', () => {
  const { ord } = setup(2);
  const cards = loadCards();
  assert.equal(centreHoursInFy(cards, '2026-05-12').get(ord.mf!.ops![0].work_centre_id), 4);
  assert.equal(overheadFactor({ normal_hours: 2 }, 4), 0.5);
  const c = orderConversion(ord, cards, loadCentres(), '2026-05-12');
  assert.deepEqual([c.ops[0].overhead, c.unabsorbed, c.total], [400, 400, 3080]);
});

test('memo WIP conversion on open orders at report time (not in the stock engine)', () => {
  setup();
  const m = liveMemoConversion('2026-05-12');
  assert.deepEqual([m.rows.length, m.total], [1, 3480]);
  assert.equal(computeStock(liveTrackingInputs()).reduce((s, x) => s + Math.max(x.value, 0), 0), 60000, 'stock value unchanged by the memo');
});
