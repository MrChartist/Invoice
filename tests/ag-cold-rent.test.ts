/** AG-D2 storage rent: every basis, part months, minimum, charges in / out, bill at release for released bags only, class, snapshot, no double billing. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setTable, KEYS } from '../src/lib/storage.ts';
import { addLot, loadLots } from '../src/lib/agri/ag-cold-lots.ts';
import { issueGatePass } from '../src/lib/agri/ag-gatepass.ts';
import { EXEMPT_NOTE, billedOn, deletePlan, monthsBetween, nextOn, raiseRentBill, rentDue, rentFor, savePlan, suggestClass, unbilledRent } from '../src/lib/agri/ag-cold-rent.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { ColdRentPlan } from '../src/types/agri-r12d.ts';
import type { Client, InvoiceRecord } from '../src/types/invoice.ts';

const farmer: Client = { id: 'c-ram', name: 'Ram Singh', state_code: '27' } as Client;
const base: Omit<ColdRentPlan, 'id'> = { name: 'Potato season', basis: 'bag_season', rate: 180, season: { from: '03-01', to: '11-30' }, part_month: 'full', charges: [{ name: 'Loading', basis: 'bag', rate: 5, when: 'out' }, { name: 'Unloading', basis: 'bag', rate: 5, when: 'in' }], class: 'storage_agri', bill_at: 'out' };
const lotIn = { bags: 240, bag_kg: 50, weight_kg: 12000, date_in: '2026-03-10' };
beforeEach(() => {
  resetStorage();
  installSettings();
  setTable(KEYS.clients, [farmer]);
});

test('months: whole months, the part month as full or by days; next MM-DD', () => {
  assert.equal(monthsBetween('2026-03-10', '2026-06-10', 'full'), 3);
  assert.equal(monthsBetween('2026-03-10', '2026-06-11', 'full'), 4);
  assert.equal(monthsBetween('2026-03-10', '2026-06-25', 'days'), 3.5);
  assert.equal(monthsBetween('2026-01-31', '2026-02-28', 'full'), 1, 'month end clamps');
  assert.equal(nextOn('11-30', '2026-03-10'), '2026-11-30');
  assert.equal(nextOn('02-28', '2026-03-10'), '2027-02-28');
});

test('every basis, minimum months, late rent and charges in / out', () => {
  const p = (o: Partial<ColdRentPlan>) => ({ ...base, id: 'p', ...o }) as ColdRentPlan;
  const r = (o: Partial<ColdRentPlan>, bags = 60, to = '2026-07-20', x = {}) => rentFor(p(o), lotIn, { bags, from: lotIn.date_in, to, ...x });
  assert.equal(r({ charges: [] }).total, 10800, '60 × 180');
  assert.equal(r({ basis: 'qtl_season', rate: 400, charges: [] }).total, 12000, '30 qtl × 400');
  assert.equal(r({ basis: 'bag_month', rate: 4, charges: [] }).total, 1200, '60 × 4 × 5 months (part month full)');
  assert.equal(r({ basis: 'bag_month', rate: 4, charges: [], min_months: 6 }).total, 1440, 'minimum 6 months');
  assert.equal(r({ basis: 'qtl_month', rate: 10, part_month: 'days', charges: [] }, 60, '2026-04-25').total, 450, '30 qtl × 10 × 1.5');
  assert.equal(r({ basis: 'flat', rate: 25000, charges: [] }).total, 25000);
  assert.equal(r({ charges: [], late: { after: '11-30', rate_per_bag_month: 10 } }, 60, '2027-01-15').total, 10800 + 60 * 10 * 2, 'late Dec + part Jan');
  const w = r({}, 60, '2026-07-20', { inCharges: true, outBags: 60 });
  assert.deepEqual(w.lines.map((l) => [l.name, l.amount]), [['Storage rent (per bag, season)', 10800], ['Loading', 300], ['Unloading', 1200]]);
  assert.equal(r({ notified: { rate: 170, order_ref: 'UP order 12/2026' }, charges: [] }).total, 10200, 'notified rate wins');
});

test('exempt vs taxable class suggestion', () => {
  assert.equal(suggestClass('Potato'), 'storage_agri');
  assert.equal(suggestClass('Frozen peas'), 'storage_other');
  assert.equal(suggestClass('Dry fruit (processed)'), 'storage_other');
  assert.equal(suggestClass('Widgets'), undefined);
  assert.equal(suggestClass('Potato', true), 'storage_other', 'space rent');
});

test('the gate pass raises a bill of supply for the bags released only, with the lot snapshot; a pass is billed once', () => {
  const plan = savePlan(base);
  const lot = addLot({ ...lotIn, depositor_id: farmer.id, depositor_name: farmer.name, commodity: 'Potato', chamber_id: 'c1', season: '2026', rent_plan_id: plan.id });
  const g = issueGatePass(lot.id, { date: '2026-07-20', bags: 60 }, 'Chamber 1');
  const bill = g.bill!;
  assert.equal(bill.doc_type, 'BILL_OF_SUPPLY');
  assert.equal(bill.total, 10800 + 300 + 1200);
  assert.equal(bill.tax_amount, 0);
  assert.ok(bill.notes?.includes(EXEMPT_NOTE));
  const snap = bill.ag!.rent!;
  assert.deepEqual([snap.lot_no, snap.bags, snap.bags_in, snap.balance, snap.out_id, snap.chamber, snap.in_charges], [lot.number, 60, 240, 180, g.out.id, 'Chamber 1', true]);
  assert.throws(() => raiseRentBill(loadLots()[0], { kind: 'out', out: g.out }), /already billed/);
  const g2 = issueGatePass(lot.id, { date: '2026-08-01', bags: 40 });
  assert.equal(g2.bill!.total, 40 * 180 + 40 * 5, 'no unloading the second time');
  // a plan edit never changes a raised bill (snapshot)
  savePlan({ ...plan, rate: 999 });
  assert.equal((localDb.invoices.getById(bill.id) as InvoiceRecord).ag!.rent!.rate, 180);
  assert.throws(() => deletePlan(plan.id, loadLots()), /Lots use/);
});

test('taxable storage at 18%; advance billing then release bills no rent twice; season end bills the rest', () => {
  const plan = savePlan({ ...base, name: 'Frozen', class: 'storage_other', bill_at: 'in', charges: [] });
  const lot = addLot({ ...lotIn, depositor_id: farmer.id, depositor_name: farmer.name, commodity: 'Frozen peas', chamber_id: 'c1', season: '2026', rent_plan_id: plan.id });
  const adv = raiseRentBill(lot, { kind: 'in' });
  assert.equal(adv.doc_type, 'INVOICE');
  assert.equal(adv.taxable_value, 43200);
  assert.equal(adv.tax_amount, 7776, '18%');
  assert.throws(() => raiseRentBill(lot, { kind: 'in' }), /already billed/);
  assert.throws(() => raiseRentBill(lot, { kind: 'season_end', date: '2026-11-30' }), /already billed/);
  const plan2 = savePlan({ ...base, name: 'Season end', bill_at: 'season_end', charges: [] });
  const lot2 = addLot({ ...lotIn, depositor_id: farmer.id, depositor_name: farmer.name, commodity: 'Onion', chamber_id: 'c1', season: '2026', rent_plan_id: plan2.id });
  assert.equal(issueGatePass(lot2.id, { date: '2026-06-01', bags: 40 }).bill, undefined, 'season-end plan: no bill at release');
  const end = raiseRentBill(loadLots().find((l) => l.id === lot2.id)!, { kind: 'season_end', date: '2026-11-30' });
  assert.equal(end.total, 240 * 180);
  assert.equal(billedOn(localDb.invoices.getAll(), lot2.id).seasonBags, 240);
});

test('monthly bills never overlap; unbilled rent memo; rent due by depositor and season', () => {
  const plan = savePlan({ ...base, name: 'Monthly', basis: 'bag_month', rate: 4, bill_at: 'monthly', charges: [] });
  const lot = addLot({ ...lotIn, depositor_id: farmer.id, depositor_name: farmer.name, commodity: 'Apple', chamber_id: 'c1', season: '2026', rent_plan_id: plan.id });
  const m1 = raiseRentBill(lot, { kind: 'month', from: '2026-03-10', to: '2026-04-09' });
  assert.equal(m1.total, 960);
  assert.throws(() => raiseRentBill(lot, { kind: 'month', from: '2026-04-01', to: '2026-04-30' }), /billed up to 2026-04-09/);
  const memo = unbilledRent(loadLots(), [plan], localDb.invoices.getAll(), '2026-06-09');
  assert.equal(memo[0].amount, 240 * 4 * 2, 'two months unbilled');
  localDb.invoices.save({ ...m1, status: 'Sent' });
  const due = rentDue(localDb.invoices.getAll(), loadLots());
  assert.deepEqual(due.map((d) => [d.depositor, d.season, d.billed, d.due]), [['Ram Singh', '2026', 960, 960]]);
});
