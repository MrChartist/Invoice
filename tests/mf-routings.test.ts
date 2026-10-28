/** MF-A2 work centres and routings: rate sum, planned hours (run basis, batch), validation, CSV round trip, release snapshot, outside op prefill. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { blankStockItem, stockDb } from '../src/lib/inventory.ts';
import { bomsDb } from '../src/lib/manufacturing.ts';
import { productionOrdersDb } from '../src/lib/production/orders.ts';
import { availableHours, machineHourRate, removeCentre, saveCentre, validateCentre } from '../src/lib/mfg/mf-centres.ts';
import { loadRoutings, opsForQty, outsideSendHref, plannedHours, routingsCsv, routingsFromCsv, runMinutes, saveRouting, standardConversion, validateRouting } from '../src/lib/mfg/mf-routings.ts';
import type { WorkCentre } from '../src/types/mfg-r13.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
const shift = [{ name: 'S1', hours: 8 }];
const wc = (name: string, x: Partial<WorkCentre> = {}) => saveCentre({ name, kind: 'machine', hourly_rate: 1800, shifts: shift, days: [1, 2, 3, 4, 5, 6], ...x });

test('machine-hour rate is the sum of its parts; available hours by shifts, days, units, efficiency, holidays', () => {
  assert.equal(machineHourRate({ hourly_rate: 0, labour_rate: 450, power_rate: 120, overhead_rate: 30 }), 600);
  const c = wc('Laser 1', { shifts: [shift[0], { name: 'S2', hours: 8 }], capacity_units: 2, efficiency_pct: 75, holidays: ['2026-11-09'] });
  assert.equal(availableHours(c, '2026-11-10'), 24, '16 h × 2 × 75%');
  assert.equal(availableHours(c, '2026-11-08'), 0, 'Sunday off');
  assert.equal(availableHours(c, '2026-11-09'), 0, 'holiday');
  assert.match(validateCentre({ name: 'X', shifts: [{ name: 'a', hours: 30 }], days: [1] }), /24/);
  assert.match(validateCentre({ name: 'X', shifts: shift, days: [] }), /days/);
  assert.throws(() => wc('laser 1'), /exists/);
});

test('planned hours: per unit, per hour, per batch; efficiency; standard conversion', () => {
  assert.equal(runMinutes({ run_min_per_unit: 3 }, 200), 600);
  assert.equal(runMinutes({ run_units_per_hour: 30 }, 60), 120);
  assert.equal(runMinutes({ run_min_per_unit: 120, batch_size: 50 }, 120), 360, '3 batches × 2 h');
  assert.equal(plannedHours({ setup_min: 15, run_min_per_unit: 3 }, 200), 10.25);
  assert.equal(plannedHours({ setup_min: 30, run_min_per_unit: 3 }, 10, { efficiency_pct: 50 }), 2);
  const a = wc('Laser');
  const b = wc('Weld', { hourly_rate: 0, labour_rate: 450, power_rate: 150 });
  const ops = opsForQty({ ops: [{ id: 'o2', seq: 20, name: 'Weld', work_centre_id: b.id, setup_min: 0, run_min_per_unit: 6 }, { id: 'o1', seq: 10, name: 'Cut', work_centre_id: a.id, setup_min: 0, run_min_per_unit: 2 }] }, 30, [a, b]);
  assert.deepEqual(ops.map((o) => [o.seq, o.planned_hours, o.rate]), [[10, 1, 1800], [20, 3, 600]]);
  assert.equal(standardConversion(ops, 30), 120, '(1 × 1800 + 3 × 600) ÷ 30');
});

test('validation: work centre, negative times, duplicate seq; one default per item; centre in use cannot go', () => {
  const a = wc('Laser');
  const op = { id: 'x', seq: 10, name: 'Cut', work_centre_id: a.id, setup_min: 5 };
  assert.match(validateRouting({ item_id: 'i', name: 'R', ops: [{ ...op, work_centre_id: '' }] }, [a]), /work centre/);
  assert.match(validateRouting({ item_id: 'i', name: 'R', ops: [{ ...op, setup_min: -1 }] }, [a]), /negative/);
  assert.match(validateRouting({ item_id: 'i', name: 'R', ops: [op, { ...op, id: 'y' }] }, [a]), /twice/);
  const r1 = saveRouting({ item_id: 'i', name: 'R1', is_default: false, ops: [op] });
  assert.equal(r1.is_default, true, 'the first routing of an item is its default');
  saveRouting({ item_id: 'i', name: 'R2', is_default: true, ops: [op] });
  assert.deepEqual(loadRoutings().map((r) => [r.name, r.is_default]), [['R1', false], ['R2', true]]);
  assert.throws(() => removeCentre(a.id), /routing uses/);
});

test('CSV round trip (one row per operation)', () => {
  const a = wc('Laser');
  saveRouting({ item_id: 'i1', name: 'Std', is_default: true, ops: [{ id: 'o', seq: 10, name: 'Cut', work_centre_id: a.id, setup_min: 15, run_min_per_unit: 3, inspection: true }, { id: 'p', seq: 20, name: 'Coat', work_centre_id: a.id, setup_min: 0, run_min_per_unit: 120, batch_size: 50 }] });
  const csv = routingsCsv(loadRoutings(), () => 'Bracket', [a]);
  const back = routingsFromCsv(csv, (n) => (n === 'Bracket' ? 'i1' : undefined), [a]);
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.routings[0].ops.map((o) => [o.seq, o.name, o.setup_min, o.run_min_per_unit, o.batch_size ?? null, !!o.inspection]), [[10, 'Cut', 15, 3, null, true], [20, 'Coat', 0, 120, 50, false]]);
  assert.equal(routingsFromCsv(csv.replace('Laser', 'Nope'), () => 'i1', [a]).errors.length, 1);
});

test('release copies the default routing as a snapshot (shopfloor pack only); outside op → Material Out prefill', () => {
  stockDb.saveItem(blankStockItem({ id: 'steel', name: 'Steel', unit: 'KG', opening_qty: 1000, opening_rate: 60 }));
  stockDb.saveItem(blankStockItem({ id: 'br', name: 'Bracket' }));
  bomsDb.save({ item_id: 'br', name: 'Std', batch_qty: 1, components: [{ id: 'c', item_id: 'steel', qty: 0.5 }] }, stockDb.items());
  const a = wc('Laser');
  const plating = wc('Plating', { kind: 'outside', vendor_id: 'v1', hourly_rate: 0 });
  saveRouting({ item_id: 'br', name: 'Std', is_default: true, ops: [{ id: 'o1', seq: 10, name: 'Cut', work_centre_id: a.id, setup_min: 15, run_min_per_unit: 3 }, { id: 'o2', seq: 20, name: 'Zinc plate', work_centre_id: plating.id, setup_min: 0, run_min_per_unit: 0 }] });
  const plain = productionOrdersDb.release(productionOrdersDb.save({ date: '2026-05-10', item_id: 'br', planned_qty: 200 }, stockDb.items(), bomsDb.all()).id, bomsDb.all());
  assert.equal(plain.mf, undefined, 'without the pack the order is released exactly as before');
  localDb.settings.save({ ...localDb.settings.get(), industry_packs: ['shopfloor'] });
  const o = productionOrdersDb.release(productionOrdersDb.save({ date: '2026-05-10', item_id: 'br', planned_qty: 200 }, stockDb.items(), bomsDb.all()).id, bomsDb.all());
  assert.deepEqual(o.mf?.ops?.map((x) => [x.name, x.planned_hours, x.rate]), [['Cut', 10.25, 1800], ['Zinc plate', 0, 0]]);
  saveRouting({ ...loadRoutings()[0], ops: [{ id: 'o1', seq: 10, name: 'Cut', work_centre_id: a.id, setup_min: 60, run_min_per_unit: 9 }] });
  assert.equal(productionOrdersDb.get(o.id)?.mf?.ops?.[0].planned_hours, 10.25, 'a routing changed later never changes a released order');
  assert.equal(outsideSendHref(o.mf!.ops![0], o, [a, plating]), null);
  assert.equal(outsideSendHref(o.mf!.ops![1], o, [a, plating]), '/manufacturing?tab=jobwork&jw=out&mfout=v1~br~200~Zinc%20plate');
});
