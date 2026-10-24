import { resetStorage } from './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  complianceCalendar,
  daysBetween,
  filedFor,
  loadFiled,
  pendingReturns,
  qrmp3bDay,
  returnStatus,
  returnsForMonth,
  saveFiled,
  setFiled,
  type ReturnDue,
} from '../src/lib/compliance.ts';
import { estimateFor, gstInterest, gstr9LateFee, lateDays, returnLateFee } from '../src/lib/gst-penalties.ts';
import { localDb } from '../src/lib/localDb.ts';
import { readRaw } from '../src/lib/storage.ts';

const byForm = (list: ReturnDue[]) => Object.fromEntries(list.map((r) => [r.form, r]));

/* ── due dates ── */

test('monthly filer: GSTR-1 on the 11th, GSTR-3B on the 20th of the next month', () => {
  const r = byForm(returnsForMonth(2025, 4, 'monthly'));
  assert.deepEqual(Object.keys(r).sort(), ['GSTR1', 'GSTR3B']);
  assert.equal(r.GSTR1.due, '2025-05-11');
  assert.equal(r.GSTR3B.due, '2025-05-20');
  assert.deepEqual([r.GSTR1.periodKey, r.GSTR1.label, r.GSTR1.from, r.GSTR1.to], ['2025-04', 'April 2025', '2025-04-01', '2025-04-30']);
  assert.equal(r.GSTR1.id, 'GSTR1:2025-04');
});

test('monthly filer: December rolls into January of the next year', () => {
  const r = byForm(returnsForMonth(2025, 12, 'monthly'));
  assert.equal(r.GSTR1.due, '2026-01-11');
  assert.equal(r.GSTR3B.due, '2026-01-20');
});

test('March adds GSTR-9 for the FY, due 31 December after the FY ends', () => {
  const r = byForm(returnsForMonth(2026, 3, 'monthly'));
  assert.equal(r.GSTR1.due, '2026-04-11');
  assert.equal(r.GSTR3B.due, '2026-04-20');
  assert.deepEqual([r.GSTR9.periodKey, r.GSTR9.label, r.GSTR9.from, r.GSTR9.to, r.GSTR9.due], ['FY2025', 'FY 25-26', '2025-04-01', '2026-03-31', '2026-12-31']);
  assert.equal(r.GSTR9.optional, false);
});

test('before 1 Jan 2021: GSTR-1 on the 10th and no QRMP even when asked for', () => {
  const r = byForm(returnsForMonth(2020, 11, 'qrmp'));
  assert.equal(r.GSTR1.due, '2020-12-10');
  assert.equal(r.GSTR3B.due, '2020-12-20');
  assert.equal(r.IFF, undefined);
});

test('QRMP: months 1 and 2 have optional IFF (13th) and PMT-06 (25th) only', () => {
  const r = byForm(returnsForMonth(2025, 4, 'qrmp', '27'));
  assert.deepEqual(Object.keys(r).sort(), ['IFF', 'PMT06']);
  assert.equal(r.IFF.due, '2025-05-13');
  assert.equal(r.PMT06.due, '2025-05-25');
  assert.ok(r.IFF.optional && r.PMT06.optional);
});

test('QRMP: quarter-end GSTR-1 on the 13th; GSTR-3B 22nd (category X) or 24th (category Y)', () => {
  const mh = byForm(returnsForMonth(2025, 6, 'qrmp', '27'));
  assert.deepEqual([mh.GSTR1.periodKey, mh.GSTR1.label, mh.GSTR1.from, mh.GSTR1.to], ['2025-Q1', 'Q1 FY 25-26 (Apr-Jun)', '2025-04-01', '2025-06-30']);
  assert.equal(mh.GSTR1.due, '2025-07-13');
  assert.equal(mh.GSTR3B.due, '2025-07-22');
  const dl = byForm(returnsForMonth(2025, 6, 'qrmp', '07'));
  assert.equal(dl.GSTR3B.due, '2025-07-24');
  assert.equal(qrmp3bDay('7', '2025-04-01'), 24); // unpadded code
  assert.equal(qrmp3bDay('', '2025-04-01'), 22); // unknown state: the earlier day
  assert.equal(qrmp3bDay('38', '2025-04-01'), 24); // Ladakh
  assert.equal(qrmp3bDay('37', '2025-04-01'), 22); // Andhra Pradesh
});

test('QRMP: Q3 rolls into January; Q4 (Jan-Mar) also brings GSTR-9', () => {
  const q3 = byForm(returnsForMonth(2025, 12, 'qrmp', '07'));
  assert.equal(q3.GSTR1.periodKey, '2025-Q3');
  assert.equal(q3.GSTR1.due, '2026-01-13');
  assert.equal(q3.GSTR3B.due, '2026-01-24');
  const q4 = byForm(returnsForMonth(2026, 3, 'qrmp', '27'));
  assert.deepEqual([q4.GSTR1.periodKey, q4.GSTR1.label, q4.GSTR1.from], ['2025-Q4', 'Q4 FY 25-26 (Jan-Mar)', '2026-01-01']);
  assert.equal(q4.GSTR1.due, '2026-04-13');
  assert.equal(q4.GSTR3B.due, '2026-04-22');
  assert.equal(q4.GSTR9.due, '2026-12-31');
});

