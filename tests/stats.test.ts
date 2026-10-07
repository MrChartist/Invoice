import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionList, compactInr, monthlyBilled, summarize } from '../src/lib/stats.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const row = (over: Partial<InvoiceRecord>): InvoiceRecord =>
  ({
    id: 'x',
    invoice_number: 'INV/FY25-26/0001',
    doc_type: 'INVOICE',
    status: 'Sent',
    issue_date: '2026-03-10',
    due_date: '2026-03-24',
    total: 1000,
    amount_paid: 0,
    balance_due: 1000,
    ...over,
  }) as InvoiceRecord;

const NOW = new Date('2026-04-15T10:00:00');

test('summarize: drafts, cancelled and quotations are not revenue', () => {
  const s = summarize(
    [row({}), row({ status: 'Draft' }), row({ status: 'Cancelled' }), row({ doc_type: 'QUOTATION' })],
    NOW,
  );
  assert.equal(s.count, 1);
  assert.equal(s.billed, 1000);
});

test('summarize: partial payment leaves the balance outstanding and flags overdue', () => {
  const s = summarize([row({ status: 'Partially Paid', amount_paid: 400, balance_due: 600 })], NOW);
  assert.equal(s.received, 400);
  assert.equal(s.outstanding, 600);
  assert.equal(s.overdueCount, 1);
  assert.equal(s.overdueAmount, 600);
});

test('summarize: a paid invoice is never overdue', () => {
  const s = summarize([row({ status: 'Paid', amount_paid: 1000, balance_due: 0 })], NOW);
  assert.equal(s.outstanding, 0);
  assert.equal(s.overdueCount, 0);
});

test('monthlyBilled: buckets the last N months oldest first', () => {
  const m = monthlyBilled([row({ issue_date: '2026-03-10' }), row({ issue_date: '2026-04-02', total: 500 })], 3, NOW);
  assert.deepEqual(m.map((b) => b.key), ['2026-02', '2026-03', '2026-04']);
  assert.deepEqual(m.map((b) => b.billed), [0, 1000, 500]);
});

test('attentionList: most overdue first, paid excluded', () => {
  const list = attentionList(
    [
      row({ id: 'a', due_date: '2026-04-10' }),
      row({ id: 'b', due_date: '2026-02-01' }),
      row({ id: 'c', status: 'Paid', amount_paid: 1000, balance_due: 0 }),
    ],
    5,
    NOW,
  );
  assert.deepEqual(list.map((i) => i.id), ['b', 'a']);
});

test('compactInr: lakh and crore', () => {
  assert.equal(compactInr(250000), '2.5L');
  assert.equal(compactInr(30000000), '3Cr');
  assert.equal(compactInr(999), '999');
});

test('summarize: credit notes reduce billed and the linked invoice balance', () => {
  const inv = row({ id: 'inv1', total: 1000, balance_due: 1000 });
  const note = row({ id: 'cn1', doc_type: 'CREDIT_NOTE', total: 300, balance_due: 0 });
  const s = summarize([inv, note], NOW, [{ from_id: 'inv1', to_id: 'cn1', relation: 'credit_note' }]);
  assert.equal(s.billed, 700);
  assert.equal(s.credited, 300);
  assert.equal(s.outstanding, 700);
});

test('summarize: a cancelled credit note is ignored', () => {
  const inv = row({ id: 'inv1', total: 1000, balance_due: 1000 });
  const note = row({ id: 'cn1', doc_type: 'CREDIT_NOTE', total: 300, status: 'Cancelled' });
  const s = summarize([inv, note], NOW, [{ from_id: 'inv1', to_id: 'cn1', relation: 'credit_note' }]);
  assert.equal(s.billed, 1000);
  assert.equal(s.outstanding, 1000);
});
