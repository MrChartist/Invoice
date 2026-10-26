/**
 * R6-C2: supplier opening bills in bill-wise payables — they age from their own date, settle Agst Ref through
 * supplier payments (`vendor_payments.allocations[].opening_bill_id`) and adjustments, the typed opening not split
 * into bills shows as "On Account", and the payables total equals the ledger's creditor balance.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { EMPTY_BOOKS } from '../src/lib/books.ts';
import { A, accountStatement, buildLedger, loadLedgerInput, partyLedgerId, saveOpenings } from '../src/lib/ledger/index.ts';
import { loadPayableOpeningBills, payableOpeningBills, saveOpeningBillsFor } from '../src/lib/opening-bills.ts';
import { adjustAgainstBill, billwisePayables, deleteVendorPayment, openingRefKey, payablesTotals, recordSupplierPayment, vendorPaymentsDb } from '../src/lib/billwise.ts';
import { paymentsDb, purchasesDb } from '../src/lib/purchases.ts';
import type { PurchaseRecord, Vendor } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  freezeDate('2026-06-30T10:00:00');
});
afterEach(() => thawDate());

const FY = { start: '2026-04-01', end: '2027-03-31' };
const shree: Vendor = { id: 'v1', name: 'Shree Packaging' };

function world() {
  setTable('vendors', [shree]);
  saveOpeningBillsFor({ id: 'v1', name: 'Shree Packaging', side: 'payable' }, [
    { ref_no: 'SP/101', date: '2026-02-01', due_date: '2026-03-03', amount: 20_000, dr_cr: 'Cr' },
    { ref_no: 'SP/117', date: '2026-03-15', amount: 6_000, dr_cr: 'Cr' },
  ]);
  // Typed opening ₹30,000 Cr: ₹4,000 is not split into bills → On Account.
  saveOpenings([{ ledger_id: partyLedgerId('creditor', 'v1'), amount: -30_000_00, party_name: 'Shree Packaging' }]);
  const bill: PurchaseRecord = {
    id: 'p1', kind: 'PURCHASE', vendor_id: 'v1', vendor_name: 'Shree Packaging', bill_number: 'SP/140', date: '2026-05-01', due_date: '2026-05-31',
    category: 'Purchases', lines: [{ id: 'l1', name: 'Cartons', quantity: 100, rate: 100, tax_rate: 18 }], taxable: 10_000, cgst: 900, sgst: 900, igst: 0,
    itc_eligible: true, total: 11_800, amount_paid: 0, place_of_supply: '27',
  };
  setTable('purchases', [bill]);
}

const payables = () => billwisePayables({ purchases: purchasesDb.all(), payments: paymentsDb.all(), vendorPayments: vendorPaymentsDb.all(), vendors: [shree], asOf: '2026-06-30', openingBills: loadPayableOpeningBills([shree], '2026-06-30') });

test('pure: payable opening bills + the On Account residual of the typed opening', () => {
  const rows = payableOpeningBills(
    [{ id: 'o1', party_id: 'v1', party_name: 'Shree', side: 'payable', ref_no: 'A', date: '2026-02-01', amount: 20_000, dr_cr: 'Cr' }, { id: 'o2', party_id: 'c1', party_name: 'Asha', side: 'receivable', ref_no: 'B', date: '2026-02-01', amount: 5, dr_cr: 'Dr' }],
    new Map([[partyLedgerId('creditor', 'v1'), -25_000_00]]),
    [shree],
    '2026-04-01',
  );
  assert.deepEqual(rows.map((r) => [r.id, r.amount, r.dr_cr, !!r.on_account]), [['o1', 20_000, 'Cr', false], ['onacc:v1', 5_000, 'Cr', true]]);
});

test('opening bills age from their own date and appear in the payables picker keys', () => {
  world();
  const [p] = payables();
  assert.deepEqual(p.bills.map((b) => [b.number, b.balance, b.bucket, !!b.opening]), [
    ['SP/101', 20_000, 'd90plus', true],
    ['SP/117', 6_000, 'd90plus', true],
    ['On Account', 4_000, 'd90plus', true],
    ['SP/140', 11_800, 'd0_30', false],
  ]);
  assert.equal(p.bills.find((b) => b.number === 'SP/101')!.overdueDays, 119);
  assert.ok(p.bills.filter((b) => b.opening).every((b) => b.purchaseId.startsWith('opening:')));
});

test('settled Agst Ref by a supplier payment and an advance adjustment; payables total = ledger creditor balance', () => {
  world();
  const ob = loadPayableOpeningBills([shree], '2026-06-30');
  const sp101 = ob.find((b) => b.ref_no === 'SP/101')!;
  const sp117 = ob.find((b) => b.ref_no === 'SP/117')!;
  const r = recordSupplierPayment({
    vendorId: 'v1', vendorName: 'Shree Packaging', date: '2026-06-05', amount: 15_000, method: 'Bank transfer',
    allocations: [{ purchaseId: openingRefKey(sp101.id), amount: 12_000 }, { purchaseId: 'p1', amount: 3_000 }],
  });
  assert.equal(r.payments.length, 1, 'the bill gets its Agst Ref payment row');
  assert.deepEqual(r.remainder?.allocations, [{ purchase_id: '', opening_bill_id: sp101.id, amount: 12_000, date: '2026-06-05' }]);
  // An on-account payment, adjusted later against the other opening bill.
  const adv = recordSupplierPayment({ vendorId: 'v1', vendorName: 'Shree Packaging', date: '2026-06-10', amount: 5_000, method: 'Cash', allocations: [] });
  adjustAgainstBill(adv.remainder!.id, openingRefKey(sp117.id), 5_000, '2026-06-12');
  assert.throws(() => adjustAgainstBill(adv.remainder!.id, openingRefKey(sp117.id), 1, '2026-06-12'), /unadjusted|balance/);
  assert.throws(() => recordSupplierPayment({ vendorId: 'v1', vendorName: 'Shree Packaging', date: '2026-06-20', amount: 9_000, method: 'Cash', allocations: [{ purchaseId: openingRefKey(sp101.id), amount: 8_500 }] }), /exceeds its balance of 8000.00/);

  const [p] = payables();
  const bal = Object.fromEntries(p.bills.map((b) => [b.number, b.balance]));
  assert.deepEqual(bal, { 'On Account': 4_000, 'SP/101': 8_000, 'SP/117': 1_000, 'SP/140': 8_800 });
  assert.equal(p.advancesTotal, 0, 'both payments fully adjusted');
  const totals = payablesTotals([p]);
  assert.equal(totals.net, 21_800);

  // Ledger: opening 30,000 Cr + bill 11,800 − payments 20,000 = 21,800 Cr.
  const ledger = buildLedger(loadLedgerInput({ ...EMPTY_BOOKS, purchases: getTable('purchases') as never, purchasePayments: getTable('purchase_payments') as never, vendors: [shree], vendorPayments: vendorPaymentsDb.all() } as never, '2026-06-30'));
  const st = accountStatement(ledger, A.creditors, FY, 'Shree Packaging')!;
  assert.equal(st.closing, -21_800_00, 'ledger creditor balance = bill-wise payables net');

  // Deleting the payment that settled an opening bill puts its balance back (no bill row to undo).
  deleteVendorPayment(r.remainder!.id);
  assert.equal(payables()[0].bills.find((b) => b.number === 'SP/101')!.balance, 20_000);
  assert.equal(purchasesDb.get('p1')!.amount_paid, 3_000, 'the bill payment row is separate and stays');
});
