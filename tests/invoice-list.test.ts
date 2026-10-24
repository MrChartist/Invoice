import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { createViaStore, installSettings, reload } from './helpers/world.ts';
import { bulkMarkPaid, canMarkPaid, matchesListFilter, sortInvoices } from '../src/lib/invoice-list.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const row = (o: Partial<InvoiceRecord>) => ({ doc_type: 'INVOICE', status: 'Sent', total: 100, balance_due: 100, client: { name: '' }, ...o }) as InvoiceRecord;

test('date range is inclusive and compares local days; type filter is exact', () => {
  const inv = row({ issue_date: '2026-04-30', doc_type: 'QUOTATION' });
  assert.ok(matchesListFilter(inv, { from: '2026-04-30', to: '2026-04-30' }));
  assert.ok(!matchesListFilter(inv, { from: '2026-05-01' }));
  assert.ok(!matchesListFilter(inv, { to: '2026-04-29' }));
  assert.ok(matchesListFilter(inv, { docType: 'QUOTATION' }));
  assert.ok(!matchesListFilter(inv, { docType: 'INVOICE' }));
  assert.ok(matchesListFilter(inv, {}));
});

test('sorting by amount, client and number (numeric-aware) in both directions', () => {
  const rows = [
    row({ invoice_number: 'INV/FY26-27/0010', total: 500, client: { name: 'bravo' } as never }),
    row({ invoice_number: 'INV/FY26-27/0002', total: 2000, client: { name: 'Alpha' } as never }),
    row({ invoice_number: 'INV/FY26-27/0100', total: 50, client: { name: 'charlie' } as never }),
  ];
  assert.deepEqual(sortInvoices(rows, 'total', 'desc').map((r) => r.total), [2000, 500, 50]);
  assert.deepEqual(sortInvoices(rows, 'client', 'asc').map((r) => r.client.name), ['Alpha', 'bravo', 'charlie']);
  assert.deepEqual(sortInvoices(rows, 'number', 'asc').map((r) => r.invoice_number.slice(-4)), ['0002', '0010', '0100']);
});

test('bulkMarkPaid records each balance, skips what cannot be paid, and survives errors', () => {
  const a = createViaStore({ date: '2026-04-10', lines: [{ qty: 1, rate: 1000 }] });
  const b = createViaStore({ date: '2026-04-11', lines: [{ qty: 2, rate: 1000 }] });
  localDb.payments.record({ invoiceId: b.id, amount: 500, method: 'UPI', date: '2026-04-12' });
  const q = createViaStore({ date: '2026-04-11', docType: 'QUOTATION', lines: [{ qty: 1, rate: 99 }] });
  assert.equal(canMarkPaid(reload(q.id)), false);

  const r = bulkMarkPaid([a.id, b.id, q.id, 'missing'], { method: 'Bank Transfer', date: '2026-04-20' });
  assert.equal(r.paid.length, 2);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.total, 1180 + (2360 - 500));
  assert.equal(reload(a.id).status, 'Paid');
  assert.equal(reload(b.id).balance_due, 0);
  // Already paid: a second run skips them.
  assert.equal(bulkMarkPaid([a.id], { method: 'UPI', date: '2026-04-21' }).skipped[0].reason, 'nothing to collect');
});
