import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stageForDays, daysUntil, buildReminder, pendingReminders, lastReminder, reminderCount,
  makeLogEntry, makeSnooze, isSnoozed, termsMentionInterest, fillTemplate, suggestStage,
} from '../src/lib/reminders.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const TODAY = new Date(2026, 9, 7, 15, 30); // 7 Oct 2026, afternoon

function inv(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'i1', invoice_number: 'INV/FY26-27/0007', doc_type: 'INVOICE', issue_date: '2026-09-01',
    due_date: '2026-10-07', status: 'Sent', currency: 'INR',
    client: { name: 'Asha', email: '', address: '', city: '', zip: '' },
    sender: { companyName: 'MrChartist', companyPhone: '9876543210', upiId: 'mc@okaxis' },
    items: [], total: 5000, balance_due: 5000, amount_paid: 0, terms: '', notes: '',
    ...over,
  } as unknown as InvoiceRecord;
}

test('stageForDays boundaries', () => {
  assert.equal(stageForDays(4), null);
  assert.equal(stageForDays(3), 'upcoming');
  assert.equal(stageForDays(1), 'upcoming');
  assert.equal(stageForDays(0), 'due_today');
  assert.equal(stageForDays(-1), 'overdue_polite');
  assert.equal(stageForDays(-7), 'overdue_polite');
  assert.equal(stageForDays(-8), 'overdue_firm');
  assert.equal(stageForDays(-30), 'overdue_firm');
  assert.equal(stageForDays(-31), 'overdue_final');
  assert.equal(stageForDays(NaN), null);
});

test('daysUntil ignores time of day', () => {
  assert.equal(daysUntil('2026-10-07', TODAY), 0);
  assert.equal(daysUntil('2026-10-10', TODAY), 3);
  assert.equal(daysUntil('2026-10-06', TODAY), -1);
  assert.ok(Number.isNaN(daysUntil(undefined, TODAY)));
});

test('suggestStage: paid -> thank_you', () => {
  assert.equal(suggestStage(inv({ status: 'Paid', balance_due: 0 }), TODAY), 'thank_you');
  assert.equal(suggestStage(inv({ due_date: '2026-09-01' }), TODAY), 'overdue_final');
});

test('buildReminder fills placeholders in English and Hinglish', () => {
  const en = buildReminder(inv({ due_date: '2026-10-02' }), 'overdue_polite', 'en', TODAY);
  assert.match(en.body, /Asha/);
  assert.match(en.body, /INV\/FY26-27\/0007/);
  assert.match(en.body, /5,000\.00/);
  assert.match(en.body, /5 days overdue/);
  assert.match(en.body, /mc@okaxis/);
  assert.ok(!/\{\w+\}/.test(en.body + en.subject));
  const hi = buildReminder(inv(), 'due_today', 'hinglish', TODAY);
  assert.match(hi.body, /Namaste Asha ji/);
});

test('final notice mentions interest only if terms do', () => {
  const none = buildReminder(inv({ due_date: '2026-08-01' }), 'overdue_final', 'en', TODAY);
  assert.ok(!/charges|interest/i.test(none.body));
  const withTerms = buildReminder(
    inv({ due_date: '2026-08-01', terms: 'Interest @18% p.a. on late payment' }), 'overdue_final', 'en', TODAY);
  assert.match(withTerms.body, /late-payment charges/);
  assert.equal(termsMentionInterest({ terms: 'Net 15', notes: '' }), false);
});

test('fillTemplate leaves unknown tokens', () => {
  assert.equal(fillTemplate('{a} {b}', { a: 'x' }), 'x {b}');
});

test('pendingReminders: selection, ordering, exclusions', () => {
  const list = [
    inv({ id: 'far', due_date: '2026-10-20' }),
    inv({ id: 'soon', due_date: '2026-10-09' }),
    inv({ id: 'late', due_date: '2026-09-01' }),
    inv({ id: 'paid', status: 'Paid', balance_due: 0 }),
    inv({ id: 'draft', status: 'Draft' }),
    inv({ id: 'quote', doc_type: 'QUOTATION' }),
  ];
  const res = pendingReminders(list, TODAY, []);
  assert.deepEqual(res.map((r) => r.invoice.id), ['late', 'soon']);
  assert.equal(res[0].stage, 'overdue_final');
});

test('pendingReminders: cooldown and snooze', () => {
  const i = inv({ id: 'x', due_date: '2026-10-01' });
  const recent = makeLogEntry('l1', 'x', 'whatsapp', 'overdue_polite', new Date(2026, 9, 6));
  assert.equal(pendingReminders([i], TODAY, [recent]).length, 0);
  const old = makeLogEntry('l2', 'x', 'whatsapp', 'overdue_polite', new Date(2026, 9, 3));
  const got = pendingReminders([i], TODAY, [old]);
  assert.equal(got.length, 1);
  assert.equal(got[0].count, 1);
  const snooze = makeSnooze('s1', 'x', 2, TODAY);
  assert.equal(snooze.note, '2026-10-09');
  assert.equal(isSnoozed([snooze], 'x', TODAY), true);
  assert.equal(pendingReminders([i], TODAY, [snooze]).length, 0);
  assert.equal(pendingReminders([i], new Date(2026, 9, 9), [snooze]).length, 1);
});

test('log helpers ignore snooze rows', () => {
  const log = [
    makeLogEntry('a', 'x', 'email', 'upcoming', new Date(2026, 9, 1)),
    makeLogEntry('b', 'x', 'sms', 'due_today', new Date(2026, 9, 5)),
    makeSnooze('c', 'x', 3, new Date(2026, 9, 6)),
  ];
  assert.equal(reminderCount(log, 'x'), 2);
  assert.equal(lastReminder(log, 'x')?.id, 'b');
  assert.equal(lastReminder(log, 'nope'), null);
});

test('final notice states accrued interest only when the invoice terms mention interest', () => {
  const terms = inv({ due_date: '2026-08-01', terms: 'Interest @18% p.a. on late payment' });
  const stated = buildReminder(terms, 'overdue_final', 'en', TODAY, { interestAccrued: 123.45 });
  assert.match(stated.body, /late-payment interest of .*123\.45 has accrued as of/);
  assert.match(stated.body, /does not include it/);
  const hi = buildReminder(terms, 'overdue_final', 'hinglish', TODAY, { interestAccrued: 123.45 });
  assert.match(hi.body, /123\.45 late-payment interest bana hai/);

  // terms silent -> never mentioned, even when an amount is supplied
  const silent = buildReminder(inv({ due_date: '2026-08-01' }), 'overdue_final', 'en', TODAY, { interestAccrued: 500 });
  assert.ok(!/interest|charges/i.test(silent.body));

  // zero / missing / junk amounts fall back to the generic wording
  for (const interestAccrued of [0, -5, NaN, undefined]) {
    const m = buildReminder(terms, 'overdue_final', 'en', TODAY, { interestAccrued });
    assert.match(m.body, /late-payment charges may apply/);
  }
  // other stages never carry the line
  const firm = buildReminder(terms, 'overdue_firm', 'en', TODAY, { interestAccrued: 10 });
  assert.ok(!/interest/i.test(firm.body));
});
