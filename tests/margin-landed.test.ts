/**
 * R6-C1: the margin chip and the insights tile cost goods at the landed rate the stock reports use — they read
 * purchases through `liveInputs()` (landed-cost vouchers applied on engine copies). Plus the QC-reject debit-note
 * prefill link (`debitNotePrefillHref` / `parseDebitNotePrefill`).
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { blankStockItem, stockDb } from '../src/lib/inventory.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { landedVouchersDb } from '../src/lib/landed-voucher.ts';
import { buildUnitCosts, documentMargin, liveCostPurchases, liveUnitCosts } from '../src/lib/margin.ts';
import { buildInsights } from '../src/lib/insights.ts';
import { debitNotePrefillHref, parseDebitNotePrefill } from '../src/lib/purchases.ts';
import type { ReceiptNote } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-05-10T10:00:00');
});
afterEach(() => thawDate());

const bill = (id: string, date: string, lines: object[], extra: object = {}) => ({ id, kind: 'PURCHASE', bill_number: id.toUpperCase(), vendor_name: 'Steel Co', date, status: 'Unpaid', total: 0, taxable: 0, lines, ...extra });

function world() {
  stockDb.saveItem(blankStockItem({ id: 'steel', name: 'Steel rod', unit: 'KG' }));
  setTable('purchases', [
    bill('b1', '2026-04-05', [{ id: 'b1a', name: 'Steel rod', item_id: 'steel', quantity: 100, rate: 50 }]),
    bill('f1', '2026-04-15', [{ id: 'f1a', name: 'Freight inward', quantity: 1, rate: 500 }], { vendor_name: 'Fast Logistics' }),
  ]);
}

test('a landed-cost voucher raises the cost the margin chip uses', () => {
  world();
  const before = liveUnitCosts();
  assert.equal(before.get('steel rod')?.cost, 50, 'bill rate before the voucher');
  landedVouchersDb.save(
    { date: '2026-04-20', method: 'value', charges: [{ id: 'c1', source: { kind: 'bill', id: 'f1', line_id: 'f1a' }, label: 'Freight', amount: 500 }], targets: [{ kind: 'bill', id: 'b1' }] },
    { purchases: getTable('purchases'), receipts: getTable<ReceiptNote>('receipt_notes'), items: stockDb.items() },
  );
  const raw = buildUnitCosts(getTable('purchases'), stockDb.items(), []);
  assert.equal(raw.get('steel rod')?.cost, 50, 'raw bills alone do not see the voucher');
  const live = liveUnitCosts();
  assert.equal(live.get('steel rod')?.cost, 55, '₹500 freight over 100 kg → ₹55 landed');
  const m = documentMargin([{ name: 'Steel rod', quantity: 10, rate: 60 }], live);
  assert.deepEqual([m.revenue, m.cost, m.margin], [600, 550, 50]);
  // Stored bills never change.
  assert.equal(JSON.stringify(getTable('purchases')).includes('__landed_extra'), false);
});

test('insights margin erosion reads the landed costs; the GST / expense cards are unchanged by the engine copies', () => {
  world();
  landedVouchersDb.save(
    { date: '2026-04-20', method: 'value', charges: [{ id: 'c1', source: { kind: 'bill', id: 'f1', line_id: 'f1a' }, label: 'Freight', amount: 500 }], targets: [{ kind: 'bill', id: 'b1' }] },
    { purchases: getTable('purchases'), receipts: getTable<ReceiptNote>('receipt_notes'), items: stockDb.items() },
  );
  const sale = (id: string, date: string) => ({ id, doc_type: 'TAX_INVOICE', status: 'Sent', invoice_number: id, issue_date: date, currency: 'INR', total: 600, client: { name: 'A' }, items: [{ id: 'l', name: 'Steel rod', quantity: 10, rate: 60 }] });
  const input = { invoices: [sale('s1', '2026-05-05')] as never[], payments: [], purchases: liveCostPurchases(), costs: liveUnitCosts() };
  const margin = buildInsights(input, '2026-05-10').find((c) => c.id === 'margin');
  assert.equal(margin?.value, 8.33, '(600 − 550) / 600');
  const gstLive = buildInsights(input, '2026-05-10').find((c) => c.id === 'gstTrend')?.value;
  const gstRaw = buildInsights({ ...input, purchases: getTable('purchases') }, '2026-05-10').find((c) => c.id === 'gstTrend')?.value;
  assert.equal(gstLive, gstRaw);
});

test('QC reject → debit note prefill: href and param parsing round-trip', () => {
  const href = debitNotePrefillHref('bill 1', [{ id: 'l1', quantity: 4 }, { id: 'l2', quantity: 0 }, { id: 'l3', quantity: 1.255 }]);
  assert.equal(href, '/expenses?tab=returns&new=dn&bill=bill%201&lines=l1%3A4%2Cl3%3A1.26');
  const params = new URLSearchParams(href.split('?')[1]);
  assert.deepEqual(parseDebitNotePrefill(params), { billId: 'bill 1', qty: { l1: 4, l3: 1.26 } });
  assert.deepEqual(parseDebitNotePrefill(new URLSearchParams('new=dn&lines=x:-1,:3,y:abc,z:2')), { billId: undefined, qty: { z: 2 } });
});
