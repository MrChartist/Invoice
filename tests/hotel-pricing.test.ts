/** R7-A2 / C1 rule rows: accommodation bands (₹7,500 boundary per date), tax-inclusive reverse solve, nightly pricing. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOMMODATION_RATE_RULES, FORM_C_HOURS_RULES, HOTEL_RESTAURANT_RATE_RULES, SPECIFIED_PREMISES_RULES, accommodationBand, bandForInclusive } from '../src/lib/hotel/hotel-rules.ts';
import { minStayError, priceNight, priceStay, stayTotal } from '../src/lib/hotel/pricing.ts';
import { saveReservation } from '../src/lib/hotel/reservations.ts';
import { hotelDb } from '../src/lib/hotel/hotel-store.ts';
import { DLX, EP, STE, booking, setupHotel } from './helpers/hotel.ts';
import type { RatePlan } from '../src/types/hotel-r7.ts';

const rate = (v: number, d: string) => accommodationBand(v, d).rate;

test('rule rows: append-only, dated ascending, every source ends in "verify"', () => {
  for (const rows of [ACCOMMODATION_RATE_RULES, HOTEL_RESTAURANT_RATE_RULES, SPECIFIED_PREMISES_RULES, FORM_C_HOURS_RULES] as unknown as (readonly { from: string; source?: string }[])[]) {
    assert.deepEqual([...rows].map((r) => r.from), [...rows].map((r) => r.from).sort());
    for (const r of rows) assert.match(r.source ?? '', /verify$/);
  }
});

test('22 Sep 2025 band: ₹7,500.00 is 5% without ITC (D1), ₹7,500.01 is 18% with ITC', () => {
  assert.deepEqual(accommodationBand(7500, '2025-09-22'), { rate: 5, itc: false, exempt: false, band: 'low' });
  assert.deepEqual(accommodationBand(7500.01, '2025-09-22'), { rate: 18, itc: true, exempt: false, band: 'high' });
  assert.equal(rate(1, '2026-10-24'), 5, 'no nil band below ₹1,000 after 18 Jul 2022');
  assert.equal(rate(7500.004, '2026-10-24'), 5, 'compared at paise');
});

test('earlier rows at their boundaries (back-dated documents)', () => {
  assert.equal(rate(7500, '2025-09-21'), 12);
  assert.equal(rate(7500.01, '2025-09-21'), 18);
  assert.equal(rate(999, '2022-07-18'), 12);
  assert.deepEqual(accommodationBand(1000, '2019-10-01'), { rate: 0, itc: false, exempt: true, band: 'low' });
  assert.equal(rate(1000.01, '2019-10-01'), 12);
  assert.equal(rate(7500.01, '2019-10-01'), 18);
  assert.equal(rate(999.99, '2017-07-01'), 0);
  assert.equal(rate(1000, '2017-07-01'), 12);
  assert.equal(rate(2500, '2017-07-01'), 18);
  assert.equal(rate(7500, '2017-07-01'), 28);
});

test('bandForInclusive round-trips and flags the gap between bands', () => {
  for (const [value, r] of [[3000, 5], [7500, 5], [8000, 18], [12000, 18]] as const) {
    const gross = Math.round(value * (1 + r / 100) * 100) / 100;
    const b = bandForInclusive(gross, '2026-10-24');
    assert.equal(b.value, value);
    assert.equal(b.rate, r);
    assert.equal(b.gap, undefined);
  }
  const gap = bandForInclusive(8000, '2026-10-24');
  assert.equal(gap.gap, true);
  assert.equal(gap.rate, 18);
});

test('priceNight: 1 / 2 adults, extra adult, child, extra bed', () => {
  assert.equal(priceNight(EP, DLX, { night: '2026-10-20', adults: 1, children: 0, extraBeds: 0 }).total, 3000); // Tuesday
  const p = priceNight(EP, DLX, { night: '2026-10-20', adults: 3, children: 1, extraBeds: 1 });
  assert.deepEqual([p.room, p.extra_adult, p.extra_child, p.extra_bed, p.total], [3500, 800, 500, 700, 5500]);
});

test('weekend (Fri, Sat): own weekend rate beats the % uplift; a season override beats the weekend; later seasons win', () => {
  assert.equal(priceNight(EP, DLX, { night: '2026-10-23', adults: 2, children: 0, extraBeds: 0 }).room, 4200, 'Friday +20%');
  const own: RatePlan = { ...EP, rates: [{ ...EP.rates[0], weekend_double: 3900 }] };
  assert.equal(priceNight(own, DLX, { night: '2026-10-24', adults: 2, children: 0, extraBeds: 0 }).room, 3900);
  assert.equal(priceNight(own, DLX, { night: '2026-10-25', adults: 2, children: 0, extraBeds: 0 }).room, 3500, 'Sunday is a weekday');
  const seasons: RatePlan = { ...own, seasons: [
    { name: 'Diwali', from: '2026-11-01', to: '2026-11-15', kind: 'override', value: 6000 },
    { name: 'Peak', from: '2026-11-10', to: '2026-11-12', kind: 'pct', value: 50 },
  ] };
  assert.equal(priceNight(seasons, DLX, { night: '2026-11-06', adults: 2, children: 0, extraBeds: 0 }).room, 6000, 'override on a Friday');
  const peak = priceNight(seasons, DLX, { night: '2026-11-11', adults: 2, children: 0, extraBeds: 1 });
  assert.deepEqual([peak.room, peak.extra_bed], [5250, 1050], 'the later pct season scales every charge');
  const amt: RatePlan = { ...EP, seasons: [{ name: 'x', from: '2026-10-20', to: '2026-10-20', kind: 'amount', value: 250 }] };
  assert.equal(priceNight(amt, DLX, { night: '2026-10-20', adults: 2, children: 0, extraBeds: 1 }).total, 4450);
});

test('meal share is information inside the total; min stay', () => {
  const cp: RatePlan = { ...EP, meal_plan: 'CP', meal_per_adult: 300, min_stay: 2 };
  const n = priceNight(cp, DLX, { night: '2026-10-20', adults: 2, children: 0, extraBeds: 0 });
  assert.deepEqual([n.meal, n.total], [600, 3500]);
  assert.match(minStayError(cp, 1), /at least 2/);
  assert.equal(minStayError(cp, 2), '');
});

test('tax-inclusive plan: each night reverse-solved through its own band', () => {
  const inc: RatePlan = { ...EP, tax_inclusive: true, rates: [{ ...EP.rates[0], single: 3150 }, { ...EP.rates[1], single: 9440 }] };
  const low = priceNight(inc, DLX, { night: '2026-10-20', adults: 1, children: 0, extraBeds: 0 });
  assert.deepEqual([low.total, low.room, low.gross], [3000, 3000, 3150]);
  const high = priceNight(inc, STE, { night: '2026-10-20', adults: 1, children: 0, extraBeds: 0 });
  assert.deepEqual([high.total, high.gross], [8000, 9440]);
  const mixed = priceNight(inc, DLX, { night: '2026-10-20', adults: 3, children: 0, extraBeds: 0 });
  assert.equal(Math.round((mixed.room + mixed.extra_adult) * 100) / 100, mixed.total, 'parts add up to the pre-tax value');
  assert.equal(stayTotal(priceStay(inc, DLX, { adults: 1, children: 0, extraBeds: 0 }, '2026-10-19', '2026-10-21')), 6000);
});

test('a booking snapshots its nights: a plan edit does not reprice it, "Re-price" does', () => {
  setupHotel();
  const { res } = saveReservation(booking('2026-10-20', '2026-10-22'));
  assert.equal(res.lines[0].nightly.map((n) => n.total).join(','), '3500,3500');
  hotelDb.saveRatePlans([{ ...EP, rates: [{ ...EP.rates[0], double: 4000 }, EP.rates[1]] }]);
  const kept = saveReservation({ ...res, notes: 'late arrival' });
  assert.equal(kept.res.lines[0].nightly.map((n) => n.total).join(','), '3500,3500');
  const longer = saveReservation({ ...kept.res, departure: '2026-10-23' });
  assert.equal(longer.res.lines[0].nightly.map((n) => n.total).join(','), '3500,3500,4000', 'only the new night is priced (at the current plan)');
  const re = saveReservation({ ...longer.res }, { reprice: true });
  assert.equal(re.res.lines[0].nightly.map((n) => n.total).join(','), '4000,4000,4000');
});
