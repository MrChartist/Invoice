/**
 * SV-C3 class bookings per occurrence (PENDING #21): a member books one meeting of a class — an appointment on that date
 * and time with `class_id` (additive), the class's staff and resource, no services (nothing to bill: the class is
 * covered by the member's plan). The occurrence must be a meeting day (weekday, dates, holidays); the class capacity caps
 * the live bookings of that day (cancelled / no-show bookings free the place); a member books a day once. The term
 * enrolment and its wait-list (`enrolMember`) are unchanged.
 */
import './sv-registry';
import type { Appointment, ClassSchedule } from '../../types/services-r10';
import { loadAppointments, saveAppointment, setAppointmentStatus } from './sv-appointments';
import { loadClasses, occurrences } from './sv-classes';

const live = (a: Appointment) => a.status !== 'cancelled' && a.status !== 'no_show';

/** Live bookings of a class on `date` (pure). */
export const bookingsOf = (all: readonly Appointment[], classId: string, date: string): Appointment[] =>
  all.filter((a) => a.class_id === classId && a.date === date && live(a));

/** Places left on `date` (Infinity without a capacity). */
export const placesLeft = (c: Pick<ClassSchedule, 'id' | 'capacity'>, all: readonly Appointment[], date: string): number =>
  c.capacity ? Math.max(0, c.capacity - bookingsOf(all, c.id, date).length) : Infinity;

/** Pure check: '' when `client` may book `c` on `date`, else why not. */
export function bookingProblem(c: ClassSchedule, all: readonly Appointment[], date: string, client: { id?: string; name: string }): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !occurrences(c, date, date).length) return `${c.name} does not meet on ${date || 'that day'}.`;
  if (c.active === false) return `${c.name} is not active.`;
  const mine = bookingsOf(all, c.id, date).some((a) => (client.id ? a.client_id === client.id : a.client_name.trim().toLowerCase() === client.name.trim().toLowerCase()));
  if (mine) return `${client.name} is already booked on ${date}.`;
  if (!placesLeft(c, all, date)) return `${c.name} on ${date} is full (${c.capacity} booked).`;
  return '';
}

/** Book `client` into the class meeting on `date` (an appointment with `class_id`). */
export function bookOccurrence(classId: string, date: string, client: { id?: string; name: string; phone?: string }): Appointment {
  const c = loadClasses().find((x) => x.id === classId);
  if (!c) throw new Error('Class not found.');
  const why = bookingProblem(c, loadAppointments(), date, client);
  if (why) throw new Error(why);
  return saveAppointment({
    date, start: c.start, minutes: c.minutes, client_id: client.id, client_name: client.name, ...(client.phone ? { phone: client.phone } : {}),
    services: [], ...(c.staff_id ? { staff_id: c.staff_id } : {}), ...(c.resource_id ? { resource_id: c.resource_id } : {}), class_id: c.id, notes: c.name,
  });
}

/** Cancel a booking (the place frees up). */
export const cancelBooking = (id: string, reason = 'Booking cancelled'): Appointment => setAppointmentStatus(id, 'cancelled', reason);
