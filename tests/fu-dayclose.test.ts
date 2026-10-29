/** R21-B3 day close: one saveMany for the day; stock leaves the right tank; receipts reach the right accounts; clearing accounts never in cheque / BRS pickers; an excess stays out of the receipts; shortage settled; undo restores `closed` and keeps the number. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setTable } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import { bankAccountsDb, pickableBankAccounts } from '../src/lib/bank-accounts.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import { openShift, readShifts, saveShift } from '../src/lib/fuel/fu-dayclose.ts';
import { dayClose, settleShort, shiftBill, undoShift } from '../src/lib/fuel/fu-issue-io.ts';
import type { FuelNozzle } from '../src/types/fuel-r21.ts';

const NZ: FuelNozzle[] = [
  { id: 'n1', du_no: '1', nozzle_no: 'A', tank_id: 't1', item_id: 'ms', totaliser_start: 1000, active: true },
  { id: 'n2', du_no: '2', nozzle_no: 'A', tank_id: 't2', item_id: 'hsd', totaliser_start: 0, active: true },
];

beforeEach(() => {
  resetStorage();
  installSettings();
  setTable('stock_items', [{ id: 'ms', name: 'Petrol (MS)', unit: 'LTR', hsn: '27101241', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, fu: { product: 'ms', unit: 'L' } }, { id: 'hsd', name: 'Diesel (HSD)', unit: 'LTR', hsn: '27101943', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, fu: { product: 'hsd', unit: 'L' } }]);
  setTable('fuel_nozzles', NZ);
  setTable('fuel_prices', [{ id: 'p1', item_id: 'ms', date: '2026-10-29', time: '06:00', rsp: 100 }, { id: 'p2', item_id: 'hsd', date: '2026-10-29', time: '06:00', rsp: 90 }]);
});

function closedDay() {
  for (const [no, start, end] of [[1, '06:00', '14:00'], [2, '14:00', '22:00']] as const) {
    const s = openShift({ date: '2026-10-29', shift_no: no, start, test_l: 5, attendants: [{ name: 'Ravi', nozzle_ids: ['n1'] }, { name: 'Sita', nozzle_ids: ['n2'] }] }, NZ);
    saveShift(s.id, {
      readings: s.readings.map((r) => ({ ...r, closing: r.opening + 105 })),
      collections: [{ attendant: 0, mode: 'cash', amount: 9000 }, { attendant: 0, mode: 'card', amount: 500 }, { attendant: 1, mode: 'upi', amount: 9100 }],
    }, NZ, `2026-10-29 ${end}`);
  }
}

test('one write for the day; non-GST Bill of Supply per shift; lines per tank; receipts by mode; the excess stays out', () => {
  closedDay();
  const real = localDb.invoices.saveMany;
  let calls = 0;
  localDb.invoices.saveMany = (l) => { calls++; return real(l); };
  try {
    dayClose('2026-10-29', {});
  } finally {
    localDb.invoices.saveMany = real;
  }
  assert.equal(calls, 1, 'one saveMany for the whole day');
  const bills = localDb.invoices.getAll().filter((i) => i.fu?.shift_id);
  assert.equal(bills.length, 2);
  const b = bills[0];
  assert.equal(b.doc_type, 'BILL_OF_SUPPLY');
  assert.equal(b.exempt_kind, 'NON_GST');
  assert.equal(b.client.name, 'Counter sales — fuel');
  assert.deepEqual(b.items.map((i) => [i.name, i.godown_id, i.quantity, i.amount, i.sv?.exempt]), [['Petrol (MS)', 't1', 100, 10000, 'NON_GST'], ['Diesel (HSD)', 't2', 100, 9000, 'NON_GST']]);
  assert.equal(b.total, 19000);
  const pays = localDb.payments.listFor(b.id);
  const cash = pays.find((p) => p.method === 'Cash');
  const card = pays.find((p) => p.method === 'Card');
  const upi = pays.find((p) => p.method === 'UPI');
  assert.equal(cash?.amount, 9000);
  assert.equal(cash?.bank_account_id, undefined);
  assert.equal(upi?.amount, 9000, 'Sita’s ₹100 excess comes off her UPI');
  const clearing = bankAccountsDb.all().find((a) => a.id === card?.bank_account_id);
  assert.equal(clearing?.name, 'Card settlements clearing');
  assert.equal(clearing?.clearing, true);
  for (const p of ['cheque', 'epay', 'brs'] as const) assert.ok(!pickableBankAccounts(p).some((a) => a.id === clearing?.id), `${p} never offers the clearing account`);
  const shifts = readShifts();
  assert.ok(shifts.every((s) => s.status === 'posted'));
  assert.equal(pays.reduce((a, p) => a + p.amount, 0), 18500, 'receipts = collections less Sita’s ₹100 excess (a note, journal cut)');
  assert.throws(() => dayClose('2026-10-29'), /No closed shift/);
});

test('shortage: written off (no cash) or recovered; undo restores closed, cancels the bill, keeps its number', () => {
  closedDay();
  dayClose('2026-10-29');
  const [s1, s2] = readShifts().sort((a, b) => a.shift_no - b.shift_no);
  const b1 = shiftBill(s1.id)!;
  assert.equal(b1.balance_due, 500, 'Ravi is ₹500 short');
  settleShort(s1.id, 0, 'write_off');
  assert.throws(() => settleShort(s1.id, 0, 'cash'), /already settled/);
  assert.throws(() => settleShort(s1.id, 1, 'cash'), /Nothing short/);
  const wo = localDb.payments.listFor(b1.id).find((p) => p.write_off);
  assert.ok(wo && movedNoCash(wo) && /Shortage at pump — Ravi/.test(wo.note ?? ''));
  assert.equal(localDb.invoices.getById(b1.id)?.status, 'Paid');
  settleShort(s2.id, 0, 'cash');
  assert.equal(localDb.payments.listFor(shiftBill(s2.id)!.id).filter((p) => p.method === 'Cash').length, 2);
  const number = b1.invoice_number;
  undoShift(s1.id);
  const back = readShifts().find((s) => s.id === s1.id)!;
  assert.equal(back.status, 'closed');
  assert.equal(back.settled, undefined);
  assert.equal(localDb.invoices.getById(b1.id)?.status, 'Cancelled');
  assert.equal(localDb.payments.listFor(b1.id).length, 0);
  dayClose('2026-10-29');
  const again = shiftBill(s1.id)!;
  assert.notEqual(again.invoice_number, number, 'the cancelled number stays used');
});
