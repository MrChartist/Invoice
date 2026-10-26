/** RT-A4: supplier free quantity and line discount — stock = paid + free, cost spread, GST / ITC on the paid value. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setTable } from '../src/lib/storage.ts';
import { readPurchase, readPurchaseLines } from '../src/lib/purchase-normalize.ts';
import { computePurchaseTotals } from '../src/lib/purchases.ts';
import { loadPositions } from '../src/lib/inventory.ts';
import { loadTracking } from '../src/lib/stock-tracking.ts';
import { freeUnitsReturned, noteLineFrom, returnableLines } from '../src/lib/purchase-returns.ts';
import { lastPurchaseRate } from '../src/lib/trade/tr-party-rates.ts';
import type { PurchaseLine, PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const strip: PurchaseLine = { id: 'l1', name: 'Paracetamol strip', hsn: '3004', unit: 'STRIP', quantity: 10, free_qty: 1, rate: 80, discount_percent: 5, tax_rate: 5, batch_no: 'PX1', mrp: 120 };
const bill = (lines: PurchaseLine[] = [strip]): PurchaseRecord => {
  const t = computePurchaseTotals(lines, { placeOfSupply: '27', businessState: '27' });
  return { id: 'b1', kind: 'PURCHASE', vendor_id: 'v1', vendor_name: 'Pharma Dist', bill_number: 'D-1', date: '2026-07-01', status: 'unpaid', lines, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total, amount_paid: 0, itc_eligible: true } as unknown as PurchaseRecord;
};

test('10 + 1 at ₹80 less 5%: taxable ₹760, GST on ₹760 only', () => {
  const t = computePurchaseTotals([strip], { placeOfSupply: '27', businessState: '27' });
  assert.deepEqual([t.taxable, t.cgst, t.sgst, t.total], [760, 19, 19, 798]);
  const c = readPurchase(bill())!;
  assert.deepEqual([c.taxable, c.tax], [760, 38], 'GSTR-2 / ITC readers see the paid value only');
  const [l] = readPurchaseLines(bill());
  assert.deepEqual([l.quantity, l.paidQty, l.freeQty, l.netRate], [11, 10, 1, 76]);
  assert.equal(Math.round(l.unitCost * 100) / 100, 69.09);
  assert.equal(Math.round(l.quantity * l.unitCost * 100) / 100, 760, 'quantity × unit cost is still the taxable value');
});

test('stock +11 at ₹69.09; the batch holds 11', () => {
  setTable('stock_items', [{ id: 's1', name: 'Paracetamol strip', hsn: '3004', unit: 'STRIP', track_stock: true, track_batches: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }]);
  setTable('purchases', [bill()]);
  const p = loadPositions().find((x) => x.item.id === 's1')!;
  assert.equal(p.qty, 11);
  assert.equal(Math.round(p.avgCost * 100) / 100, 69.09);
  assert.equal(Math.round(p.value * 100) / 100, 760);
  assert.equal(loadTracking().get('s1')?.batches.find((b) => b.batch === 'PX1')?.qty, 11);
});

test('alternate units: 2 BOX (of 10) + 1 free BOX → 30 base units', () => {
  setTable('stock_items', [{ id: 's2', name: 'Soap', hsn: '3401', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, alt_units: [{ unit: 'BOX', factor: 10 }] }]);
  setTable('purchases', [bill([{ id: 'l2', name: 'Soap', hsn: '3401', unit: 'BOX', unit_factor: 10, quantity: 2, free_qty: 1, rate: 300, tax_rate: 18 }])]);
  const p = loadPositions().find((x) => x.item.id === 's2')!;
  assert.equal(p.qty, 30);
  assert.equal(Math.round(p.avgCost * 100) / 100, 20, '₹600 over 30 units');
});

test('return: paid units go back at cost first, free units at zero value', () => {
  const b = bill();
  const [r] = returnableLines(b, []);
  assert.deepEqual([r.billed, r.paid, r.available], [11, 10, 11]);
  assert.equal(freeUnitsReturned(r, 2), 0);
  assert.equal(noteLineFrom(r, 2).rate, 76);
  assert.equal(freeUnitsReturned(r, 11), 1);
  assert.equal(Math.round(noteLineFrom(r, 11).rate * 11 * 100) / 100, 759.99, 'the full return credits the paid value (rate rounded to the paisa: 69.09 × 11)');
});

test('the party-rate hint keeps the rate charged per paid unit', () => {
  assert.equal(lastPurchaseRate([bill()], { id: 'v1', name: 'Pharma Dist' }, 'Paracetamol strip')?.rate, 76);
});
