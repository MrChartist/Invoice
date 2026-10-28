/**
 * R7-A4 check-in, walk-in and the check-out status change.
 *
 * Check-in of a booked room line: the room must not be out of order or taken (refused); a room that is not vacant
 * clean / inspected needs `force` (the UI asks first). Guests are saved (Aadhaar masked, returning guests matched by
 * the caller), the line is stamped `checked_in_at`, folios open (window 1, and 2 for a company bill-to) and a foreign
 * guest starts the Form C clock: due = check-in + the rule's hours (D15). Missing Form C fields do not block ("complete
 * later") — the C2 desk keeps them red. A walk-in creates the booking and checks in in one step (rolled back together).
 * `markCheckedOut` is the status change R7-B3's check-out calls after billing: line out, room dirty.
 */
import type { Folio, Reservation, RoomLine } from '../../types/hotel-r7';
import { requireAccess } from '../access';
import { withTablesRollback } from '../table-txn';
import { hotelDb, HT } from './hotel-store';
import { checkLines, lineDates, oooOn } from './availability';
import { HotelError, saveReservation, type ReservationInput } from './reservations';
import { cleanGuest, formCMissing, isIndian, type GuestInput } from './guests';
import { openFolios, pendingNights } from './room-post';
import { leaveDay } from './business-date';
import { billable } from './checkout';
import { todayIso } from '../tax-rules';
import { formCRule } from './hotel-rules';
import { readyForCheckIn, setHk } from './housekeeping';

/** Thrown when the room is not ready (dirty / out of service): the user may confirm and retry with `force`. */
export class NeedsConfirm extends HotelError {}

export interface CheckInInput {
  resId: string;
  lineId: string;
  roomId: string;
  guests: GuestInput[];
  force?: boolean;
  at?: Date;
}

export interface CheckInResult {
  res: Reservation;
  line: RoomLine;
  folios: Folio[];
  /** Form C fields still missing (foreign guests). */
  formCIncomplete: boolean;
}

export function checkIn(input: CheckInInput): CheckInResult {
  requireAccess('doc.create');
  const at = input.at ?? new Date();
  const res = hotelDb.reservation(input.resId);
  if (!res || (res.status !== 'confirmed' && res.status !== 'tentative' && res.status !== 'checked_in')) throw new HotelError('This booking cannot be checked in.');
  const line = res.lines.find((l) => l.id === input.lineId);
  if (!line || line.status !== 'booked') throw new HotelError('This room is already checked in or closed.');
  const rooms = hotelDb.rooms();
  const room = rooms.find((r) => r.id === input.roomId);
  if (!room) throw new HotelError('Choose a room.');
  if (room.room_type_id !== line.room_type_id) throw new HotelError(`Room ${room.number} is another room type — change the booking first.`);
  if (oooOn(room, line.arrival || res.arrival)) throw new HotelError(`Room ${room.number} is out of order.`);
  const others = hotelDb.reservations();
  if (others.some((r) => r.lines.some((l) => l.status === 'checked_in' && l.room_id === room.id))) throw new HotelError(`Room ${room.number} is occupied.`);
  const moved = { ...line, room_id: room.id };
  const check = checkLines({ ...res, lines: res.lines.map((l) => (l.id === line.id ? moved : l)) }, { rooms, reservations: others, exceptResId: res.id });
  if (check.error) throw new HotelError(check.error);
  if (!input.force && !readyForCheckIn(room)) throw new NeedsConfirm(`Room ${room.number} is ${room.hk_status ?? 'not ready'} — check in anyway?`);
  if (!input.guests.length) throw new HotelError('Add the primary guest.');
  const guests = input.guests.map((g) => cleanGuest(g, at));
  const foreign = guests.filter((g) => !isIndian(g.nationality));
  const done: RoomLine = {
    ...moved, status: 'checked_in', checked_in_at: at.toISOString(), guest_ids: guests.map((g) => g.id),
    ...(foreign.length ? { form_c: { ...line.form_c, due_at: new Date(at.getTime() + formCRule(res.arrival).hours * 3_600_000).toISOString() } } : {}),
  };
  const next: Reservation = {
    ...res, status: 'checked_in', lines: res.lines.map((l) => (l.id === line.id ? done : l)),
    guest: { ...res.guest, guest_id: res.guest.guest_id ?? guests[0].id }, updated_at: at.toISOString(),
  };
  const day = hotelDb.settings().business_date;
  const folios = openFolios(next, done, day, hotelDb.folios());
  withTablesRollback([HT.guests, HT.reservations, HT.folios], () => {
    hotelDb.putGuests(...guests);
    hotelDb.putReservations(next);
    if (folios.length) hotelDb.putFolios(...folios);
  });
  return { res: next, line: done, folios, formCIncomplete: foreign.some((g) => formCMissing(g).length > 0) };
}

