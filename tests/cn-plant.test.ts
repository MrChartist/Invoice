/** CN-D3: equipment, log sheets, utilisation and fuel flag, hire-in bill with TDS by operator, hire-out recovery. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { HIRER, siteWorld, SUB } from './helpers/site-ops.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { readPurchase } from '../src/lib/purchase-normalize.ts';
import { loadAssets, saveAsset } from '../src/lib/ledger/assets.ts';
import { hireRecoveryFor, internalCharges, loadLogs, machines, monthSummary, saveHired, saveLog, setEquipment } from '../src/lib/construction/cn-plant.ts';
import { bookHireIn, hireProposal } from '../src/lib/construction/cn-plant-hire.ts';
import { fromBoq, saveWorkOrder } from '../src/lib/construction/cn-subcon.ts';
import { saveSubBill } from '../src/lib/construction/cn-subcon-bill.ts';

let w: ReturnType<typeof siteWorld>;
beforeEach(() => {
  w = siteWorld();
  setTable('fixed_assets', [{ id: 'fa1', name: 'Roller', block: 'PLANT_MACHINERY', account_id: 'fa_plant', cost: 2500000, acquired_on: '2025-04-01', put_to_use: '2025-04-01', paid_from: '', created_at: '' }]);
  setEquipment('fa1', { kind: 'Roller', reg_no: 'MH12AB1234', internal_rate: 900, hire_rate: 1200, fuel_min: 4, fuel_max: 8 });
});

const log = (o: Record<string, unknown>) => saveLog({ date: '2026-07-01', equipment_ref: 'fa:fa1', site_id: w.site.id, hours_worked: 8, idle_hours: 2, breakdown_hours: 0, fuel_litres: 48, ...o } as never);

test('equipment = a fixed asset marked cn_equipment (kept through an asset edit) or a hired item', () => {
  const h = saveHired({ vendor_id: HIRER.id, vendor_name: HIRER.name, description: 'Crane 25 t', rate: 25000, basis: 'day', with_operator: false, from: '2026-07-01' });
  assert.deepEqual(machines().map((m) => [m.ref, m.own, m.internal, m.hireOut]), [['fa:fa1', true, 900, 1200], [`hire:${h.id}`, false, 0, 0]]);
  const a = loadAssets()[0];
  saveAsset({ ...a, name: 'Roller 10 t' });
  assert.equal(loadAssets()[0].cn_equipment?.reg_no, 'MH12AB1234', 'an asset edit keeps the equipment details');
});

test('log sheets: PLG series, hours ≤ 24; utilisation and fuel per hour flagged outside the typed range', () => {
  assert.equal(log({}).number, 'PLG/FY26-27/0001');
  log({ date: '2026-07-02', hours_worked: 6, idle_hours: 0, breakdown_hours: 4, fuel_litres: 60 });
  assert.throws(() => log({ hours_worked: 20, idle_hours: 5 }), /24/);
  const [m] = monthSummary(loadLogs(), '2026-07', machines());
  assert.deepEqual([m.days, m.worked, m.idle, m.breakdown, m.utilisation, m.fuelPerHour, m.fuelFlag], [2, 14, 2, 4, 70, 7.71, null]);
  log({ date: '2026-07-03', hours_worked: 2, idle_hours: 0, fuel_litres: 60 });
  assert.equal(monthSummary(loadLogs(), '2026-07', machines())[0].fuelFlag, 'high');
  assert.deepEqual([...internalCharges(loadLogs(), machines(), '2026-07-01', '2026-07-31')], [[w.site.id, 16 * 900]], 'own plant at our own site: internal charge');
});

test('hire in: month-end bill from the logs; TDS by the operator flag (194-I(a) without, 194C with); booked once', () => {
  const crane = saveHired({ vendor_id: HIRER.id, vendor_name: HIRER.name, description: 'Crane 25 t', rate: 25000, basis: 'day', with_operator: false, from: '2026-07-01' });
  for (const d of ['2026-07-01', '2026-07-02', '2026-07-03']) saveLog({ date: d, equipment_ref: `hire:${crane.id}`, site_id: w.site.id, hours_worked: 8, idle_hours: 0, breakdown_hours: 0, fuel_litres: 0 });
  const p = hireProposal(crane, '2026-07', loadLogs(), HIRER);
  assert.deepEqual([p.qty, p.amount, p.tds, p.sac, p.gst], [3, 75000, '194I-A', '997313', 18]);
  assert.match(p.tdsLabel, /393/, 'ITA 2025 label from 1 Apr 2026');
  const bill = bookHireIn(crane.id, '2026-07', 'CH/88');
  assert.deepEqual([bill.date, bill.taxable, bill.tds_section, bill.tds_amount, bill.cn_sub?.kind, bill.cost_centre_id], ['2026-07-31', 75000, '194I-A', 1500, 'hire', w.cc.id]);
  assert.throws(() => bookHireIn(crane.id, '2026-07', 'CH/89'), /Already booked/);
  const withOp = { ...crane, with_operator: true };
  assert.equal(hireProposal(withOp, '2026-07', loadLogs(), HIRER).tds, '194C-2', 'with operator: 194C by the PAN (company)');
  assert.equal(readPurchase(bill)!.taxable, 75000, 'purchase contract');
});

test('hire out: logs charged to a sub-contractor become a recovery on his bill (marked recovered)', () => {
  log({ hours_worked: 5, sub_contractor_id: SUB.id });
  log({ date: '2026-07-02', hours_worked: 3, sub_contractor_id: SUB.id });
  assert.equal(hireRecoveryFor(SUB.id, '2026-07-31', loadLogs(), machines()).amount, 8 * 1200);
  assert.equal(internalCharges(loadLogs(), machines(), '2026-07-01', '2026-07-31').size, 0, 'not an internal charge');
  const wo = saveWorkOrder({ date: '2026-06-01', vendor_id: SUB.id, vendor_name: SUB.name, boq_id: w.boq.id, cost_centre_id: w.cc.id, lines: fromBoq(w.boq, ['l2'], 90), deductions: [] });
  const { bill, measurement } = saveSubBill(wo.id, { date: '2026-07-31', qty: [{ line_id: wo.lines[0].id, cumulative: 10 }] });
  assert.deepEqual(bill.cn_sub!.deductions!.map((d) => [d.kind, d.amount]), [['hire_recovery', 9600]]);
  assert.ok(loadLogs().every((l) => l.recovered_in === measurement.number));
  assert.equal(hireRecoveryFor(SUB.id, '2026-07-31', loadLogs(), machines()).amount, 0);
  assert.equal(getTable('purchases').length, purchasesDb.all().length);
});
