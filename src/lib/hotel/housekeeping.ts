/**
 * R7-A5 housekeeping: room status `clean | dirty | inspected | ooo | oos`, plus occupancy derived from stays (a room
 * with a checked-in line is occupied). Automatic changes: check-out → dirty; night audit → occupied rooms dirty
 * (setting, default on); out of order with from / to / reason blocks the room for bookings in that range. A clerk may
 * change statuses (`doc.create`); every change reaches the edit log through the watched `hotel_rooms` table.
 */
import type { HkStatus, Reservation, Room } from '../../types/hotel-r7';
import { currentActor } from '../access';
import { hotelDb } from './hotel-store';
import { isLiveLine, isLiveRes, lineDates } from './availability';
import { HotelError } from './reservations';

export const HK_STATUSES: readonly HkStatus[] = ['clean', 'dirty', 'inspected', 'ooo', 'oos'];

export const who = (): string => currentActor()?.name || 'Owner';

/** Rooms with a guest in them now (checked-in lines), by room id → reservation. */
export function occupiedRooms(reservations: readonly Reservation[]): Map<string, Reservation> {
  const out = new Map<string, Reservation>();
  for (const r of reservations) for (const l of r.lines) if (l.status === 'checked_in' && l.room_id) out.set(l.room_id, r);
  return out;
}

/** Vacant clean / inspected (and not out of order): offered first at check-in. */
export const readyForCheckIn = (room: Pick<Room, 'hk_status' | 'ooo' | 'active'>): boolean =>
  room.active && !room.ooo && (room.hk_status ?? 'clean') !== 'dirty' && room.hk_status !== 'ooo' && room.hk_status !== 'oos';

export function setHk(ids: readonly string[], status: Exclude<HkStatus, 'ooo'>, at: Date = new Date()): void {
  const stamp = { hk_status: status, hk_at: at.toISOString(), hk_by: who() };
  hotelDb.patchRooms(Object.fromEntries(ids.map((id) => [id, stamp])));
}

/** Put a room out of order for [from, to] (inclusive), or bring it back (`null` → dirty, to be cleaned). */
export function setOoo(roomId: string, ooo: { from: string; to: string; reason: string } | null, reservations: readonly Reservation[] = hotelDb.reservations(), at: Date = new Date()): void {
  if (!ooo) {
    hotelDb.patchRooms({ [roomId]: { hk_status: 'dirty', ooo: undefined, hk_at: at.toISOString(), hk_by: who() } });
    return;
  }
  if (!ooo.from || !ooo.to || ooo.to < ooo.from) throw new HotelError('Choose from and to dates.');
  if (!ooo.reason.trim()) throw new HotelError('Give a reason.');
  const clash = reservations.find((r) => isLiveRes(r) && r.lines.some((l) => isLiveLine(l) && l.room_id === roomId && lineDates(r, l).arrival <= ooo.to && ooo.from < lineDates(r, l).departure));
  if (clash) throw new HotelError(`Booking ${clash.number} uses this room then — move it first.`);
  hotelDb.patchRooms({ [roomId]: { hk_status: 'ooo', ooo: { ...ooo, reason: ooo.reason.trim() }, hk_at: at.toISOString(), hk_by: who() } });
}

/** Board rows grouped by floor (floor order, then room number). */
export function byFloor(rooms: readonly Room[]): [string, Room[]][] {
  const m = new Map<string, Room[]>();
  for (const r of rooms) m.set(r.floor || '—', [...(m.get(r.floor || '—') ?? []), r]);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}
