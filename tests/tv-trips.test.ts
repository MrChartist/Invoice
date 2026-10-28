/** R15-B2 trip files and bookings: a trip is a cost centre with `tv`; codes; validation; bookings CRUD; billed is derived; volume. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { loadCostCentres } from '../src/lib/cost-centres.ts';
import { cleanTrip, loadTrips, saveTrip, suggestTripCode, validateTrip } from '../src/lib/travel/tv-trips.ts';
import { costInr, isBilled, liveLines, loadBookings, removeBooking, saveBooking } from '../src/lib/travel/tv-bookings.ts';
import { tripMargins } from '../src/lib/travel/tv-costing.ts';
import type { TripInfo, TravelBooking } from '../src/types/travel-r15.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
const info = (o: Partial<TripInfo> = {}): TripInfo => ({ code: '', kind: 'trip', scope: 'domestic', regime: 'to5', status: 'confirmed', start: '2026-11-10', end: '2026-11-15', destination: 'Kerala', pax: [{ name: 'Ravi', type: 'adult' }], ...o });

test('a trip is a project cost centre with `tv`; code suggested per start month and unique', () => {
  assert.equal(suggestTripCode('2026-11-10', []), '2611-001');
  const t = saveTrip({ name: 'Kerala — Nair family', tv: info({ code: '2611-001', pax: [{ name: ' Ravi ', type: 'adult' }, { name: 'Anu', type: 'child' }] }) });
  const c = loadCostCentres().find((x) => x.id === t.id)!;
  assert.equal(c.kind, 'project');
  assert.equal(c.start, '2026-11-10');
  assert.deepEqual(c.tv!.pax, [{ name: 'Ravi', type: 'adult' }, { name: 'Anu', type: 'child' }], 'names only, trimmed');
  assert.equal(suggestTripCode('2026-11-20', loadCostCentres()), '2611-002');
  assert.throws(() => saveTrip({ name: 'Other', tv: info({ code: '2611-001' }) }), /already used/);
  assert.equal(validateTrip(info({ code: 'X', end: '2026-11-01' }), undefined, []), 'The end date is before the start date.');
  assert.equal(validateTrip(info({ code: 'X', regime: 'bad' as never }), undefined, []), 'Choose the GST regime.');
  assert.equal(cleanTrip(info({ code: ' ab ', destination: ' ' })).destination, undefined);
  assert.equal(loadTrips().length, 1);
  saveTrip({ id: t.id, name: t.name, tv: { ...t.tv, status: 'closed' } });
  assert.equal(loadCostCentres()[0].status, 'done');
});

test('bookings: saved with INR cost at the rate, audited table, billed derived from the line reference, refused when billed', () => {
  assert.ok(WATCHED_TABLES.travel_bookings, 'audited (and binned on delete)');
  const b = saveBooking({ trip_id: 't', component: 'hotel', start: '2026-11-10', cost: 400, cost_currency: 'USD', fx: 84.25, sell: 40000, status: 'held' });
  assert.equal(costInr(b), 33700);
  assert.throws(() => saveBooking({ trip_id: 't', component: 'boat' as never, start: '2026-11-10', cost: 1, sell: 1, status: 'held' }), /component/);
  const inv = { id: 'i', status: 'Sent', items: [{ id: 'l' }] } as never;
  const billed = saveBooking({ ...b, line_ref: { invoice_id: 'i', line_id: 'l' } });
  assert.equal(isBilled(billed, liveLines([inv])), true);
  assert.equal(isBilled(billed, liveLines([{ ...(inv as object), status: 'Cancelled' } as never])), false, 'a cancelled invoice frees it');
  assert.equal(isBilled(billed, liveLines([{ id: 'i', status: 'Sent', items: [] } as never])), false, 'a deleted line frees it');
  assert.throws(() => removeBooking(b.id, liveLines([inv])), /billed/);
  removeBooking(b.id, new Set());
  assert.equal(loadBookings().length, 0);
});

test('volume: the trip margin of a month reads only the trips that start in it', () => {
  const trips = Array.from({ length: 2400 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, kind: 'project' as const, active: true, created_at: '', tv: info({ code: `T${i}`, start: `2026-${String((i % 12) + 1).padStart(2, '0')}-10` }) }));
  const bookings: TravelBooking[] = trips.flatMap((t) => [0, 1, 2].map((j) => ({ id: `${t.id}-${j}`, trip_id: t.id, component: 'hotel' as const, start: t.tv.start!, cost: 1000, sell: 1200, status: 'confirmed' as const, created_at: '' })));
  const t0 = performance.now();
  const rows = tripMargins(trips, bookings, [], new Set(), '2026-11-01', '2026-11-30');
  assert.ok(performance.now() - t0 < 200);
  assert.equal(rows.length, 200);
  assert.ok(rows.every((r) => r.month === '2026-11' && r.c.sell === 3600 && r.c.margin === 600));
});
