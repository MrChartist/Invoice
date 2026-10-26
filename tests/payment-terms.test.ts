/**
 * R2-A1 payment terms master: each kind across month ends, local days near the FY boundary, instalment rounding,
 * early-pay `until`, the 8G schedule they fill, snapshot independence, MSME 45-day note and recurring issue.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, inTimeZones } from './helpers/shim.ts';
import { installSettings, createViaStore, reload } from './helpers/world.ts';
import {
  STARTER_TERMS, defaultTermFor, loadPaymentTerms, msmeNote, offsetDate, resolveTerms, savePaymentTerm, setTermActive, termIssues, termPatch,
  type PaymentTerm,
} from '../src/lib/payment-terms.ts';
import { effectiveDueDate, instalmentAmounts } from '../src/lib/payment-schedule.ts';
import { buildInvoiceFromSchedule, type RecurringSchedule } from '../src/lib/recurring.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setActorProvider } from '../src/lib/access.ts';

beforeEach(() => { resetStorage(); installSettings(); });
afterEach(() => setActorProvider(null));

test('net / eom / day-of-next-month dates across month ends and leap years', () => {
  assert.equal(offsetDate('2026-01-31', 'days', 30), '2026-03-02');
  assert.equal(offsetDate('2026-01-31', 'eom', 0), '2026-01-31');
  assert.equal(offsetDate('2026-01-15', 'eom', 30), '2026-03-02', 'EOM of Jan + 30 = 2 Mar (28-day Feb)');
  assert.equal(offsetDate('2028-01-15', 'eom', 30), '2028-03-01', 'leap year Feb has 29 days');
  assert.equal(offsetDate('2026-01-31', 'day_next_month', 31), '2026-02-28', 'day 31 clamps to the month length');
  assert.equal(offsetDate('2028-01-10', 'day_next_month', 30), '2028-02-29');
  assert.equal(offsetDate('2026-12-20', 'day_next_month', 10), '2027-01-10', 'December rolls over the year');
});

test('local days near 31 March stay in their FY in every time zone', () => {
  inTimeZones(['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC'], (tz) => {
    assert.equal(offsetDate('2026-03-31', 'days', 0), '2026-03-31', tz);
    assert.equal(offsetDate('2026-03-31', 'days', 1), '2026-04-01', tz);
    assert.equal(offsetDate('2026-03-01', 'eom', 0), '2026-03-31', tz);
  });
});

test('instalments: % rows sorted by date, last row takes the rounding remainder, sum is exact', () => {
  const term: PaymentTerm = {
    id: 't', name: '30/70', kind: 'instalments',
    instalments: [{ percent: 70, offset_kind: 'days', offset: 45 }, { percent: 30, offset_kind: 'days', offset: 0, label: 'Advance' }],
  };
  const r = resolveTerms(term, '2026-10-01', 1000.01);
  assert.equal(r.schedule.length, 2);
  assert.equal(r.schedule[0].label, 'Advance');
  assert.equal(r.schedule[0].due_date, '2026-10-01');
  assert.equal(r.due_date, '2026-11-15', 'due date = the final instalment');
  const amounts = instalmentAmounts(r.schedule, 1000.01);
  assert.equal(Math.round((amounts[0] + amounts[1]) * 100), 100001);
  const three: PaymentTerm = { id: 'x', name: 'Thirds', kind: 'instalments', instalments: [1, 2, 3].map((n) => ({ percent: 33.33 + (n === 3 ? 0.01 : 0), offset_kind: 'days' as const, offset: n * 10 })) };
  const a3 = instalmentAmounts(resolveTerms(three, '2026-10-01', 100).schedule, 100);
  assert.equal(Math.round(a3.reduce((s, x) => s + x, 0) * 100), 10000);
});

test('early-pay discount: amount and until date; simple terms need no schedule', () => {
  const r = resolveTerms({ id: 'n30', name: 'Net 30 / 2% 7', kind: 'net', days: 30, early_discount: { percent: 2, days: 7 } }, '2026-10-26', 100000);
  assert.deepEqual(r.snapshot.early_discount, { percent: 2, until: '2026-11-02', amount: 2000 });
  assert.equal(r.schedule.length, 0);
  assert.equal(r.due_date, '2026-11-25');
});

test('validation: names, percents adding up to 100, day of month', () => {
  assert.ok(termIssues({ id: '', name: '', kind: 'net', days: 5 }).length);
  assert.ok(termIssues({ id: '', name: 'Bad', kind: 'instalments', instalments: [{ percent: 50, offset_kind: 'days', offset: 0 }, { percent: 40, offset_kind: 'days', offset: 10 }] }).some((e) => /100/.test(e)));
  assert.ok(termIssues({ id: '', name: 'D', kind: 'day_next_month', day: 40 }).length);
  assert.equal(termIssues({ id: '', name: 'OK', kind: 'eom', days: 30 }).length, 0);
});

test('master: starter set until the first save, rename clash, deactivate; client default pre-selects', () => {
  assert.equal(loadPaymentTerms().length, STARTER_TERMS.length);
  const t = savePaymentTerm({ id: '', name: 'Net 60', kind: 'net', days: 60 });
  assert.equal(loadPaymentTerms().length, STARTER_TERMS.length + 1, 'the starter set is stored with the first save');
  assert.throws(() => savePaymentTerm({ id: '', name: 'net 60', kind: 'net', days: 61 }), /already exists/);
  setTermActive(t.id, false);
  assert.equal(defaultTermFor({ payment_terms_id: t.id }, loadPaymentTerms()), null, 'inactive terms are not pre-selected');
  setTermActive(t.id, true);
  assert.equal(defaultTermFor({ payment_terms_id: t.id }, loadPaymentTerms())?.name, 'Net 60');
  setActorProvider(() => ({ id: 'v', name: 'V', role: 'viewer' }));
  assert.throws(() => savePaymentTerm({ id: '', name: 'X', kind: 'net', days: 1 }), /cannot/);
});

test('a saved document keeps its term snapshot when the master changes; reminders follow the next unpaid instalment', () => {
  const term = savePaymentTerm({ id: '', name: '30/70 in 45', kind: 'instalments', early_discount: { percent: 2, days: 7 }, instalments: [{ percent: 30, offset_kind: 'days', offset: 0 }, { percent: 70, offset_kind: 'days', offset: 45 }] });
  const draft = createViaStore({ date: '2026-10-01', lines: [{ qty: 1, rate: 1000, tax: 0 }], gstMode: 'NONE' });
  const patch = termPatch(term, draft);
  const inv = localDb.invoices.save({ ...draft, ...patch });
  assert.equal(inv.payment_terms?.name, '30/70 in 45');
  savePaymentTerm({ ...term, name: 'Renamed', early_discount: { percent: 5, days: 3 } });
  const saved = reload(inv.id);
  assert.equal(saved.payment_terms?.name, '30/70 in 45', 'snapshot unaffected by master edits');
  assert.equal(saved.payment_terms?.early_discount?.percent, 2);
  assert.equal(effectiveDueDate(saved), '2026-10-01', 'first instalment open');
  localDb.payments.record({ invoiceId: inv.id, amount: 300, method: 'UPI', date: '2026-10-02' });
  assert.equal(effectiveDueDate(reload(inv.id)), '2026-11-15', 'the next unpaid instalment after a part payment');
});

test('MSME 45-day note: only with a seller Udyam number, a business buyer and a final due date beyond 45 days', () => {
  const seller = { msme_udyam: 'UDYAM-MH-01-0000001' };
  assert.equal(msmeNote(seller, '2026-10-01', '2026-11-20', '27AAACB2230M1Z5'), true);
  assert.equal(msmeNote(seller, '2026-10-01', '2026-11-15', '27AAACB2230M1Z5'), false, '45 days exactly is fine');
  assert.equal(msmeNote({}, '2026-10-01', '2026-12-31', '27AAACB2230M1Z5'), false);
  assert.equal(msmeNote(seller, '2026-10-01', '2026-12-31', ''), false, 'consumer (no GSTIN)');
});

test('recurring documents carry the term id and recompute the schedule on each issue', () => {
  const term = savePaymentTerm({ id: '', name: 'EOM 15', kind: 'eom', days: 15, early_discount: { percent: 1, days: 5 } });
  const tpl = createViaStore({ date: '2026-10-01', lines: [{ qty: 1, rate: 500, tax: 0 }], gstMode: 'NONE', asDraft: true });
  const s = { id: 'r1', name: 'Rent', template: tpl, frequency: 'monthly', interval: 1, start_date: '2026-11-03', next_run: '2026-11-03', run_count: 0, due_in_days: 7, mode: 'draft', active: true, history: [], payment_terms_id: term.id } as unknown as RecurringSchedule;
  const doc = buildInvoiceFromSchedule(s, '2026-11-03', { invoiceNumber: 'INV/FY26-27/0100', terms: loadPaymentTerms() });
  assert.equal(doc.due_date, '2026-12-15', 'EOM of Nov + 15');
  assert.equal(doc.payment_terms?.early_discount?.until, '2026-11-08');
  const plain = buildInvoiceFromSchedule({ ...s, payment_terms_id: undefined }, '2026-11-03', { invoiceNumber: 'INV/FY26-27/0101' });
  assert.equal(plain.due_date, '2026-11-10', 'without a term the schedule due-in-days applies');
});
