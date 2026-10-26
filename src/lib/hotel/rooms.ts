/**
 * R7-A2 room types and rooms (masters, `master.edit`). Validation is pure; saving goes through `hotelDb`. A room type
 * or room still used by a live booking cannot be removed (the row would dangle).
 */
import type { Reservation, Room, RoomType } from '../../types/hotel-r7';
import { generateId } from '../storage';
import { hotelDb, usingStarter } from './hotel-store';
import { isLiveLine } from './availability';

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function roomTypeError(t: RoomType, all: readonly RoomType[]): string {
  if (!t.name.trim() || !t.code.trim()) return 'Every room type needs a name and a code.';
  if (all.some((x) => x.id !== t.id && x.code.trim().toUpperCase() === t.code.trim().toUpperCase())) return `Code ${t.code} is used twice.`;
  if (!(n(t.base_occupancy) >= 1) || n(t.max_occupancy) < n(t.base_occupancy)) return `${t.name}: max occupancy must be at least the base occupancy.`;
  if (n(t.max_extra_beds) < 0) return `${t.name}: extra beds cannot be negative.`;
  return '';
}

export function roomError(r: Room, all: readonly Room[], types: readonly RoomType[]): string {
  if (!r.number.trim()) return 'Every room needs a number.';
  if (all.some((x) => x.id !== r.id && x.number.trim().toLowerCase() === r.number.trim().toLowerCase())) return `Room ${r.number} is listed twice.`;
  if (!types.some((t) => t.id === r.room_type_id)) return `Room ${r.number}: choose its room type.`;
  return '';
}

/** Ids still used by a live booking (not removable). */
export function usedIds(reservations: readonly Reservation[]): Set<string> {
  const out = new Set<string>();
  for (const res of reservations) for (const l of res.lines) if (isLiveLine(l)) [l.room_type_id, l.room_id ?? '', l.rate_plan_id].forEach((x) => x && out.add(x));
  return out;
}

export function saveRoomTypes(rows: RoomType[], reservations: readonly Reservation[] = hotelDb.reservations()): void {
  const used = usedIds(reservations);
  for (const t of rows) {
    const e = roomTypeError(t, rows);
    if (e) throw new Error(e);
  }
  const gone = hotelDb.roomTypes().find((t) => used.has(t.id) && !rows.some((x) => x.id === t.id));
  if (gone) throw new Error(`${gone.name} is used by a booking.`);
  hotelDb.saveRoomTypes(rows.map((t) => ({ ...t, id: t.id || generateId(), name: t.name.trim(), code: t.code.trim().toUpperCase() })));
}

export function saveRooms(rows: Room[], reservations: readonly Reservation[] = hotelDb.reservations()): void {
  const types = hotelDb.roomTypes();
  const used = usedIds(reservations);
  for (const r of rows) {
    const e = roomError(r, rows, types);
    if (e) throw new Error(e);
  }
  const gone = hotelDb.rooms().find((r) => used.has(r.id) && !rows.some((x) => x.id === r.id));
  if (gone) throw new Error(`Room ${gone.number} is used by a booking.`);
  // Saving rooms fixes the starter room type too, so a room's type never dangles.
  if (usingStarter()) hotelDb.saveRoomTypes(types);
  hotelDb.saveRooms(rows.map((r) => ({ ...r, id: r.id || generateId(), number: r.number.trim() })));
}
