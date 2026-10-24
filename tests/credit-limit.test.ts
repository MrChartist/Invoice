/** Credit limits at billing (roadmap 6.25): advisory warning maths. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { belongsTo, creditCheck, masterFor } from '../src/lib/credit-limit.ts';
import type { Client, InvoiceRecord } from '../src/types/invoice.ts';

const TODAY = '2026-10-24';
const client = (over: Partial<Client> = {}): Client => ({ id: 'c1', name: 'Acme Buyers', email: '', address: '', city: '', zip: '', ...over });
const inv = (over: Partial<InvoiceRecord>) =>
  ({ id: 'x', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-10-01', currency: 'INR', client: { id: 'c1', name: 'Acme Buyers' }, total: 0, balance_due: 0, ...over }) as InvoiceRecord;

const book = [
  inv({ id: 'a', total: 30000, balance_due: 30000, issue_date: '2026-08-01' }),
  inv({ id: 'b', total: 20000, balance_due: 5000, amount_paid: 15000, issue_date: '2026-10-10' }),
  inv({ id: 'p', total: 9999, balance_due: 0, status: 'Paid' }),
  inv({ id: 'd', total: 70000, balance_due: 70000, status: 'Draft' }),
  inv({ id: 'q', doc_type: 'QUOTATION', total: 50000, balance_due: 50000 }),
  inv({ id: 'o', total: 50000, balance_due: 50000, client: { id: 'c2', name: 'Other' } as Client }),
  inv({ id: 'u', total: 100, balance_due: 100, currency: 'USD', exchange_rate: 80 }),
  inv({ id: 'n', total: 100, balance_due: 100, currency: 'EUR' }),
];

test('no limit, no credit days, no bounces → nothing to say', () => {
  const r = creditCheck({ client: client(), draft: { doc_type: 'INVOICE', total: 1e9 }, invoices: book, today: TODAY });
  assert.deepEqual(r.warnings, []);
});

test('outstanding + this invoice over the limit warns with the figures', () => {
  // Open: 30,000 + 5,000 + USD 100 × 80 = 8,000 → 43,000; EUR without a rate is left out.
  const r = creditCheck({ client: client({ credit_limit: 50000 }), draft: { doc_type: 'INVOICE', total: 10000 }, invoices: book, today: TODAY });
  assert.equal(r.outstanding, 43000);
  assert.equal(r.thisInvoice, 10000);
  assert.equal(r.projected, 53000);
  assert.equal(r.overBy, 3000);
  assert.match(r.warnings[0], /Over the credit limit by ₹3,000\.00/);
  // Within the limit: silent.
  assert.deepEqual(creditCheck({ client: client({ credit_limit: 60000 }), draft: { doc_type: 'INVOICE', total: 10000 }, invoices: book, today: TODAY }).warnings, []);
});

test('the document being edited is not counted twice; TDS and receipts reduce it; quotes add nothing', () => {
  const editing = creditCheck({ client: client({ credit_limit: 40000 }), draft: { id: 'a', doc_type: 'INVOICE', status: 'Sent', total: 30000, tds_amount: 1000, amount_paid: 4000 }, invoices: book, today: TODAY });
  assert.equal(editing.outstanding, 13000);
  assert.equal(editing.thisInvoice, 25000);
  assert.equal(editing.overBy, 0);
  const quote = creditCheck({ client: client({ credit_limit: 1 }), draft: { doc_type: 'QUOTATION', total: 99999 }, invoices: [], today: TODAY });
  assert.equal(quote.thisInvoice, 0);
  assert.deepEqual(quote.warnings, []);
  // A foreign draft is converted at its rate.
  const fx = creditCheck({ client: client({ credit_limit: 1 }), draft: { doc_type: 'INVOICE', total: 10, currency: 'USD', exchange_rate: 83.5 }, invoices: [], today: TODAY });
  assert.equal(fx.thisInvoice, 835);
});

test('bills older than the credit period warn even within the limit', () => {
  const r = creditCheck({ client: client({ credit_limit: 1e7, credit_days: 30 }), draft: { doc_type: 'INVOICE', total: 1 }, invoices: book, today: TODAY });
  // 'a' (1 Aug, 84 days) and 'u' (1 Oct, 23 days → within). Only 'a' is past 30 days.
  assert.deepEqual(r.overdue, { count: 1, amount: 30000, oldestDays: 84 });
  assert.equal(r.overBy, 0);
  assert.match(r.warnings[0], /1 bill \(₹30,000\.00\) older than the 30-day credit period — oldest 84 days/);
});

test('client master is found by id, else by name; invoices match by id, else by name', () => {
  const clients = [client({ credit_limit: 5 }), client({ id: 'c9', name: 'Beta Co' })];
  assert.equal(masterFor({ id: 'c1', name: 'renamed' }, clients)!.credit_limit, 5);
  assert.equal(masterFor({ name: ' beta co ' }, clients)!.id, 'c9');
  assert.equal(masterFor({ id: 'gone', name: 'Nobody' }, clients), undefined);
  assert.equal(belongsTo(inv({ client: { name: 'acme buyers' } as Client }), { name: 'Acme Buyers' }), true);
  assert.equal(belongsTo(inv({ client: { id: 'c2', name: 'Acme Buyers' } as Client }), { id: 'c1', name: 'Acme Buyers' }), false);
});
