/**
 * PENDING 49 (8.111): insights per branch — sales, bills and payments narrowed by the branch rules of `branch.ts`
 * (tag, else profile / GSTIN; a bill by its single in-State branch; UNASSIGNED = none); stock card left out.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { branchInsightInput, buildInsights } from '../src/lib/insights.ts';
import { UNASSIGNED, type Branch } from '../src/lib/branch.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

const branches: Branch[] = [
  { id: 'pun', name: 'Pune', state_code: '27', profile_id: 'p-pune' },
  { id: 'blr', name: 'Bengaluru', state_code: '29' },
];
const inv = (id: string, total: number, over: Partial<InvoiceRecord> = {}) => ({
  id, doc_type: 'TAX_INVOICE', status: 'Sent', currency: 'INR', issue_date: '2026-10-05', total, taxable_value: total,
  client: { name: `C-${id}` }, items: [], ...over,
}) as unknown as InvoiceRecord;

test('branchInsightInput narrows invoices, payments and bills; stock dropped; "" keeps everything', () => {
  const input = {
    invoices: [inv('a', 1000, { branch_id: 'pun' }), inv('b', 5000, { sender: { id: 'p-pune' } as never }), inv('c', 7000, { branch_id: 'blr' }), inv('d', 300)],
    payments: [{ id: 'x', invoice_id: 'a', amount: 1000, date: '2026-10-06' }, { id: 'y', invoice_id: 'c', amount: 7000, date: '2026-10-06' }] as unknown as Payment[],
    purchases: [{ id: 'b1', date: '2026-10-02', place_of_supply: '29', total: 100 }, { id: 'b2', date: '2026-10-02', branch_id: 'pun', total: 50 }],
    stock: [{ name: 'Rice', qty: 1, reorder: 5 }],
  };
  assert.equal(branchInsightInput(input, '', branches), input);
  const pune = branchInsightInput(input, 'pun', branches);
  assert.deepEqual(pune.invoices.map((i) => i.id), ['a', 'b']);
  assert.deepEqual(pune.payments.map((p) => p.id), ['x']);
  assert.deepEqual((pune.purchases as { id: string }[]).map((p) => p.id), ['b2']);
  assert.equal(pune.stock, undefined);
  const blr = branchInsightInput(input, 'blr', branches);
  assert.deepEqual((blr.purchases as { id: string }[]).map((p) => p.id), ['b1'], 'bill placed by its single in-State branch');
  assert.deepEqual(branchInsightInput(input, UNASSIGNED, branches).invoices.map((i) => i.id), ['d']);

  const cards = buildInsights(pune, '2026-10-20');
  assert.equal(cards.find((c) => c.id === 'revenue')?.value, 6000);
  assert.ok(!cards.some((c) => c.id === 'stockRisk'));
  assert.equal(buildInsights(input, '2026-10-20').find((c) => c.id === 'revenue')?.value, 13300);
});
