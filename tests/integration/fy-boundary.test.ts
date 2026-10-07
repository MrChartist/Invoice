/**
 * Financial-year boundary: documents dated 31 March / 1 April number into the
 * right FY series, every report's FY filter agrees, and no helper ever shifts a
 * bare `YYYY-MM-DD` by a day in ANY time zone. Each assertion runs in zones on
 * both sides of UTC (and Kathmandu's +05:45 / Honolulu's -10 for good measure).
 */
import '../helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, inTimeZones, ZONES } from '../helpers/shim.ts';
import { createViaStore, installSettings, SELLER_GSTIN } from '../helpers/world.ts';
import { localDb, getIndianFY } from '../../src/lib/localDb.ts';
import { addDaysInput, daysOverdue, formatDate, toDateInput } from '../../src/lib/utils.ts';
import { isInFY } from '../../src/lib/invoice-number.ts';
import { agingBucket, effectiveStatus } from '../../src/lib/invoice-status.ts';
import { dateKey, buildReceivables } from '../../src/lib/receivables.ts';
import { fyPeriod, fyStartYearOf, inPeriod, periodForPreset, profitAndLoss, toIsoDate, loadBooksData } from '../../src/lib/books.ts';
import { buildGstReport, periodForDate, periodRange, inPeriod as gstInPeriod } from '../../src/lib/gst-reports.ts';
import { filterInvoices, fyRange, isoDate } from '../../src/lib/export-shared.ts';
import { parseDay, isoDay, shiftDay } from '../../src/lib/dates.ts';
import { dayDiff } from '../../src/lib/notifications.ts';
import { daysUntil } from '../../src/lib/reminders.ts';

test('numbering: 31 March continues FY25-26, 1 April restarts FY26-27 at 0001 (any zone)', () => {
  inTimeZones(ZONES, (tz) => {
    resetStorage();
    installSettings();
    const a = createViaStore({ date: '2026-03-30', lines: [{ qty: 1, rate: 1000 }] });
    const b = createViaStore({ date: '2026-03-31', lines: [{ qty: 1, rate: 1000 }] });
    const c = createViaStore({ date: '2026-04-01', lines: [{ qty: 1, rate: 1000 }] });
    const d = createViaStore({ date: '2026-04-02', lines: [{ qty: 1, rate: 1000 }] });
    assert.deepEqual(
      [a, b, c, d].map((x) => x.invoice_number),
      ['INV/FY25-26/0001', 'INV/FY25-26/0002', 'INV/FY26-27/0001', 'INV/FY26-27/0002'],
      tz,
    );
    // the next number for an arbitrary date comes from that date's series
    assert.equal(localDb.invoices.nextNumber('2026-03-31'), 'INV/FY25-26/0003', tz);
    assert.equal(localDb.invoices.nextNumber('2026-04-01'), 'INV/FY26-27/0003', tz);
    assert.equal(localDb.invoices.nextNumber('2027-03-31'), 'INV/FY26-27/0003', tz);
    assert.equal(localDb.invoices.nextNumber('2027-04-01'), 'INV/FY27-28/0001', tz);
    assert.equal(getIndianFY('2027-04-01').label, '27-28', tz);
    assert.ok(isInFY('2026-04-01', '26-27') && !isInFY('2026-03-31', '26-27'), tz);
  });
});

