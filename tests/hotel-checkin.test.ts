/** R7-A4 check-in / walk-in / guests and R7-A5 housekeeping. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { booking, setupHotel } from './helpers/hotel.ts';
import { NeedsConfirm, checkIn, markCheckedOut, walkIn } from '../src/lib/hotel/checkin.ts';
import { saveReservation } from '../src/lib/hotel/reservations.ts';
import { cleanGuest, formCMissing, guestRegister, maskAadhaar, matchGuest, shownId } from '../src/lib/hotel/guests.ts';
import { hotelDb } from '../src/lib/hotel/hotel-store.ts';
import { readyForCheckIn, setHk, setOoo } from '../src/lib/hotel/housekeeping.ts';
import { freeRooms } from '../src/lib/hotel/availability.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { genericChanges } from '../src/lib/audit-edits.ts';

afterEach(() => setActorProvider(null));
const AT = new Date('2026-10-20T13:00:00');
const guest = (over = {}) => ({ name: 'Asha Rao', phone: '9876543210', nationality: 'IN', id_doc: { type: 'aadhaar' as const, number: '1234 5678 9012' }, ...over });

test('walk-in: one step creates the booking (arriving on the business date), checks in and opens window 1', () => {
  setupHotel('2026-10-20');
  const out = walkIn({ booking: { guest: { name: 'Asha Rao' }, departure: '2026-10-22', guarantee: 'none', lines: [{ room_type_id: 'dlx', rate_plan_id: 'ep', adults: 2, children: 0, extra_beds: 0, room_id: 'r101' }] } as never, roomId: 'r101', guests: [guest()], at: AT });
  assert.equal(out.res.source, 'walk_in');
  assert.equal(out.res.arrival, '2026-10-20');
  assert.equal(out.res.status, 'checked_in');
  assert.equal(out.line.status, 'checked_in');
  assert.equal(out.line.checked_in_at, AT.toISOString());
  assert.equal(out.folios.length, 1);
  assert.deepEqual([out.folios[0].window, out.folios[0].payer.kind, out.folios[0].name], [1, 'guest', `${out.res.number} · W1`]);
  assert.equal(hotelDb.folios().length, 1);
  assert.equal(out.formCIncomplete, false);
  assert.equal(out.line.form_c, undefined, 'no Form C clock for an Indian guest');
});

test('a failed walk-in leaves nothing behind', () => {
  setupHotel('2026-10-20');
  setOoo('r101', { from: '2026-10-20', to: '2026-10-21', reason: 'leak' });
  assert.throws(() => walkIn({ booking: { guest: { name: 'X' }, departure: '2026-10-21', guarantee: 'none', lines: [{ room_type_id: 'dlx', rate_plan_id: 'ep', adults: 1, children: 0, extra_beds: 0 }] } as never, roomId: 'r101', guests: [guest()], at: AT }), /out of order/);
  assert.equal(hotelDb.reservations().length, 0);
  assert.equal(hotelDb.guests().length, 0);
});

test('company bill-to: check-in opens windows 1 (guest) and 2 (company)', () => {
  setupHotel('2026-10-20');
  const { res } = saveReservation(booking('2026-10-20', '2026-10-21', {}, { bill_to: { client_id: 'c1', name: 'Acme' } }));
  const out = checkIn({ resId: res.id, lineId: res.lines[0].id, roomId: 'r102', guests: [guest()], at: AT });
  assert.deepEqual(out.folios.map((f) => [f.window, f.payer.kind, f.payer.client_id]), [[1, 'guest', undefined], [2, 'client', 'c1']]);
});

test('foreign guest without passport: check-in completes, Form C incomplete, due = check-in + 24 h', () => {
  setupHotel('2026-10-20');
  const { res } = saveReservation(booking('2026-10-20', '2026-10-21'));
  const out = checkIn({ resId: res.id, lineId: res.lines[0].id, roomId: 'r101', guests: [{ name: 'Jean Dupont', nationality: 'FR' }], at: AT });
  assert.equal(out.formCIncomplete, true);
  assert.equal(out.line.form_c?.due_at, new Date(AT.getTime() + 24 * 3_600_000).toISOString());
  const g = hotelDb.guests()[0];
  assert.ok(formCMissing(g).includes('passport_no'));
  assert.deepEqual(formCMissing({ nationality: 'IN' }), []);
});

test('Aadhaar is stored masked by default (unmasked only when asked); lists show masked ids', () => {
  assert.equal(maskAadhaar('123456789012'), 'XXXX XXXX 9012');
  const g = cleanGuest(guest());
  assert.deepEqual(g.id_doc, { type: 'aadhaar', number: 'XXXX XXXX 9012', masked: true });
  const open = cleanGuest({ ...guest(), storeMasked: false });
  assert.equal(open.id_doc?.number, '1234 5678 9012');
  assert.equal(shownId(open), 'XXXX XXXX 9012');
  assert.throws(() => cleanGuest(guest({ id_doc: { type: 'aadhaar', number: '1234' } })), /12 digits/);
  assert.equal(shownId(cleanGuest(guest({ id_doc: { type: 'passport', number: 'Z1234567' } }))), '…4567');
  // The edit log never copies ID / passport / visa / date-of-birth values.
  const changes = genericChanges({ id: 'g', id_doc: { number: 'A' }, foreign: { passport_no: 'P1' }, dob: '1990-01-01' }, { id: 'g', id_doc: { number: 'B' }, foreign: { passport_no: 'P2' }, dob: '1991-01-01' });
  assert.ok(changes.every((c) => c.from === '(hidden)'));
});

test('returning guests are matched by phone (last 10 digits) or passport', () => {
  const list = [cleanGuest(guest({ id: 'g1' })), cleanGuest({ id: 'g2', name: 'Jean', nationality: 'FR', foreign: { passport_no: 'X123' } })];
  assert.equal(matchGuest(list, { phone: '+91 98765 43210' })?.id, 'g1');
  assert.equal(matchGuest(list, { passport: 'x123' })?.id, 'g2');
  assert.equal(matchGuest(list, { phone: '12345' }), undefined);
});

test('check-in refused on an OOO / occupied / other-type room; a dirty room needs confirmation; inspected is ready', () => {
  setupHotel('2026-10-20');
  const { res } = saveReservation(booking('2026-10-20', '2026-10-21'));
  const other = saveReservation(booking('2026-10-20', '2026-10-21')).res;
  const line = res.lines[0].id;
  setOoo('r102', { from: '2026-10-20', to: '2026-10-20', reason: 'paint' });
  assert.throws(() => checkIn({ resId: res.id, lineId: line, roomId: 'r102', guests: [guest()] }), /out of order/);
  assert.throws(() => checkIn({ resId: res.id, lineId: line, roomId: 'r201', guests: [guest()] }), /another room type/);
  setOoo('r102', null);
  setHk(['r101'], 'dirty');
  assert.throws(() => checkIn({ resId: res.id, lineId: line, roomId: 'r101', guests: [guest()] }), NeedsConfirm);
  setHk(['r101'], 'inspected');
  assert.equal(readyForCheckIn(hotelDb.rooms().find((r) => r.id === 'r101')!), true);
  assert.ok(checkIn({ resId: res.id, lineId: line, roomId: 'r101', guests: [guest()] }));
  assert.throws(() => checkIn({ resId: other.id, lineId: other.lines[0].id, roomId: 'r101', guests: [guest()] }), /occupied/);
});

test('check-out → room dirty, booking closed; guest register lists the stay', () => {
  setupHotel('2026-10-20');
  const out = walkIn({ booking: { guest: { name: 'Asha Rao' }, departure: '2026-10-21', guarantee: 'none', lines: [{ room_type_id: 'dlx', rate_plan_id: 'ep', adults: 1, children: 0, extra_beds: 0 }] } as never, roomId: 'r101', guests: [guest(), guest({ name: 'Ravi Rao', phone: '' })], at: AT });
  const after = markCheckedOut(out.res.id, out.line.id, new Date('2026-10-21T10:00:00'));
  assert.equal(after.status, 'checked_out');
  assert.equal(hotelDb.rooms().find((r) => r.id === 'r101')!.hk_status, 'dirty');
  const reg = guestRegister(hotelDb.reservations(), hotelDb.guests(), (id) => (id === 'r101' ? '101' : ''), '2026-10-01', '2026-10-31');
  assert.deepEqual(reg.map((r) => [r.guest.name, r.room]), [['Asha Rao', '101'], ['Ravi Rao', '101']]);
});

test('OOO range blocks availability; a clerk may change housekeeping status, a viewer may not', () => {
  setupHotel('2026-10-20');
  setActorProvider(() => ({ id: 'c', name: 'Clerk', role: 'clerk' }));
  setOoo('r101', { from: '2026-10-22', to: '2026-10-24', reason: 'AC' });
  assert.deepEqual(freeRooms('dlx', '2026-10-23', '2026-10-24', { rooms: hotelDb.rooms(), reservations: [] }).map((r) => r.id), ['r102']);
  setOoo('r101', null);
  assert.equal(hotelDb.rooms().find((r) => r.id === 'r101')!.hk_status, 'dirty');
  assert.equal(hotelDb.rooms().find((r) => r.id === 'r101')!.hk_by, 'Clerk');
  setActorProvider(() => ({ id: 'v', name: 'Viewer', role: 'viewer' }));
  assert.throws(() => setHk(['r101'], 'clean'), /cannot/i);
});
