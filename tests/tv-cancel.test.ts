/**
 * R15-C3 cancellations: credit note of what was billed, our fee at the principal supply's rate (Circular 178, TV15),
 * the supplier's debit note for the refund due, the trip's loss, guards (shared package line, draft, amounts above the
 * cost, never billed again) and receivables after.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { saveTrip, loadTrips } from '../src/lib/travel/tv-trips.ts';
import { loadBookings, saveBooking } from '../src/lib/travel/tv-bookings.ts';
import { billTickets } from '../src/lib/travel/tv-air.ts';
import { billTrip } from '../src/lib/travel/tv-bill.ts';
import { cancelBookings, feeRate } from '../src/lib/travel/tv-cancel.ts';
import { tripCosting } from '../src/lib/travel/tv-costing.ts';
import type { TvRegime } from '../src/types/travel-r15.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
});

const trip = (regime: TvRegime) => saveTrip({ name: 'Trip', client_id: 'c-mh', tv: { code: `26${regime}`, kind: 'trip', scope: 'domestic', start: '2026-10-05', regime, status: 'confirmed', pax: [] } });

test('fee rate follows the principal supply: 5 % in the 5 % regime, 18 % for an agency fee, 0 abroad', () => {
  assert.deepEqual((['to5', 'to18', 'agent', 'exempt_outside'] as const).map((r) => feeRate(r, '2026-10-05')), [5, 18, 18, 0]);
});

test('cancel a ticket: credit note, fee at 18 %, debit note to the supplier, trip loss; never billed again', () => {
  const t = trip('agent');
  const bill = purchasesDb.save({ kind: 'EXPENSE', vendor_name: 'Air consolidator', bill_number: 'AC/1', date: '2026-10-05', category: 'Air fares', lines: [{ id: 'l', name: 'Fares', quantity: 1, rate: 10700, tax_rate: 0 }], taxable: 10700, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 10700, amount_paid: 0 });
  const b = saveBooking({ trip_id: t.id, component: 'air', start: '2026-10-05', cost: 10700, sell: 10700, status: 'confirmed', ref: 'ABC123', bill_id: bill.id });
  const inv = billTickets(b.id, [{ basic: 4200, taxes: 940, airline_gst: 210 }, { basic: 4200, taxes: 940, airline_gst: 210 }], { method: 'deemed', fee: 0, date: '2026-10-05' });
  const input = { date: '2026-10-08', supplier_charge: 3000, fee: 500, refund_in: 7700 };
  assert.throws(() => cancelBookings([b.id], input), /Issue the invoice first/);
  localDb.invoices.setStatus(inv.id, 'Sent');
  assert.throws(() => cancelBookings([b.id], { ...input, refund_in: 9000 }), /more than the cost/);
  const r = cancelBookings([b.id], input);
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0].doc_type, 'CREDIT_NOTE');
  assert.equal(r.notes[0].taxable_value, 10700 + 420, 'the whole ticket invoice is credited, GST reversed');
  assert.equal(r.fee?.items[0].tax_rate, 18);
  assert.equal(r.fee?.items[0].hsn, '998551');
  assert.equal(r.fee?.total, 590);
  assert.equal(r.plan.refundOut, Math.round((10700 + 420 + 75.6 - 590) * 100) / 100);
  const dn = getTable<{ purchase_id: string; total: number }>('purchase_returns');
  assert.deepEqual(dn.map((n) => [n.purchase_id, n.total]), [[bill.id, 7700]]);
  const after = loadBookings(t.id)[0];
  assert.equal(after.status, 'cancelled');
  assert.deepEqual(after.cancel && [after.cancel.supplier_charge, after.cancel.fee, after.cancel.refund_in], [3000, 500, 7700]);
  assert.equal(tripCosting([after], [], new Set()).loss, 2500, 'the charge not recovered by our fee is the loss');
  assert.equal(loadTrips()[0].tv.status, 'cancelled', 'every booking cancelled → the trip is cancelled');
  assert.throws(() => billTrip(t.id), /Nothing to bill/);
  assert.throws(() => cancelBookings([b.id], input), /Nothing to cancel/);
});

test('a booking inside the package line is cancelled with its whole trip; fee at 5 %', () => {
  const t = trip('to5');
  const h = saveBooking({ trip_id: t.id, component: 'hotel', start: '2026-10-05', cost: 42000, sell: 50000, status: 'confirmed' });
  const c = saveBooking({ trip_id: t.id, component: 'transfer', start: '2026-10-05', cost: 6000, sell: 10000, status: 'confirmed' });
  const inv = billTrip(t.id, '2026-10-01');
  localDb.invoices.setStatus(inv.id, 'Sent');
  assert.throws(() => cancelBookings([h.id], { date: '2026-10-02', supplier_charge: 0, fee: 0, refund_in: 0 }), /whole trip/);
  const r = cancelBookings([h.id, c.id], { date: '2026-10-02', supplier_charge: 6000, fee: 1500, refund_in: 42000 });
  assert.equal(r.notes[0].taxable_value, 60000);
  assert.deepEqual([r.fee?.items[0].tax_rate, r.fee?.items[0].hsn], [5, '998555']);
  assert.equal(r.plan.refundOut, 63000 - 1575);
  const bk = loadBookings(t.id);
  assert.equal(bk.reduce((s, b) => s + (b.cancel?.supplier_charge ?? 0), 0), 6000, 'charges split over the bookings by cost');
  assert.equal(localDb.invoices.getById(inv.id)?.status, 'Paid', 'receivables: the fully credited invoice is settled; the fee draft is what the client owes');
});
