/**
 * R7-A3 reservations: number `RES/FY…` (series counter, never reused), availability (no overbooking), nightly price
 * snapshots, cancel / no-show (rooms released; the B6 charge is R7-B's), lists and the confirmation text.
 *
 * A booking snapshots each night's price: a later plan edit never reprices it; changing its dates / occupancy prices
 * only the new nights, and "Re-price" (`reprice: true`) recomputes every night. Period lock: creating or editing the
 * terms of a booking whose arrival is in a locked period is refused (status changes — check-in / out — are not); an
 * in-house stay is checked per changed night, so it can be extended past a locked arrival month (QA9 H16).
 */
import type { NightPrice, RatePlan, Reservation, RoomLine, RoomType } from '../../types/hotel-r7';
import { generateId } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { todayIso } from '../tax-rules';
import { round2 } from '../invoice-calc';
import { RES_PREFIX, hotelDb, persistStarters, usingStarter } from './hotel-store';
import { checkLines, isLiveLine, isLiveRes, lineDates } from './availability';
import { minStayError, priceNight, stayTotal } from './pricing';
import { nightsBetween } from './business-date';
import { accommodationBand } from './hotel-rules';
import { saveAdvance, senderSnapshot } from '../advances';
import { checkGstin } from '../gstin';
import { localDb } from '../localDb';
import type { AdvanceRecord } from '../../types/advances';

export class HotelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HotelError';
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const lockOf = (r: Pick<Reservation, 'id' | 'arrival' | 'number'>) => ({ id: r.id, issue_date: r.arrival, invoice_number: r.number });

export const nextResNumber = (date: string, rows: readonly Pick<Reservation, 'number'>[] = hotelDb.reservations()): string =>
  nextSeriesNumberFor(RES_PREFIX, date, rows.map((r) => r.number));

export type ReservationInput = Omit<Reservation, 'id' | 'number' | 'status' | 'lines'> & {
  id?: string;
  status?: Reservation['status'];
  lines: (Omit<RoomLine, 'id' | 'nightly' | 'status'> & Partial<Pick<RoomLine, 'id' | 'nightly' | 'status'>>)[];
};

interface Masters {
  types: readonly RoomType[];
  plans: readonly RatePlan[];
}

/** Nightly snapshot of a line: kept nights reuse the old price unless `reprice`. */
export function priceLine(line: Pick<RoomLine, 'room_type_id' | 'rate_plan_id' | 'adults' | 'children' | 'extra_beds'> & { nightly?: NightPrice[] }, arrival: string, departure: string, m: Masters, reprice = false, prev?: RoomLine): NightPrice[] {
  const plan = m.plans.find((p) => p.id === line.rate_plan_id);
  const type = m.types.find((t) => t.id === line.room_type_id);
  if (!plan || !type) throw new HotelError('Choose the room type and the rate plan.');
  const same = prev && prev.rate_plan_id === line.rate_plan_id && prev.room_type_id === line.room_type_id && prev.adults === line.adults && prev.children === line.children && prev.extra_beds === line.extra_beds;
  const keep = new Map((!reprice && same ? prev.nightly : []).map((x) => [x.night, x]));
  return nightsBetween(arrival, departure).map((night) => keep.get(night) ?? priceNight(plan, type, { night, adults: line.adults, children: line.children, extraBeds: line.extra_beds }));
}

function validate(input: ReservationInput, m: Masters): string {
  if (!DAY.test(input.arrival) || !DAY.test(input.departure) || input.departure <= input.arrival) return 'Choose the arrival and a later departure.';
  if (!input.guest?.name?.trim()) return 'Enter the guest name.';
  if (!input.lines.length) return 'Add at least one room.';
  for (const l of input.lines) {
    const type = m.types.find((t) => t.id === l.room_type_id);
    const plan = m.plans.find((p) => p.id === l.rate_plan_id);
    if (!type || !plan) return 'Choose the room type and the rate plan.';
    if (!(l.adults >= 1)) return 'At least one adult per room.';
    if (l.adults + (l.children || 0) > type.max_occupancy + (l.extra_beds || 0)) return `${type.name}: more guests than the room holds.`;
    if ((l.extra_beds || 0) > type.max_extra_beds) return `${type.name}: at most ${type.max_extra_beds} extra bed(s).`;
    const d = lineDates(input, l);
    const e = minStayError(plan, nightsBetween(d.arrival, d.departure).length);
    if (e) return e;
  }
  return '';
}

