/** SV-A2 appointment book: slots, overlaps, status flow, tokens, bill prefill, no-shows, texts, birthdays. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import type { Appointment } from '../src/types/services-r10.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import { appointmentDraft, appointmentText, billLines, billedMap, birthdaysIn, deleteAppointment, loadAppointments, noShowCount, saveAppointment, setAppointmentStatus, shownStatus, tomorrowList } from '../src/lib/services/sv-appointments.ts';
import { nextToken, overlaps, slotsFor, staffFree, weekdayOf } from '../src/lib/services/sv-slots.ts';
import { saveServiceSettings } from '../src/lib/services/sv-settings.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const appt = (over: Partial<Appointment> = {}) => saveAppointment({ date: '2026-10-27', start: '11:00', client_name: 'Asha', services: [{ name: 'Haircut', minutes: 30, price: 500 }, { name: 'Colour', minutes: 45, price: 2500, sv_class: 'beauty_9997' }], staff_id: 's1', ...over });

test('slots over opening hours, step, weekly off and breaks', () => {
  assert.equal(weekdayOf('2026-10-26'), 0, 'Monday');
  const s = { hours: Array.from({ length: 7 }, (_x, i) => (i === 6 ? { open: '10:00', close: '12:00', closed: true } : { open: '10:00', close: '12:00' })), slot_step: 30 as const };
  assert.deepEqual(slotsFor(s, '2026-10-27', 30), ['10:00', '10:30', '11:00', '11:30']);
  assert.deepEqual(slotsFor(s, '2026-10-27', 60), ['10:00', '10:30', '11:00']);
  assert.deepEqual(slotsFor(s, '2026-11-01', 30), [], 'closed on Sunday');
  const staff = { hours: { off_days: [1], breaks: [{ from: '10:30', to: '11:00' }] } };
  assert.deepEqual(slotsFor(s, '2026-10-26', 30, staff), ['10:00', '11:00', '11:30']);
  assert.deepEqual(slotsFor(s, '2026-10-27', 30, staff), [], 'weekly off on Tuesday');
  assert.equal(staffFree(undefined, '2026-10-27', 600, 30), true);
});

test('overlap is a warning: same staff or resource, same day, overlapping time; cancelled ignored', () => {
  const a = appt();
  assert.equal(a.minutes, 75);
  const b = appt({ start: '12:00', client_name: 'Bina' });
  assert.deepEqual(overlaps(b, loadAppointments()).map((x) => x.id), [a.id]);
  const c = appt({ start: '12:15', staff_id: 's2', client_name: 'C' });
  assert.deepEqual(overlaps(c, loadAppointments()), []);
  setAppointmentStatus(a.id, 'cancelled', 'Client called');
  assert.deepEqual(overlaps(b, loadAppointments()), []);
});

test('status flow: allowed moves only; no-show / cancel need a reason; daily token reset for walk-ins', () => {
  const a = appt();
  assert.equal(a.status, 'booked');
  assert.throws(() => setAppointmentStatus(a.id, 'done'), /cannot become/);
  assert.throws(() => setAppointmentStatus(a.id, 'no_show'), /reason/);
  setAppointmentStatus(a.id, 'arrived');
  assert.equal(setAppointmentStatus(a.id, 'in_service').queue, 'called');
  assert.equal(setAppointmentStatus(a.id, 'done').status, 'done');
  const w1 = appt({ source: 'walk-in' });
  const w2 = appt({ source: 'walk-in' });
  const w3 = appt({ source: 'walk-in', date: '2026-10-28' });
  assert.deepEqual([w1.token, w2.token, w3.token], [1, 2, 1]);
  assert.equal(w1.status, 'arrived');
  assert.equal(nextToken(loadAppointments(), '2026-10-27'), 3);
});

test('bill prefill: one line per service, staff on each, class rate by date, exempt column; billed derived from a live bill', () => {
  const a = appt();
  const lines = billLines(a, [{ id: 's1', name: 'Priya' }], '2026-10-27');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => [l.name, l.rate, l.sv?.staff_id, l.sv?.staff_name, l.sv?.appointment_id]), [['Haircut', 500, 's1', 'Priya', a.id], ['Colour', 2500, 's1', 'Priya', a.id]]);
  assert.equal(lines[1].tax_rate, 5, 'beauty after 22 Sep 2025: 5%');
  assert.equal(lines[1].hsn, '999721');
  assert.equal(billLines(a, [], '2025-09-21')[1].tax_rate, 18, 'before: 18%');
  const ex = billLines({ ...a, services: [{ name: 'Consult', minutes: 15, price: 500, sv_class: 'health_exempt' }] }, [], '2026-10-27')[0];
  assert.deepEqual([ex.tax_rate, ex.sv?.exempt], [0, 'EXEMPT']);
  // Bill in the editor: a draft with the lines; billed once a live bill carries them.
  const draft = appointmentDraft(a, [{ id: 's1', name: 'Priya' }], '2026-10-27');
  assert.equal(draft.status, 'Draft');
  assert.equal(shownStatus(a, billedMap(getTable<InvoiceRecord>('invoices'))), 'booked', 'a draft does not bill it');
  localDb.invoices.save({ ...draft, status: 'Sent' });
  assert.equal(shownStatus(a, billedMap(getTable<InvoiceRecord>('invoices'))), 'billed');
});

test('no-show count, reminder text, tomorrow list, delete', () => {
  const a = appt({ client_id: 'c1' });
  setAppointmentStatus(a.id, 'no_show', 'Did not come');
  appt({ client_id: 'c1', date: '2026-10-28' });
  assert.equal(noShowCount(loadAppointments(), { id: 'c1', name: 'Asha' }), 1);
  assert.equal(tomorrowList(loadAppointments(), '2026-10-27').length, 1);
  const t = appointmentText('reminder', a, { business: 'Glow', staff: 'Priya', date: '28 Oct', messages: { reminder: 'Hi {name}, {date} {time} with {staff} at {business}' } });
  assert.equal(t, 'Hi Asha, 28 Oct 11:00 with Priya at Glow');
  deleteAppointment(a.id);
  assert.equal(loadAppointments().length, 1);
});

test('birthday window across the year end; MM-DD or full date', () => {
  const clients = [{ id: 'a', name: 'A', dob: '01-02' }, { id: 'b', name: 'B', dob: '1990-12-30' }, { id: 'c', name: 'C', anniversary: '12-29' }, { id: 'd', name: 'D', dob: '06-01' }] as never[];
  const list = birthdaysIn(clients, '2026-12-28', 7);
  assert.deepEqual(list.map((x) => [x.client.id, x.day, x.kind]), [['c', '2026-12-29', 'anniversary'], ['b', '2026-12-30', 'dob'], ['a', '2027-01-02', 'dob']]);
});

test('desk settings: clean values only', () => {
  const s = saveServiceSettings({ slot_step: 7 as never, hours: [{ open: '9', close: 'x' }] as never, resources: [{ id: '', name: 'Chair 1', kind: 'chair' }] });
  assert.equal(s.slot_step, undefined);
  assert.equal(s.hours, undefined);
  assert.equal(s.resources?.[0].name, 'Chair 1');
  assert.ok(s.resources?.[0].id);
});
