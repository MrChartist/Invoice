/**
 * Contract test: the report modules read the `purchases` table through the shared
 * `readPurchase` / `splitLumpTax` and their own thin adapters. They must all understand
 * the real PurchaseRecord shape (src/types/purchases.ts) and split legacy rows alike.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePurchase as booksNormalize } from '../src/lib/books.ts';
import { normalizePurchase as exportNormalize } from '../src/lib/export-shared.ts';
import { normalizePurchase as gstNormalize } from '../src/lib/gst-reports.ts';
import { collectEvents } from '../src/lib/inventory.ts';
import { bookBills } from '../src/lib/gstr2b.ts';
import { buildGstr9 } from '../src/lib/gstr9.ts';
import { readPurchase } from '../src/lib/purchase-normalize.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import { gstinChecksumChar } from '../src/lib/gstin.ts';

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

test('every reader understands the GST-completeness fields (RCM, import, reversal, 17(5))', () => {
  const full: PurchaseRecord = {
    ...bill,
    id: 'p2',
    reverse_charge: true,
    import_type: 'GOODS',
    boe_number: '7654321',
    boe_date: '2026-04-10',
    port_code: 'INNSA1',
    itc_reversed: 18,
    itc_reversal_reason: 'RULE_42',
  };
  const core = readPurchase(full)!;
  assert.equal(core.reverseCharge, true);
  assert.equal(core.importType, 'GOODS');
  assert.equal(core.itcReversed, 18);
  assert.equal(core.itcReversalReason, 'RULE_42');
  const g = gstNormalize(full, '27')!;
  assert.equal(g.reverseCharge, true);
  assert.equal(g.importType, 'GOODS');
  assert.equal(g.itcReversalReason, 'RULE_42');
  const blocked = gstNormalize({ ...bill, itc_eligible: false, itc_reversal_reason: 'SEC_17_5' }, '27')!;
  assert.equal(blocked.itcEligible, false);
  assert.equal(blocked.itcReversalReason, 'SEC_17_5');
  // Books and exports keep reading the same money figures regardless of the new flags.
  assert.equal(booksNormalize(full as never)!.total, 1180);
  assert.equal(exportNormalize(full)!.taxable, 1000);
  // Legacy rows without the fields read as domestic, forward charge, no reversal.
  const legacy = readPurchase(bill)!;
  assert.deepEqual([legacy.reverseCharge, legacy.importType, legacy.itcReversed, legacy.itcReversalReason], [false, '', 0, '']);
});

test('gstr9 reads the real purchase shape (Table 6B, 7, 18)', () => {
  const g = buildGstr9([], [bill, { ...bill, id: 'p3', itc_reversed: 18, itc_reversal_reason: 'RULE_42' }], { fyStart: 2026, filerStateCode: '27' });
  const b6 = g.table6.find((r) => r.id === '6B(i)')!;
  assert.deepEqual([b6.cgst, b6.sgst, b6.igst], [180, 180, 0]);
  assert.equal(g.table7.find((r) => r.id === '7C')!.cgst, 9);
  const h = g.table18.find((r) => r.hsn === '4802')!;
  assert.deepEqual([h.qty, h.taxable, h.cgst, h.rate], [20, 2000, 180, 18]);
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

test('a legacy lump-tax row splits the same way in GST reports, books and exports', () => {
  // Intra-state supplier (27) buying in 27: CGST + SGST, never all IGST.
  const intra = { id: 'old1', vendor_name: 'Old Co', vendor_gstin: '27AAPFU0939F1ZV', bill_number: 'L1', date: '2026-04-12', place_of_supply: '27', taxable: 1000, tax_amount: 180, total: 1180 };
  const g = gstNormalize(intra, '27')!;
  const b = booksNormalize(intra as never)!;
  const e = exportNormalize(intra)!;
  for (const [name, n] of [['gst', g], ['books', b], ['export', e]] as const) {
    assert.deepEqual([n.cgst, n.sgst, n.igst], [90, 90, 0], `${name} split`);
  }
  assert.equal(e.tax, 180);
  assert.equal(b.gst, 180);

  // Inter-state supplier (07) billing into 27: all IGST everywhere.
  const delhi = '07AAPFU0939F1Z' + gstinChecksumChar('07AAPFU0939F1Z');
  const inter = { ...intra, id: 'old2', vendor_gstin: delhi };
  assert.equal(gstNormalize(inter, '27')!.igst, 180);
  assert.equal(booksNormalize(inter as never)!.igst, 180);
  assert.equal(exportNormalize(inter)!.igst, 180);

  // Rate only (no tax figure): tax derived from the rate and taken out of the total.
  const rateOnly = { id: 'old3', vendor_name: 'Old Co', date: '2026-04-12', place_of_supply: '27', tax_rate: 18, total: 1180 };
  const r = exportNormalize(rateOnly)!;
  assert.equal(r.taxable + r.tax, 1180);
});

test('GSTR-2B matcher reads the real purchase shape (and skips drafts)', () => {
  const [b] = bookBills([bill, { ...bill, id: 'p2', status: 'draft' }], '27');
  assert.equal(bookBills([bill, { ...bill, id: 'p2', status: 'draft' }], '27').length, 1);
  assert.equal(b.number, 'AS/22');
  assert.equal(b.gstin, '27AAPFU0939F1ZV');
  assert.equal(b.date, '2026-04-12');
  assert.equal(b.taxable, 1000);
  assert.equal(b.tax, 180);
  assert.equal(b.in4a5, true);
});
