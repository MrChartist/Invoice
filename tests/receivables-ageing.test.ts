/** PENDING 34 (GAP P1-6): user ageing slabs, ageing by bill date, interest column in the CSV. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { agingCsv, buildReceivables, normalizeAgeing, slabBucket } from '../src/lib/receivables.ts';
import { bucketLabel } from '../src/i18n/areas/receivables.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const NOW = new Date(2026, 9, 7); // 7 Oct 2026
const inv = (id: string, issue: string, due: string, total: number): InvoiceRecord => ({
  id, invoice_number: id, doc_type: 'INVOICE', issue_date: issue, due_date: due, status: 'Sent', currency: 'INR',
  client: { id: 'a', name: 'Alpha Ltd' }, total, amount_paid: 0, balance_due: total, items: [],
} as unknown as InvoiceRecord);

// Bill 1: dated 7 Sep, due 22 Sep → 15 days past due, 30 days since the bill. Bill 2: dated 17 Aug, due 6 Oct → 1 / 51.
const invoices = [inv('B1', '2026-09-07', '2026-09-22', 1000), inv('B2', '2026-08-17', '2026-10-06', 500)];

test('slabs: 10 / 45 / 90 move bills between buckets; default stays 30 / 60 / 90', () => {
  const def = buildReceivables({ invoices, payments: [] }, { now: NOW });
  assert.equal(def.totals.buckets['1–30 days'], 1500);
  const r = buildReceivables({ invoices, payments: [] }, { now: NOW, ageing: { basis: 'due', slabs: [10, 45, 90] } });
  assert.deepEqual([r.totals.buckets['1–30 days'], r.totals.buckets['31–60 days']], [500, 1000]);
  assert.equal(slabBucket(46, [15, 45, 90]), '61–90 days');
  assert.equal(slabBucket(0, [15, 45, 90]), 'Not due');
});

test('basis bill date ages from the bill: 30 days and 51 days', () => {
  const r = buildReceivables({ invoices, payments: [] }, { now: NOW, ageing: { basis: 'bill', slabs: [30, 60, 90] } });
  assert.deepEqual([r.totals.buckets['1–30 days'], r.totals.buckets['31–60 days']], [1000, 500]);
});

test('labels follow the slabs; bad slabs fall back to the default; CSV takes labels and an interest column', () => {
  const a = { basis: 'due' as const, slabs: [15, 45, 90] as [number, number, number] };
  assert.deepEqual(['1–30 days', '31–60 days', '61–90 days', '90+ days'].map((b) => bucketLabel(b, a)), ['1–15 days', '16–45 days', '46–90 days', '90+ days']);
  assert.equal(bucketLabel('Not due', { basis: 'bill', slabs: [30, 60, 90] }), 'Today');
  assert.equal(bucketLabel('31–60 days'), '31–60 days');
  assert.deepEqual(normalizeAgeing({ slabs: [60, 30, 90] }).slabs, [30, 60, 90]);
  assert.deepEqual(normalizeAgeing({ slabs: [7, 14, 21], basis: 'bill', interest: true }), { basis: 'bill', slabs: [7, 14, 21], interest: true });
  const r = buildReceivables({ invoices, payments: [] }, { now: NOW, ageing: a });
  const csv = agingCsv(r, { '1–30 days': '1–15 days' }, new Map([[r.parties[0].key, 12.5]]));
  const [head, row, total] = csv.trim().split(/\r?\n/);
  assert.match(head, /^Party,Not due,1–15 days,31–60 days/);
  assert.match(head, /,Interest$/);
  assert.match(row, /,12\.5$/);
  assert.match(total, /,12\.5$/);
});
