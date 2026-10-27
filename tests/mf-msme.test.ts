/** MF-D3 MSME both ways: receivable limit / interest equal msme.ts on mirrored data, GSTIN buyers only, Form-1, trader flag. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { disallowance43Bh, msmeBills, traderExcluded } from '../src/lib/msme.ts';
import { byBuyer, interestLetterHtml, mseReceivables, reminderText, sellerIsMse } from '../src/lib/mfg/mf-msme-recv.ts';
import { form1Dues, form1Half, form1Rows, form1Sheet, isCompany, previousHalf } from '../src/lib/mfg/mf-msme-form1.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { PurchaseRecord, Vendor } from '../src/types/purchases.ts';

const inv = (id: string, date: string, total: number, gstin = '27AAPFU0939F1ZV', extra: Partial<InvoiceRecord> = {}) => ({
  id, invoice_number: `INV/${id}`, doc_type: 'INVOICE', status: 'Sent', issue_date: date, due_date: '', total, amount_paid: 0, client: { name: `Buyer ${gstin.slice(0, 2)}`, gstin }, items: [], ...extra,
}) as unknown as InvoiceRecord;
const bill = (id: string, date: string, total: number, vendor = 'v1'): PurchaseRecord => ({ id, kind: 'PURCHASE', vendor_id: vendor, vendor_name: 'Mill', bill_number: `B-${id}`, date, lines: [], taxable: total, total, amount_paid: 0, itc_eligible: false } as unknown as PurchaseRecord);

test('the seller side needs our Udyam number and micro / small category', () => {
  assert.equal(sellerIsMse({ msme_udyam: 'UDYAM-MH-26-0012345', msme_category: 'MICRO' }), true);
  assert.equal(sellerIsMse({ msme_udyam: 'UDYAM-MH-26-0012345', msme_category: 'MEDIUM' }), false);
  assert.equal(sellerIsMse({ msme_category: 'SMALL' }), false);
});

test('receivable limit and Sec 16 interest equal msme.ts on mirrored data; only GSTIN buyers; paid late keeps the interest', () => {
  const asOf = '2026-10-27';
  const invoices = [inv('a', '2026-06-01', 100000), inv('b', '2026-06-01', 50000, ''), inv('c', '2026-10-20', 9000), inv('d', '2026-05-01', 20000, '29AAPFU0939F1ZV', { due_date: '2026-05-31' } as never)];
  const payments = [{ id: 'p1', invoice_id: 'a', amount: 40000, date: '2026-08-01', method: 'UPI' }, { id: 'p2', invoice_id: 'd', amount: 20000, date: '2026-07-01', method: 'UPI' }] as Payment[];
  const rows = mseReceivables(invoices, payments, asOf);
  assert.deepEqual(rows.map((r) => [r.number, r.limit, r.unpaid, r.paidLate]), [['INV/d', '2026-05-31', 0, true], ['INV/a', '2026-06-16', 60000, false]]);
  const vendors = [{ id: 'v1', name: 'Mill', msme_category: 'MICRO' }] as Vendor[];
  const mirrored = msmeBills([bill('a', '2026-06-01', 100000)], vendors, [{ id: 'q', purchase_id: 'a', amount: 40000, date: '2026-08-01', method: 'UPI' }] as never, asOf);
  assert.equal(rows[1].interest, mirrored[0].interest);
  assert.equal(rows[1].daysOverdue, mirrored[0].daysOverdue);
  assert.ok(rows[0].interest > 0);
  assert.equal(byBuyer(rows).length, 2);
});

test('reminder text and interest letter cite MSMED Sec 15 / 16 (Samadhaan optional)', () => {
  const rows = mseReceivables([inv('a', '2026-06-01', 100000)], [], '2026-10-27');
  const seller = { name: 'Shree Namkeen', udyam: 'UDYAM-MH-26-0012345', category: 'MICRO' };
  const t = reminderText(seller, 'Buyer', rows, '2026-10-27');
  assert.match(t, /Sec 15 of the MSMED Act 2006/);
  assert.match(t, /Sec 16/);
  assert.doesNotMatch(t, /Samadhaan/);
  assert.match(reminderText(seller, 'Buyer', rows, '2026-10-27', true), /Samadhaan/);
  assert.match(interestLetterHtml(seller, 'Buyer & Co', '27X', rows, '2026-10-27'), /Buyer &amp; Co[\s\S]*43B\(h\)/);
});

test('Form-1: half-years, unpaid beyond 45 days at the half-year end, reasons, companies only', () => {
  assert.deepEqual(form1Half('2026-09-30'), { id: 'H1-2026', from: '2026-04-01', to: '2026-09-30', due: '2026-10-31', label: 'Apr–Sep 2026' });
  assert.deepEqual([form1Half('2027-02-10').id, form1Half('2027-02-10').due], ['H2-2026', '2027-04-30']);
  assert.equal(previousHalf(form1Half('2026-10-01')).id, 'H1-2026');
  const vendors = [{ id: 'v1', name: 'Mill', msme_category: 'MICRO', pan: 'aaapm1234c', msme_udyam: 'UDYAM-MH-01-0000001' }, { id: 'v2', name: 'Medium Co', msme_category: 'MEDIUM' }] as Vendor[];
  const purchases = [bill('old', '2026-07-01', 5000), bill('new', '2026-09-10', 7000), bill('paid', '2026-06-01', 3000), bill('med', '2026-05-01', 9000, 'v2')];
  const rows = form1Rows(purchases, vendors, [{ id: 'p', purchase_id: 'paid', amount: 3000, date: '2026-09-01' }] as never, form1Half('2026-09-30'), { old: 'Quality dispute' });
  assert.deepEqual(rows.map((r) => [r.bill, r.pan, r.unpaid, r.days, r.reason]), [['B-old', 'AAAPM1234C', 5000, 91, 'Quality dispute']]);
  assert.equal(form1Sheet(rows, form1Half('2026-09-30'))[2][10], 'Quality dispute');
  assert.equal(isCompany(undefined, 'Shree Foods Private Limited'), true);
  assert.equal(isCompany('proprietorship', 'X Pvt Ltd'), false);
  assert.deepEqual(form1Dues('2026-10-27'), [{ date: '2026-10-31', label: 'MSME Form-1 (Apr–Sep 2026)' }, { date: '2027-04-30', label: 'MSME Form-1 (Oct 2026 – Mar 2027)' }]);
});

test('trader flag removes a supplier from the 43B(h) totals, with a note; unflagged results unchanged', () => {
  const vendors = [{ id: 'v1', name: 'Mill', msme_category: 'MICRO' }, { id: 'v2', name: 'Trader', msme_category: 'SMALL', mf: { msme_trader: true } }] as Vendor[];
  assert.equal(traderExcluded(vendors[1]), true);
  assert.equal(traderExcluded(vendors[0]), false);
  const purchases = [bill('a', '2025-06-01', 1000), bill('b', '2025-06-01', 2000, 'v2')];
  const d = disallowance43Bh(purchases, vendors, [], 2025, '2026-06-01');
  assert.deepEqual([d.total, d.rows.length, d.excludedTraders], [1000, 1, ['Trader']]);
  const plain = disallowance43Bh(purchases, [vendors[0]], [], 2025, '2026-06-01');
  assert.equal('excludedTraders' in plain, false);
});
