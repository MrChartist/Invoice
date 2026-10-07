import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/lib/purchases.ts';
import * as V from '../src/lib/vendors.ts';
import type { PurchaseRecord as PR } from '../src/types/purchases.ts';

// Minimal localStorage shim for the Node test runtime.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

const line = (rate: number, tax: number, qty = 1) => ({ id: 'l' + rate, name: 'x', quantity: qty, rate, tax_rate: tax });

function bill(over: Partial<PR> = {}): Omit<PR, 'id'> {
  const t = P.computePurchaseTotals([line(1000, 18)], { placeOfSupply: '27', businessState: '27' });
  return {
    kind: 'PURCHASE', vendor_name: 'Acme', bill_number: 'A-1', date: '2026-04-10', due_date: '2026-04-20',
    category: 'Purchases', lines: [line(1000, 18)], taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst,
    itc_eligible: true, total: t.total, amount_paid: 0, ...over,
  };
}

test('intra-state splits CGST+SGST, inter-state charges IGST', () => {
  const a = P.computePurchaseTotals([line(1000, 18)], { placeOfSupply: '27', businessState: '27' });
  assert.deepEqual([a.cgst, a.sgst, a.igst, a.total], [90, 90, 0, 1180]);
  const b = P.computePurchaseTotals([line(1000, 18)], { placeOfSupply: '29', businessState: '27' });
  assert.deepEqual([b.cgst, b.sgst, b.igst, b.total], [0, 0, 180, 1180]);
  const c = P.computePurchaseTotals([line(1000, 18)], { gstApplies: false });
  assert.equal(c.total, 1000);
});

test('multi-line totals round to the paisa', () => {
  const t = P.computePurchaseTotals([line(33.33, 5, 3), line(10.01, 12, 7)], { placeOfSupply: '27', businessState: '27' });
  assert.equal(t.total, Math.round(t.total * 100) / 100);
  assert.equal(Math.round((t.cgst + t.sgst + t.igst) * 100) / 100, t.tax);
});

test('expenseLine backs tax out of an inclusive amount', () => {
  assert.equal(P.expenseLine('Rent', 1180, 18, true).rate, 1000);
  assert.equal(P.expenseLine('Rent', 1000, 18, false).rate, 1000);
});

test('status derivation', () => {
  const base = { ...bill(), id: '1' } as PR;
  assert.equal(P.deriveStatus(base, '2026-04-15'), 'Unpaid');
  assert.equal(P.deriveStatus(base, '2026-04-21'), 'Overdue');
  assert.equal(P.deriveStatus({ ...base, amount_paid: 100 }, '2026-04-15'), 'Partially paid');
  assert.equal(P.deriveStatus({ ...base, amount_paid: 1180 }, '2026-05-30'), 'Paid');
});

test('payments: record, overpay rejected, delete rolls back', () => {
  const saved = P.purchasesDb.save(bill());
  P.paymentsDb.record(saved.id, { amount: 500, date: '2026-04-12', method: 'UPI', reference: 'u1' });
  assert.equal(P.purchasesDb.get(saved.id)!.amount_paid, 500);
  assert.throws(() => P.paymentsDb.record(saved.id, { amount: 700, date: '2026-04-13', method: 'Cash' }), /exceeds/);
  const p2 = P.paymentsDb.record(saved.id, { amount: 680, date: '2026-04-14', method: 'Cash' });
  assert.equal(P.deriveStatus(P.purchasesDb.get(saved.id)!, '2026-06-01'), 'Paid');
  P.paymentsDb.remove(p2.id);
  assert.equal(P.purchasesDb.get(saved.id)!.amount_paid, 500);
  assert.equal(P.paymentsDb.forPurchase(saved.id).length, 1);
  assert.equal(P.paidInMonth(P.paymentsDb.all(), '2026-04'), 500);
  P.purchasesDb.remove(saved.id);
  assert.equal(P.paymentsDb.forPurchase(saved.id).length, 0);
});

test('aggregates: payables, ITC, categories, months, filters', () => {
  const a = { ...bill(), id: 'a', amount_paid: 180 } as PR;
  const b = { ...bill({ itc_eligible: false, category: 'Rent', date: '2026-05-02', due_date: undefined }), id: 'b' } as PR;
  assert.equal(P.payablesOutstanding([a, b]), 2180);
  const itc = P.itcTotals([a, b]);
  assert.equal(itc.total, 180);
  assert.equal(itc.ineligible, 180);
  assert.equal(P.itcTotals([a, b], '2026-05').total, 0);
  assert.equal(P.categorySummary([a, b])[0].category, 'Purchases');
  assert.deepEqual(P.monthBuckets([b, a]).map((m) => m.month), ['2026-04', '2026-05']);
  assert.equal(P.filterPurchases([a, b], { category: 'Rent' }, '2026-06-01').length, 1);
  assert.equal(P.filterPurchases([a, b], { status: 'Overdue' }, '2026-06-01').length, 1);
  assert.equal(P.filterPurchases([a, b], { from: '2026-05-01', query: 'acme' }, '2026-06-01').length, 1);
  assert.equal(P.purchasesToCsvRows([a], '2026-06-01').length, 2);
});

test('vendors: validation, save, balances', () => {
  assert.match(V.validateVendor({ name: '' }), /required/);
  assert.notEqual(V.validateVendor({ name: 'X', gstin: '27AAAAA0000A1Z4' }), '');
  assert.equal(V.validateVendor({ name: 'X' }), '');
  const v = V.vendorsDb.save({ name: ' Acme ' });
  assert.equal(V.vendorsDb.get(v.id)!.name, 'Acme');
  const rows = [{ ...bill({ vendor_id: v.id }), id: 'z' } as PR];
  assert.equal(V.vendorBalances(rows).get(v.id)!.outstanding, 1180);
  assert.equal(V.searchVendors(V.vendorsDb.all(), 'acm').length, 1);
  V.vendorsDb.remove(v.id);
  assert.equal(V.vendorsDb.all().length, 0);
});