/** Create or edit a booking. Returns the saved row and any "last room" warnings. */
export function saveReservation(input: ReservationInput, opts: { reprice?: boolean; now?: Date } = {}): { res: Reservation; warnings: string[] } {
  requireAccess('doc.create');
  const m: Masters = { types: hotelDb.roomTypes(), plans: hotelDb.ratePlans() };
  const err = validate(input, m);
  if (err) throw new HotelError(err);
  const all = hotelDb.reservations();
  const prev = input.id ? all.find((r) => r.id === input.id) : undefined;
  if (prev && !isLiveRes(prev)) throw new HotelError(`${prev.number} is ${prev.status.replace('_', ' ')} and cannot be changed.`);
  const id = prev?.id ?? generateId();
  const booked_on = prev?.booked_on ?? (DAY.test(input.booked_on ?? '') ? input.booked_on : todayIso(opts.now));
  const number = prev?.number ?? nextResNumber(booked_on, all);
  // QA9 H16: an in-house stay is checked night by night — an edit that changes only nights after the lock date (an
  // extension, a later room move) is allowed; a booking not yet in is checked on its arrival as before.
  const inHouse = !!prev?.lines.some((l) => l.status === 'checked_in');
  if (prev && !inHouse) assertUnlocked(lockOf(prev), 'edit');
  if (!inHouse) assertUnlocked({ id, issue_date: input.arrival, invoice_number: number }, prev ? 'edit' : 'create');
  const lines: RoomLine[] = input.lines.map((l) => {
    const old = l.id ? prev?.lines.find((x) => x.id === l.id) : undefined;
    const d = lineDates(input, l);
    const status = l.status ?? old?.status ?? 'booked';
    return {
      ...old, ...l, id: l.id || generateId(), status,
      nightly: isLiveLine({ status }) ? priceLine(l, d.arrival, d.departure, m, opts.reprice, old) : (old?.nightly ?? l.nightly ?? []),
    } as RoomLine;
  });
  if (inHouse) for (const night of changedNights(prev!, { ...input, lines })) assertUnlocked({ id, issue_date: night, invoice_number: number }, 'edit');
  const rooms = hotelDb.rooms();
  const check = checkLines({ arrival: input.arrival, departure: input.departure, lines }, { rooms, reservations: all, exceptResId: id }, (t) => m.types.find((x) => x.id === t)?.name ?? t);
  if (check.error) throw new HotelError(check.error);
  const nowIso = (opts.now ?? new Date()).toISOString();
  const res: Reservation = {
    ...prev, ...input, id, number, booked_on, lines,
    status: input.status ?? prev?.status ?? 'confirmed',
    guest: { ...input.guest, name: input.guest.name.trim() },
    created_at: prev?.created_at ?? nowIso,
    ...(prev ? { updated_at: nowIso } : {}),
  };
  if (usingStarter()) persistStarters();
  hotelDb.putReservations(res);
  recordSeries(number);
  return { res, warnings: check.warnings };
}

/** Nights whose terms differ between two versions of a booking (room, plan, occupancy, price, or added / removed). */
export function changedNights(a: Pick<Reservation, 'arrival' | 'departure' | 'lines'>, b: Pick<Reservation, 'arrival' | 'departure' | 'lines'>): string[] {
  const terms = (r: typeof a) => {
    const m = new Map<string, string>();
    for (const l of r.lines) {
      const d = lineDates(r, l);
      for (const n of l.nightly) if (n.night >= d.arrival && n.night < d.departure) m.set(`${l.id}|${n.night}`, JSON.stringify([l.status === 'cancelled', l.room_id, l.rate_plan_id, l.adults, l.children, l.extra_beds, l.comp, n.total]));
    }
    return m;
  };
  const x = terms(a);
  const y = terms(b);
  const out = new Set<string>();
  for (const k of new Set([...x.keys(), ...y.keys()])) if (x.get(k) !== y.get(k)) out.add(k.split('|')[1]);
  return [...out].sort();
}

