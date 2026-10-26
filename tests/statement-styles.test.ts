/**
 * R2-A6 statement styles: open-item totals equal the party net, transaction ordering, ageing buckets at their
 * boundaries (local days), bulk skip rules, device-local preference.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, buildReceivables } from '../src/lib/receivables.ts';
import {
  ageingStrip, loadStatementPrefs, normalizeStatementPrefs, openItemRows, openItemTotals, saveStatementPrefs, skipInBulk, stripBucket, transactionRows,
  STATEMENT_PREFS_KEY,
} from '../src/lib/statement-styles.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

let k = 0;
function inv(issue: string, due: string, total: number, over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  k++;
  return {
    id: `i${k}`, invoice_number: `INV/${k}`, doc_type: 'TAX_INVOICE', issue_date: issue, due_date: due, status: 'Sent', currency: 'INR', template_id: 't',
    client: { id: 'c1', name: 'Bharat', email: '', address: '', city: '', zip: '' }, sender: null, items: [], gst_mode: 'NONE', place_of_supply: '27',
    reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0,
    notes: '', terms: '', subtotal: total, discount_amount: 0, taxable_value: total, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0,
    total, balance_due: total, ...over,
  };
}

const NOW = new Date(2026, 9, 25);
const a = inv('2026-07-01', '2026-07-15', 1000);
const b = inv('2026-09-01', '2026-09-25', 2000, { amount_paid: 500, balance_due: 1500, status: 'Partially Paid' });
const c = inv('2026-10-01', '2026-10-31', 3000);
const cnLinked = inv('2026-10-02', '2026-10-02', 300, { id: 'cnL', doc_type: 'CREDIT_NOTE' });
const cnFree = inv('2026-10-03', '2026-10-03', 200, { id: 'cnF', doc_type: 'CREDIT_NOTE' });
const payments: Payment[] = [{ id: 'p1', invoice_id: b.id, amount: 500, method: 'UPI', date: '2026-09-20' }];
const report = buildReceivables({ invoices: [a, b, c, cnLinked, cnFree], payments, links: [{ from_id: c.id, to_id: 'cnL', relation: 'credit_note' }] }, { now: NOW });
const party = report.parties[0];

test('open items: original, credited, received, open; totals equal the party net', () => {
  const rows = openItemRows(party);
  assert.deepEqual(rows.map((r) => r.number), [a.invoice_number, b.invoice_number, c.invoice_number], 'oldest due first');
  const rc = rows.find((r) => r.invoiceId === c.id)!;
  assert.deepEqual([rc.original, rc.credited, rc.received, rc.open], [3000, 300, 0, 2700]);
  const rb = rows.find((r) => r.invoiceId === b.id)!;
  assert.deepEqual([rb.received, rb.open, rb.daysOverdue], [500, 1500, 30]);
  const t = openItemTotals(party, rows);
  assert.equal(t.unallocated, 200, 'only the unallocated credit note');
  assert.equal(t.net, party.net);
});

test('transactions: every entry in the range, oldest first, no running balance', () => {
  const ledger = buildLedger(party, '2026-09-01', '2026-10-31');
  const rows = transactionRows(ledger);
  assert.ok(rows.every((r) => !('balance' in r)));
  assert.deepEqual(rows.map((r) => r.date), [...rows.map((r) => r.date)].sort());
  assert.ok(!rows.some((r) => r.date < '2026-09-01'));
});

test('ageing strip at the boundaries (local days)', () => {
  assert.equal(stripBucket(0), 'Current');
  assert.equal(stripBucket(1), '1–30');
  assert.equal(stripBucket(30), '1–30');
  assert.equal(stripBucket(31), '31–60');
  assert.equal(stripBucket(60), '31–60');
  assert.equal(stripBucket(61), '61–90');
  assert.equal(stripBucket(90), '61–90');
  assert.equal(stripBucket(91), '90+');
  const s = ageingStrip(party, '2026-10-25');
  assert.equal(s.Current, 2700);
  assert.equal(s['1–30'], 1500, '25 Sep → 30 days');
  assert.equal(s['90+'], 1000, '15 Jul to 25 Oct is 102 days');
});

test('bulk skip rules: no activity in range (balance forward / transactions), zero balance (open items)', () => {
  const quiet = buildLedger(party, '2025-01-01', '2025-03-31');
  assert.equal(skipInBulk(party, quiet, 'balance_forward'), true);
  assert.equal(skipInBulk(party, quiet, 'open_items'), false, 'open bills still print on an open-item statement');
  const settled = { ...party, bills: [], net: 0 };
  assert.equal(skipInBulk(settled, buildLedger(party, '2026-09-01', '2026-10-31'), 'open_items'), true);
});

test('style preference is device-local and fail-soft', () => {
  assert.deepEqual(normalizeStatementPrefs({ style: 'nope', ageing: 'yes' }), { style: 'balance_forward', ageing: false });
  saveStatementPrefs({ style: 'open_items', ageing: true });
  assert.deepEqual(loadStatementPrefs(), { style: 'open_items', ageing: true });
  assert.ok(!STATEMENT_PREFS_KEY.startsWith('mrchartist_inv_'), 'outside the backed-up prefix');
});
