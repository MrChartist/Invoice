/** R7-B6 cancellation / no-show: free window, first night / pct / full, band of the replaced night (₹7,500 boundary), advance + refund, waiver. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { booking, setupHotel, EP } from './helpers/hotel.ts';
import { closeReservation, saveReservation, takeAdvance } from '../src/lib/hotel/reservations.ts';
import { hotelDb } from '../src/lib/hotel/hotel-store.ts';
import { cancelCharge, chargeCancellation, hoursBefore } from '../src/lib/hotel/cancellation.ts';
import { loadAdvances } from '../src/lib/advances.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { RatePlan } from '../src/types/hotel-r7.ts';

afterEach(() => setActorProvider(null));

function withPolicy(policy: RatePlan['policy'], rates: Partial<RatePlan['rates'][number]> = {}) {
  setupHotel('2026-10-20');
  hotelDb.saveRatePlans([{ ...EP, policy, rates: EP.rates.map((r) => ({ ...r, ...rates })) }]);
}
const res3 = (adults = 2) => saveReservation(booking('2026-10-25', '2026-10-28', { adults })).res;

test('free window, then first night / pct / full; no-show rules', () => {
  withPolicy({ free_until_hours: 24, charge: 'first_night', no_show: 'full' });
  const r = res3();
  const plans = hotelDb.ratePlans();
  assert.equal(hoursBefore('2026-10-25', '12:00', new Date('2026-10-24T12:00:00')), 24);
  assert.deepEqual(cancelCharge(r, plans, 'cancelled', new Date('2026-10-23T12:00:00'), '12:00'), { amount: 0, parts: [], free: true });
  assert.equal(cancelCharge(r, plans, 'cancelled', new Date('2026-10-24T13:00:00'), '12:00').amount, 3500, 'inside 24 h: first night');
  assert.equal(cancelCharge(r, plans, 'no_show', new Date('2026-10-26T01:00:00'), '12:00').amount, 10500, 'no-show: full stay');
  assert.equal(cancelCharge(r, [{ id: 'ep', policy: { free_until_hours: 0, charge: 'pct', pct: 50, no_show: 'none' } }], 'cancelled', new Date('2026-10-26T00:00:00'), '12:00').amount, 5250);
  assert.equal(cancelCharge(r, [{ id: 'ep', policy: { free_until_hours: 0, charge: 'full', no_show: 'none' } }], 'cancelled', new Date('2026-10-26T00:00:00'), '12:00').amount, 10500);
  assert.equal(cancelCharge(r, [{ id: 'ep', policy: { free_until_hours: 0, charge: 'full', no_show: 'none' } }], 'no_show', new Date('2026-10-26T00:00:00'), '12:00').amount, 0);
});

test('a ₹8,000 night → 18% cancellation invoice; a ₹3,000 night → 5%', () => {
  withPolicy({ free_until_hours: 0, charge: 'first_night', no_show: 'first_night' }, { double: 8000 });
  const a = res3();
  closeReservation(a.id, 'cancelled', 'plans changed');
  const { invoice } = chargeCancellation(a.id, { at: new Date('2026-10-26T00:00:00') });
  assert.deepEqual([invoice?.items[0].tax_rate, invoice?.items[0].hsn, invoice?.taxable_value, invoice?.hotel_band], [18, '996311', 8000, 'high']);
  const b = res3(1);
  closeReservation(b.id, 'no_show');
  const out = chargeCancellation(b.id, { at: new Date('2026-10-26T00:00:00') });
  assert.deepEqual([out.invoice?.items[0].tax_rate, out.invoice?.total, out.res.cancellation?.charge], [5, 3150, 3000]);
  assert.throws(() => chargeCancellation(b.id), /already settled/);
});

test('₹7,500 boundary: the band of the replaced night, not of the (pct) charge', () => {
  withPolicy({ free_until_hours: 0, charge: 'pct', pct: 50, no_show: 'none' }, { double: 7500 });
  const a = res3();
  closeReservation(a.id, 'cancelled');
  assert.equal(chargeCancellation(a.id, { at: new Date('2026-10-26T00:00:00') }).invoice?.items[0].tax_rate, 5, '₹7,500.00 a night → low band');
  withPolicy({ free_until_hours: 0, charge: 'pct', pct: 50, no_show: 'none' }, { double: 7500.01 });
  const b = res3();
  closeReservation(b.id, 'cancelled');
  const inv = chargeCancellation(b.id, { at: new Date('2026-10-26T00:00:00') }).invoice!;
  assert.deepEqual([inv.items[0].tax_rate, inv.items[0].rate, inv.items[0].quantity], [18, 3750.01, 3], 'half of ₹7,500.01 is below ₹7,500, still 18%');
});

test('advance applied to the charge, the rest refunded with a refund voucher; waive needs a reason and makes no invoice', () => {
  withPolicy({ free_until_hours: 0, charge: 'first_night', no_show: 'first_night' }, { single: 3000 });
  const r = res3(1);
  const adv = takeAdvance(r.id, { amount: 5000, method: 'UPI', date: '2026-10-20' });
  closeReservation(r.id, 'cancelled');
  const { invoice, res } = chargeCancellation(r.id, { refund: { method: 'UPI' }, at: new Date('2026-10-26T00:00:00') });
  assert.equal(invoice?.total, 3150);
  assert.equal(invoice?.status, 'Paid');
  assert.deepEqual(localDb.payments.getAll().map((p) => [p.amount, p.advance_id]), [[3150, adv.id]]);
  const refunds = loadAdvances().find((a) => a.id === adv.id)?.refunds ?? [];
  assert.deepEqual(refunds.map((x) => [x.amount, x.number.slice(0, 3)]), [[1850, 'RFV']]);
  assert.equal(res.cancellation?.refund_id, refunds[0].id);
  const w = res3(1);
  closeReservation(w.id, 'cancelled');
  assert.throws(() => chargeCancellation(w.id, { waive: true }), /reason/);
  const waived = chargeCancellation(w.id, { waive: true, reason: 'regular guest' });
  assert.deepEqual([waived.invoice, waived.res.cancellation?.waived, waived.res.cancellation?.charge], [undefined, true, 0]);
  assert.equal(localDb.invoices.getAll().length, 1);
});
