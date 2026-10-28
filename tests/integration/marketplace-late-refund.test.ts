/** PENDING 27 (R5-A7): a marketplace refund paid in a LATER settlement than the sale leaves the customer square on Receivables. */
import '../helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, importMtr, setupWorld } from '../helpers/marketplace.ts';
import { importSettlement, parseSettlement } from '../../src/lib/marketplace/settlement-import.ts';
import { postSettlement } from '../../src/lib/marketplace/settlement-post.ts';
import { buildReceivables, settlementRefunds } from '../../src/lib/receivables.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { getTable } from '../../src/lib/storage.ts';
import type { SalesChannel, Settlement } from '../../src/types/marketplace-r5.ts';

let ch: SalesChannel;
beforeEach(() => {
  ch = setupWorld();
  importMtr(ch);
  const t = fixture('amazon-settlement-v2.csv');
  const col = (name: string) => t.headers.indexOf(name);
  const isRefund = (r: string[]) => r[col('transaction-type')] === 'Refund';
  // Settlement 9001 without the refund (payout + 590); settlement 9002 a fortnight later with only the refund.
  const first = t.rows.map((r, i) => (i === 0 ? r.map((c, j) => (j === col('total-amount') ? '2606.57' : c)) : r)).filter((r) => !isRefund(r));
  const head2: Record<string, string> = { 'settlement-id': '9002', 'settlement-start-date': '2026-10-15', 'settlement-end-date': '2026-10-28', 'deposit-date': '2026-10-30', 'total-amount': '-590' };
  const second = [
    t.rows[0].map((c, j) => head2[t.headers[j]] ?? c),
    ...t.rows.filter(isRefund).map((r) => r.map((c, j) => (j === col('settlement-id') ? '9002' : c))),
  ];
  postSettlement(importSettlement(ch, parseSettlement([{ name: 'a', table: { headers: t.headers, rows: first } }], 'amazon_v2'), 'a.csv').id);
  postSettlement(importSettlement(ch, parseSettlement([{ name: 'b', table: { headers: t.headers, rows: second } }], 'amazon_v2'), 'b.csv').id);
});

test('a refund paid in a later settlement uses up the credit note: nobody is left in credit', () => {
  const input = { invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll(), links: getTable('doc_links') };
  const before = buildReceivables(input as never, { now: new Date('2026-11-05') });
  assert.ok(before.totals.net < -1, `without the refund rows the customer shows in credit (${before.totals.net})`);
  const refunds = settlementRefunds(getTable<Settlement>('settlements'));
  assert.equal(refunds.length, 1);
  assert.deepEqual([refunds[0].amount, refunds[0].date, refunds[0].ref], [590, '2026-10-30', '9002']);
  const rep = buildReceivables({ ...input, refunds } as never, { now: new Date('2026-11-05') });
  assert.ok(Math.abs(rep.totals.net) < 0.01, `receivable left: ${rep.totals.net}`);
});

test('a refund netted in the same settlement as its sale adds no refund row', () => {
  const t = fixture('amazon-settlement-v2.csv');
  const rows = t.rows.map((r) => r.map((c, j) => (t.headers[j] === 'settlement-id' ? '9003' : c)));
  const s = importSettlement(ch, parseSettlement([{ name: 'c', table: { headers: t.headers, rows } }], 'amazon_v2'), 'c.csv');
  assert.equal(settlementRefunds([{ ...s, posted: { payment_ids: [], at: '' } }]).length, 0);
});
