/** R7-A3 reservations: availability (departure day free, OOO, type count), RES numbering, cancel, band-correct advance. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, thawDate } from './helpers/shim.ts';
import { booking, setupHotel } from './helpers/hotel.ts';
import { HotelError, arrivalsOn, closeReservation, departuresOn, inHouseOn, nextResNumber, saveReservation, searchReservations, takeAdvance } from '../src/lib/hotel/reservations.ts';
import { freeRooms, typeFreeCount } from '../src/lib/hotel/availability.ts';
import { hotelDb } from '../src/lib/hotel/hotel-store.ts';
import { setOoo } from '../src/lib/hotel/housekeeping.ts';
import { loadAdvances } from '../src/lib/advances.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { PeriodLockedError } from '../src/lib/period-lock.ts';

afterEach(() => {
  thawDate();
  setActorProvider(null);
});

const ctx = () => ({ rooms: hotelDb.rooms(), reservations: hotelDb.reservations() });

test('a room is taken on its nights only: the departure day is free; an overlap is refused', () => {
  setupHotel();
  saveReservation(booking('2026-10-24', '2026-10-26', { room_id: 'r101' }));
  assert.ok(saveReservation(booking('2026-10-26', '2026-10-27', { room_id: 'r101' })).res.number);
  assert.throws(() => saveReservation(booking('2026-10-25', '2026-10-27', { room_id: 'r101' })), (e: Error) => e instanceof HotelError && /101 is already booked on 2026-10-25/.test(e.message));
  assert.deepEqual(freeRooms('dlx', '2026-10-24', '2026-10-26', ctx()).map((r) => r.id), ['r102']);
});

test('out-of-order rooms are excluded for their range (both days inclusive)', () => {
  setupHotel();
  setOoo('r102', { from: '2026-10-24', to: '2026-10-25', reason: 'AC broken' });
  assert.deepEqual(freeRooms('dlx', '2026-10-25', '2026-10-26', ctx()).map((r) => r.id), ['r101']);
  assert.deepEqual(freeRooms('dlx', '2026-10-26', '2026-10-27', ctx()).map((r) => r.id), ['r101', 'r102']);
  assert.throws(() => saveReservation(booking('2026-10-25', '2026-10-26', { room_id: 'r102' })), /out of order/);
  saveReservation(booking('2026-10-27', '2026-10-28', { room_id: 'r101' }));
  assert.throws(() => setOoo('r101', { from: '2026-10-27', to: '2026-10-27', reason: 'paint' }), /move it first/);
});

test('type-level bookings up to the free count: a warning on the last room, then refused', () => {
  setupHotel();
  const a = saveReservation(booking('2026-10-24', '2026-10-25'));
  assert.deepEqual(a.warnings, []);
  assert.equal(typeFreeCount('dlx', '2026-10-24', '2026-10-25', ctx()), 1);
  const b = saveReservation(booking('2026-10-24', '2026-10-25'));
  assert.match(b.warnings.join(), /Last Deluxe room on 2026-10-24/);
  assert.throws(() => saveReservation(booking('2026-10-24', '2026-10-25')), /No Deluxe room is free/);
  assert.throws(() => saveReservation(booking('2026-10-24', '2026-10-25', { room_id: 'r101' })), /No Deluxe room is free/, 'assigning a room cannot starve an unassigned booking');
  // Two lines of one booking cannot share a room.
  assert.throws(() => saveReservation({ ...booking('2026-10-26', '2026-10-27', { room_id: 'r101' }), lines: [{ room_type_id: 'dlx', rate_plan_id: 'ep', adults: 1, children: 0, extra_beds: 0, room_id: 'r101' }, { room_type_id: 'dlx', rate_plan_id: 'ep', adults: 1, children: 0, extra_beds: 0, room_id: 'r101' }] }), /already booked/);
});

test('validation: dates, guest, occupancy, extra beds', () => {
  setupHotel();
  assert.throws(() => saveReservation(booking('2026-10-24', '2026-10-24')), /later departure/);
  assert.throws(() => saveReservation({ ...booking('2026-10-24', '2026-10-25'), guest: { name: ' ' } }), /guest name/);
  assert.throws(() => saveReservation(booking('2026-10-24', '2026-10-25', { adults: 4 })), /more guests/);
  assert.throws(() => saveReservation(booking('2026-10-24', '2026-10-25', { extra_beds: 2 })), /at most 1 extra bed/);
});

test('RES/FY numbering follows the booking date across 31 Mar → 1 Apr, never reused', () => {
  setupHotel('2026-03-31');
  const a = saveReservation(booking('2026-04-02', '2026-04-03', {}, { booked_on: '2026-03-31' })).res;
  const b = saveReservation(booking('2026-04-02', '2026-04-03', {}, { booked_on: '2026-04-01' })).res;
  assert.equal(a.number, 'RES/FY25-26/0001');
  assert.equal(b.number, 'RES/FY26-27/0001');
  assert.equal(nextResNumber('2026-04-05'), 'RES/FY26-27/0002');
});

test('cancel / no-show release the rooms; a closed booking cannot be edited', () => {
  setupHotel();
  const { res } = saveReservation(booking('2026-10-24', '2026-10-26', { room_id: 'r101' }));
  const closed = closeReservation(res.id, 'cancelled', 'plans changed');
  assert.equal(closed.lines[0].status, 'cancelled');
  assert.match(closed.notes ?? '', /plans changed/);
  assert.ok(saveReservation(booking('2026-10-24', '2026-10-26', { room_id: 'r101' })).res, 'room free again');
  assert.throws(() => saveReservation({ ...closed }), /cancelled and cannot be changed/);
  assert.throws(() => closeReservation(res.id, 'no_show'), /cancelled/);
});

test('lists and search', () => {
  setupHotel();
  const { res } = saveReservation(booking('2026-10-24', '2026-10-26'));
  assert.deepEqual(arrivalsOn(hotelDb.reservations(), '2026-10-24').map((r) => r.id), [res.id]);
  assert.deepEqual(departuresOn(hotelDb.reservations(), '2026-10-26'), []);
  assert.deepEqual(inHouseOn(hotelDb.reservations(), '2026-10-24'), []);
  assert.equal(searchReservations(hotelDb.reservations(), '43210').length, 1);
  assert.equal(searchReservations(hotelDb.reservations(), 'asha').length, 1);
  assert.equal(searchReservations(hotelDb.reservations(), 'zzz').length, 0);
});

test('the advance carries the band-correct GST (5% at ₹3,500, 18% above ₹7,500), POS = the property, linked to the booking', () => {
  setupHotel();
  freezeDate('2026-10-20T10:00:00');
  const low = saveReservation(booking('2026-10-24', '2026-10-25')).res;
  const a = takeAdvance(low.id, { amount: 3000, method: 'UPI' });
  assert.equal(a.tax_rate, 5);
  assert.equal(a.place_of_supply, '27');
  assert.equal(a.supply, 'services');
  assert.deepEqual(hotelDb.reservation(low.id)!.advance_ids, [a.id]);
  assert.equal(hotelDb.reservation(low.id)!.guarantee, 'advance');
  const high = saveReservation(booking('2026-10-24', '2026-10-25', { room_type_id: 'ste' })).res;
  assert.equal(takeAdvance(high.id, { amount: 9440, method: 'Cash' }).tax_rate, 18);
  assert.equal(loadAdvances().length, 2);
  void localDb;
});

test('period lock: a booking arriving in a locked period cannot be created; roles: a viewer cannot book', () => {
  setupHotel('2026-10-20', { lock_until: '2026-09-30' });
  assert.throws(() => saveReservation(booking('2026-09-29', '2026-10-02')), PeriodLockedError);
  setActorProvider(() => ({ id: 'v', name: 'Viewer', role: 'viewer' }));
  assert.throws(() => saveReservation(booking('2026-10-24', '2026-10-25')), /cannot/i);
});
