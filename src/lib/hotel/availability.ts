/**
 * R7-A3 availability (pure). A room is taken on a night by any live room line whose nights cover it (the departure
 * day is free) and is unavailable while inactive or out of order (A5: `ooo` range, both days inclusive). A booking
 * without a room is allowed up to the type's free count per night; the last free room gives a warning.
 */
import type { Reservation, Room, RoomLine } from '../../types/hotel-r7';
import { nightsBetween } from './business-date';

export const isLiveLine = (l: Pick<RoomLine, 'status'>): boolean => l.status === 'booked' || l.status === 'checked_in';
export const isLiveRes = (r: Pick<Reservation, 'status'>): boolean => r.status === 'tentative' || r.status === 'confirmed' || r.status === 'checked_in';

/** The line's own dates, else the reservation's. */
export const lineDates = (res: Pick<Reservation, 'arrival' | 'departure'>, l: Pick<RoomLine, 'arrival' | 'departure'>) => ({
  arrival: l.arrival || res.arrival,
  departure: l.departure || res.departure,
});

/** Out of order (or inactive) on `night`. */
export function oooOn(room: Pick<Room, 'active' | 'ooo' | 'hk_status'>, night: string): boolean {
  if (!room.active) return true;
  if (room.ooo) return room.ooo.from <= night && night <= room.ooo.to;
  return room.hk_status === 'ooo';
}

export interface AvailCtx {
  rooms: readonly Room[];
  reservations: readonly Reservation[];
  /** The reservation being edited (left out of "taken"). */
  exceptResId?: string;
}

interface Taken {
  rooms: Set<string>;
  /** Unassigned lines per room type. */
  open: Map<string, number>;
}

function takenOn(ctx: AvailCtx, night: string): Taken {
  const t: Taken = { rooms: new Set(), open: new Map() };
  for (const r of ctx.reservations) {
    if (r.id === ctx.exceptResId || !isLiveRes(r)) continue;
    for (const l of r.lines) {
      if (!isLiveLine(l)) continue;
      const d = lineDates(r, l);
      if (!(d.arrival <= night && night < d.departure)) continue;
      if (l.room_id) t.rooms.add(l.room_id);
      else t.open.set(l.room_type_id, (t.open.get(l.room_type_id) ?? 0) + 1);
    }
  }
  return t;
}

const freeOf = (ctx: AvailCtx, typeId: string | undefined, night: string, t: Taken) =>
  ctx.rooms.filter((r) => (!typeId || r.room_type_id === typeId) && !oooOn(r, night) && !t.rooms.has(r.id));

/** Rooms of a type (any type when omitted) free on every night of [from, to). */
export function freeRooms(typeId: string | undefined, from: string, to: string, ctx: AvailCtx): Room[] {
  const nights = nightsBetween(from, to);
  const per = nights.map((n) => new Set(freeOf(ctx, typeId, n, takenOn(ctx, n)).map((r) => r.id)));
  return ctx.rooms.filter((r) => (!typeId || r.room_type_id === typeId) && per.every((s) => s.has(r.id)));
}

/** How many more rooms of a type can still be sold for [from, to) (the tightest night). */
export function typeFreeCount(typeId: string, from: string, to: string, ctx: AvailCtx): number {
  const nights = nightsBetween(from, to);
  if (!nights.length) return 0;
  return Math.min(...nights.map((n) => {
    const t = takenOn(ctx, n);
    return freeOf(ctx, typeId, n, t).length - (t.open.get(typeId) ?? 0);
  }));
}

/**
 * Can these lines be booked? Refuses an overbooked room (or a type with nothing left); warns on the last free room
 * of a type. Lines are checked in order, so two lines of one booking cannot take the same room.
 */
export function checkLines(res: Pick<Reservation, 'arrival' | 'departure' | 'lines'>, ctx: AvailCtx, typeName: (id: string) => string = (id) => id): { error: string; warnings: string[] } {
  const warnings: string[] = [];
  const byNight = new Map<string, Taken>();
  const at = (n: string) => byNight.get(n) ?? byNight.set(n, takenOn(ctx, n)).get(n)!;
  const roomNo = (id: string) => ctx.rooms.find((r) => r.id === id)?.number ?? id;
  for (const l of res.lines) {
    if (!isLiveLine(l)) continue;
    const d = lineDates(res, l);
    if (!(d.arrival < d.departure)) return { error: 'The departure must be after the arrival.', warnings };
    for (const n of nightsBetween(d.arrival, d.departure)) {
      const t = at(n);
      if (l.room_id) {
        const room = ctx.rooms.find((r) => r.id === l.room_id);
        if (!room) return { error: 'That room no longer exists.', warnings };
        if (oooOn(room, n)) return { error: `Room ${room.number} is out of order on ${n}.`, warnings };
        if (t.rooms.has(room.id)) return { error: `Room ${roomNo(room.id)} is already booked on ${n}.`, warnings };
        const left = freeOf(ctx, l.room_type_id, n, t).length - (t.open.get(l.room_type_id) ?? 0);
        if (left < 1) return { error: `No ${typeName(l.room_type_id)} room is free on ${n}.`, warnings };
        t.rooms.add(room.id);
      } else {
        const left = freeOf(ctx, l.room_type_id, n, t).length - (t.open.get(l.room_type_id) ?? 0);
        if (left < 1) return { error: `No ${typeName(l.room_type_id)} room is free on ${n}.`, warnings };
        if (left === 1) warnings.push(`Last ${typeName(l.room_type_id)} room on ${n}.`);
        t.open.set(l.room_type_id, (t.open.get(l.room_type_id) ?? 0) + 1);
      }
    }
  }
  return { error: '', warnings: [...new Set(warnings)] };
}
