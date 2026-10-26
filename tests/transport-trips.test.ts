/** R5-B3: vehicles, trip sheets, trip P&L, driver advances, lorry hire with 194C / 194C(6), document bell. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupTransport } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { peekTable } from '../src/lib/storage.ts';
import { loadCostCentres } from '../src/lib/cost-centres.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { loadLedger } from '../src/lib/ledger/index.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { docAlerts, loadVehicles, saveVehicle } from '../src/lib/transport/vehicles.ts';
import { addTripExpense, closeTrip, giveDriverAdvance, loadTrips, recordLorryHire, saveTrip, tripAdvances, tripExpenses } from '../src/lib/transport/trips.ts';
import { lrIncome, rollup, tripPnl } from '../src/lib/transport/trip-pnl.ts';
import { saveLr, loadLrs, type LrInput } from '../src/lib/transport/consignment-notes.ts';
import { createFreightBills } from '../src/lib/transport/freight-bill.ts';
import { suggestTds, tdsDeductions, transporter194c6Exempt } from '../src/lib/tds-payables.ts';
import { form26Q } from '../src/lib/tds-returns.ts';
import { transportNotices } from '../src/lib/transport/transport-alerts.ts';
import { sectionText } from '../src/lib/ita2025.ts';

beforeEach(() => setupTransport());

const lrIn = (over: Partial<LrInput> = {}): LrInput => ({
  date: '2026-06-10', from: { place: 'Pune', state: '27' }, to: { place: 'Nashik', state: '27' }, consignor_id: 'c-mh', consignee_id: 'c-ka', billing_party_id: 'c-mh',
  lines: [{ description: 'Cartons', packages: 10, charged_weight: 1000 }], basis: 'per_kg', rate: 10, charges: [], payment_basis: 'tbb', ...over,
});

test('own vehicle gets one cost centre of kind vehicle (reused on edit); docs feed the bell', () => {
  const v = saveVehicle({ reg_no: 'mh-12 ab 1234', own: true, docs: [{ kind: 'insurance', expires_on: '2026-07-05' }, { kind: 'puc', expires_on: '2026-06-01' }, { kind: 'permit', expires_on: '2027-03-31' }] });
  assert.equal(v.reg_no, 'MH12AB1234');
  const cc = loadCostCentres().filter((c) => c.kind === 'vehicle');
  assert.equal(cc.length, 1);
  assert.equal(v.cost_centre_id, cc[0].id);
  saveVehicle({ ...v, type: 'Truck 10T' });
  assert.equal(loadCostCentres().filter((c) => c.kind === 'vehicle').length, 1);
  const alerts = docAlerts(loadVehicles(), '2026-06-25');
  assert.deepEqual(alerts.map((a) => [a.doc.kind, a.expired]), [['puc', true], ['insurance', false]]);
  const n = transportNotices('2026-06-25', 'now');
  assert.ok(n.some((x) => x.id.includes(':puc:') && x.severity === 'critical'));
  assert.ok(n.some((x) => x.id.includes(':insurance:') && x.severity === 'warning'));
  assert.ok(!n.some((x) => x.id.startsWith('tw:gta')), 'outside the Jan–Mar window');
  assert.ok(transportNotices('2027-02-01', 'now').some((x) => x.id === 'tw:gta:27-28'), 'option window reminder');
});

test('trip P&L: freight of LRs (allocated by charged weight on a shared bill) − expenses − hire; mileage flag; rollups', () => {
  const v = saveVehicle({ reg_no: 'MH12AB1234', own: true, docs: [], km_per_litre: { min: 4, max: 6 } });
  const a = saveLr(lrIn(), localDb.clients.getAll());
  const b = saveLr(lrIn({ lines: [{ description: 'Drums', packages: 5, charged_weight: 3000 }] }), localDb.clients.getAll());
  const t = saveTrip({ vehicle_id: v.id, driver: 'Raju', start_date: '2026-06-10', start_km: 1000, lr_ids: [a.id] });
  assert.equal(t.number, 'TRP/FY26-27/0001');
  assert.equal(loadLrs().find((l) => l.id === a.id)?.status, 'in_transit');
  addTripExpense(t.id, { date: '2026-06-10', kind: 'Diesel', amount: 9000, litres: 100 });
  addTripExpense(t.id, { date: '2026-06-11', kind: 'Toll', amount: 1500 });
  const exp = tripExpenses(t.id);
  assert.equal(exp.length, 2);
  const bill = purchasesDb.get(exp[0].id)!;
  assert.equal(bill.trip_id, t.id);
  assert.equal(bill.cost_centre_id, v.cost_centre_id);
  // Both LRs on one freight bill (₹10,000 + ₹30,000 taxable) → the trip's LR gets its 1000 / 4000 kg share.
  createFreightBills([a.id, b.id], '2026-06-30');
  const income = lrIncome(loadLrs(), localDb.invoices.getAll());
  assert.equal(income.get(a.id), 10000);
  closeTrip(t.id, { date: '2026-06-12', end_km: 1300 });
  const [p] = tripPnl({ trips: loadTrips(), vehicles: loadVehicles(), lrs: loadLrs(), invoices: localDb.invoices.getAll(), purchases: peekTable('purchases') });
  assert.equal(p.freight, 10000);
  assert.equal(p.expenses, 10500);
  assert.equal(p.margin, -500);
  assert.equal(p.kmpl, 3);
  assert.equal(p.mileageFlag, 'low');
  assert.deepEqual(rollup([p], 'vehicle').map((r) => [r.key, r.margin]), [['MH12AB1234', -500]]);
  assert.deepEqual(rollup([p], 'month').map((r) => r.key), ['2026-06']);
});

test('driver advance: payment voucher Dr 3615; close settles spent + returned; the rest is carried', () => {
  const v = saveVehicle({ reg_no: 'MH12AB1234', own: true, docs: [] });
  const t = saveTrip({ vehicle_id: v.id, driver: 'Raju', start_date: '2026-06-10' });
  giveDriverAdvance(t.id, { date: '2026-06-10', amount: 10000, method: 'Cash' });
  addTripExpense(t.id, { date: '2026-06-11', kind: 'Diesel', amount: 6000 });
  assert.equal(tripAdvances(loadTrips()[0]).given, 10000);
  assert.throws(() => closeTrip(t.id, { date: '2026-06-12', spent: 9000, returned: 2000 }), /more than the advances/);
  const closed = closeTrip(t.id, { date: '2026-06-12', spent: 6000, returned: 3000 });
  assert.equal(tripAdvances(closed).settled, 9000);
  const staff = loadLedger().vouchers.flatMap((x) => x.lines).filter((l) => l.account === A.staffAdvances).reduce((s, l) => s + l.dr - l.cr, 0);
  assert.equal(staff, 100000, '₹1,000 stays with the driver');
  const cash = loadLedger().vouchers.flatMap((x) => x.lines).filter((l) => l.account === A.cash).reduce((s, l) => s + l.dr - l.cr, 0);
  assert.equal(cash, -700000, 'cash: −10,000 advance −6,000 expense +9,000 settled');
});

test('194C(6): nil TDS only with a declaration, PAN and ≤ 10 vehicles, on or after the declaration; 26Q reason T', () => {
  const decl = { declared_on: '2026-04-01', vehicles_owned: 8, pan: 'ABCPK1234F' };
  assert.ok(transporter194c6Exempt('194C-1', '2026-06-01', { pan: 'ABCPK1234F', transporter194c6: decl }));
  assert.ok(!transporter194c6Exempt('194C-1', '2026-06-01', { transporter194c6: { ...decl, vehicles_owned: 11 } }), '11 carriages');
  assert.ok(!transporter194c6Exempt('194C-1', '2026-06-01', { transporter194c6: { ...decl, pan: 'BAD' } }), 'no valid PAN');
  assert.ok(!transporter194c6Exempt('194C-1', '2026-03-01', { transporter194c6: decl }), 'before the declaration');
  assert.ok(!transporter194c6Exempt('194J', '2026-06-01', { transporter194c6: decl }), '194C only');
  assert.equal(suggestTds('194C-1', '2026-06-01', 50000, { pan: 'ABCPK1234F', transporter194c6: decl }, [])?.reason, 'T');

  const owner = vendorsDb.save({ name: 'Kamal Roadlines', pan: 'ABCPK1234F', deductee_type: 'INDIVIDUAL', transporter_194c6: decl });
  const plain = vendorsDb.save({ name: 'Market Lorry', pan: 'ABCPM9999K', deductee_type: 'INDIVIDUAL' });
  const hired = saveVehicle({ reg_no: 'MH14XY9999', own: false, owner_id: owner.id, docs: [] });
  const t1 = saveTrip({ vehicle_id: hired.id, start_date: '2026-06-10' });
  const b1 = recordLorryHire(t1.id, { date: '2026-06-10', vendorId: owner.id, amount: 40000 });
  assert.equal(b1.tds_amount, 0);
  assert.equal(b1.tds_reason, 'T');
  const t2 = saveTrip({ vehicle_id: hired.id, start_date: '2026-06-11' });
  const b2 = recordLorryHire(t2.id, { date: '2026-06-11', vendorId: plain.id, amount: 40000 });
  assert.equal(b2.tds_amount, 400, '194C individual 1% without the declaration');
  const rows = tdsDeductions({ purchases: purchasesDb.all(), payments: [], vendors: vendorsDb.all() });
  const nil = rows.find((r) => r.purchaseId === b1.id)!;
  assert.equal(nil.amount, 0);
  assert.equal(nil.reason, 'T');
  const paper = form26Q(rows, [], 2026, 1);
  const line = paper.deducteeRows.find((r) => r[5] === 'Kamal Roadlines')!;
  assert.equal(line[15], 'T');
  assert.ok(paper.warnings.some((w) => /194C\(6\)/.test(w)));
  assert.ok(!paper.warnings.some((w) => /Kamal Roadlines: ₹0\.00 deducted/.test(w)));
  // The label follows the Income-tax Act 2025 from 1 Apr 2026.
  assert.match(sectionText('194C-1', '2026-06-10'), /Sec 393\(1\).*6\(i\).*\[old 194C\]/);
});
