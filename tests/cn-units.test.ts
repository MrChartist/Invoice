/** CN-C1 projects and units: bulk add by tower, the affordable test (both limits, both city classes), the class by
 * date with land one-third, the completion-certificate cut-off, unit status flow, RERA account flag. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { thawDate } from './helpers/shim.ts';
import { book, realtyWorld } from './helpers/realty.ts';
import { bankAccountsDb } from '../src/lib/bank-accounts.ts';
import { loadCostCentres } from '../src/lib/cost-centres.ts';
import { addUnits, bulkUnits, canMove, deleteUnit, loadUnits, saveUnit, unitPrice } from '../src/lib/construction/cn-units.ts';
import { deleteProject } from '../src/lib/construction/cn-realty-projects.ts';
import { afterCc, isAffordable, landSplit, splitTax, unitClass } from '../src/lib/construction/cn-realty-tax.ts';

afterEach(() => thawDate());

test('bulk add: floors × units per floor, "A-101" numbers, existing numbers skipped', () => {
  const w = realtyWorld();
  assert.deepEqual(w.units.map((u) => u.unit_no), ['A-101', 'A-102', 'A-103', 'A-104']);
  const more = bulkUnits({ project_id: w.project.id, tower_id: w.tower.id, tower: 'A', floors: 2, perFloor: 2, from: 1, type: 'residential', carpet_sqm: 50, base_rate: 4000 }, loadUnits());
  assert.deepEqual(more.map((u) => u.unit_no), ['A-201', 'A-202'], 'A-101 / A-102 exist already');
  assert.throws(() => addUnits({ project_id: w.project.id, tower_id: w.tower.id, tower: 'A', floors: 1, perFloor: 4, type: 'residential', carpet_sqm: 50, base_rate: 1 }), /No new units/);
  assert.equal(unitPrice(w.units[0]), 7500000, '1,500 sq ft × ₹5,000');
  assert.equal(unitPrice({ base_rate: 1000, carpet_sqm: 10, plc: [{ label: 'Corner', amount: 5000 }] }), 112639, 'carpet converted (10.7639) + PLC');
});

test('the project is a cost centre and flags its RERA account', () => {
  const w = realtyWorld();
  assert.ok(loadCostCentres().some((c) => c.id === w.project.cost_centre_id && c.kind === 'project'));
  assert.equal(bankAccountsDb.all().find((a) => a.id === 'rera')?.rera_project_id, w.project.id);
  assert.throws(() => deleteProject(w.project.id), /units first/);
});

test('affordable test: carpet 60 sq m metro / 90 sq m other AND value ≤ ₹45 lakh (both limits inclusive)', () => {
  assert.equal(isAffordable(60, 'metro', 4500000, '2026-06-01'), true);
  assert.equal(isAffordable(60.01, 'metro', 4500000, '2026-06-01'), false);
  assert.equal(isAffordable(90, 'other', 4500000, '2026-06-01'), true);
  assert.equal(isAffordable(90, 'metro', 4000000, '2026-06-01'), false, 'metro limit is 60 sq m');
  assert.equal(isAffordable(55, 'metro', 4500001, '2026-06-01'), false, 'value above ₹45 lakh');
  const proj = { city_class: 'other' as const, gst_scheme: 'n03_2019' as const };
  assert.equal(unitClass({ type: 'residential', carpet_sqm: 80 }, proj, 4000000, '2026-06-01'), 'realty_affordable');
  assert.equal(unitClass({ type: 'residential', carpet_sqm: 80 }, proj, 5000000, '2026-06-01'), 'realty_residential');
  assert.equal(unitClass({ type: 'commercial', carpet_sqm: 20 }, proj, 1000000, '2026-06-01'), 'realty_commercial');
  assert.equal(unitClass({ type: 'residential', carpet_sqm: 20 }, { ...proj, gst_scheme: 'old_option' }, 1000000, '2026-06-01'), 'realty_old_option');
});

test('rate by class and date: land deemed one-third, 1.5% / 7.5% on two-thirds = 1% / 5%; before 1 Apr 2019 with ITC', () => {
  const r = landSplit(750000, 'realty_residential', '2026-06-01');
  assert.deepEqual(r, { value: 750000, land: 250000, taxable: 500000, notif: 7.5, effective: 5 });
  assert.deepEqual(splitTax(r), { cgst: 18750, sgst: 18750, igst: 0, total: 37500 }, 'CGST 3.75% + SGST 3.75% on ₹5,00,000 = 5% of ₹7,50,000');
  const a = landSplit(100000.01, 'realty_affordable', '2026-06-01');
  assert.deepEqual([a.taxable, a.land, a.notif, a.effective], [66666.67, 33333.34, 1.5, 1]);
  assert.equal(splitTax(a).total, 1000, '1.5% of ₹66,666.67 = ₹1,000.00 to the paisa');
  assert.equal(landSplit(300000, 'realty_commercial', '2026-06-01').effective, 5);
  assert.deepEqual([landSplit(300000, 'realty_residential', '2019-03-31').effective, landSplit(300000, 'realty_residential', '2019-03-31').notif], [12, 18], 'old regime before N 03/2019');
  assert.deepEqual(landSplit(100000, 'realty_old_option', '2026-06-01', 12), { value: 100000, land: 0, taxable: 100000, notif: 12, effective: 12 });
});

test('completion certificate: on / after cc_date → not a supply', () => {
  assert.equal(afterCc({ cc_date: '2026-09-30' }, '2026-09-29'), false);
  assert.equal(afterCc({ cc_date: '2026-09-30' }, '2026-09-30'), true);
  assert.equal(afterCc({}, '2030-01-01'), false);
});

test('status flow: a booked unit moves only through its booking; delete refused while booked', () => {
  const w = realtyWorld();
  assert.equal(canMove('available', 'hold'), true);
  assert.equal(canMove('registered', 'hold'), false);
  saveUnit({ ...w.units[1], status: 'hold' });
  assert.throws(() => saveUnit({ ...loadUnits()[1], status: 'registered' }), /cannot be marked/);
  const b = book(w);
  const u = loadUnits().find((x) => x.id === b.unit_id)!;
  assert.equal(u.status, 'booked');
  assert.throws(() => saveUnit({ ...u, status: 'available' }), /from the booking/);
  assert.throws(() => deleteUnit(u.id), /booking/);
  deleteUnit(w.units[3].id);
  assert.equal(loadUnits().length, 3);
});

test('recycle bin: a deleted unit comes back while its project lives; a deleted booking does not (book again)', async () => {
  const { restoreEntry } = await import('../src/lib/trust/recycle-bin.ts');
  const { getTable } = await import('../src/lib/storage.ts');
  const { deleteBooking } = await import('../src/lib/construction/cn-bookings.ts');
  const w = realtyWorld();
  deleteUnit(w.units[3].id);
  const bin = () => getTable<{ id: string; table: string; row_id: string }>('recycle_bin');
  restoreEntry(bin().find((b) => b.table === 'realty_units' && b.row_id === w.units[3].id)!.id);
  assert.equal(loadUnits().length, 4);
  const b = book(w);
  deleteBooking(b.id);
  assert.throws(() => restoreEntry(bin().find((e) => e.table === 'realty_bookings' && e.row_id === b.id)!.id), /Book the unit again/);
});
