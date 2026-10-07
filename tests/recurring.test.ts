import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal in-memory localStorage so the storage-backed paths run under Node.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return mem.size; },
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
} as Storage;

const R = await import('../src/lib/recurring.ts');
const { localDb } = await import('../src/lib/localDb.ts');
const { makeDraft } = await import('../src/store/invoice-defaults.ts');

beforeEach(() => mem.clear());

function sampleTemplate(): import('../src/lib/recurring.ts').RecurringTemplate {
  const draft = makeDraft({ settings: localDb.settings.get(), sender: null });
  draft.client = { ...draft.client, name: 'Acme Traders', email: 'a@acme.test' };
  draft.items = [
    { id: 'i1', name: 'Research plan — {month} {year}', type: 'Service', quantity: 1, rate: 1000, tax_rate: 0, amount: 1000 },
  ];
  draft.gst_mode = 'NONE';
  draft.round_off_enabled = false;
  return R.templateFromInvoice(draft);
}

function schedule(over: Partial<import('../src/lib/recurring.ts').RecurringSchedule> & { start_date: string }) {
  const s = R.createSchedule({
    name: 'Retainer',
    template: sampleTemplate(),
    frequency: 'monthly',
    due_in_days: 10,
    mode: 'issue',
    ...over,
  });
  return { ...s, ...over };
}

test('addMonths clamps to month end and keeps the anchor day', () => {
  assert.equal(R.addMonths('2025-01-31', 1), '2025-02-28');
  assert.equal(R.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(R.addMonths('2025-01-30', 1), '2025-02-28');
  assert.equal(R.addMonths('2025-12-15', 2), '2026-02-15');
  assert.equal(R.addMonths('2025-03-31', -1), '2025-02-28');
});

test('occurrences return to the anchor day instead of drifting', () => {
  const rule = { frequency: 'monthly' as const, interval: 1, start_date: '2025-01-31' };
  const dates = Array.from({ length: 5 }, (_, n) => R.occurrenceDate(rule, n));
  assert.deepEqual(dates, ['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31']);
});

test('leap years: 29 Feb yearly series falls back to 28 Feb then returns', () => {
  const rule = { frequency: 'yearly' as const, interval: 1, start_date: '2024-02-29' };
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((n) => R.occurrenceDate(rule, n)),
    ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'],
  );
  assert.equal(R.isLeapYear(1900), false);
  assert.equal(R.isLeapYear(2000), true);
});

test('frequencies: weekly, quarterly, half-yearly, custom days', () => {
  const base = { interval: 1, start_date: '2025-01-10' };
  assert.equal(R.nextOccurrence({ ...base, frequency: 'weekly' }, '2025-01-10'), '2025-01-17');
  assert.equal(R.nextOccurrence({ ...base, frequency: 'quarterly' }, '2025-01-10'), '2025-04-10');
  assert.equal(R.nextOccurrence({ ...base, frequency: 'half-yearly' }, '2025-01-10'), '2025-07-10');
  assert.equal(R.nextOccurrence({ ...base, interval: 45, frequency: 'custom-days' }, '2025-01-10'), '2025-02-24');
  assert.equal(R.nextOccurrence({ ...base, interval: 2, frequency: 'monthly' }, '2025-01-10'), '2025-03-10');
});

test('dueRuns returns every missed occurrence, oldest first', () => {
  const s = schedule({ start_date: '2025-01-15', next_run: '2025-01-15' });
  assert.deepEqual(R.dueRuns(s, '2025-04-20'), ['2025-01-15', '2025-02-15', '2025-03-15', '2025-04-15']);
  assert.deepEqual(R.dueRuns(s, '2025-01-14'), []);
});

test('dueRuns caps catch-up to the most recent 12 and reports the overflow', () => {
  const s = schedule({ start_date: '2020-01-01', next_run: '2020-01-01' });
  const d = R.dueRunsDetailed(s, '2025-01-01');
  assert.equal(d.dates.length, 12);
  assert.equal(d.dates[11], '2025-01-01');
  assert.equal(d.skipped, 61 - 12);
  assert.equal(d.nextRun, '2025-02-01');
});

test('dueRuns honours max_runs, end_date and pause', () => {
  const s = schedule({ start_date: '2025-01-01', next_run: '2025-01-01', max_runs: 2 });
  assert.equal(R.dueRuns(s, '2025-12-31').length, 2);
  const e = schedule({ start_date: '2025-01-01', next_run: '2025-01-01', end_date: '2025-03-01' });
  assert.deepEqual(R.dueRuns(e, '2025-12-31'), ['2025-01-01', '2025-02-01', '2025-03-01']);
  const p = schedule({ start_date: '2025-01-01', next_run: '2025-01-01', active: false });
  assert.deepEqual(R.dueRuns(p, '2025-12-31'), []);
  assert.equal(R.scheduleStatus(p), 'paused');
});

