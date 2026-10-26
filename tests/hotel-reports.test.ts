/** R7-C3 hotel reports: occupancy / ADR / RevPAR (D14: complimentary rooms are occupied but not in ADR), audit vs stays
 * basis, by month and room type, source mix totals = room revenue, and reading writes nothing. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupHotel } from './helpers/hotel.ts';
import { walkIn } from '../src/lib/hotel/checkin.ts';
import { runNight, statsOf } from '../src/lib/hotel/night-audit.ts';
import { hotelDb, HOTEL_TABLES, HOTEL_SETTINGS_KEY } from '../src/lib/hotel/hotel-store.ts';
import { byMonth, byRoomType, occupancyByDay, sourceOf, sourceMix } from '../src/lib/hotel/hotel-reports.ts';
import { DB_PREFIX, readRaw, subscribeStorageChanges } from '../src/lib/storage.ts';
import { setActorProvider } from '../src/lib/access.ts';

afterEach(() => setActorProvider(null));

function stay(roomId: string, line: Record<string, unknown> = {}) {
  return walkIn({
    booking: { guest: { name: 'G' }, arrival: '2026-10-20', departure: '2026-10-23', guarantee: 'none', lines: [{ room_type_id: roomId === 'r201' ? 'ste' : 'dlx', rate_plan_id: 'ep', adults: 2, children: 0, extra_beds: 0, ...line }] } as never,
    roomId, guests: [{ name: 'G', nationality: 'IN' }], at: new Date('2026-10-20T13:00:00'),
  });
}
const world = () => ({ rooms: hotelDb.rooms(), types: hotelDb.roomTypes(), reservations: hotelDb.reservations(), folios: hotelDb.folios(), audits: hotelDb.audits() });

test('formulas (D14): comp / house occupied for occupancy, not for ADR; RevPAR over rooms available', () => {
  const s = statsOf({ available: 10, occupied: 6, complimentary: 1, house: 1, ooo: 0, room_revenue: 12000 });
  assert.deepEqual([s.occupancy, s.adr, s.revpar], [60, 3000, 1200]);
  assert.deepEqual([statsOf({ available: 0, occupied: 0, complimentary: 0, house: 0, ooo: 1, room_revenue: 0 }).revpar], [0]);
});

test('occupancy by day from audits, then from stays; by month; by room type; source mix = room revenue', () => {
  setupHotel('2026-10-20');
  stay('r101'); // ₹3,500 a night (2 adults), walk-in
  stay('r102', { comp: 'complimentary' });
  const ota = stay('r201'); // ₹8,000; walk-ins are always walk-in, so mark this one as an OTA booking
  hotelDb.putReservations({ ...hotelDb.reservation(ota.res.id)!, source: 'ota', ota: { name: 'Booking.com', collect: 'hotel_collect' } });
  runNight('2026-10-20');
  runNight('2026-10-21');
  const d = world();
  const days = occupancyByDay('2026-10-20', '2026-10-22', d);
  assert.deepEqual(days.map((r) => [r.day, r.basis, r.available, r.occupied, r.complimentary, r.occupancy, r.room_revenue, r.adr, r.revpar]), [
    ['2026-10-20', 'audit', 3, 3, 1, 100, 11500, 5750, 3833.33],
    ['2026-10-21', 'audit', 3, 3, 1, 100, 11500, 5750, 3833.33],
    ['2026-10-22', 'stays', 3, 3, 1, 100, 0, 0, 0],
  ]);
  const m = byMonth(days);
  assert.deepEqual(m.map((r) => [r.month, r.available, r.occupied, r.room_revenue, r.adr, r.revpar, r.occupancy]), [['2026-10', 9, 9, 23000, 3833.33, 2555.56, 100]]);
  const t = byRoomType('2026-10-20', '2026-10-22', d);
  assert.deepEqual(t.map((r) => [r.type, r.available, r.occupied, r.complimentary, r.room_revenue, r.adr]), [['Deluxe', 6, 6, 3, 7000, 2333.33], ['Suite', 3, 3, 0, 16000, 5333.33]]);
  const mix = sourceMix('2026-10-20', '2026-10-22', d.reservations, d.folios);
  assert.deepEqual(mix.map((r) => [r.source, r.nights, r.revenue]), [['OTA · Booking.com', 3, 16000], ['walk_in', 3, 7000]]);
  assert.equal(mix.reduce((s, r) => s + r.revenue, 0), days.reduce((s, r) => s + r.room_revenue, 0), 'source mix totals equal the room revenue');
  assert.equal(sourceOf({ source: 'company' }), 'company');
});

test('reading the reports performs no writes', () => {
  setupHotel('2026-10-20');
  stay('r101');
  runNight('2026-10-20');
  const keys = [...HOTEL_TABLES.map((t) => DB_PREFIX + t), HOTEL_SETTINGS_KEY];
  const before = keys.map((k) => readRaw(k));
  const writes: string[] = [];
  const off = subscribeStorageChanges((k) => writes.push(k));
  try {
    const d = world();
    occupancyByDay('2026-10-01', '2026-10-31', d);
    byMonth(occupancyByDay('2026-10-01', '2026-10-31', d));
    byRoomType('2026-10-01', '2026-10-31', d);
    sourceMix('2026-10-01', '2026-10-31', d.reservations, d.folios);
  } finally {
    off();
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(keys.map((k) => readRaw(k)), before);
});
