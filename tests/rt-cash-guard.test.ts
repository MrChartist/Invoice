/** RT-E3 cash (Sec 269ST) and PAN (Rule 114B) guards: ₹1,99,999 passes, ₹2,00,000 blocked, same-day aggregation by
 * customer, old-gold cash paid not counted, PAN above ₹2 lakh, 40A(3), PMLA, rule rows by date. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setJson } from '../src/lib/storage.ts';
import { cashFromCustomer, cashGuards, cashPaymentIssue, kycGate, liveSaleGuards, maskPan, panGuard, validPan } from '../src/lib/retail/rt-cash-guard.ts';
import { RETAIL_SETTINGS_KEY } from '../src/lib/retail/rt-settings.ts';
import { CASH_RECEIPT_LIMIT_RULES, PAN_SALE_LIMIT_RULES } from '../src/lib/retail-rules.ts';
import { ruleAt } from '../src/lib/tax-rules.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
const DAY = '2026-10-27';

test('₹1,99,999 in cash passes; ₹2,00,000 is blocked (block) or warned (warn); off = nothing', () => {
  assert.deepEqual(cashGuards('block', DAY, 199999), []);
  const [g] = cashGuards('block', DAY, 200000);
  assert.equal(g.level, 'error');
  assert.match(g.message, /Sec 269ST.*verify with your CA/i);
  assert.equal(cashGuards('warn', DAY, 200000)[0].level, 'warn');
  assert.deepEqual(cashGuards('off', DAY, 250000), []);
  assert.deepEqual(cashGuards('block', DAY, 0, 300000), [], 'no cash on this bill: nothing to refuse');
});

test('same-day aggregation by customer (client id or phone); other days, other customers, refunds and no-cash rows do not count', () => {
  const inv = (id: string, client: object) => ({ id, client, items: [] }) as unknown as InvoiceRecord;
  const invoices = [inv('a', { id: 'c1', name: 'X' }), inv('b', { name: 'X', phone: '+91 98000 00001' }), inv('c', { id: 'c2', name: 'Y' })];
  const p = (invoice_id: string, amount: number, extra: Partial<Payment> = {}) => ({ id: `${invoice_id}${amount}`, invoice_id, amount, method: 'Cash', date: DAY, ...extra }) as Payment;
  const payments = [p('a', 120000), p('b', 50000), p('c', 90000), p('a', 30000, { date: '2026-10-26' }), p('a', 10000, { method: 'UPI' }), p('a', -5000), p('a', 40000, { exchange_purchase_id: 'urd' } as never)];
  assert.equal(cashFromCustomer(payments, invoices, { id: 'new', client: { id: 'c1', name: 'X', phone: '9800000001' } } as never, DAY), 170000);
  assert.equal(cashFromCustomer(payments, invoices, { id: 'new', client: { name: 'Walk-in' } } as never, DAY), 0);
  assert.equal(cashGuards('block', DAY, 30000, 170000)[0].level, 'error', '₹30,000 now + ₹1,70,000 earlier today');
  assert.deepEqual(cashGuards('block', DAY, 29999, 170000), []);
});

test('live: settings decide; earlier cash of the customer that day is read from receipts', () => {
  assert.deepEqual(liveSaleGuards({ id: 'n', client: { name: 'X' }, total: 250000, issue_date: DAY } as never, 250000).map((g) => g.level), ['warn'], 'no settings: cash guard off; PAN only warns');
  setJson(RETAIL_SETTINGS_KEY, { cash_guard: 'block', require_pan: true });
  localDb.invoices.save({ id: 'i1', invoice_number: 'INV/FY26-27/0001', doc_type: 'INVOICE', status: 'Sent', issue_date: DAY, due_date: DAY, total: 150000, client: { id: 'c1', name: 'X' }, items: [{ id: 'l', name: 'Ring', type: 'Goods', quantity: 1, rate: 150000, tax_rate: 0, discount_percent: 0, amount: 150000 }] } as unknown as InvoiceRecord);
  localDb.payments.record({ invoiceId: 'i1', amount: 150000, method: 'Cash', date: DAY });
  const g = liveSaleGuards({ id: 'n', client: { id: 'c1', name: 'X' }, total: 60000, issue_date: DAY } as never, 60000);
  assert.deepEqual(g.map((x) => x.level), ['error'], '₹60,000 + ₹1,50,000 earlier');
  assert.deepEqual(liveSaleGuards({ id: 'n', client: { id: 'c9', name: 'Z' }, total: 60000, issue_date: DAY } as never, 60000), []);
});

test('PAN above ₹2 lakh (any mode): PAN or Form 60 / 97; warning, or an error with Require PAN; the editor gate', () => {
  assert.equal(panGuard(200000, DAY, undefined, true), null, 'exactly ₹2 lakh is not above');
  assert.equal(panGuard(200001, DAY, undefined, false)!.level, 'warn');
  assert.equal(panGuard(200001, DAY, undefined, true)!.level, 'error');
  assert.equal(panGuard(250000, DAY, { pan: 'ABCDE1234F' }, true), null);
  assert.equal(panGuard(250000, DAY, { form: '60' }, true), null);
  assert.equal(panGuard(250000, DAY, { pan: 'ABC' }, true)!.level, 'error', 'an invalid PAN does not count');
  assert.ok(validPan('abcde1234f') && !validPan('ABCDE12345'));
  assert.equal(maskPan('ABCDE1234F'), 'ABCDE****F');
  setJson(RETAIL_SETTINGS_KEY, { require_pan: true });
  assert.equal(kycGate({ doc_type: 'INVOICE', total: 250000, issue_date: DAY }).length, 1);
  assert.deepEqual(kycGate({ doc_type: 'QUOTATION', total: 250000, issue_date: DAY }), []);
});

test('Sec 40A(3) cash paid above ₹10,000 a day: a warning; PMLA note at ₹10 lakh; rule rows by date', () => {
  assert.equal(cashPaymentIssue(10000, DAY), '');
  assert.match(cashPaymentIssue(10001, DAY), /Sec 40A\(3\)/);
  assert.match(cashGuards('off', DAY, 1000000).map((g) => g.message).join(), /PMLA/);
  assert.equal(ruleAt(CASH_RECEIPT_LIMIT_RULES, '2017-04-01'), 200000);
  assert.equal(ruleAt(PAN_SALE_LIMIT_RULES, '2016-01-01'), 200000);
});
