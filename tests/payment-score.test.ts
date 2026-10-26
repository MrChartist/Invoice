/**
 * R2-A7 party payment score: grading thresholds, amount weighting, credit notes / advances / TDS as settlement,
 * partial payments, insufficient history, trend, promises and write-offs lowering the grade.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeFor, paymentScores, paymentScore, scoreSummary, MIN_BILLS } from '../src/lib/payment-score.ts';
import { reminderPriority } from '../src/lib/reminders.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { CollectionNote } from '../src/lib/collections.ts';

const TODAY = '2026-10-25';
let n = 0;
function inv(due: string, total: number, over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  n++;
  return {
    id: `i${n}`, invoice_number: `INV/${n}`, doc_type: 'TAX_INVOICE', issue_date: due, due_date: due, status: 'Paid', currency: 'INR', template_id: 't',
    client: { id: 'c1', name: 'Bharat', email: '', address: '', city: '', zip: '' }, sender: null, items: [], gst_mode: 'NONE', place_of_supply: '27',
    reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: total,
    notes: '', terms: '', subtotal: total, discount_amount: 0, taxable_value: total, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0,
    total, balance_due: 0, ...over,
  };
}
const pay = (i: InvoiceRecord, date: string, amount = i.total, over: Partial<Payment> = {}): Payment => ({ id: `p${i.id}${date}${amount}`, invoice_id: i.id, amount, method: 'UPI', date, ...over });

test('grade thresholds', () => {
  assert.equal(gradeFor(0, 80), 'A');
  assert.equal(gradeFor(0, 79), 'B');
  assert.equal(gradeFor(15, 0), 'B');
  assert.equal(gradeFor(15.1, 0), 'C');
  assert.equal(gradeFor(45, 0), 'C');
  assert.equal(gradeFor(46, 100), 'D');
});

test('fewer than 3 settled bills: not enough history (no grade)', () => {
  const a = inv('2026-09-01', 100);
  const s = paymentScore('c1', { invoices: [a], payments: [pay(a, '2026-09-01')] }, TODAY)!;
  assert.equal(s.grade, null);
  assert.equal(s.reasons[0], 'Not enough history');
  assert.equal(MIN_BILLS, 3);
});

test('amount-weighted average days late; on-time %; longest delay; partial payments settle on the last one', () => {
  const a = inv('2026-09-01', 1000);
  const b = inv('2026-09-01', 1000);
  const c = inv('2026-09-01', 8000);
  const payments = [pay(a, '2026-09-01'), pay(b, '2026-09-11'), pay(c, '2026-09-05', 4000), pay(c, '2026-09-21', 4000)];
  const s = paymentScore('c1', { invoices: [a, b, c], payments }, TODAY)!;
  assert.equal(s.avgDaysLate, Math.round(((0 * 1000 + 10 * 1000 + 20 * 8000) / 10000) * 10) / 10, '17 days, weighted by amount');
  assert.equal(s.onTimePct, 33);
  assert.equal(s.longestDelay, 20);
  assert.equal(s.grade, 'C');
  assert.match(scoreSummary(s), /^C · pays 17 days late/);
});

test('credit notes, advance adjustments and TDS count as settlement', () => {
  const a = inv('2026-09-01', 1000, { tds_amount: 100 });
  const b = inv('2026-09-01', 1000);
  const c = inv('2026-09-01', 1000);
  const cn = inv('2026-09-01', 400, { id: 'cn1', doc_type: 'CREDIT_NOTE', status: 'Sent', issue_date: '2026-08-30' });
  const payments = [pay(a, '2026-08-31', 900), pay(b, '2026-08-31', 600), pay(c, '2026-08-30', 1000, { advance_id: 'adv1' })];
  const s = paymentScore('c1', { invoices: [a, b, c, cn], payments, links: [{ from_id: b.id, to_id: 'cn1', relation: 'credit_note' }] }, TODAY)!;
  assert.equal(s.settledBills, 3);
  assert.equal(s.onTimePct, 100);
  assert.equal(s.grade, 'A');
});

test('trend against the previous 12 months; broken promises and write-offs lower the grade', () => {
  const now = ['2026-03-01', '2026-04-01', '2026-05-01'].map((d) => inv(d, 100));
  const old = ['2025-03-01', '2025-04-01', '2025-05-01'].map((d) => inv(d, 100));
  const late = (i: InvoiceRecord, days: number) => {
    const d = new Date(Number(i.due_date.slice(0, 4)), Number(i.due_date.slice(5, 7)) - 1, 1 + days);
    return pay(i, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  };
  const payments = [...now.map((i) => late(i, 2)), ...old.map((i) => late(i, 30))];
  const s = paymentScore('c1', { invoices: [...now, ...old], payments }, TODAY)!;
  assert.equal(s.trend, 'better');
  assert.equal(s.previousAvg, 30);
  assert.equal(s.grade, 'B');
  const notes: CollectionNote[] = [1, 2].map((k) => ({ id: `n${k}`, party_key: 'c1', kind: 'call', outcome: '', date: '2026-06-01', created_at: '', promise: { amount: 999, date: `2026-06-0${k + 1}` } }));
  assert.equal(paymentScore('c1', { invoices: [...now, ...old], payments, notes, receipts: [] }, TODAY)!.grade, 'C', 'two broken promises: one step down');
  const wo = inv('2026-01-01', 50);
  const withWo = paymentScores({ invoices: [...now, ...old, wo], payments: [...payments, pay(wo, '2026-06-01', 50, { write_off: true })] }, TODAY).get('c1')!;
  assert.equal(withWo.writtenOff, 1);
  assert.equal(withWo.grade, 'C');
});

test('reminder priority weighs the grade (C +5, D +10; A / no history 0)', () => {
  const base = { daysToDue: -10, balanceInr: 10000, otherOverdue: 0, remindersSent: 0 };
  const none = reminderPriority(base).score;
  assert.equal(reminderPriority({ ...base, grade: 'A' }).score, none);
  assert.equal(reminderPriority({ ...base, grade: 'C' }).score, none + 5);
  assert.equal(reminderPriority({ ...base, grade: 'D' }).score, none + 10);
  assert.ok(reminderPriority({ ...base, grade: 'D' }).reasons.some((r) => /grade D/.test(r)));
});
