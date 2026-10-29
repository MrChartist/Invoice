/**
 * R7-C3 hotel reports — pure readers, no writes. Cut-first applied (PRD §5): occupancy by day / month / room type,
 * source mix and the night-audit history; the guest ledger and advances held are on every night-audit row, the city
 * ledger is Receivables filtered by the company. Occupancy / ADR / RevPAR per day come from the night-audit rows (A6)
 * or, for a day without an audit, from the stays and folio lines (`nightStats`, the same formulas). D14: complimentary
 * and house-use rooms count as occupied for occupancy but not for ADR; ADR = room revenue ÷ paid occupied rooms;
 * RevPAR = room revenue ÷ rooms available (active − out of order). Room revenue = room-kind folio lines (room, extra
 * bed, extra person, meal plan) of the night.
 */
import type { AuditStats, Folio, NightAudit, Reservation, Room, RoomType } from '../../types/hotel-r7';
import { round2 } from '../invoice-calc';
import { lineDates, oooOn } from './availability';
import { nightsBetween, nextDay } from './business-date';
import { nightStats, statsOf } from './night-audit';
import { ROOM_KINDS } from './room-post';

export interface DayRow extends AuditStats { day: string; basis: 'audit' | 'stays' }

/** One row per night `from`…`to` (inclusive). */
export function occupancyByDay(from: string, to: string, d: { audits: readonly NightAudit[]; rooms: readonly Room[]; reservations: readonly Reservation[]; folios: readonly Folio[] }): DayRow[] {
  const byDay = new Map(d.audits.map((a) => [a.business_date, a]));
  return nightsBetween(from, nextDay(to)).map((day) => {
    const a = byDay.get(day);
    return a ? { ...a.stats, day, basis: 'audit' } : { ...nightStats(day, d.rooms, d.reservations, d.folios), day, basis: 'stays' };
  });
}

const sumStats = (rows: readonly AuditStats[]): AuditStats => statsOf(rows.reduce((s, r) => ({
  available: s.available + r.available, occupied: s.occupied + r.occupied, complimentary: s.complimentary + r.complimentary,
  house: s.house + r.house, ooo: s.ooo + r.ooo, room_revenue: s.room_revenue + r.room_revenue,
}), { available: 0, occupied: 0, complimentary: 0, house: 0, ooo: 0, room_revenue: 0 }));

/** Day rows rolled up by month (sums, then the same formulas). */
export function byMonth(rows: readonly DayRow[]): (AuditStats & { month: string })[] {
  const m = new Map<string, DayRow[]>();
  for (const r of rows) m.set(r.day.slice(0, 7), [...(m.get(r.day.slice(0, 7)) ?? []), r]);
  return [...m].map(([month, list]) => ({ ...sumStats(list), month }));
}

/** Room revenue of one room line on one night (non-void room-kind folio lines). */
function lineRevenue(folios: readonly Folio[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of folios) for (const l of f.lines) {
    if (l.void || !ROOM_KINDS.has(l.kind) || !l.src?.line_id) continue;
    const k = `${l.src.line_id}|${l.date}`;
    out.set(k, round2((out.get(k) ?? 0) + l.amount));
  }
  return out;
}

interface Occ { res: Reservation; lineId: string; typeId: string; day: string; comp: boolean; revenue: number }

function occupiedNights(from: string, to: string, reservations: readonly Reservation[], folios: readonly Folio[]): Occ[] {
  const rev = lineRevenue(folios);
  const out: Occ[] = [];
  for (const res of reservations) for (const l of res.lines) {
    if (l.status !== 'checked_in' && l.status !== 'checked_out') continue;
    const d = lineDates(res, l);
    for (const day of nightsBetween(d.arrival < from ? from : d.arrival, d.departure)) {
      if (day > to) break;
      out.push({ res, lineId: l.id, typeId: l.room_type_id, day, comp: !!l.comp, revenue: rev.get(`${l.id}|${day}`) ?? 0 });
    }
  }
  return out;
}

/** Per room type for the period. */
export function byRoomType(from: string, to: string, d: { rooms: readonly Room[]; types: readonly RoomType[]; reservations: readonly Reservation[]; folios: readonly Folio[] }): (AuditStats & { type: string })[] {
  const occ = occupiedNights(from, to, d.reservations, d.folios);
  const days = nightsBetween(from, nextDay(to));
  return d.types.map((t) => {
    const rooms = d.rooms.filter((r) => r.active && r.room_type_id === t.id);
    const ooo = days.reduce((s, day) => s + rooms.filter((r) => oooOn(r, day)).length, 0);
    const mine = occ.filter((o) => o.typeId === t.id);
    const comp = (k: 'complimentary' | 'house') => mine.filter((o) => o.res.lines.find((l) => l.id === o.lineId)?.comp === k).length;
    return { ...statsOf({ available: rooms.length * days.length - ooo, occupied: mine.length, complimentary: comp('complimentary'), house: comp('house'), ooo, room_revenue: mine.reduce((s, o) => s + o.revenue, 0) }), type: t.name };
  });
}

/** Source of a booking: walk-in / phone / direct / company / agent, or the OTA's name. */
export const sourceOf = (r: Pick<Reservation, 'source' | 'ota'>): string => (r.source === 'ota' ? `OTA · ${r.ota?.name || '-'}` : r.source);

/** Room-nights (paid) and room revenue by source; totals equal the period's room revenue from stays. */
export function sourceMix(from: string, to: string, reservations: readonly Reservation[], folios: readonly Folio[]): { source: string; nights: number; revenue: number }[] {
  const m = new Map<string, { source: string; nights: number; revenue: number }>();
  for (const o of occupiedNights(from, to, reservations, folios)) {
    const k = sourceOf(o.res);
    const r = m.get(k) ?? { source: k, nights: 0, revenue: 0 };
    if (!o.comp) r.nights++;
    r.revenue = round2(r.revenue + o.revenue);
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue);
}