test('complianceCalendar: from the first activity month (max 12 months back), sorted by due date', () => {
  const list = complianceCalendar({ frequency: 'monthly', today: '2026-06-15', since: '2026-04-20' });
  assert.deepEqual(list.map((r) => r.id), [
    'GSTR1:2026-04', 'GSTR3B:2026-04', 'GSTR1:2026-05', 'GSTR3B:2026-05', 'GSTR1:2026-06', 'GSTR3B:2026-06',
  ]);
  const year = complianceCalendar({ frequency: 'monthly', today: '2026-06-15', since: '2020-01-01' });
  assert.equal(year[0].periodKey, '2025-06'); // 12 months back
  assert.ok(year.some((r) => r.id === 'GSTR9:FY2025'));
  const short = complianceCalendar({ frequency: 'monthly', today: '2026-06-15', monthsBack: 1 });
  assert.equal(short.length, 4);
});

/* ── status ── */

test('returnStatus: overdue, due soon (0-3 days), upcoming, filed; optional never overdue', () => {
  const [g1] = returnsForMonth(2026, 5, 'monthly'); // GSTR-1 due 2026-06-11
  assert.equal(returnStatus(g1, '2026-06-12'), 'overdue');
  assert.equal(returnStatus(g1, '2026-06-11'), 'due-soon');
  assert.equal(returnStatus(g1, '2026-06-08'), 'due-soon');
  assert.equal(returnStatus(g1, '2026-06-07'), 'upcoming');
  const filed = { id: 'x', form: g1.form, period_key: g1.periodKey, gstin: '', filed_on: '2026-06-10', marked_at: '' };
  assert.equal(returnStatus(g1, '2026-07-01', filed), 'filed');
  const [iff] = returnsForMonth(2026, 4, 'qrmp');
  assert.equal(returnStatus(iff, '2026-07-01'), 'upcoming');
});

test('filed marks: per GSTIN, blank GSTIN matches any; clearing removes the mark', () => {
  const [g1] = returnsForMonth(2026, 5, 'monthly');
  let rows = setFiled([], g1, '27aaaaa0000a1z5', '2026-06-10', new Date(2026, 5, 10));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gstin, '27AAAAA0000A1Z5');
  assert.equal(rows[0].filed_on, '2026-06-10');
  assert.ok(filedFor(rows, g1, '27AAAAA0000A1Z5'));
  assert.ok(filedFor(rows, g1, '')); // "all profiles" view sees it
  assert.equal(filedFor(rows, g1, '07BBBBB1111B1Z5'), undefined);
  rows = setFiled(rows, g1, '27AAAAA0000A1Z5', '2026-06-12');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].filed_on, '2026-06-12');
  assert.deepEqual(setFiled(rows, g1, '27AAAAA0000A1Z5', null), []);
});

test('filed marks persist in mrchartist_inv_compliance; frequency persists in settings', () => {
  resetStorage();
  const [g1] = returnsForMonth(2026, 5, 'monthly');
  saveFiled(setFiled([], g1, '', '2026-06-10'));
  assert.ok(readRaw('mrchartist_inv_compliance'));
  assert.equal(loadFiled()[0].period_key, '2026-05');
  assert.equal(localDb.settings.get().gst_filing_frequency, undefined);
  localDb.settings.save({ ...localDb.settings.get(), gst_filing_frequency: 'qrmp' });
  assert.equal(localDb.settings.get().gst_filing_frequency, 'qrmp');
  localDb.settings.save({ ...localDb.settings.get(), gst_filing_frequency: 'bogus' as never });
  assert.equal(localDb.settings.get().gst_filing_frequency, undefined);
  resetStorage();
});

test('pendingReturns: overdue and due-soon, skipping filed and optional returns', () => {
  const o = { frequency: 'monthly' as const, today: '2026-06-17', since: '2026-04-05' };
  const p = pendingReturns(o, []);
  assert.deepEqual(p.overdue.map((r) => r.id), ['GSTR1:2026-04', 'GSTR3B:2026-04', 'GSTR1:2026-05']);
  assert.deepEqual(p.soon.map((r) => r.id), ['GSTR3B:2026-05']);
  let filed = setFiled([], returnsForMonth(2026, 4, 'monthly')[0], '', '2026-05-11');
  filed = setFiled(filed, returnsForMonth(2026, 4, 'monthly')[1], '', '2026-05-20');
  assert.deepEqual(pendingReturns(o, filed).overdue.map((r) => r.id), ['GSTR1:2026-05']);
  const q = pendingReturns({ ...o, frequency: 'qrmp', stateCode: '27' }, []);
  assert.equal(q.overdue.length + q.soon.length, 0); // only optional IFF / PMT-06 so far in Q1
});