/** Cancel (or mark a no-show): every line not checked in is released. Charges are R7-B6. */
export function closeReservation(id: string, kind: 'cancelled' | 'no_show', reason = '', now: Date = new Date()): Reservation {
  requireAccess('doc.create');
  const prev = hotelDb.reservation(id);
  if (!prev) throw new HotelError('This booking no longer exists.');
  if (prev.status !== 'tentative' && prev.status !== 'confirmed') throw new HotelError(`${prev.number} is ${prev.status.replace('_', ' ')}.`);
  const res: Reservation = {
    ...prev, status: kind, lines: prev.lines.map((l) => (l.status === 'booked' ? { ...l, status: kind } : l)),
    ...(reason ? { notes: [prev.notes, `${kind === 'cancelled' ? 'Cancelled' : 'No-show'}: ${reason}`].filter(Boolean).join('\n') } : {}),
    updated_at: now.toISOString(),
  };
  hotelDb.putReservations(res);
  return res;
}

/* ── Lists ─────────────────────────────────────────────────────── */

const live = (rows: readonly Reservation[]) => rows.filter(isLiveRes);
export const arrivalsOn = (rows: readonly Reservation[], day: string) => live(rows).filter((r) => r.lines.some((l) => l.status === 'booked' && lineDates(r, l).arrival <= day && day < lineDates(r, l).departure));
export const departuresOn = (rows: readonly Reservation[], day: string) => live(rows).filter((r) => r.lines.some((l) => l.status === 'checked_in' && lineDates(r, l).departure <= day));
export const inHouseOn = (rows: readonly Reservation[], day: string) => rows.filter((r) => r.lines.some((l) => l.status === 'checked_in' && lineDates(r, l).arrival <= day && day < lineDates(r, l).departure));

export function searchReservations(rows: readonly Reservation[], q: string): Reservation[] {
  const s = q.trim().toLowerCase();
  if (!s) return [...rows];
  const digits = s.replace(/\D/g, '');
  return rows.filter((r) => r.number.toLowerCase().includes(s) || r.guest.name.toLowerCase().includes(s) || (digits.length >= 4 && (r.guest.phone ?? '').replace(/\D/g, '').includes(digits)));
}

/** Booked value of a reservation (pre-GST). */
export const reservationValue = (r: Pick<Reservation, 'lines'>): number =>
  round2(r.lines.filter((l) => l.status !== 'cancelled' && !l.comp).reduce((s, l) => s + stayTotal(l.nightly), 0));

/**
 * GST rate an advance for this booking carries (C1 band of its booked nights; a mixed stay takes the higher rate —
 * working paper, verify with your CA). D6: the advance keeps this rate.
 */
export function advanceRate(r: Pick<Reservation, 'lines'>): number {
  let rate = 0;
  for (const l of r.lines) for (const n of l.nightly) rate = Math.max(rate, accommodationBand(n.total, n.night).rate);
  return rate;
}

/**
 * "Take advance" (A3): an advance receipt voucher (Rule 50, `advances.ts`) from the bill-to party (else the guest), for
 * services, place of supply = the property's state (F6), GST at `advanceRate` — then linked on the booking.
 */
export function takeAdvance(resId: string, input: { amount: number; method: string; date?: string; reference?: string; bankAccountId?: string }): AdvanceRecord {
  requireAccess('doc.create');
  const res = hotelDb.reservation(resId);
  if (!res || !isLiveRes(res)) throw new HotelError('This booking cannot take an advance.');
  const sender = senderSnapshot();
  const pos = sender?.stateCode || checkGstin(sender?.companyGstin ?? '').stateCode || '';
  const c = res.bill_to ? localDb.clients.getAll().find((x) => x.id === res.bill_to?.client_id) : undefined;
  const adv = saveAdvance({
    date: input.date || todayIso(),
    client: c ? { id: c.id, name: c.name, company: c.company, gstin: c.gstin, address: c.address, state_code: c.state_code } : { name: res.guest.name },
    place_of_supply: pos, supply: 'services', tax_rate: advanceRate(res), amount: input.amount, method: input.method,
    reference: input.reference, bankAccountId: input.bankAccountId, description: `Room advance · ${res.number} (${res.arrival} → ${res.departure})`,
  });
  hotelDb.putReservations({ ...res, advance_ids: [...(res.advance_ids ?? []), adv.id], guarantee: res.guarantee === 'none' ? 'advance' : res.guarantee });
  return adv;
}
