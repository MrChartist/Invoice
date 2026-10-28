/** R15-B2 costing: per component and in total, the actual bill over the booking cost, unconfirmed / unbilled, margin %. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripCosting } from '../src/lib/travel/tv-costing.ts';
import type { TravelBooking } from '../src/types/travel-r15.ts';

const b = (id: string, component: TravelBooking['component'], cost: number, sell: number, o: Partial<TravelBooking> = {}): TravelBooking => ({ id, trip_id: 't', component, start: '2026-11-10', cost, sell, status: 'confirmed', created_at: '', ...o });

test('Kerala: ₹2,46,000 sell vs ₹2,08,500 cost → 15.24 % margin; unconfirmed counted', () => {
  const c = tripCosting([b('a', 'air', 96000, 110000, { status: 'held' }), b('h1', 'hotel', 30000, 36000), b('h2', 'hotel', 28000, 34000), b('h3', 'hotel', 22500, 26000), b('c', 'transfer', 14000, 17000), b('hb', 'sightseeing', 18000, 23000)], [], new Set());
  assert.deepEqual([c.sell, c.cost, c.margin, c.pct, c.unconfirmed, c.unbilled], [246000, 208500, 37500, 15.24, 1, 6]);
  assert.deepEqual(c.rows.find((r) => r.component === 'hotel'), { component: 'hotel', cost: 80500, sell: 96000, margin: 15500 });
});

test('foreign-currency cost at the booking rate; the actual bill wins; cancelled bookings count as a loss; commission adds', () => {
  const bill = { id: 'p', date: '2026-11-11', bill_number: 'H/1', taxable: 45000, cgst: 1125, sgst: 1125, igst: 0, total: 47250, itc_eligible: false, amount_paid: 0, tv: { trip_id: 't', booking_id: 'h' } };
  const c = tripCosting([b('h', 'hotel', 500, 50000, { cost_currency: 'USD', fx: 84 }), b('x', 'air', 9000, 10000, { status: 'cancelled', cancel: { date: '2026-11-01', supplier_charge: 3000, fee: 500, refund_in: 6000, refund_out: 9500 } }), b('k', 'other', 0, 0, { commission: 1200 })], [bill], new Set());
  assert.equal(c.rows.find((r) => r.component === 'hotel')!.cost, 47250, 'no ITC: the bill total, not 500 × 84');
  assert.deepEqual([c.loss, c.commission, c.unpaid], [2500, 1200, 47250]);
  assert.equal(c.margin, 50000 - 47250 - 2500 + 1200);
  assert.equal(tripCosting([b('h', 'hotel', 500, 50000, { cost_currency: 'USD', fx: 84 })], [], new Set()).cost, 42000);
});
