/** R7-C1 hotel GST desk: band rows at their boundaries and rate-change dates, inclusive solve, specified premises,
 * declarations window, restaurant rate, band report → common-credit input, guards, HSN 9963. Working papers. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { Reservation } from '../src/types/hotel-r7.ts';
import { accommodationBand, bandForInclusive, fyOfDay, hotelGuards, restaurantRate } from '../src/lib/hotel/hotel-gst.ts';
import { addDecl, declError, premisesNow, premisesStatus, prevFyMax } from '../src/lib/hotel/premises.ts';
import { bandReport, exemptLike, hsn9963 } from '../src/lib/hotel/band-report.ts';
import { hotelDb } from '../src/lib/hotel/hotel-store.ts';
import { setupHotel } from './helpers/hotel.ts';

const band = (v: number, d: string) => { const b = accommodationBand(v, d); return `${b.rate}${b.exempt ? 'E' : ''}${b.itc ? '+' : '-'}${b.band[0]}`; };

test('ACCOMMODATION_RATE_RULES: every row at its boundaries', () => {
  // 1 Jul 2017, declared tariff
  assert.deepEqual([999.99, 1000, 2499.99, 2500, 7499.99, 7500].map((v) => band(v, '2018-01-10')), ['0E-l', '12+l', '12+l', '18+l', '18+l', '28+h']);
  // 1 Oct 2019: ≤ 1000 exempt, ≤ 7500 12%, above 18%
  assert.deepEqual([999.99, 1000, 1000.01, 7500, 7500.01].map((v) => band(v, '2020-06-01')), ['0E-l', '0E-l', '12+l', '12+l', '18+h']);
  // 18 Jul 2022: exemption withdrawn
  assert.deepEqual([999.99, 1000, 1000.01, 7500, 7500.01].map((v) => band(v, '2023-06-01')), ['12+l', '12+l', '12+l', '12+l', '18+h']);
  // 22 Sep 2025: ≤ ₹7,500 → 5% without ITC (D1: exactly ₹7,500 is low)
  assert.deepEqual([999.99, 1000, 1000.01, 7500, 7500.01].map((v) => band(v, '2025-09-22')), ['5-l', '5-l', '5-l', '5-l', '18+h']);
});

test('rate-change dates: the row in force on the day', () => {
  assert.equal(band(3000, '2019-09-30'), '18+l', 'still the 2017 declared-tariff bands');
  assert.equal(band(3000, '2019-10-01'), '12+l');
  assert.equal(band(800, '2022-07-17'), '0E-l');
  assert.equal(band(800, '2022-07-18'), '12+l');
  assert.equal(band(3000, '2025-09-21'), '12+l');
  assert.equal(band(3000, '2025-09-22'), '5-l');
  assert.equal(band(7500.01, '2025-09-21'), '18+h');
});

test('bandForInclusive round-trips and flags the gap', () => {
  for (const v of [3000, 7500, 7500.01, 8000]) {
    const g = Math.round(v * (1 + accommodationBand(v, '2026-01-10').rate / 100) * 100) / 100;
    const r = bandForInclusive(g, '2026-01-10');
    assert.equal(r.value, v, `gross ${g}`);
    assert.equal(r.gap, undefined);
  }
  const gap = bandForInclusive(8000, '2026-01-10');
  assert.equal(gap.gap, true);
  assert.equal(gap.rate, 18);
});

test('specified premises: previous-FY value, opt-in window, opt-out cannot undo clause (a)', () => {
  const at = (value: number) => ({ value, source: 'typed' as const });
  assert.equal(premisesStatus(2026, { prev: at(7500.01), decls: [] }).specified, true);
  assert.equal(premisesStatus(2026, { prev: at(7500.01), decls: [] }).basis, 'previous_fy_value');
  assert.equal(premisesStatus(2026, { prev: at(7500), decls: [] }).specified, false, '₹7,500.00 is not above ₹7,500');
  const optIn = { fy: '2026-27', kind: 'opt_in' as const, filed_on: '2026-02-10', ref: 'ARN-1' };
  assert.equal(declError(optIn), '');
  assert.deepEqual(premisesStatus(2026, { prev: at(5000), decls: [optIn] }).basis, 'opt_in');
  assert.equal(premisesStatus(2027, { prev: at(5000), decls: [optIn] }).specified, true, 'a declaration continues until changed');
  assert.equal(premisesStatus(2025, { prev: null, decls: [optIn] }).specified, false, 'not before its FY');
  assert.match(declError({ ...optIn, filed_on: '2026-04-05' }), /2026-01-01 – 2026-03-31/);
  assert.match(declError({ ...optIn, filed_on: '2025-12-31' }), /window/);
  const optOut = { fy: '2027-28', kind: 'opt_out' as const, filed_on: '2027-03-01' };
  assert.equal(premisesStatus(2027, { prev: at(5000), decls: [optIn, optOut] }).specified, false, 'opt-out cancels the opt-in');
  const law = premisesStatus(2027, { prev: at(9000), decls: [optIn, optOut] });
  assert.equal(law.specified, true);
  assert.equal(law.optOutIgnored, true, 'clause (a) wins over the opt-out (D4)');
  // Annexure VIII: within 15 days of the ARN
  const nr = { fy: '2026-27', kind: 'new_reg_opt_in' as const, filed_on: '2026-06-15', arn_on: '2026-06-01' };
  assert.equal(declError(nr), '');
  assert.match(declError({ ...nr, filed_on: '2026-06-17' }), /window/);
  assert.equal(premisesStatus(2026, { prev: null, decls: [nr] }).basis, 'new_reg_opt_in');
  // Per premises (D18)
  assert.equal(premisesStatus(2026, { prev: null, decls: [{ ...optIn, property_id: 'branch' }] }).specified, false);
  assert.equal(premisesStatus(2026, { prev: null, decls: [{ ...optIn, property_id: 'branch' }], propertyId: 'branch' }).specified, true);
  // Before 1 Apr 2025: declared-tariff test, no declarations
  assert.equal(premisesStatus(2024, { prev: at(9000), decls: [] }).rule, false);
  assert.match(declError({ fy: '2024-25', kind: 'opt_in', filed_on: '2024-02-01' }), /No declarations/);
});

test('previous-FY value from stays (night snapshots, meals priced separately left out) and the typed figure', () => {
  const res = {
    id: 'r1', number: 'RES/1', property_id: undefined, lines: [
      { id: 'l1', room_type_id: 'dlx', room_id: 'r101', rate_plan_id: 'ep', status: 'checked_out', nightly: [{ night: '2025-11-14', total: 8200, meal: 0 }, { night: '2026-04-02', total: 9000, meal: 0 }] },
      { id: 'l2', room_type_id: 'dlx', room_id: 'r102', rate_plan_id: 'map', status: 'checked_out', nightly: [{ night: '2025-12-01', total: 9500, meal: 2000 }] },
      { id: 'l3', room_type_id: 'dlx', room_id: 'r102', rate_plan_id: 'ep', status: 'cancelled', nightly: [{ night: '2025-12-01', total: 20000, meal: 0 }] },
      { id: 'l4', room_type_id: 'dlx', room_id: 'r102', rate_plan_id: 'ep', status: 'checked_out', comp: 'complimentary', nightly: [{ night: '2025-12-02', total: 20000, meal: 0 }] },
    ],
  } as unknown as Reservation;
  const rooms = [{ id: 'r101', number: '301', room_type_id: 'dlx', active: true }, { id: 'r102', number: '302', room_type_id: 'dlx', active: true }];
  const plans = [{ id: 'map', meals_separate: true }] as never;
  const m = prevFyMax(2026, { reservations: [res], rooms, plans });
  assert.deepEqual(m, { value: 8200, room: '301', night: '2025-11-14', source: 'stays' });
  assert.equal(prevFyMax(2026, { reservations: [res], rooms, plans, typed: { '2025-26': 8300 } })?.source, 'typed');
  assert.equal(prevFyMax(2026, { reservations: [res], rooms, plans, propertyId: 'branch' }), null, 'other premises');
});

test('premisesNow reads the store; a declaration outside the window is refused; settings keep the un-audited business date', () => {
  setupHotel('2026-10-20');
  assert.equal(premisesNow(2026).specified, false);
  assert.throws(() => addDecl({ fy: '2027-28', kind: 'opt_in', filed_on: '2026-10-20' }), /window/);
  addDecl({ fy: '2027-28', kind: 'opt_in', filed_on: '2027-01-15' });
  assert.equal(premisesNow(2027).specified, true);
  assert.equal(hotelDb.settings().premises.length, 1);
  assert.equal(hotelDb.settings().business_date, '2026-10-20');
});

test('restaurantRate by status and date (F5)', () => {
  assert.deepEqual(restaurantRate({ specified: true }, '2026-05-01'), { rate: 18, itc: true });
  assert.deepEqual(restaurantRate({ specified: false }, '2026-05-01'), { rate: 5, itc: false });
  assert.deepEqual(restaurantRate({ specified: false }, '2018-01-01'), { rate: 5, itc: false });
});

const inv = (id: string, date: string, items: [string, number, number, number][], over: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id, invoice_number: id, doc_type: 'INVOICE', status: 'Sent', issue_date: date, gst_mode: 'CGST_SGST', place_of_supply: '27',
  items: items.map(([hsn, quantity, rate, tax_rate], i) => ({ id: `${id}-${i}`, name: hsn, type: 'Service', hsn, quantity, rate, tax_rate, amount: quantity * rate })),
  ...over,
} as unknown as InvoiceRecord);

test('band report and the common-credit input (D12): no-ITC rooms and F&B are exempt-like; credit notes net off', () => {
  const docs = [
    inv('A', '2026-05-10', [['996311', 2, 3000, 5], ['996331', 1, 1000, 5]]),
    inv('B', '2026-05-12', [['996311', 1, 8000, 18], ['996311', 1, 1000, 18]]),
    inv('C', '2026-06-01', [['996311', 1, 3000, 5]], { doc_type: 'CREDIT_NOTE' } as never),
    inv('D', '2026-06-02', [['996311', 1, 3000, 5]], { status: 'Draft' } as never),
    inv('E', '2026-06-03', [['998599', 1, 500, 18]]),
  ];
  const rows = bandReport(docs, '2026-04-01', '2027-03-31');
  assert.deepEqual(rows.map((r) => [r.month, r.low.nights, r.low.value, r.high.nights, r.high.value, r.fnb, r.noItc, r.withItc]), [
    ['2026-05', 2, 6000, 2, 9000, 1000, 7000, 9000],
    ['2026-06', -1, -3000, 0, 0, 0, -3000, 0],
  ]);
  assert.equal(exemptLike(docs, '2026-04-01', '2027-03-31'), 4000);
  assert.equal(exemptLike(docs, '2026-05-01', '2026-05-31'), 7000);
  // Before 22 Sep 2025 the 12% band carried ITC: nothing is exempt-like.
  assert.equal(exemptLike([inv('F', '2025-08-01', [['996311', 1, 3000, 12]])], '2025-04-01', '2026-03-31'), 0);
  assert.deepEqual(hsn9963(docs, '2026-04-01', '2027-03-31'), [
    { hsn: '996311', rate: 5, qty: 1, taxable: 3000, tax: 150 },
    { hsn: '996311', rate: 18, qty: 2, taxable: 9000, tax: 1620 },
    { hsn: '996331', rate: 5, qty: 1, taxable: 1000, tax: 50 },
  ]);
});

test('guards: wrong band, extra bed riding with its room, F&B rate, IGST, ITC on an all-5% period', () => {
  const docs = [
    inv('OK', '2026-05-10', [['996311', 1, 8000, 18], ['996311', 1, 1000, 18]]),
    inv('LOW', '2026-05-11', [['996311', 1, 8000, 5]]),
    inv('HIGH', '2026-05-12', [['996311', 2, 3000, 18]]),
    inv('FNB', '2026-05-13', [['996331', 1, 1000, 18]]),
    inv('IG', '2026-05-14', [['996311', 1, 3000, 5]], { gst_mode: 'IGST' }),
  ];
  const g = hotelGuards(docs, [], () => false, '2026-04-01', '2027-03-31');
  assert.deepEqual(g.map((x) => `${x.kind}:${x.number}:${x.got ?? ''}>${x.expect ?? ''}`), ['band:LOW:5>18', 'band:HIGH:18>5', 'fnb:FNB:18>5', 'igst:IG:>']);
  assert.equal(hotelGuards([docs[3]], [], () => true, '2026-04-01', '2027-03-31').length, 0, 'specified premises: F&B 18% is right');
  const bill = { id: 'p1', kind: 'PURCHASE', date: '2026-05-20', taxable: 1000, cgst: 90, sgst: 90, igst: 0, total: 1180, itc_eligible: true };
  const low = [inv('L1', '2026-05-10', [['996311', 2, 3000, 5]])];
  assert.deepEqual(hotelGuards(low, [bill], () => false, '2026-04-01', '2027-03-31').map((x) => [x.kind, x.amount]), [['itc', 180]]);
  assert.equal(hotelGuards(low, [{ ...bill, itc_eligible: false }], () => false, '2026-04-01', '2027-03-31').length, 0);
  assert.equal(hotelGuards([...low, docs[0]], [bill], () => false, '2026-04-01', '2027-03-31').length, 0, 'an 18% room-night keeps common ITC');
  assert.equal(fyOfDay('2027-03-31'), 2026);
  assert.equal(fyOfDay('2027-04-01'), 2027);
});

test('GST → Hotel: with the pack off the tab reads no hotel table (static: the pack check comes before every read)', async () => {
  const { readFileSync } = await import('node:fs');
  const tab = readFileSync(new URL('../src/components/hotel/HotelGstTab.tsx', import.meta.url), 'utf8');
  const body = tab.slice(tab.indexOf('const d = useMemo('));
  assert.match(body, /^const d = useMemo\(\(\) => \{\n\s+if \(!on\) return null;/, 'first statement: the pack gate');
  assert.match(tab, /const on = isPackOn\(localDb\.settings\.get\(\), 'hotel'\);/);
  assert.match(tab, /if \(!d\) return <p[^>]*data-hotel-gst-off/);
  const gst = readFileSync(new URL('../src/pages/GstReports.tsx', import.meta.url), 'utf8');
  assert.match(gst, /lazy\(\(\) => import\('\.\.\/components\/hotel\/hotel-lazy'\)/, 'the tab is a lazy chunk');
  assert.ok(!/^import [^;]*hotel/m.test(gst.replace(/^import type [^;]*;/gm, '')), 'no static hotel import in GstReports.tsx');
});
