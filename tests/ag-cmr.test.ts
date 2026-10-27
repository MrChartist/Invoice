/** AG-C3: custom milling (CMR) account, deliveries, the Circular 153 25% test, job milling; paddy never in stock. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { clientMH, installSettings } from './helpers/world.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { setTable } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import { principalBalances, principalDb } from '../src/lib/job-work.ts';
import { blankStockItem, computeStock, liveInputs, stockDb } from '../src/lib/inventory.ts';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import { openSlip, recordTare, loadSlips } from '../src/lib/agri/ag-weighbridge.ts';
import {
  addDelivery, addPaddyLot, cmrAccount, cmrSnapshot, defaultOutturn, deleteAgreement, jobMillingInvoice, jobMillingRate, loadAgreements, millingChargesInvoice,
  paddyName, pdsTest, removeDelivery, removePaddyLot, saveAgreement,
} from '../src/lib/agri/ag-cmr.ts';

const AGENCY = { ...clientMH, id: 'c-fci', name: 'State Civil Supplies Corp' };

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-10-27T10:00:00');
  setTable('clients', [AGENCY, { ...clientMH, id: 'c-farmer', name: 'Harpal (farmer)', gstin: '' }]);
});
afterEach(() => thawDate());

const agreement = (o: Record<string, unknown> = {}) => saveAgreement({ agency_id: AGENCY.id, season: 'Kharif 2026-27', kind: 'raw', milling_rate: 40, due_by: '2027-03-31', byproduct_recovery: { basis: 'per_qtl_paddy', rate: 25 }, ...o } as never, '2026-10-27');

test('defaults: 67% raw, 68% parboiled (agency norm); registered at runtime', () => {
  assert.equal(defaultOutturn('raw', '2026-10-27'), 67);
  assert.equal(defaultOutturn('parboiled', '2026-10-27'), 68);
  assert.equal(agreement({ kind: 'parboiled' }).outturn_pct, 68);
  assert.equal(agreement().outturn_pct, 67);
  assert.equal(TABLE_ACTIONS.cmr_agreements, 'doc.create');
  assert.throws(() => saveAgreement({ agency_id: 'nope', season: 'x', kind: 'raw' }), /agency/);
});

test('account: paddy 50 qtl → rice due 33.5; a delivery numbered CMR/FY…; balance, % complete, days left, recovery, charges', () => {
  const a = agreement();
  addPaddyLot(a.id, { date: '2026-10-27', qty: 50 });
  const d = addDelivery(a.id, { date: '2026-11-05', qty: 20, lot_no: 'L-1', ack_no: 'ACK-77', fortified: true });
  assert.equal(d.number, 'CMR/FY26-27/0001');
  const acc = cmrAccount(loadAgreements()[0], '2026-11-05');
  assert.deepEqual([acc.paddy, acc.due, acc.delivered, acc.balance, acc.pct, acc.daysLeft, acc.overdue], [50, 33.5, 20, 13.5, 59.7, 146, false]);
  assert.deepEqual([acc.byproductDue, acc.chargesEarned, acc.paddyPending], [1250, 800, 20.149]);
  assert.equal(addDelivery(a.id, { date: '2026-11-06', qty: 10, lot_no: 'L-2' }).number, 'CMR/FY26-27/0002');
  assert.throws(() => addDelivery(a.id, { date: '2026-11-07', qty: 4, lot_no: 'L-3' }), /Only 3\.5 qtl/);
  assert.equal(cmrAccount(loadAgreements()[0], '2027-04-02').overdue, true);
  const snap = cmrSnapshot(loadAgreements()[0], '2026-11-06');
  assert.deepEqual([snap.kind, snap.paddy, snap.rice_due, snap.rice_delivered, snap.outturn_pct], ['cmr', 50, 33.5, 30, 67]);
});

test('paddy is the principal\'s material: JWP receipt and processed return, never in our stock valuation', () => {
  stockDb.saveItem(blankStockItem({ id: 'rice', name: 'Rice', unit: 'QTL', opening_qty: 10, opening_rate: 3000 }));
  const a = agreement();
  addPaddyLot(a.id, { date: '2026-10-27', qty: 50 });
  addDelivery(a.id, { date: '2026-11-05', qty: 33.5, lot_no: 'L-1' });
  const [rec, ret] = principalDb.all();
  assert.deepEqual([rec.kind, rec.number, rec.lines[0].name, rec.lines[0].qty], ['receipt', 'JWP/FY26-27/0001', paddyName(a), 50]);
  assert.deepEqual([ret.kind, ret.lines[0].qty, ret.lines[0].processed, ret.challan_no], ['return', 50, true, 'CMR/FY26-27/0001']);
  assert.equal(principalBalances(principalDb.all())[0].pending, 0, 'all paddy milled and delivered');
  const pos = computeStock({ ...liveInputs(), asOf: '2026-11-30' });
  assert.deepEqual(pos.map((p) => [p.item.name, p.qty, p.value]), [['Rice', 10, 30000]], 'no paddy line; our stock untouched');
});

test('a weighbridge slip received for CMR fills the lot from its net weight and is marked used; removing frees it', () => {
  const a = agreement();
  const s = recordTare(openSlip({ date: '2026-10-27', vehicle: 'PB10', party_kind: 'agency', commodity: 'Paddy', gross_kg: 9000 }).id, 4000);
  const lot = addPaddyLot(a.id, { date: '2026-10-27', wbs_id: s.id });
  assert.equal(lot.qty, 50);
  assert.deepEqual([loadSlips()[0].use, loadSlips()[0].ref_id], ['cmr', a.id]);
  assert.throws(() => addPaddyLot(a.id, { date: '2026-10-27', wbs_id: s.id }), /already used/);
  addDelivery(a.id, { date: '2026-10-28', qty: 30, lot_no: 'L' });
  assert.throws(() => removePaddyLot(a.id, lot.id, '2026-10-28'), /delivered/);
  assert.throws(() => deleteAgreement(a.id), /first/);
  removeDelivery(a.id, loadAgreements()[0].deliveries[0].id);
  removePaddyLot(a.id, lot.id, '2026-10-28');
  assert.equal(loadSlips()[0].ref_id, undefined);
  assert.equal(principalDb.all().length, 0);
  assert.throws(() => addDelivery(a.id, { date: '2026-10-29', qty: 1, lot_no: 'x' }), /Only 0 qtl/);
});

test('Circular 153: goods ≤ 25% exempt (boundary in), above → 5%; the milling-charges draft follows the test', () => {
  assert.deepEqual([pdsTest(25, 100).exempt, pdsTest(25, 100).rate], [true, 0]);
  assert.deepEqual([pdsTest(25.01, 100).exempt, pdsTest(25.01, 100).rate, pdsTest(25.01, 100).suggestion], [false, 5, 'job_work_5']);
  const a = agreement();
  addPaddyLot(a.id, { date: '2026-10-27', qty: 50 });
  // 20 qtl × ₹40 = 800 service; goods 200 → 20% → exempt bill of supply.
  const ex = millingChargesInvoice(a.id, { date: '2026-10-27', qty: 20, goods_value: 200 });
  assert.deepEqual([ex.test.goodsPct, ex.test.exempt, ex.invoice.doc_type, ex.invoice.tax_amount, ex.invoice.items.length], [20, true, 'BILL_OF_SUPPLY', 0, 2]);
  assert.equal(ex.invoice.ag?.kind, 'cmr');
  assert.equal(ex.invoice.ag?.cmr?.suggestion, 'exempt');
  assert.match(ex.invoice.notes ?? '', /entry 3A/);
  // goods 30% of the whole value → 5%.
  const t = millingChargesInvoice(a.id, { date: '2026-10-27', qty: 20, goods_value: 342.86 });
  assert.deepEqual([t.test.goodsPct, t.test.rate, t.invoice.doc_type, t.invoice.items[0].tax_rate], [30, 5, 'TAX_INVOICE', 5]);
  assert.ok(t.invoice.tax_amount > 0);
  // The `ag` snapshot survives the editor's load → save (R12_RECORD_KEYS).
  const back = normalizeRecord(localDb.invoices.getById(t.invoice.id));
  assert.equal(back.ag?.cmr?.goods_pct, 30);
});

test('job milling: 5% for a registered principal; unregistered → typed rate required (AG10)', () => {
  assert.deepEqual(jobMillingRate(true, '2026-10-27'), { rate: 5, sac: '9988' });
  assert.equal(jobMillingRate(false).rate, null);
  const inv = jobMillingInvoice({ client_id: AGENCY.id, date: '2026-10-27', qty: 30, rate: 60, registered: true, process: 'dal milling', jwp_number: 'JWP/FY26-27/0001' });
  assert.deepEqual([inv.items[0].tax_rate, inv.items[0].hsn, inv.items[0].ag_class, inv.ag?.kind], [5, '9988', 'job_milling', 'job_milling']);
  assert.match(inv.items[0].name, /dal milling/);
  assert.throws(() => jobMillingInvoice({ client_id: 'c-farmer', date: '2026-10-27', qty: 2, rate: 60, registered: false }), /type the GST rate/);
  const own = jobMillingInvoice({ client_id: 'c-farmer', date: '2026-10-27', qty: 2, rate: 60, registered: false, tax_rate: 0 });
  assert.equal(own.doc_type, 'BILL_OF_SUPPLY');
});