test('every FY filter puts 31 March in the old year and 1 April in the new one (any zone)', () => {
  inTimeZones(ZONES, (tz) => {
    resetStorage();
    installSettings();
    const mar = createViaStore({ date: '2026-03-31', lines: [{ qty: 1, rate: 1000, tax: 18 }] }); // 1,180
    const apr = createViaStore({ date: '2026-04-01', lines: [{ qty: 1, rate: 2000, tax: 18 }] }); // 2,360
    const all = localDb.invoices.getAll();

    // exports
    assert.deepEqual(filterInvoices(all, fyRange(2025)).map((i) => i.id), [mar.id], tz);
    assert.deepEqual(filterInvoices(all, fyRange(2026)).map((i) => i.id), [apr.id], tz);
    // books
    const data = loadBooksData();
    assert.equal(profitAndLoss(data, fyPeriod(2025)).income, 1000, tz);
    assert.equal(profitAndLoss(data, fyPeriod(2026)).income, 2000, tz);
    assert.equal(fyStartYearOf('2026-03-31'), 2025);
    assert.equal(fyStartYearOf('2026-04-01'), 2026);
    assert.ok(inPeriod('2026-03-31', fyPeriod(2025)) && !inPeriod('2026-03-31', fyPeriod(2026)));
    // gst
    const g25 = buildGstReport(all, [], { period: { kind: 'fy', fyStart: 2025 }, gstin: SELLER_GSTIN });
    const g26 = buildGstReport(all, [], { period: { kind: 'fy', fyStart: 2026 }, gstin: SELLER_GSTIN });
    assert.equal(g25.gstr1.totals.taxable, 1000, tz);
    assert.equal(g26.gstr1.totals.taxable, 2000, tz);
    assert.deepEqual(periodForDate('quarter', '2026-03-31'), { kind: 'quarter', fyStart: 2025, quarter: 4 });
    assert.deepEqual(periodForDate('quarter', '2026-04-01'), { kind: 'quarter', fyStart: 2026, quarter: 1 });
    assert.deepEqual(periodRange({ kind: 'quarter', fyStart: 2025, quarter: 4 }), { from: '2026-01-01', to: '2026-03-31' });
    assert.ok(gstInPeriod('2026-03-31', { kind: 'month', fyStart: 2025, month: 3 }));
    assert.ok(!gstInPeriod('2026-04-01', { kind: 'month', fyStart: 2025, month: 3 }));
    // Q1 of FY26-27 only has the April invoice, Q4 of FY25-26 only the March one
    const q1 = buildGstReport(all, [], { period: { kind: 'quarter', fyStart: 2026, quarter: 1 }, gstin: SELLER_GSTIN });
    const q4 = buildGstReport(all, [], { period: { kind: 'quarter', fyStart: 2025, quarter: 4 }, gstin: SELLER_GSTIN });
    assert.deepEqual([q1.gstr1.totals.taxable, q4.gstr1.totals.taxable], [2000, 1000], tz);
  });
});

test('REGRESSION: date helpers treat a bare YYYY-MM-DD as that calendar day in every zone', () => {
  inTimeZones(ZONES, (tz) => {
    assert.equal(formatDate('2026-04-01'), '1 Apr 2026', `formatDate ${tz}`);
    assert.equal(formatDate('2026-03-31'), '31 Mar 2026', `formatDate ${tz}`);
    assert.equal(toDateInput('2026-04-01'), '2026-04-01', `toDateInput ${tz}`);
    assert.equal(addDaysInput(14, '2026-03-25'), '2026-04-08', `addDaysInput ${tz}`);
    assert.equal(addDaysInput(0, '2026-04-01'), '2026-04-01', `addDaysInput ${tz}`);
    // a due date is overdue only from the NEXT local day
    const dueAprFirst = '2026-04-01';
    assert.equal(daysOverdue(dueAprFirst, new Date(2026, 3, 1, 23, 59)), 0, `due today ${tz}`);
    assert.equal(daysOverdue(dueAprFirst, new Date(2026, 3, 2, 0, 1)), 1, `1 day late ${tz}`);
    assert.equal(daysOverdue(dueAprFirst, new Date(2026, 3, 11, 12, 0)), 10, `10 days late ${tz}`);
    assert.equal(agingBucket(dueAprFirst, new Date(2026, 4, 1, 9, 0)), '1–30 days', tz);
    assert.equal(
      effectiveStatus({ status: 'Sent', due_date: dueAprFirst, balance_due: 100, total: 100, amount_paid: 0 }, new Date(2026, 3, 1, 23, 0)),
      'Sent',
      `not overdue on its due day ${tz}`,
    );
    assert.equal(dayDiff(new Date(2026, 3, 1), parseDay(dueAprFirst)), 0, `notifications ${tz}`);
    assert.equal(daysUntil(dueAprFirst, new Date(2026, 3, 1, 15, 0)), 0, `reminders ${tz}`);
    assert.equal(daysUntil(dueAprFirst, new Date(2026, 2, 29, 15, 0)), 3, `reminders ${tz}`);
  });
});

