/**
 * Per-client late-fee line (roadmap 6.15): maths reuse the interest engine, and the action
 * creates a NEW draft invoice without touching the overdue one; the period lock is respected.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings, reload } from './helpers/world.ts';
import {
  LateFeeError,
  buildLateFeeInvoice,
  buildLateFeeItem,
  computeClientLateFee,
  createLateFeeInvoice,
  describeClientLateFee,
  lateFeeRaisedFor,
  lateFeeRuleFor,
  sanitizeClientLateFee,
  type ClientLateFee,
} from '../src/lib/late-fee.ts';
import { computeInterest, type InterestInput } from '../src/lib/interest.ts';
import { localDb } from '../src/lib/localDb.ts';
import { round2 } from '../src/lib/invoice-calc.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const base: InterestInput = { doc_type: 'INVOICE', status: 'Sent', due_date: '2025-06-30', total: 11800 };
const pct: ClientLateFee = { mode: 'percent_pa', rate: 18, graceDays: 5 };
const flat: ClientLateFee = { mode: 'flat', rate: 500, graceDays: 7 };

test('sanitize: unknown mode, zero rate and junk are dropped; values clamped', () => {
  assert.equal(sanitizeClientLateFee(undefined), undefined);
  assert.equal(sanitizeClientLateFee({ mode: 'weekly', rate: 5, graceDays: 0 }), undefined);
  assert.equal(sanitizeClientLateFee({ mode: 'flat', rate: 0, graceDays: 0 }), undefined);
  assert.deepEqual(sanitizeClientLateFee({ mode: 'percent_pa', rate: 250, graceDays: 900.4 }), { mode: 'percent_pa', rate: 100, graceDays: 365 });
  assert.deepEqual(sanitizeClientLateFee({ mode: 'flat', rate: '750.555', graceDays: '3' }), { mode: 'flat', rate: 750.56, graceDays: 3 });
  assert.equal(describeClientLateFee(pct), '18% p.a. simple interest after 5 grace days');
  assert.equal(describeClientLateFee({ ...flat, graceDays: 0 }), 'flat ₹500.00');
});

test('percent p.a.: simple interest from the day after due + grace (365-day year), same as computeInterest', () => {
  const q = computeClientLateFee(base, pct, '2025-07-15');
  // 7 Jul..15 Jul... accrues from the day after 5 Jul: 6..15 Jul = 10 days.
  assert.equal(q.eligible, true);
  assert.equal(q.interest.chargeable_days, 10);
  assert.equal(q.amount, round2((11800 * 0.18 * 10) / 365));
  assert.equal(q.amount, 58.19);
  const direct = computeInterest(base, { enabled: true, mode: 'annual', rate: 18, grace_days: 5 }, '2025-07-15');
  assert.equal(q.amount, direct.amount);
});

test('percent p.a.: a part-payment reduces the balance from the next day; not late yet / settled in grace', () => {
  const paid = computeClientLateFee({ ...base, payments: [{ date: '2025-07-10', amount: 5800 }] }, pct, '2025-07-15');
  // 6..10 Jul on 11,800 (5 days) + 11..15 Jul on 6,000 (5 days).
  assert.equal(paid.amount, round2((11800 * 0.18 * 5) / 365) + round2((6000 * 0.18 * 5) / 365));
  const early = computeClientLateFee(base, pct, '2025-07-04');
  assert.equal(early.eligible, false);
  assert.match(early.reason!, /grace/);
  const draft = computeClientLateFee({ ...base, status: 'Draft' }, pct, '2025-08-01');
  assert.equal(draft.eligible, false);
});

test('flat: fixed fee once unpaid beyond the grace period; paid in grace = no fee; paid late = fee', () => {
  assert.equal(computeClientLateFee(base, flat, '2025-07-07').eligible, false);
  const late = computeClientLateFee(base, flat, '2025-07-08');
  assert.deepEqual([late.eligible, late.amount], [true, 500]);
  const inGrace = computeClientLateFee({ ...base, payments: [{ date: '2025-07-06', amount: 11800 }] }, flat, '2025-08-30');
  assert.equal(inGrace.eligible, false);
  assert.match(inGrace.reason!, /grace/);
  const paidLate = computeClientLateFee({ ...base, payments: [{ date: '2025-07-20', amount: 11800 }] }, flat, '2025-08-30');
  assert.deepEqual([paidLate.eligible, paidLate.amount], [true, 500]);
});

test('the line and the new invoice: one line, tax 0 %, total = fee, original untouched', () => {
  const orig = createViaStore({ date: '2025-06-01', due: '2025-06-30', lines: [{ qty: 10, rate: 1000 }] });
  const before = JSON.stringify(reload(orig.id));
  const q = computeClientLateFee(base, pct, '2025-07-15');
  const item = buildLateFeeItem(q, pct, orig)!;
  assert.equal(item.rate, 58.19);
  assert.equal(item.tax_rate, 0);
  assert.match(item.name, new RegExp(orig.invoice_number.replace(/\//g, '\\/')));
  const rec = buildLateFeeInvoice(orig, item, { id: 'lf1', invoice_number: 'INV/FY25-26/0099', today: '2025-07-15', dueDays: 7 });
  assert.equal(rec.id, 'lf1');
  assert.equal(rec.status, 'Draft');
  assert.equal(rec.due_date, '2025-07-22');
  assert.equal(rec.items.length, 1);
  assert.equal(rec.total, 58);
  assert.equal(rec.taxable_value, 58.19);
  assert.equal(rec.late_fee_for, orig.id);
  assert.equal(rec.amount_paid, 0);
  assert.equal(JSON.stringify(reload(orig.id)), before, 'building never edits the original');
  assert.equal(buildLateFeeItem(computeClientLateFee(base, pct, '2025-07-01'), pct, orig), null);
});

test('createLateFeeInvoice: uses the client master terms, saves a NEW draft, refuses a second one', () => {
  const orig = createViaStore({ date: '2025-06-01', due: '2025-06-30', lines: [{ qty: 10, rate: 1000 }] });
  assert.throws(() => createLateFeeInvoice(orig, new Date(2025, 6, 15)), LateFeeError, 'no terms on the client yet');
  localDb.clients.upsert({ ...clientMH, id: clientMH.id, late_fee: flat });
  assert.deepEqual(lateFeeRuleFor(orig), flat);
  const before = JSON.stringify(reload(orig.id));
  const count = localDb.invoices.getAll().length;

  freezeDate('2025-07-15T10:00:00');
  try {
    const saved = createLateFeeInvoice(reload(orig.id), new Date(2025, 6, 15));
    assert.notEqual(saved.id, orig.id);
    assert.equal(saved.issue_date, '2025-07-15');
    assert.equal(saved.status, 'Draft');
    assert.equal(saved.total, 500);
    assert.equal(saved.client.name, orig.client.name);
    assert.ok(saved.invoice_number && saved.invoice_number !== orig.invoice_number);
    assert.equal(localDb.invoices.getAll().length, count + 1);
    assert.equal(JSON.stringify(reload(orig.id)), before, 'the overdue invoice is never edited');
    assert.equal(lateFeeRaisedFor(orig.id, localDb.invoices.getAll())?.id, saved.id);
    assert.throws(() => createLateFeeInvoice(reload(orig.id), new Date(2025, 6, 15)), /already raised/);
  } finally {
    thawDate();
  }
});

test('createLateFeeInvoice respects the period lock', () => {
  const orig = createViaStore({ date: '2025-06-01', due: '2025-06-30', lines: [{ qty: 10, rate: 1000 }] });
  localDb.clients.upsert({ ...clientMH, id: clientMH.id, late_fee: pct });
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2025-07-31' });
  const count = localDb.invoices.getAll().length;
  assert.throws(() => createLateFeeInvoice(reload(orig.id), new Date(2025, 6, 15)), /lock/i);
  assert.equal(localDb.invoices.getAll().length, count);
});
