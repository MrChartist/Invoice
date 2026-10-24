import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysBetween,
  disallowance43Bh,
  fyStartYear,
  isMse,
  msmeBills,
  msmedInterest,
  paymentLimit,
  validateUdyam,
} from '../src/lib/msme.ts';
import { rbiBankRate } from '../src/lib/tax-rules.ts';
import type { PurchaseRecord, Vendor } from '../src/types/purchases.ts';
import type { PurchasePayment } from '../src/lib/purchases.ts';

const vendors: Vendor[] = [
  { id: 'v1', name: 'Tiny Tools', msme_category: 'MICRO', msme_udyam: 'UDYAM-MH-01-0000001' },
  { id: 'v2', name: 'Mid Metals', msme_category: 'MEDIUM' },
  { id: 'v3', name: 'Small Supplies', msme_category: 'SMALL' },
  { id: 'v4', name: 'Big Corp' },
];

const bill = (p: Partial<PurchaseRecord>): PurchaseRecord => ({
  id: 'x', kind: 'PURCHASE', vendor_name: '', bill_number: 'B', date: '2025-04-01', category: 'Purchases',
  lines: [], taxable: 0, cgst: 0, sgst: 0, igst: 0, itc_eligible: true, total: 0, amount_paid: 0, ...p,
});

const purchases: PurchaseRecord[] = [
  bill({ id: 'b1', vendor_id: 'v1', vendor_name: 'Tiny Tools', bill_number: 'T1', date: '2025-04-01', due_date: '2025-06-30', taxable: 100000, cgst: 9000, sgst: 9000, total: 118000, amount_paid: 50000 }),
  bill({ id: 'b2', vendor_id: 'v2', vendor_name: 'Mid Metals', date: '2025-04-01', total: 5000 }),
  bill({ id: 'b3', vendor_id: 'v3', vendor_name: 'Small Supplies', bill_number: 'S1', date: '2026-03-20', taxable: 10000, total: 10000, itc_eligible: false }),
  bill({ id: 'b4', vendor_id: 'v4', date: '2025-04-01', total: 9000 }),
];
const payments: PurchasePayment[] = [{ id: 'pay1', purchase_id: 'b1', amount: 50000, date: '2025-05-10', method: 'UPI' }];

test('Udyam number format and MSE categories', () => {
  assert.equal(validateUdyam(''), '');
  assert.equal(validateUdyam(' udyam-mh-01-0000001 '), '');
  assert.notEqual(validateUdyam('UDYAM-MH-1-0000001'), '');
  assert.equal(isMse(vendors[0]), true);
  assert.equal(isMse(vendors[1]), false);
  assert.equal(isMse(vendors[3]), false);
});

test('payment limit: agreed date capped at 45 days; 15 days without one', () => {
  assert.equal(paymentLimit('2025-04-01', '2025-04-20'), '2025-04-20');
  assert.equal(paymentLimit('2025-04-01', '2025-06-30'), '2025-05-16');
  assert.equal(paymentLimit('2025-04-01'), '2025-04-16');
  assert.equal(paymentLimit('2026-02-20'), '2026-03-07');
  assert.equal(daysBetween('2025-05-16', '2025-06-16'), 31);
  assert.equal(fyStartYear('2026-03-31'), 2025);
  assert.equal(fyStartYear('2026-04-01'), 2026);
});

test('MSMED interest: compound monthly at 3 x the bank rate in force when interest starts', () => {
  assert.equal(rbiBankRate('2025-05-17'), 6.25);
  assert.equal(rbiBankRate('2024-06-02'), 6.75);
  assert.equal(msmedInterest(100000, '2025-05-16', '2025-06-16'), 1592.7);
  assert.equal(msmedInterest(50000, '2024-06-01', '2024-06-16'), 414.33);
  assert.equal(msmedInterest(50000, '2024-06-01', '2024-06-01'), 0);
});

test('msmeBills: only micro / small vendors, balance and lateness on the as-of day', () => {
  const rows = msmeBills(purchases, vendors, payments, '2025-06-16');
  assert.deepEqual(rows.map((r) => r.id), ['b1']);
  const b1 = rows[0];
  assert.equal(b1.limit, '2025-05-16');
  assert.equal(b1.unpaid, 68000);
  assert.equal(b1.daysOverdue, 31);
  // Interest only on the 68,000 still open (the 50,000 was paid in time).
  assert.equal(b1.interest, msmedInterest(68000, '2025-05-16', '2025-06-16'));
  // A late payment keeps its interest after the bill is settled.
  const late = msmeBills(purchases, vendors, [...payments, { id: 'p2', purchase_id: 'b1', amount: 68000, date: '2025-06-16', method: 'UPI' }], '2025-07-01');
  assert.equal(late[0].unpaid, 0);
  assert.equal(late[0].interest, msmedInterest(68000, '2025-05-16', '2025-06-16'));
});

test('43B(h): unpaid past the limit and past 31 March is disallowed; ITC share excluded', () => {
  // On 31 March the balance can still be paid within the year: at risk, not final.
  const onYearEnd = disallowance43Bh(purchases, vendors, payments, 2025, '2026-03-31');
  assert.equal(onYearEnd.fy, 'FY 2025-26');
  assert.equal(onYearEnd.total, 0);
  assert.equal(onYearEnd.atRisk, round(68000 * (100000 / 118000)) + 10000);

  // After the year: b1 is final; b3's 15-day limit (4 Apr) has also passed unpaid.
  const after = disallowance43Bh(purchases, vendors, payments, 2025, '2026-04-10');
  assert.equal(after.total, 57627.12 + 10000);
  assert.equal(after.atRisk, 0);
  assert.deepEqual(after.rows.map((r) => [r.id, r.unpaid, r.final]), [['b1', 68000, true], ['b3', 10000, true]]);

  // b3 paid on 3 April (within its limit after year-end): no disallowance for it.
  const paidInTime = disallowance43Bh(purchases, vendors, [...payments, { id: 'p3', purchase_id: 'b3', amount: 10000, date: '2026-04-03', method: 'UPI' }], 2025, '2026-04-10');
  assert.deepEqual(paidInTime.rows.map((r) => r.id), ['b1']);

  // b1 paid late but inside the same year: deductible in that year, nothing disallowed.
  const paidLateSameYear = disallowance43Bh(purchases, vendors, [...payments, { id: 'p4', purchase_id: 'b1', amount: 68000, date: '2025-09-01', method: 'UPI' }], 2025, '2026-04-10');
  assert.deepEqual(paidLateSameYear.rows.map((r) => r.id), ['b3']);
});

test('43B(h) does not apply before FY 2023-24', () => {
  const old = [bill({ id: 'o1', vendor_id: 'v1', date: '2022-05-01', total: 1000 })];
  assert.equal(disallowance43Bh(old, vendors, [], 2022, '2024-01-01').rows.length, 0);
});

test('legacy amount_paid without payment rows counts as paid on the bill date', () => {
  const legacy = [bill({ id: 'l1', vendor_id: 'v1', date: '2025-04-01', total: 1000, amount_paid: 1000 })];
  assert.equal(msmeBills(legacy, vendors, [], '2025-12-01')[0].unpaid, 0);
  assert.equal(disallowance43Bh(legacy, vendors, [], 2025, '2026-06-01').rows.length, 0);
});

function round(n: number) {
  return Math.round(n * 100) / 100;
}
