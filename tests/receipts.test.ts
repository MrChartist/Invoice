import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt, receiptHtml, receiptNumber, referenceLabel } from '../src/lib/receipts.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

const pay = (id: string, date: string, amount = 100, invoice_id = 'i1'): Payment => ({ id, date, amount, invoice_id, method: 'UPI' });

test('receipt numbers run per Indian FY in date order', () => {
  const all = [pay('b', '2026-04-05'), pay('a', '2026-04-05'), pay('c', '2026-03-31'), pay('d', '2026-05-01')];
  assert.equal(receiptNumber(all[1], all), 'RCPT/FY26-27/0001');
  assert.equal(receiptNumber(all[0], all), 'RCPT/FY26-27/0002');
  assert.equal(receiptNumber(all[3], all), 'RCPT/FY26-27/0003');
  assert.equal(receiptNumber(all[2], all), 'RCPT/FY25-26/0001', '31 March belongs to the previous FY');
});

test('buildReceipt: balance after each payment counts earlier payments and TDS', () => {
  const inv = { id: 'i1', invoice_number: 'INV/FY26-27/0001', total: 11800, tds_amount: 1000, currency: 'INR', client: { name: 'Acme', company: 'Acme Pvt Ltd', gstin: '' }, sender: { companyName: 'Me' } } as unknown as InvoiceRecord;
  const p1 = pay('p1', '2026-04-10', 5000);
  const p2 = pay('p2', '2026-04-20', 5800);
  const other = pay('x', '2026-04-15', 999, 'i2');
  const r1 = buildReceipt(inv, p1, [p2, other, p1]);
  assert.equal(r1.balanceAfter, 5800);
  assert.equal(r1.from, 'Acme Pvt Ltd');
  assert.match(r1.amountWords, /Five Thousand/);
  assert.equal(buildReceipt(inv, p2, [p1, p2, other]).balanceAfter, 0);
});

test('receiptHtml escapes user text and carries no script', () => {
  const html = receiptHtml({
    number: 'RCPT/FY26-27/0001', date: '2026-04-10', from: '<img src=x onerror=alert(1)>', fromGstin: '', business: 'A & B', businessGstin: '',
    businessAddress: 'L1\nL2', amount: 10, currency: 'INR', amountWords: 'Ten', method: 'UPI', reference: '"utr"', against: 'INV/1', invoiceTotal: 10, balanceAfter: 0,
  });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('A &amp; B'));
  assert.ok(html.includes('L1<br>L2'));
  assert.ok(!/<script/i.test(html));
});

test('referenceLabel follows the payment method', () => {
  assert.equal(referenceLabel('UPI'), 'UPI ref / UTR');
  assert.equal(referenceLabel('Bank transfer'), 'UTR number');
  assert.equal(referenceLabel('Cheque'), 'Cheque number');
  assert.equal(referenceLabel('Cash'), 'Reference');
});
