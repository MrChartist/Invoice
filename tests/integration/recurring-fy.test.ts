/**
 * Recurring generation: idempotent (two tabs, a crash between "save invoice" and
 * "advance schedule", a manual re-run), numbering restarts with the Indian FY,
 * the generated invoice keeps its tax setup, and catching up a long-dormant
 * schedule is fast.
 */
import '../helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, inTimeZones, ZONES } from '../helpers/shim.ts';
import { clientUS, createViaStore, installSettings, reload } from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import {
  addMonths,
  createSchedule,
  dueRunsDetailed,
  generateInvoiceFromSchedule,
  nextOccurrence,
  occurrenceDate,
  recurringDb,
  runDueSchedules,
  templateFromInvoice,
  type RecurringSchedule,
} from '../../src/lib/recurring.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

function monthlyFrom(start: string, over: Partial<Parameters<typeof createSchedule>[0]> = {}) {
  const source = createViaStore({ date: '2026-02-01', lines: [{ name: 'Retainer {month} {year}', qty: 1, rate: 10000, tax: 18 }] });
  const s = createSchedule({
    name: 'Retainer',
    template: templateFromInvoice(source),
    frequency: 'monthly',
    start_date: start,
    mode: 'issue',
    ...over,
  });
  recurringDb.save(s);
  return { source, schedule: s };
}

test('catching up across 1 April: numbers continue in FY25-26 then restart at 0001 in FY26-27', () => {
  const { source } = monthlyFrom('2026-03-15');
  assert.equal(source.invoice_number, 'INV/FY25-26/0001');
  const run = runDueSchedules('2026-04-20');
  assert.deepEqual(
    run.generated.map((g) => [g.recurring_date, g.invoice_number]),
    [
      ['2026-03-15', 'INV/FY25-26/0002'],
      ['2026-04-15', 'INV/FY26-27/0001'],
    ],
  );
  assert.deepEqual(run.generated.map((g) => g.total), [11800, 11800]);
  assert.equal(run.generated[0].items[0].name, 'Retainer March 2026'); // token expansion
  assert.equal(run.generated[1].items[0].name, 'Retainer April 2026');
  assert.equal(run.generated[1].status, 'Sent'); // mode: issue
  assert.equal(run.generated[1].due_date, '2026-04-29'); // +14 days
});

test('idempotent: re-running, a crashed advance, and two tabs never duplicate an occurrence', () => {
  const { schedule } = monthlyFrom('2026-03-15');
  runDueSchedules('2026-04-20');
  const count = () => localDb.invoices.getAll().length;
  assert.equal(count(), 3); // source + 2 generated

  // 1. plain re-run
  assert.equal(runDueSchedules('2026-04-20').generated.length, 0);
  assert.equal(count(), 3);

  // 2. crash between "save invoice" and "advance schedule": the schedule is rolled back to before the runs
  const rolledBack: RecurringSchedule = { ...recurringDb.getById(schedule.id)!, next_run: '2026-03-15', run_count: 0, history: [] };
  recurringDb.save(rolledBack);
  const again = runDueSchedules('2026-04-20');
  assert.equal(again.generated.length, 0, 'the stamped invoices are found, nothing new is created');
  assert.equal(count(), 3);
  assert.equal(recurringDb.getById(schedule.id)!.next_run, '2026-05-15', 'but the schedule advances again');

  // 3. two tabs: the second call for the same occurrence is a no-op that returns the same invoice
  const a = generateInvoiceFromSchedule(recurringDb.getById(schedule.id)!, '2026-05-15');
  const b = generateInvoiceFromSchedule(recurringDb.getById(schedule.id)!, '2026-05-15');
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.invoice.id, b.invoice.id);
  assert.equal(count(), 4);
});

test('numbering is by the invoice date\'s FY in every time zone (31 Mar vs 1 Apr occurrences)', () => {
  inTimeZones(ZONES, (tz) => {
    resetStorage();
    installSettings();
    const { schedule } = monthlyFrom('2026-03-31', { frequency: 'custom-days', interval: 1 });
    const run = runDueSchedules('2026-04-01');
    assert.deepEqual(
      run.generated.map((g) => [g.recurring_date, g.invoice_number]),
      [
        ['2026-03-31', 'INV/FY25-26/0002'],
        ['2026-04-01', 'INV/FY26-27/0001'],
      ],
      tz,
    );
    assert.equal(recurringDb.getById(schedule.id)!.next_run, '2026-04-02', tz);
  });
});

test('REGRESSION: a recurring export-under-LUT / TDS invoice keeps its tax setup on every run', () => {
  const source = createViaStore({
    date: '2026-04-01',
    client: clientUS,
    pos: '99',
    supply: 'EXPORT_LUT',
    tds: { rate: 10 },
    lines: [{ qty: 1, rate: 100000, tax: 18 }],
  });
  assert.equal(source.tax_amount, 0);
  const s = createSchedule({
    name: 'Export retainer',
    template: templateFromInvoice(reload(source.id)),
    frequency: 'monthly',
    start_date: '2026-05-01',
    mode: 'issue',
  });
  recurringDb.save(s);
  const gen = runDueSchedules('2026-06-01').generated;
  assert.equal(gen.length, 2);
  for (const g of gen) {
    assert.equal(g.supply_type, 'EXPORT_LUT');
    assert.equal(g.tax_amount, 0, 'a zero-rated supply must not start charging IGST');
    assert.equal(g.total, 100000);
    assert.equal(g.tds_enabled, true);
    assert.equal(g.tds_amount, 10000); // 10% of taxable
    assert.equal(g.balance_due, 90000);
  }
});

test('REGRESSION: catching up a daily schedule that started years ago is fast (was quadratic) and capped', () => {
  const { schedule } = monthlyFrom('2018-01-01', { frequency: 'custom-days', interval: 1 });
  const t0 = performance.now();
  const due = dueRunsDetailed(schedule, '2026-04-20');
  const ms = performance.now() - t0;
  assert.equal(due.dates.length, 12, 'cap of 12 most recent occurrences');
  assert.equal(due.dates.at(-1), '2026-04-20');
  assert.ok(due.skipped > 3000);
  assert.ok(ms < 1500, `took ${ms.toFixed(0)}ms`);
  // and the closed-form helpers agree with brute force
  assert.equal(nextOccurrence(schedule, '2026-04-20'), '2026-04-21');
  assert.equal(occurrenceDate(schedule, 3000), addDaysBrute('2018-01-01', 3000));
});

function addDaysBrute(day: string, n: number): string {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

test('month arithmetic: month-end clamping keeps the anchor day, leap years behave', () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((n) => addMonths('2026-01-31', n, 31)),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'],
  );
  const yearly = { frequency: 'yearly' as const, interval: 1, start_date: '2024-02-29' };
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((n) => occurrenceDate(yearly, n)),
    ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'],
  );
  // an indexHint-accelerated scan must not skip an occurrence
  const monthly31 = { frequency: 'monthly' as const, interval: 1, start_date: '2026-01-31' };
  assert.equal(nextOccurrence(monthly31, '2026-02-28'), '2026-03-31');
  assert.equal(nextOccurrence(monthly31, '2026-03-30'), '2026-03-31');
  assert.equal(nextOccurrence(monthly31, '2025-12-01'), '2026-01-31');
});
