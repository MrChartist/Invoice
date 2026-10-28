/**
 * R4-C7 field-level merge (pure): masters per field, documents per group (totals stay with their lines, the number
 * with its date), validation, plain labels / private values, and the non-overlapping bulk rule.
 * The sync round trip (stale listing, locked period, convergence) is in tests/sync.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldDiffs, groupDiffs, groupOf, mergeKind, mergeRows, nonOverlappingPicks, remoteFollowsKnown, showValue, validateMerged } from '../src/lib/trust/field-merge.ts';
import { calcInputFromRecord, calculateInvoice } from '../src/lib/invoice-calc.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';

test('a client edited on two devices: phone here, GSTIN there → both kept', () => {
  const base = { id: 'c1', name: 'Acme', phone: '98200 00000', gstin: '27AAPFU0939F1ZV', updated_at: '2026-06-01T00:00:00Z' };
  const mine = { ...base, phone: '98200 11111', updated_at: '2026-06-02T00:00:00Z' };
  const theirs = { ...base, gstin: '27AAPFU0939F2ZU', updated_at: '2026-06-03T00:00:00Z' };
  assert.equal(mergeKind('clients'), 'master');
  assert.deepEqual(fieldDiffs(mine, theirs).map((d) => [d.key, d.label]), [['phone', 'Phone'], ['gstin', 'GSTIN']], 'updated_at is bookkeeping, never offered');
  const merged = mergeRows('clients', mine, theirs, { gstin: 'theirs' });
  assert.deepEqual(merged, { id: 'c1', name: 'Acme', phone: '98200 11111', gstin: '27AAPFU0939F2ZU', updated_at: '2026-06-03T00:00:00Z' });
  assert.equal(mergeRows('clients', mine, { ...theirs, phone: undefined }, { phone: 'theirs' }).phone, undefined, 'taking an absent field removes it');
});

test('invoice groups keep totals with their lines; the number always comes with its date', () => {
  const doc = normalizeRecord({ id: 'i1', invoice_number: 'INV/FY26-27/0001', issue_date: '2026-06-01', gst_mode: 'IGST', status: 'Sent', notes: 'old', items: [{ id: 'a', name: 'Pen', quantity: 1, rate: 100, tax_rate: 18 }] });
  const t = (r: typeof doc) => ({ ...r, ...((c) => ({ subtotal: c.subtotal, igst_amount: c.igst_amount, tax_amount: c.tax_amount, total: c.total, balance_due: c.total }))(calculateInvoice(calcInputFromRecord(r))) });
  const mine = t({ ...doc, notes: 'call before delivery' });
  const theirs = t({ ...doc, items: [{ ...doc.items[0], quantity: 3 }], invoice_number: 'INV/FY26-27/0007', issue_date: '2026-06-02' });
  assert.deepEqual(groupDiffs(mine, theirs).map((g) => [g.id, g.fields.map((f) => f.key)]), [
    ['number', ['invoice_number', 'issue_date']], ['lines', ['items', 'subtotal', 'igst_amount', 'tax_amount', 'total', 'balance_due']], ['notes', ['notes']],
  ]);
  assert.equal(groupOf('invoice_number'), groupOf('issue_date'));
  const merged = mergeRows('invoices', mine, theirs, { lines: 'theirs' });
  assert.equal(merged.total, theirs.total);
  assert.equal(merged.notes, 'call before delivery');
  assert.equal(merged.invoice_number, 'INV/FY26-27/0001', 'number from one side only, with its date');
  assert.equal(merged.issue_date, '2026-06-01');
  assert.equal(validateMerged('invoices', merged, mine, theirs, { lines: 'theirs' }), '');
  // A total that no longer matches its lines (as if a calc field had come from the other side) is refused.
  assert.equal(validateMerged('invoices', { ...merged, total: mine.total }, mine, theirs, { lines: 'theirs' }), 'mergeTotals');
  assert.equal(validateMerged('vouchers', { lines: [{ dr: 100, cr: 0 }, { dr: 0, cr: 90 }] }, {}, {}, {}), 'mergeUnbalanced');
});

test('labels and values: money and dates formatted, private fields hidden without settings.manage', () => {
  assert.equal(showValue('credit_limit', 50000, { seePrivate: true }), '₹50,000.00');
  assert.match(showValue('due_date', '2026-06-30', { seePrivate: true }), /30/);
  assert.equal(showValue('phone', '98200 11111', { seePrivate: false }), '(changed)');
  assert.equal(showValue('bank_account_no', '1234', { seePrivate: false }), '(changed)');
  assert.equal(showValue('phone', '98200 11111', { seePrivate: true }), '98200 11111');
  assert.equal(showValue('items', [1, 2], { seePrivate: true }), '2 entries');
});

test('bulk "non-overlapping masters": one-sided changes only, and only when the remote follows a version this device knew', () => {
  assert.deepEqual(nonOverlappingPicks({ id: 'c', phone: '1', email: '' }, { id: 'c', phone: '', email: 'a@b' }), { phone: 'mine', email: 'theirs' });
  assert.equal(nonOverlappingPicks({ id: 'c', city: 'Pune' }, { id: 'c', city: 'Mumbai' }), null, 'set differently on both sides: overlap');
  const local = { meta: { vv: { A: 3, B: 2 }, d: 'A' } };
  assert.equal(remoteFollowsKnown(local, { meta: { vv: { A: 2, B: 4 }, d: 'B' } }), true);
  assert.equal(remoteFollowsKnown(local, { meta: { vv: { A: 4, B: 4 }, d: 'B' } }), false, 'remote saw an A version this device never had');
  assert.equal(remoteFollowsKnown(local, { meta: null }), false);
});