test('REGRESSION: a DST change inside the window does not lose a day (23h/25h days)', () => {
  inTimeZones(['America/New_York', 'America/Los_Angeles', 'Pacific/Auckland', 'Europe/London', 'Europe/Berlin'], (tz) => {
    // US spring-forward is 8 Mar 2026; Auckland falls back on 5 Apr 2026.
    assert.equal(daysOverdue('2026-03-05', new Date(2026, 2, 12, 12, 0)), 7, `${tz} across spring-forward`);
    assert.equal(daysOverdue('2026-04-01', new Date(2026, 3, 8, 12, 0)), 7, `${tz} across fall-back`);
    assert.equal(daysOverdue('2026-03-25', new Date(2026, 3, 1, 12, 0)), 7, `${tz} across the EU spring-forward (29 Mar)`);
    assert.equal(addDaysInput(30, '2026-03-01'), '2026-03-31', tz);
    assert.equal(shiftDay('2026-03-07', 2), '2026-03-09', tz);
  });
});

test('REGRESSION: an instant stamped late on 31 March UTC is a 1 April day in India, 31 March in New York', () => {
  const instant = '2026-03-31T20:00:00.000Z';
  inTimeZones(['Asia/Kolkata'], () => {
    assert.equal(isoDay(instant), '2026-04-01');
    assert.equal(toIsoDate(instant), '2026-04-01', 'books');
    assert.equal(isoDate(instant), '2026-04-01', 'exports');
    assert.equal(dateKey(instant), '2026-04-01', 'receivables');
  });
  inTimeZones(['America/New_York'], () => {
    assert.equal(isoDay(instant), '2026-03-31');
    assert.equal(toIsoDate(instant), '2026-03-31');
    assert.equal(isoDate(instant), '2026-03-31');
    assert.equal(dateKey(instant), '2026-03-31');
  });
  // a bare day or a zone-less timestamp is never converted
  assert.equal(isoDay('2026-03-31'), '2026-03-31');
  assert.equal(isoDay('2026-03-31T23:59:00'), '2026-03-31');
});

test('receivables ledger places a payment on its local day around the FY edge', () => {
  inTimeZones(ZONES, (tz) => {
    resetStorage();
    installSettings();
    const inv = createViaStore({ date: '2026-03-31', lines: [{ qty: 1, rate: 1000, tax: 0 }] });
    localDb.payments.record({ invoiceId: inv.id, amount: 400, method: 'UPI', date: '2026-04-01' });
    const rec = buildReceivables({ invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll() }, { now: new Date(2026, 3, 30, 12) });
    const dates = rec.parties[0].entries.map((e) => [e.kind, e.date]);
    assert.deepEqual(dates, [['invoice', '2026-03-31'], ['payment', '2026-04-01']], tz);
  });
});

test('this-FY / quarter presets resolve from the LOCAL clock (1 April 00:30 local is already the new FY)', () => {
  inTimeZones(ZONES, (tz) => {
    const early = new Date(2026, 3, 1, 0, 30);
    assert.deepEqual(periodForPreset('this_fy', early), { start: '2026-04-01', end: '2027-03-31' }, tz);
    assert.deepEqual(periodForPreset('last_fy', early), { start: '2025-04-01', end: '2026-03-31' }, tz);
    assert.deepEqual(periodForPreset('this_quarter', early), { start: '2026-04-01', end: '2026-06-30' }, tz);
    const late = new Date(2026, 2, 31, 23, 30);
    assert.deepEqual(periodForPreset('this_fy', late), { start: '2025-04-01', end: '2026-03-31' }, tz);
    assert.deepEqual(periodForPreset('this_quarter', late), { start: '2026-01-01', end: '2026-03-31' }, tz);
  });
});
