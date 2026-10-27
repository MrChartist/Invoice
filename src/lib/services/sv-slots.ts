/**
 * SV-A2 slot maths (pure): opening hours per weekday, slot step, per-staff weekly offs and breaks; overlap detection
 * (a warning, never a block — double booking is normal); the walk-in token of the day. Bare dates are local days.
 */
import type { Appointment, ServiceSettings, ServiceStaff } from '../../types/services-r10';
import { hoursOf } from './sv-settings';

export const toMin = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
export const fromMin = (n: number): string => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** Weekday of a `YYYY-MM-DD` local day, Monday = 0 … Sunday = 6. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/** Is the staff member working on `day` at `start` for `minutes` (weekly off, breaks)? */
export function staffFree(staff: Pick<ServiceStaff, 'hours'> | undefined, day: string, start: number, minutes: number): boolean {
  if (!staff?.hours) return true;
  if (staff.hours.off_days?.includes(weekdayOf(day))) return false;
  return !(staff.hours.breaks ?? []).some((b) => start < toMin(b.to) && toMin(b.from) < start + minutes);
}

/** Slot start times of a day for `minutes` of work: inside opening hours, on the step, staff off / breaks left out. */
export function slotsFor(s: ServiceSettings, day: string, minutes: number, staff?: Pick<ServiceStaff, 'hours'>): string[] {
  const h = hoursOf(s, weekdayOf(day));
  if (h.closed) return [];
  const step = s.slot_step ?? 15;
  const open = toMin(h.open);
  const close = toMin(h.close);
  const out: string[] = [];
  for (let t = open; t + Math.max(minutes, step) <= close; t += step) if (staffFree(staff, day, t, Math.max(minutes, 1))) out.push(fromMin(t));
  return out;
}

const live = (a: Appointment) => a.status !== 'cancelled' && a.status !== 'no_show';

/** Live appointments on the same day sharing the staff member or the resource and overlapping `a` (warning only). */
export function overlaps(a: Pick<Appointment, 'id' | 'date' | 'start' | 'minutes' | 'staff_id' | 'resource_id'>, all: readonly Appointment[]): Appointment[] {
  const s = toMin(a.start);
  const e = s + Math.max(1, a.minutes);
  return all.filter((b) => b.id !== a.id && b.date === a.date && live(b)
    && ((!!a.staff_id && b.staff_id === a.staff_id) || (!!a.resource_id && b.resource_id === a.resource_id))
    && s < toMin(b.start) + Math.max(1, b.minutes) && toMin(b.start) < e);
}

/** Next walk-in token of the day (tokens reset every day). */
export const nextToken = (all: readonly Pick<Appointment, 'date' | 'token'>[], day: string): number =>
  all.reduce((m, a) => (a.date === day && (a.token ?? 0) > m ? a.token! : m), 0) + 1;

/** Duration of a set of services (at least one step). */
export const durationOf = (services: readonly { minutes: number }[], step = 15): number => Math.max(step, services.reduce((s, x) => s + (Number(x.minutes) || 0), 0));
