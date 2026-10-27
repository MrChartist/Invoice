/** AG-B2 shift collection: chart at the shift date, duplicates, rejection, close / reopen, stock once, data volume. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setTable } from '../src/lib/storage.ts';
import type { MilkShift } from '../src/types/agri-r12.ts';
import { saveChart } from '../src/lib/agri/ag-rate-chart.ts';
import { addEntry, closeShift, loadShifts, removeEntry, reopenShift, shiftsOn, shiftTotals } from '../src/lib/agri/ag-shifts.ts';
import { loadPositions, stockDb } from '../src/lib/inventory.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { stockJournalsDb } from '../src/lib/manufacturing.ts';
import { cowMatrix } from './helpers/ag-dairy.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  saveChart(cowMatrix());
});

const key = { centre_id: 'c1', date: '2026-11-05', shift: 'M' as const };
const can = (farmer_id: string, qty = 10, fat = 3.7, over = {}) => ({ farmer_id, name: farmer_id, milk: 'cow' as const, qty, unit: 'L' as const, fat, snf: 8.6, ...over });
const milkQty = () => loadPositions().find((p) => p.item.name === 'Cow milk')?.qty ?? 0;

test('rate from the chart at the shift date; no chart → refused', () => {
  assert.equal(addEntry(key, can('f1')).entry.amount, 340);
  assert.throws(() => addEntry({ ...key, date: '2026-10-31' }, can('f2')), /No cow milk rate chart/);
});

test('one row per centre per shift; duplicates need confirmation; rejected milk is zero with a reason', () => {
  addEntry(key, can('f1'));
  assert.throws(() => addEntry(key, can('f1')), /already has milk/);
  addEntry(key, can('f1', 5), { allowDuplicate: true });
  const r = addEntry(key, can('f2', 8, 3.7, { reject: 'Sour' })).entry;
  assert.equal(r.rejected, true);
  assert.equal(r.amount, 0);
  assert.equal(r.reason, 'Sour');
  const low = addEntry(key, can('f3', 4, 2.5)).entry;
  assert.equal(low.rejected, true, 'below the chart minimum');
  addEntry({ ...key, shift: 'E' }, can('f1'));
  assert.equal(loadShifts().length, 2);
  const t = shiftTotals(loadShifts().find((s) => s.shift === 'M')!);
  assert.equal(t.farmers, 1);
  assert.equal(t.litres, 15);
  assert.equal(t.amount, 510);
  assert.equal(t.rejected, 2);
  assert.equal(t.rejectedLitres, 12);
  assert.equal(t.avgFat, 3.7);
});

test('close posts the accepted litres to stock once; closed is read-only; reopen removes the journal', () => {
  const { shift } = addEntry(key, can('f1'));
  addEntry(key, can('f2', 20));
  addEntry(key, can('f3', 5, 3.7, { reject: 'Water' }));
  const closed = closeShift(shift.id);
  assert.ok(closed.closed_at && closed.sj_id);
  assert.equal(milkQty(), 30);
  const sj = stockJournalsDb.all()[0];
  assert.equal(sj.produce[0].rate, 34);
  assert.equal(stockDb.items().find((i) => i.name === 'Cow milk')?.ag_class, 'milk_fresh');
  assert.throws(() => addEntry(key, can('f9')), /closed/);
  assert.throws(() => removeEntry(shift.id, closed.entries[0].id), /closed/);
  assert.equal(closeShift(shift.id).sj_id, closed.sj_id, 'closing twice posts nothing more');
  // the cycle purchase of the same milk carries ag.stock_by_shift: the stock reader skips it (no double count)
  purchasesDb.save({ kind: 'PURCHASE', vendor_name: 'Milk producers — C1', bill_number: 'CYB/FY26-27/0001', date: '2026-11-10', lines: [{ id: 'l', name: 'Cow milk', unit: 'LTR', quantity: 30, rate: 34, tax_rate: 0 }], taxable: 1020, cgst: 0, sgst: 0, igst: 0, total: 1020, amount_paid: 0, category: 'Milk purchases', itc_eligible: false, ag: { cycle_id: 'x', stock_by_shift: true } });
  assert.equal(milkQty(), 30);
  const reopened = reopenShift(shift.id);
  assert.equal(reopened.closed_at, undefined);
  assert.equal(stockJournalsDb.all().length, 0);
  assert.equal(milkQty(), 0);
});

test('a shift billed in a closed cycle cannot reopen', () => {
  const { shift } = addEntry(key, can('f1'));
  closeShift(shift.id);
  setTable('farmer_cycles', [{ id: 'cy', number: 'CYB/FY26-27/0001', status: 'closed', lines: [], period_from: '2026-11-01', period_to: '2026-11-10', source: 'milk' }]);
  setTable('milk_shifts', loadShifts().map((s) => ({ ...s, cycle_id: 'cy' })));
  assert.throws(() => reopenShift(shift.id), /reopen that cycle/);
});

test('volume: 300 farmers × 365 days × 2 shifts is 730 rows; a day reads at most 2', () => {
  const rows: MilkShift[] = [];
  const entries = Array.from({ length: 300 }, (_, i) => ({ id: `e${i}`, farmer_id: `f${i}`, milk: 'cow' as const, qty: 5, unit: 'L' as const, fat: 4, snf: 8.5, rate: 35, amount: 175, at: '' }));
  for (let d = 0; d < 365; d++) {
    const date = new Date(2026, 3, 1 + d);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    for (const shift of ['M', 'E'] as const) rows.push({ id: `${iso}${shift}`, centre_id: 'c1', date: iso, shift, entries, closed_at: 'x' });
  }
  setTable('milk_shifts', rows);
  const all = loadShifts();
  assert.equal(all.length, 730);
  assert.equal(shiftsOn(all, '2026-11-05', 'c1').length, 2);
  assert.equal(shiftTotals(all[0]).litres, 1500);
});