export interface WalkInInput {
  booking: Omit<ReservationInput, 'source' | 'arrival' | 'booked_on'> & { arrival?: string };
  roomId: string;
  guests: GuestInput[];
  force?: boolean;
  at?: Date;
}

/** Walk-in: booking (source walk-in, arriving on the business date) + check-in, all or nothing. */
export function walkIn(input: WalkInInput): CheckInResult {
  requireAccess('doc.create');
  const day = input.booking.arrival || hotelDb.settings().business_date;
  return withTablesRollback([HT.reservations, HT.guests, HT.folios], () => {
    const { res } = saveReservation({ ...input.booking, source: 'walk_in', arrival: day, booked_on: day, status: 'confirmed' }, { now: input.at });
    return checkIn({ resId: res.id, lineId: res.lines[0].id, roomId: input.roomId, guests: input.guests, force: input.force, at: input.at });
  });
}

/**
 * QA9 H9: an early check-out ends the line on the day the guest left — `departure` moves there (the booked day kept in
 * `booked_departure`) and the nightly snapshot keeps only the nights stayed, so occupancy, availability and the
 * previous-FY test read what was supplied. Pure; no change when the guest leaves on the booked day.
 */
export function trimLine(res: Reservation, lineId: string, leave: string): Reservation {
  const line = res.lines.find((l) => l.id === lineId);
  if (!line) return res;
  const d = lineDates(res, line);
  if (!(leave > d.arrival && leave < d.departure)) return res;
  const cut: RoomLine = { ...line, departure: leave, booked_departure: line.booked_departure ?? d.departure, nightly: line.nightly.filter((n) => n.night < leave) };
  return { ...res, lines: res.lines.map((l) => (l.id === lineId ? cut : l)) };
}

/** The day a checked-in line's guest leaves if checked out now (QA9 H1 / H9). */
export function lineLeaveDay(res: Reservation, line: RoomLine, at: Date = new Date()): string {
  const d = lineDates(res, line);
  return leaveDay(d.arrival, d.departure, hotelDb.settings().business_date, todayIso(at));
}

/**
 * PENDING 9: the folio a checked-in line must be billed on before it can close (nights not posted before the day the guest
 * leaves, or unbilled folio lines) — its window-1 folio, else the first open one with unbilled lines; `''` when nothing
 * is left to bill (comp or already billed: a status-only check-out is allowed). The Reservations list and the night
 * audit's due-outs use it to send "Check out" through the folio's check-out (billing) instead of refusing.
 */
export function folioToBill(res: Reservation, line: RoomLine, at: Date = new Date()): string {
  const folios = hotelDb.folios();
  const open = folios.filter((f) => f.line_id === line.id && f.status === 'open');
  const unbilled = open.filter((f) => billable(f).length);
  if (!unbilled.length && !pendingNights(res, line, folios, lineLeaveDay(res, line, at)).length) return '';
  return (unbilled[0] ?? open.find((f) => f.window === 1) ?? open[0])?.id ?? '';
}

/**
 * Line out (R7-B3's check-out calls this after billing): `checked_out_at`, room dirty; the booking closes when no line
 * is in. QA9 H1: refused while the line has nights not yet posted before the day the guest leaves, or unbilled folio
 * lines — a line never closes with unbilled nights (bill it on Folios → Check out). An early check-out trims the line (H9).
 */
export function markCheckedOut(resId: string, lineId: string, at: Date = new Date()): Reservation {
  requireAccess('doc.create');
  const res = hotelDb.reservation(resId);
  const line = res?.lines.find((l) => l.id === lineId);
  if (!res || !line || line.status !== 'checked_in') throw new HotelError('This room is not checked in.');
  const leave = lineLeaveDay(res, line, at);
  const folios = hotelDb.folios();
  if (pendingNights(res, line, folios, leave).length || folios.some((f) => f.line_id === lineId && f.status === 'open' && billable(f).length)) {
    throw new HotelError('Bill the stay first: Folios → Check out.');
  }
  const cut = trimLine(res, lineId, leave);
  const lines = cut.lines.map((l) => (l.id === lineId ? { ...l, status: 'checked_out' as const, checked_out_at: at.toISOString() } : l));
  const next: Reservation = { ...cut, lines, status: lines.some((l) => l.status === 'checked_in' || l.status === 'booked') ? res.status : 'checked_out', updated_at: at.toISOString() };
  hotelDb.putReservations(next);
  if (line.room_id) setHk([line.room_id], 'dirty', at);
  return next;
}