test('generated invoice: totals, tokens, due date, status', () => {
  const s = schedule({ start_date: '2025-06-05' });
  const inv = R.buildInvoiceFromSchedule(s, '2025-06-05', { invoiceNumber: 'INV/FY25-26/0001' });
  assert.equal(inv.items[0].name, 'Research plan — June 2025');
  assert.equal(inv.total, 1000);
  assert.equal(inv.issue_date, '2025-06-05');
  assert.equal(inv.due_date, '2025-06-15');
  assert.equal(inv.status, 'Sent');
  assert.equal(inv.amount_paid, 0);
  assert.equal(inv.recurring_id, s.id);
  const draft = R.buildInvoiceFromSchedule({ ...s, mode: 'draft' }, '2025-06-05', { invoiceNumber: 'x' });
  assert.equal(draft.status, 'Draft');
});

test('runDueSchedules generates once and is idempotent', () => {
  const s = schedule({ start_date: '2025-04-10', next_run: '2025-04-10' });
  R.recurringDb.save(s);

  const first = R.runDueSchedules('2025-06-20');
  assert.equal(first.generated.length, 3);
  assert.deepEqual(first.generated.map((g) => g.invoice_number), [
    'INV/FY25-26/0001', 'INV/FY25-26/0002', 'INV/FY25-26/0003',
  ]);
  const saved = R.recurringDb.getById(s.id)!;
  assert.equal(saved.run_count, 3);
  assert.equal(saved.next_run, '2025-07-10');
  assert.equal(saved.history.length, 3);

  // Second run (e.g. another tab) creates nothing.
  assert.equal(R.runDueSchedules('2025-06-20').generated.length, 0);
  assert.equal(localDb.invoices.getAll().length, 3);
});

test('idempotent even if the schedule write was lost (stale tab / crash)', () => {
  const s = schedule({ start_date: '2025-04-10', next_run: '2025-04-10' });
  R.recurringDb.save(s);
  R.runDueSchedules('2025-04-10');
  // Simulate the schedule row reverting to its pre-run state.
  R.recurringDb.save(s);
  const again = R.runDueSchedules('2025-04-10');
  assert.equal(again.generated.length, 0);
  assert.equal(localDb.invoices.getAll().length, 1);
  const healed = R.recurringDb.getById(s.id)!;
  assert.equal(healed.next_run, '2025-05-10');
  assert.equal(healed.run_count, 1);
});

test('FY boundary: 31 Mar and 1 Apr land in different number series', () => {
  const s = schedule({ start_date: '2026-03-31', next_run: '2026-03-31', frequency: 'custom-days', interval: 1 });
  R.recurringDb.save(s);
  const r = R.runDueSchedules('2026-04-02');
  assert.deepEqual(r.generated.map((g) => g.invoice_number), [
    'INV/FY25-26/0001', 'INV/FY26-27/0001', 'INV/FY26-27/0002',
  ]);
});

test('catch-up overflow is counted as skipped and next_run advances past today', () => {
  const s = schedule({ start_date: '2023-01-01', next_run: '2023-01-01' });
  R.recurringDb.save(s);
  const r = R.runDueSchedules('2025-01-01');
  assert.equal(r.generated.length, 12);
  const saved = R.recurringDb.getById(s.id)!;
  assert.equal(saved.skipped_count, 25 - 12);
  assert.equal(saved.next_run, '2025-02-01');
});

test('pause, resume (no back-fill), skip next, stop', () => {
  const s = schedule({ start_date: '2025-01-01', next_run: '2025-01-01' });
  R.recurringDb.save(s);

  R.pauseSchedule(s.id);
  assert.equal(R.runDueSchedules('2025-06-01').generated.length, 0);

  const resumed = R.resumeSchedule(s.id, '2025-06-01')!;
  assert.equal(resumed.next_run, '2025-06-01');
  assert.equal(resumed.active, true);

  const skipped = R.skipNext(s.id)!;
  assert.equal(skipped.next_run, '2025-07-01');
  assert.equal(skipped.skipped_count, 1);
  assert.equal(skipped.run_count, 0);

  const stopped = R.stopSchedule(s.id, '2025-06-15')!;
  assert.equal(R.scheduleStatus(stopped), 'ended');
  assert.equal(R.runDueSchedules('2026-01-01').generated.length, 0);
});

test('runNow issues the next occurrence dated today, once', () => {
  const s = schedule({ start_date: '2025-09-01', next_run: '2025-09-01' });
  R.recurringDb.save(s);
  const res = R.runNow(s.id, '2025-08-20')!;
  assert.equal(res.created, true);
  assert.equal(res.invoice.issue_date, '2025-08-20');
  assert.equal(R.recurringDb.getById(s.id)!.next_run, '2025-10-01');
});

test('previewOccurrences lists the next dates and respects limits', () => {
  const rule = { frequency: 'monthly' as const, interval: 1, start_date: '2025-01-31' };
  assert.deepEqual(R.previewOccurrences(rule, 3, '2025-02-01'), ['2025-02-28', '2025-03-31', '2025-04-30']);
  assert.equal(R.previewOccurrences({ ...rule, max_runs: 2 }, 6).length, 2);
  assert.equal(R.previewOccurrences({ ...rule, end_date: '2025-03-01' }, 6).length, 2);
  assert.equal(R.previewOccurrences({ ...rule, start_date: '' }, 6).length, 0);
});

test('monthlyValue normalises quarterly to a monthly figure', () => {
  const s = schedule({ start_date: '2025-01-01', frequency: 'quarterly' });
  assert.equal(R.monthlyValue(s), 333.33);
});
