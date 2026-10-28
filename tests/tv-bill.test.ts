/** R15-B2 "Bill": a draft in the trip's regime with the `tv` snapshot; bookings get their line reference; nothing billed twice. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { saveTrip } from '../src/lib/travel/tv-trips.ts';
import { isBilled, liveLines, loadBookings, saveBooking } from '../src/lib/travel/tv-bookings.ts';
import { billTrip } from '../src/lib/travel/tv-bill.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
});

test('Goa — Mehta family, 5 %: one gross package line, the declaration, the cost centre; billed once', () => {
  const client = localDb.clients.getAll()[0];
  const t = saveTrip({ name: 'Goa — Mehta family', client_id: client.id, tv: { code: '2611-001', kind: 'trip', scope: 'domestic', destination: 'Goa', start: '2026-11-10', regime: 'to5', status: 'confirmed', pax: [{ name: 'Ravi', type: 'adult' }] } });
  saveBooking({ trip_id: t.id, component: 'hotel', start: '2026-11-10', cost: 42000, sell: 50000, status: 'confirmed' });
  saveBooking({ trip_id: t.id, component: 'transfer', start: '2026-11-10', cost: 6000, sell: 10000, status: 'confirmed' });
  saveBooking({ trip_id: t.id, component: 'air', start: '2026-11-10', cost: 9000, sell: 9500, status: 'cancelled' });
  const inv = billTrip(t.id, '2026-11-01');
  assert.equal(inv.status, 'Draft');
  assert.equal(inv.cost_centre_id, t.id);
  assert.equal(inv.client.name, client.name);
  assert.deepEqual(inv.items.map((l) => [l.rate, l.tax_rate]), [[60000, 5]]);
  assert.equal(inv.taxable_value, 60000);
  assert.equal(inv.tax_amount, 3000);
  assert.equal(inv.tv?.regime, 'to5');
  assert.match(inv.tv!.decl!, /without ITC/);
  assert.equal(inv.tv?.trip?.code, '2611-001');
  const live = liveLines(localDb.invoices.getAll());
  assert.deepEqual(loadBookings(t.id).map((b) => [b.component, isBilled(b, live)]), [['hotel', true], ['transfer', true], ['air', false]]);
  assert.throws(() => billTrip(t.id), /Nothing to bill/);
  localDb.invoices.save({ ...localDb.invoices.getById(inv.id)!, status: 'Cancelled' });
  assert.equal(billTrip(t.id, '2026-11-02').total, 63000, 'a cancelled invoice frees its bookings');
});
