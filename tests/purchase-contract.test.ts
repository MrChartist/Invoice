/**
 * Contract test: four report modules read the `purchases` table through their
 * own tolerant normalisers. They must all understand the real PurchaseRecord
 * shape that the purchases module writes (src/types/purchases.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePurchase as booksNormalize } from '../src/lib/books.ts';
import { normalizePurchase as exportNormalize } from '../src/lib/export-shared.ts';
import { normalizePurchase as gstNormalize } from '../src/lib/gst-reports.ts';
import { collectEvents } from '../src/lib/inventory.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

const bill: PurchaseRecord = {
  id: 'p1',
  kind: 'PURCHASE',
  vendor_name: 'Acme Supplies',
  vendor_gstin: '27AAPFU0939F1ZV',
  bill_number: 'AS/22',
  date: '2026-04-12',
  place_of_supply: '27',
  category: 'Purchases',
  lines: [{ id: 'l1', name: 'Paper ream', hsn: '4802', unit: 'NOS', quantity: 10, rate: 100, tax_rate: 18 }],
  taxable: 1000,
  cgst: 90,
  sgst: 90,
  igst: 0,
  itc_eligible: true,
  total: 1180,
  amount_paid: 0,
};

test('books reads the real purchase shape', () => {
  const n = booksNormalize(bill as never);
  assert.ok(n, 'books normaliser returned null');
  assert.equal(n!.date, '2026-04-12');
  assert.equal(n!.taxable, 1000);
  assert.equal(n!.cgst, 90);
  assert.equal(n!.sgst, 90);
  assert.equal(n!.total, 1180);
  assert.equal(n!.itcEligible, true);
  assert.equal(n!.isExpense, false);
});

test('books treats kind EXPENSE as an indirect expense', () => {
  const n = booksNormalize({ ...bill, kind: 'EXPENSE', category: 'Rent' } as never);
  assert.equal(n!.isExpense, true);
});

test('exports reads the real purchase shape', () => {
  const n = exportNormalize(bill);
  assert.ok(n);
  assert.equal(n!.date, '2026-04-12');
  assert.equal(n!.taxable, 1000);
  assert.equal(n!.cgst, 90);
  assert.equal(n!.total, 1180);
  assert.equal(n!.partyGstin, '27AAPFU0939F1ZV');
});

test('gst-reports reads the real purchase shape and ITC flag', () => {
  const n = gstNormalize(bill, '27');
  assert.ok(n);
  assert.equal(n!.taxable, 1000);
  assert.equal(n!.cgst, 90);
  assert.equal(n!.sgst, 90);
  assert.equal(n!.itcEligible, true);
  assert.equal(n!.supplierGstin, '27AAPFU0939F1ZV');
  const blocked = gstNormalize({ ...bill, itc_eligible: false }, '27');
  assert.equal(blocked!.itcEligible, false);
});

test('inventory brings purchase lines in as stock-in', () => {
  const events = collectEvents({
    items: [{ id: 's1', name: 'Paper ream', hsn: '4802', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }] as never,
    moves: [],
    invoices: [],
    purchases: [bill] as never,
  });
  const list = events.get('s1') ?? [];
  assert.equal(list.length, 1);
  assert.equal(list[0].qty, 10);
});
