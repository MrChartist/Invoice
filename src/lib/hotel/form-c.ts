/**
 * R7-C2 Form C desk. A foreign guest's room line carries `form_c` (set at check-in by R7-A4: due = check-in +
 * `FORM_C_HOURS_RULES` hours — 24 under the Immigration and Foreigners Act 2025 from 1 Sep 2025, as reported; verify,
 * HT13). The app prepares the data sheet in the portal's order (`FORM_C_FIELDS`) and tracks the clock; the user files
 * on the Bureau of Immigration site (boi.gov.in) — nothing is uploaded. "Mark filed" records the time and the
 * reference; "check-out updated" is the second tick after departure. Instants are ISO strings; the deadline is
 * clock time, so it runs across midnight.
 */
import type { ForeignDetails, Guest, Reservation, RoomLine } from '../../types/hotel-r7';
import { localDayOf } from '../dates';
import { formCRule } from './hotel-rules';
import { FORM_C_FIELDS, isIndian } from './guests';
import { HotelError } from './reservations';
import { hotelDb } from './hotel-store';

export type FormCStatus = 'due' | 'overdue' | 'filed' | 'departed_not_updated' | 'done';
export const FORM_C_STATUSES: readonly FormCStatus[] = ['overdue', 'due', 'departed_not_updated', 'filed', 'done'];
/** The bell warns this many hours before the deadline. */
export const FORM_C_WARN_HOURS = 6;

/** Deadline for a check-in at `checkedInAt` (ISO): + the rule's hours in force on the local check-in day. */
export function formCDue(checkedInAt: string): string {
  const at = new Date(checkedInAt);
  return new Date(at.getTime() + formCRule(localDayOf(at)).hours * 3_600_000).toISOString();
}

/** Hours left until the deadline (negative = overdue), to one decimal. */
export const hoursLeft = (dueAt: string, now: Date): number => Math.round((Date.parse(dueAt) - now.getTime()) / 360_000) / 10;

export function formCStatus(l: Pick<RoomLine, 'form_c' | 'status'>, now: Date): FormCStatus | null {
  const f = l.form_c;
  if (!f) return null;
  if (!f.filed_at) return Date.parse(f.due_at) < now.getTime() ? 'overdue' : 'due';
  if (l.status === 'checked_out') return f.checkout_updated_at ? 'done' : 'departed_not_updated';
  return 'filed';
}

export interface FormCRow {
  res: Reservation;
  line: RoomLine;
  guests: Guest[];
  status: FormCStatus;
  due_at: string;
  hours: number;
}

/** Foreign-guest rows (lines with a Form C clock), most urgent first. Indian guests have no clock, so no row. */
export function formCRows(reservations: readonly Reservation[], guests: readonly Guest[], now: Date): FormCRow[] {
  const byId = new Map(guests.map((g) => [g.id, g]));
  const out: FormCRow[] = [];
  for (const res of reservations) {
    for (const line of res.lines) {
      const status = formCStatus(line, now);
      if (!status || !line.form_c) continue;
      const gs = (line.guest_ids ?? []).map((id) => byId.get(id)).filter((g): g is Guest => !!g && !isIndian(g.nationality));
      out.push({ res, line, guests: gs, status, due_at: line.form_c.due_at, hours: hoursLeft(line.form_c.due_at, now) });
    }
  }
  return out.sort((a, b) => FORM_C_STATUSES.indexOf(a.status) - FORM_C_STATUSES.indexOf(b.status) || a.due_at.localeCompare(b.due_at));
}

/** Data sheet of one guest: personal, then the Form C fields in the portal's order, then the stay. */
export function dataSheet(g: Guest, res: Reservation, line: RoomLine, roomNo: string): [string, string][] {
  const f: ForeignDetails = g.foreign ?? {};
  return [
    ['name', g.name], ['nationality', g.nationality ?? ''], ['dob', g.dob ?? ''], ['address', g.address ?? ''],
    ...FORM_C_FIELDS.map((k) => [k, String(f[k] ?? '')] as [string, string]),
    ['checked_in_at', line.checked_in_at ?? ''], ['arrival', line.arrival ?? res.arrival], ['departure', line.departure ?? res.departure],
    ['room', roomNo], ['booking', res.number],
  ];
}

/** "Copy all" text: `label: value` lines. */
export const sheetText = (rows: readonly [string, string][], label: (k: string) => string = (k) => k): string =>
  rows.map(([k, v]) => `${label(k)}: ${v}`).join('\n');

function patchLine(resId: string, lineId: string, fn: (l: RoomLine) => RoomLine): Reservation {
  const res = hotelDb.reservation(resId);
  const line = res?.lines.find((l) => l.id === lineId);
  if (!res || !line?.form_c) throw new HotelError('No Form C for this room.');
  const next = { ...res, lines: res.lines.map((l) => (l.id === lineId ? fn(l) : l)) };
  hotelDb.putReservations(next);
  return next;
}

/** "Mark filed" with the portal's reference (`doc.create`). */
export function markFiled(resId: string, lineId: string, ref: string, at: Date = new Date()): Reservation {
  const r = ref.trim();
  if (!r) throw new HotelError('Enter the Form C reference number.');
  return patchLine(resId, lineId, (l) => ({ ...l, form_c: { ...l.form_c!, filed_at: at.toISOString(), ref: r } }));
}

/** Second tick: the check-out was updated on the portal (after departure, once filed). */
export function markCheckoutUpdated(resId: string, lineId: string, at: Date = new Date()): Reservation {
  return patchLine(resId, lineId, (l) => {
    if (!l.form_c?.filed_at || l.status !== 'checked_out') throw new HotelError('Mark it filed and check the guest out first.');
    return { ...l, form_c: { ...l.form_c, checkout_updated_at: at.toISOString() } };
  });
}
