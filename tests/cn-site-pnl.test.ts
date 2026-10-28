/** CN-D5: site P&L sums every source once (no double count of material recovered from a sub-contractor); WIP; CTC. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { HIRER, LAB, siteWorld, SUB } from './helpers/site-ops.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { godownsDb, transfersDb } from '../src/lib/godowns.ts';
import { stockDb } from '../src/lib/inventory.ts';
import { localDb } from '../src/lib/localDb.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { addSite, bookConsumption } from '../src/lib/works/sites.ts';
import { saveRaBill } from '../src/lib/works/measurements.ts';
import { fromBoq, saveWorkOrder } from '../src/lib/construction/cn-subcon.ts';
import { saveSubBill } from '../src/lib/construction/cn-subcon-bill.ts';
import { saveCompliance } from '../src/lib/construction/cn-labour-compliance.ts';
import { markDay, saveLabour, settleWeek } from '../src/lib/construction/cn-muster.ts';
import { saveHired, saveLog, setEquipment } from '../src/lib/construction/cn-plant.ts';
import { bookHireIn } from '../src/lib/construction/cn-plant-hire.ts';
import { gatherSitePnl, pnlCsvRows, saveSitePnlInputs, sitePnl } from '../src/lib/construction/cn-site-pnl.ts';

let w: ReturnType<typeof siteWorld>;
const P = { start: '2026-06-01', end: '2026-07-31' };
beforeEach(() => { w = siteWorld(); });

const expense = (id: string, o: Record<string, unknown>) => purchasesDb.save({ kind: 'EXPENSE', vendor_name: 'Shop', bill_number: id, date: '2026-07-10', category: 'Site expenses', lines: [], taxable: 10000, cgst: 0, sgst: 0, igst: 0, total: 10000, itc_eligible: false, amount_paid: 0, ...o } as never);

test('every source summed once: revenue, materials net of recoveries, sub-contractor, labour, muster, plant, other', () => {
  // Revenue: RA bill 1 (100 cum of PCC at 4,500 = 4,50,000 before GST).
  saveRaBill(w.boq.id, { date: '2026-06-30', lines: [{ line_id: 'l2', cumulative_qty: 100 }] });
  // Materials: 180 bags at ₹400 consumed at the site (72,000); 20 bags of it issued to the sub-contractor and recovered.
  transfersDb.save({ date: '2026-06-02', from_godown: 'main', to_godown: w.site.id, lines: [{ id: 't', item_id: w.cement.id, qty: 200 }] });
  bookConsumption(w.site, { date: '2026-06-25', lines: [{ item_id: w.cement.id, qty: 180 }] }, stockDb.items());
  const wo = saveWorkOrder({ date: '2026-06-01', vendor_id: SUB.id, vendor_name: SUB.name, boq_id: w.boq.id, site_id: w.site.id, cost_centre_id: w.cc.id, lines: fromBoq(w.boq, ['l2'], 90), deductions: [{ kind: 'retention', rate: 5 }] });
  saveSubBill(wo.id, { date: '2026-06-30', qty: [{ line_id: wo.lines[0].id, cumulative: 50 }], material: [{ item_id: w.cement.id, qty: 20, rate: 400 }] });
  // Labour contractor bill (vendor with a compliance pack) and the muster's site wages.
  saveCompliance({ vendor_id: LAB.id, vendor_name: LAB.name, month: '2026-07', headcount: 10, wages: 50000, pf: {}, esi: {} });
  purchasesDb.save({ kind: 'PURCHASE', vendor_id: LAB.id, vendor_name: LAB.name, bill_number: 'SL/1', date: '2026-07-31', category: 'Labour contract', lines: [], taxable: 60000, cgst: 0, sgst: 0, igst: 0, total: 60000, itc_eligible: false, amount_paid: 0, cost_centre_id: w.cc.id } as never);
  const a = saveLabour({ name: 'Ramu', trade: 'Mason', daily_rate: 800, ot_rate: 0, site_id: w.site.id });
  markDay(w.site.id, '2026-07-06', [{ labour_id: a.id, present: 1 }]);
  settleWeek(w.site, '2026-07-06', '2026-07-12', { date: '2026-07-12', method: 'Cash' });
  // Plant: a crane hired by the day, used 2 days here and 2 days at another site (split by hours); own roller internal.
  const other = addSite(w.boq.id, 'Other project site');
  setTable('godowns', getTable<{ id: string }>('godowns').map((g) => (g.id === other.id ? { ...g, boq_id: 'elsewhere', cost_centre_id: undefined } : g)));
  const crane = saveHired({ vendor_id: HIRER.id, vendor_name: HIRER.name, description: 'Crane', rate: 20000, basis: 'day', with_operator: true, from: '2026-07-01' });
  for (const [d, s] of [['2026-07-01', w.site.id], ['2026-07-02', w.site.id], ['2026-07-03', other.id], ['2026-07-04', other.id]]) saveLog({ date: d, equipment_ref: `hire:${crane.id}`, site_id: s, hours_worked: 8, idle_hours: 0, breakdown_hours: 0, fuel_litres: 0 });
  bookHireIn(crane.id, '2026-07', 'CR/1');
  setTable('fixed_assets', [{ id: 'fa1', name: 'Roller', block: 'PLANT_MACHINERY', account_id: 'fa_plant', cost: 1, acquired_on: '2025-04-01', put_to_use: '2025-04-01', paid_from: '', created_at: '' }]);
  setEquipment('fa1', { kind: 'Roller', internal_rate: 500 });
  saveLog({ date: '2026-07-05', equipment_ref: 'fa:fa1', site_id: w.site.id, hours_worked: 10, idle_hours: 0, breakdown_hours: 0, fuel_litres: 0 });
  // Other: an expense of this cost centre counts; one without it does not.
  expense('E1', { cost_centre_id: w.cc.id });
  expense('E2', {});
  const p = sitePnl(gatherSitePnl(localDb.invoices.getById(w.boq.id)!, P));
  assert.deepEqual(p.revenue.taxable, 450000);
  assert.deepEqual(p.costs, { material: 72000 - 8000, subcon: 202500, labour: 60000, muster: 800, plant: 40000 + 5000, other: 10000 });
  assert.equal(p.totalCost, 64000 + 202500 + 60000 + 800 + 45000 + 10000);
  assert.equal(p.margin, 450000 - p.totalCost);
  assert.equal(p.retentionPayable, 10125);
  assert.ok(p.held.some((h) => h.kind === 'it_tds') === false);
  assert.ok(pnlCsvRows(p, (k) => k).length > 10);
});

test('WIP memo: draft measurements × rate + work not measured; cost to complete; expected margin (no journal)', () => {
  saveRaBill(w.boq.id, { date: '2026-06-30', lines: [{ line_id: 'l2', cumulative_qty: 100 }] });
  setTable('ra_measurements', [...getTable('ra_measurements'), { id: 'd1', boq_id: w.boq.id, ra_no: 2, date: '2026-07-20', status: 'draft', lines: [{ line_id: 'l1', cumulative_qty: 200, this_qty: 200 }] }]);
  saveSitePnlInputs(localDb.invoices.getById(w.boq.id)!, { unmeasured: 30000, ctc: [{ group: 'Earthwork', amount: 150000 }, { group: 'PCC', amount: 400000 }, { group: '', amount: 5 }] });
  const boq = localDb.invoices.getById(w.boq.id)!;
  assert.equal(boq.boq_terms?.cost_centre_id, w.cc.id, 'other BOQ terms kept');
  const vouchers = getTable('vouchers').length;
  const p = sitePnl(gatherSitePnl(boq, P));
  assert.deepEqual(p.wip, { unbilled: 200 * 250, unmeasured: 30000, total: 80000 });
  assert.deepEqual(p.contract, { value: 1150000, billed: 450000, remaining: 700000, ctc: 550000, expected: 150000 });
  assert.equal(getTable('vouchers').length, vouchers, 'memo only');
  assert.equal(godownsDb.stored().length > 0, true);
});
