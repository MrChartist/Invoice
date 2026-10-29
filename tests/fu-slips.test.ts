/**
 * R21-D1 credit slips: a duplicate slip no. is refused; a vehicle over its monthly limit is warned (never blocked); the
 * month-end bill groups by customer (one Bill of Supply for fuel, a tax invoice for a lubricant on slips) with the
 * vehicle-wise annexure, in one write; billed slips cannot be edited; cancelling the bill frees the slips.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, clientRetail, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { stockDb, blankStockItem } from '../src/lib/inventory.ts';
import { savePrice } from '../src/lib/fuel/fu-price.ts';
import { billedSlipIds, planSlipBills, readSlips, removeSlip, saveSlip, slipIssue, unbilledSlips, vehicleWarning } from '../src/lib/fuel/fu-slips.ts';
import { billSlips } from '../src/lib/fuel/fu-recv-io.ts';
import type { FuelSlip } from '../src/types/fuel-r21.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

function world() {
  stockDb.saveItem(blankStockItem({ id: 'hsd', name: 'Diesel (HSD)', unit: 'LTR', fu: { product: 'hsd', unit: 'L' } }));
  stockDb.saveItem(blankStockItem({ id: 'oil', name: 'Engine oil 1L', unit: 'NOS', hsn: '27101980', tax_rate: 18 }));
  savePrice({ item_id: 'hsd', date: '2026-10-01', time: '06:00', rsp: 87.62, build: { excise: 15.8, vat: 14.2 } });
  localDb.clients.upsert({ ...clientMH, fu: { vehicles: [{ no: 'MH12AB1234', limit_l: 100 }] } });
  localDb.clients.upsert(clientRetail);
  const slip = (slip_no: string, client_id: string, vehicle_no: string, litres: number, date = '2026-10-10', item_id = 'hsd', amount = Math.round(litres * 87.62 * 100) / 100) =>
    saveSlip({ slip_no, date, client_id, vehicle_no, item_id, litres, amount });
  return { slip };
}

test('a duplicate slip no. is refused (case and spaces ignored); fields are checked', () => {
  const { slip } = world();
  slip('101', 'c-mh', 'MH12AB1234', 40);
  assert.throws(() => slip(' 101 ', 'c-retail', 'MH14ZZ0001', 10), /already in the slip book/);
  assert.match(slipIssue({ slip_no: '', date: '2026-10-10' }, readSlips()), /slip no/);
  assert.match(slipIssue({ slip_no: '9', date: '2026-10-10', client_id: 'c-mh', vehicle_no: 'X', item_id: 'hsd', litres: 0, amount: 1 }, readSlips()), /litres/);
  assert.equal(readSlips().length, 1);
});

test('a vehicle over its monthly limit is warned, never blocked; another month starts again', () => {
  const { slip } = world();
  slip('1', 'c-mh', 'mh12ab1234', 60);
  const c = localDb.clients.getById('c-mh');
  const next = { client_id: 'c-mh', vehicle_no: 'MH12AB1234', date: '2026-10-20', litres: 50, amount: 4381 };
  assert.match(vehicleWarning(next, c, readSlips()), /110 L this month, over its limit of 100 L/);
  assert.equal(vehicleWarning({ ...next, date: '2026-11-01' }, c, readSlips()), '');
  assert.equal(vehicleWarning({ ...next, vehicle_no: 'OTHER' }, c, readSlips()), '', 'no limit on an unknown vehicle');
  assert.ok(slip('2', 'c-mh', 'MH12AB1234', 50, '2026-10-20'), 'saved anyway');
});

test('the month-end bill: one Bill of Supply per customer for fuel (+ a tax invoice for a lubricant), annexure per slip, in one write', () => {
  const { slip } = world();
  slip('1', 'c-mh', 'MH12AB1234', 40);
  slip('2', 'c-mh', 'MH12CD5678', 25.5, '2026-10-12');
  slip('3', 'c-mh', 'MH12CD5678', 2, '2026-10-12', 'oil', 900);
  slip('4', 'c-retail', 'MH14ZZ0001', 10, '2026-10-15');
  slip('5', 'c-retail', 'MH14ZZ0001', 10, '2026-11-02');
  const docs = billSlips('2026-10-31');
  assert.equal(docs.length, 3);
  const mh = docs.filter((d) => d.client.id === 'c-mh');
  const bos = mh.find((d) => d.doc_type === 'BILL_OF_SUPPLY')!;
  assert.equal(bos.exempt_kind, 'NON_GST');
  assert.deepEqual([bos.items.length, bos.items[0].quantity, bos.items[0].sv?.exempt, bos.total], [1, 65.5, 'NON_GST', 5739.11]);
  assert.equal(bos.issue_date, '2026-10-31', 'dated at the month end (FU7)');
  assert.deepEqual(bos.annexure?.rows.map((r) => [r.who, r.project]), [['MH12AB1234', 'Slip 1'], ['MH12CD5678', 'Slip 2']], 'vehicle-wise annexure');
  assert.equal(bos.fu?.lines?.[bos.items[0].id]?.price_id !== undefined, true, 'the price row in force is snapshotted (Rule 42 duty)');
  const ti = mh.find((d) => d.doc_type === 'TAX_INVOICE')!;
  assert.equal(ti.total, 900, 'the lubricant is billed GST-inclusive at its slab');
  assert.ok(ti.tax_amount > 0);
  assert.ok(docs.every((d) => d.invoice_number), 'numbered');
  assert.deepEqual(unbilledSlips(readSlips(), localDb.invoices.getAll()).map((s) => s.slip_no), ['5'], 'November stays for next month');
  assert.deepEqual(billSlips('2026-10-31'), [], 'nothing billed twice');
  assert.throws(() => removeSlip(readSlips()[0].id), /cancel the bill first/);
  const s1 = readSlips()[0];
  assert.throws(() => saveSlip({ ...s1, litres: 1 }), /cancel the bill first/);
});

test('cancelling the bill frees its slips (billed state is derived, never stored)', () => {
  const { slip } = world();
  slip('1', 'c-mh', 'MH12AB1234', 40);
  const [bill] = billSlips('2026-10-31');
  assert.equal(billedSlipIds(localDb.invoices.getAll()).size, 1);
  localDb.invoices.setStatus(bill.id, 'Cancelled');
  assert.equal(billedSlipIds(localDb.invoices.getAll()).size, 0);
  assert.equal(unbilledSlips(readSlips(), localDb.invoices.getAll()).length, 1);
  assert.ok(!('billed_doc_id' in readSlips()[0]));
  assert.equal(billSlips('2026-10-31').length, 1, 'billed again');
});

test('volume: 50 customers × 300 slips a month plan in one pass', () => {
  const slips: FuelSlip[] = [];
  for (let c = 0; c < 50; c++) for (let i = 0; i < 300; i++) slips.push({ id: `${c}-${i}`, slip_no: `${c}-${i}`, date: '2026-10-10', client_id: `c${c}`, vehicle_no: `V${i % 7}`, item_id: 'hsd', litres: 10, amount: 876.2 });
  const t = Date.now();
  const plan = planSlipBills(slips, [{ id: 'hsd', name: 'Diesel', fu: { product: 'hsd', unit: 'L' } }], [{ id: 'p', item_id: 'hsd', date: '2026-10-01', time: '06:00', rsp: 87.62 }], '2026-10-31');
  assert.equal(plan.length, 50);
  assert.equal(plan[0].annexure.length, 300);
  assert.ok(Date.now() - t < 2000);
});
