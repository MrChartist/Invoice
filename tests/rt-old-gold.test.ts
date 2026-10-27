/** RT-E3 old gold: fine weight and value, no GST / ITC, stock into Old gold in the 'used' godown, exchange moves no
 * cash, the sale keeps its full value (GST on it), PAN at the limit, URD number reserved after a delete. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import { cashPaidToday, exchangeNote, oldGoldValue, oldGoldVouchers, recordOldGold } from '../src/lib/retail/rt-old-gold.ts';
import { settleByExchange } from '../src/lib/retail/rt-urd.ts';
import { localDb } from '../src/lib/localDb.ts';
import { paymentsDb, purchasesDb } from '../src/lib/purchases.ts';
import { readPurchase } from '../src/lib/purchase-normalize.ts';
import { normalizePurchase as booksNormalize } from '../src/lib/books.ts';
import { loadTracking } from '../src/lib/stock-tracking.ts';
import { godownsDb } from '../src/lib/godowns.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import { calculateInvoice, calcInputFromRecord } from '../src/lib/invoice-calc.ts';
import { withTotals } from '../src/lib/pos.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'kirana', retail_kind: 'jewellery', industry_packs: ['jewellery'] } as never);
});
const DAY = '2026-10-27';
const chain = { date: DAY, customer: { name: 'Mrs. Iyer', phone: '98000 00021' }, metal: 'gold' as const, gross: 12.3, purity_pct: 84, melt_pct: 2, rate: 10000 };

test('fine = net × touch % × (1 − melt %); value at the 24K buy rate (the PRD example ₹1,01,253.60)', () => {
  assert.deepEqual(oldGoldValue({ gross: 12.3, purity_pct: 84, melt_pct: 2, rate: 10000 }), { net: 12.3, fine: 10.125, value: 101253.6 });
  assert.deepEqual(oldGoldValue({ gross: 10, stone: 0.5, purity_pct: 91.6, rate: 10000 }), { net: 9.5, fine: 8.702, value: 87020 });
  assert.equal(oldGoldValue({ gross: 10, purity_pct: 91.6, melt_pct: 1, rate: 9150, basis: 'purity' }).value, 90585, 'setting: net × (1 − melt) × the stated purity\'s rate');
});

test('the voucher: URD number, no GST, no ITC, into Old gold (fine g) in the used godown; the books read the real shape', () => {
  const p = recordOldGold(chain);
  assert.equal(p.bill_number, 'URD/FY26-27/0001');
  assert.deepEqual([p.taxable, p.cgst, p.sgst, p.igst, p.total, p.itc_eligible, p.reverse_charge], [101253.6, 0, 0, 0, 101253.6, false, undefined]);
  assert.equal(p.old_metal!.fine_wt, 10.125);
  const c = readPurchase(p)!;
  assert.deepEqual([c.taxable, c.tax, c.itcEligible], [101253.6, 0, false]);
  assert.equal(booksNormalize(p as never)!.total, 101253.6);
  const used = godownsDb.list().find((g) => g.kind === 'used')!;
  const item = getTable<{ id: string; name: string; unit: string }>('stock_items').find((i) => i.name === 'Old gold (fine 24K)')!;
  const t = loadTracking().get(item.id)!;
  assert.deepEqual([item.unit, t.qty, t.byGodown[used.id]], ['GMS', 10.125, 10.125]);
  assert.equal(getTable('vendors').length, 1, 'the customer as a vendor');
  recordOldGold({ ...chain, gross: 1 });
  assert.equal(getTable('vendors').length, 1, 'matched again by phone');
  purchasesDb.remove(p.id);
  assert.equal(recordOldGold(chain).bill_number, 'URD/FY26-27/0003', 'a deleted URD number is never reused');
});

test('exchange: the sale keeps its full value (GST on ₹1,40,000); the exchange receipt moves no cash and clears the voucher', () => {
  const p = recordOldGold(chain);
  const sale = withTotals({ id: 'inv1', invoice_number: 'INV/FY26-27/0001', doc_type: 'INVOICE', status: 'Sent', issue_date: DAY, due_date: DAY, gst_mode: 'CGST_SGST', discount_type: 'PERCENT', discount_rate: 0, client: { name: 'Mrs. Iyer', phone: '9800000021' }, items: [{ id: 'l', name: 'Necklace', type: 'Goods', hsn: '7113', unit: 'PCS', quantity: 1, rate: 135922.33, tax_rate: 3, discount_percent: 0, amount: 135922.33 }] } as unknown as InvoiceRecord);
  localDb.invoices.save(sale);
  assert.equal(calculateInvoice(calcInputFromRecord(sale)).taxable_value, 135922.33, 'GST on the full value, not on the net of old gold');
  const r = settleByExchange(p.id, 'inv1', DAY, exchangeNote(p.old_metal!));
  assert.deepEqual([r.amount, r.method, r.exchange_purchase_id, r.note], [101253.6, 'Exchange', p.id, 'Less: old gold (12.300 g @ 84%)']);
  assert.ok(movedNoCash(r), 'cash book, Z report and bank reco skip it');
  const row = getTable<Payment>('transactions').find((x) => x.id === r.id)!;
  assert.equal(row.exchange_purchase_id, p.id);
  assert.equal(purchasesDb.get(p.id)!.amount_paid, 101253.6, 'the voucher is settled');
  const [v] = oldGoldVouchers(purchasesDb.all(), getTable<Payment>('transactions'));
  assert.deepEqual([v.exchanged, v.open], [101253.6, 0]);
  const inv = localDb.invoices.getById('inv1')!;
  assert.ok(Math.abs(inv.total - 140000) < 0.02, 'about ₹1,40,000 incl. 3% GST');
  assert.equal(inv.balance_due, Math.round((inv.total - 101253.6) * 100) / 100, 'the rest (≈ ₹38,746.40) by UPI / cash');
  assert.throws(() => settleByExchange(p.id, 'inv1', DAY, 'x'), /Nothing left/);
});

test('PAN at the limit; cash paid for old gold is a purchase payment (counted for 40A(3), never a receipt)', () => {
  assert.throws(() => recordOldGold({ ...chain, gross: 25 }), /PAN/);
  const big = recordOldGold({ ...chain, gross: 25, customer: { ...chain.customer, pan: 'abcde1234f' } });
  assert.equal(big.old_metal!.kyc!.pan, 'ABCDE1234F');
  const small = recordOldGold({ ...chain, gross: 1 });
  paymentsDb.record(small.id, { amount: small.total, date: DAY, method: 'Cash' });
  assert.equal(cashPaidToday(small.vendor_id, DAY), small.total);
  assert.equal(getTable('transactions').length, 0, 'no sale receipt row');
});