/* ── late fee and interest ── */

test('daysBetween / lateDays count calendar days (FY and leap-year boundaries)', () => {
  assert.equal(daysBetween('2026-03-31', '2026-04-01'), 1);
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
  assert.equal(lateDays('2026-05-20', '2026-05-20'), 0);
  assert.equal(lateDays('2026-05-20', '2026-05-21'), 1);
  assert.equal(lateDays('2026-05-20', '2026-05-01'), 0);
});

test('late fee (from June 2021 periods): ₹50/day, ₹20/day nil, capped by last-FY turnover', () => {
  const base = { due: '2025-05-20', periodStart: '2025-04-01' };
  assert.equal(returnLateFee({ ...base, filedOn: '2025-05-20' }), 0);
  assert.equal(returnLateFee({ ...base, filedOn: '2025-05-30' }), 500);
  assert.equal(returnLateFee({ ...base, filedOn: '2025-05-30', nil: true }), 200);
  const late100 = '2025-08-28'; // 100 days
  assert.equal(returnLateFee({ ...base, filedOn: late100, turnover: 1e7 }), 2000);
  assert.equal(returnLateFee({ ...base, filedOn: late100 }), 2000); // no turnover: lowest slab
  assert.equal(returnLateFee({ ...base, filedOn: late100, turnover: 1.5e7 }), 2000);
  assert.equal(returnLateFee({ ...base, filedOn: late100, turnover: 3e7 }), 5000);
  assert.equal(returnLateFee({ ...base, filedOn: '2026-03-16', turnover: 6e7 }), 10000); // 300 days
  assert.equal(returnLateFee({ ...base, filedOn: late100, nil: true }), 500);
});

test('late fee (periods before June 2021): statutory ₹10,000 cap whatever the turnover', () => {
  const base = { due: '2021-06-20', periodStart: '2021-05-01' };
  assert.equal(returnLateFee({ ...base, filedOn: '2022-04-16', turnover: 1e7 }), 10000); // 300 days
  assert.equal(returnLateFee({ ...base, filedOn: '2022-04-16', nil: true }), 6000);
});

test('interest u/s 50(1): 18% p.a. simple, per day, on net cash tax', () => {
  assert.equal(gstInterest(100000, '2025-05-20', '2025-06-19'), 1479.45); // 30 days
  assert.equal(gstInterest(100000, '2025-05-20', '2025-05-20'), 0);
  assert.equal(gstInterest(-5, '2025-05-20', '2025-06-19'), 0);
  assert.equal(gstInterest(36500, '2026-03-20', '2026-04-20'), 558); // 31 days across the FY end
});

test('GSTR-9 late fee: Notification 7/2023 tiers from FY 22-23, % cap on turnover', () => {
  assert.equal(gstr9LateFee('2024-12-31', '2025-01-10', 2023, 3e7), 500); // 10 days x ₹50
  assert.equal(gstr9LateFee('2024-12-31', '2026-02-04', 2023, 3e7), 12000); // capped at 0.04%
  assert.equal(gstr9LateFee('2024-12-31', '2025-01-10', 2023, 1e8), 1000); // ₹100/day tier
  assert.equal(gstr9LateFee('2024-12-31', '2025-01-10', 2023, 3e8), 2000); // ₹200/day tier
  assert.equal(gstr9LateFee('2022-12-31', '2023-01-10', 2021, 3e7), 2000); // old rule ₹200/day
  assert.equal(gstr9LateFee('2024-12-31', '2025-01-10', 2023), 500); // no turnover: uncapped
  assert.equal(gstr9LateFee('2024-12-31', '2024-12-31', 2023, 3e7), 0);
});

test('estimateFor: 3B gets late fee + interest, GSTR-1 late fee only, optional nothing', () => {
  const m = byForm(returnsForMonth(2025, 4, 'monthly'));
  assert.deepEqual(estimateFor(m.GSTR3B, { filedOn: '2025-05-30', cashTax: 36500 }), { days: 10, lateFee: 500, interest: 180 });
  assert.deepEqual(estimateFor(m.GSTR1, { filedOn: '2025-05-21', cashTax: 36500 }), { days: 10, lateFee: 500, interest: 0 });
  assert.deepEqual(estimateFor(m.GSTR1, { filedOn: '2025-05-11' }), { days: 0, lateFee: 0, interest: 0 });
  const q = byForm(returnsForMonth(2025, 4, 'qrmp'));
  assert.deepEqual(estimateFor(q.IFF, { filedOn: '2025-12-31' }), { days: 0, lateFee: 0, interest: 0 });
  const y = byForm(returnsForMonth(2026, 3, 'monthly'));
  assert.deepEqual(estimateFor(y.GSTR9, { filedOn: '2027-01-10', turnover: 3e7 }), { days: 10, lateFee: 500, interest: 0 });
});
