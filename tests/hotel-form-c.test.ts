/** R7-C2 Form C desk and hotel bell: the 24-hour clock across midnight, rows by status, filing, the check-out tick, the
 * bell rows (Form C, arrivals, due-outs, audit, declaration window) and the pack gate. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupHotel } from './helpers/hotel.ts';
import { walkIn, markCheckedOut } from '../src/lib/hotel/checkin.ts';
import { hotelDb, HOTEL_SETTINGS_KEY } from '../src/lib/hotel/hotel-store.ts';
import { FORM_C_FIELDS } from '../src/lib/hotel/guests.ts';
import { dataSheet, formCDue, formCRows, formCStatus, hoursLeft, markCheckoutUpdated, markFiled, sheetText } from '../src/lib/hotel/form-c.ts';
import { hotelNotices, registerHotelAlerts } from '../src/lib/hotel/hotel-alerts.ts';
import { buildContext, collectNotifications } from '../src/lib/notifications.ts';
import { DB_PREFIX, getJson, setJson, setReadTrace } from '../src/lib/storage.ts';
import { HOTEL_TABLES } from '../src/lib/hotel/hotel-store.ts';
import { setActorProvider } from '../src/lib/access.ts';

afterEach(() => setActorProvider(null));

const FOREIGN = {
  name: 'Jane Doe', nationality: 'GB', address: '1 High St, London',
  foreign: { passport_no: 'P123', passport_place: 'London', passport_issued: '2020-01-01', passport_expiry: '2030-01-01', visa_no: 'V9', visa_type: 'e-Tourist', visa_place: 'Online', visa_issued: '2026-09-01', visa_expiry: '2027-03-01', arrived_india_on: '2026-10-19', arrived_from: 'London', next_destination: 'Goa', purpose: 'Tourism', address_in_india: 'Hotel, Pune' },
};
const IN_GUEST = { name: 'Asha Rao', nationality: 'IN' };
const stay = (guest: Record<string, unknown>, at: Date, roomId = 'r101') => walkIn({
  booking: { guest: { name: String(guest.name) }, arrival: '2026-10-20', departure: '2026-10-22', guarantee: 'none', lines: [{ room_type_id: 'dlx', rate_plan_id: 'ep', adults: 1, children: 0, extra_beds: 0 }] } as never,
  roomId, guests: [guest as never], at,
});

test('deadline = check-in + 24 h, across midnight and before the 2025 Act', () => {
  assert.equal(formCDue('2026-10-26T22:30:00.000Z'), '2026-10-27T22:30:00.000Z');
  assert.equal(formCDue('2026-03-31T23:59:00.000Z'), '2026-04-01T23:59:00.000Z');
  assert.equal(formCDue('2024-06-01T10:00:00.000Z'), '2024-06-02T10:00:00.000Z', 'Foreigners Act 1946 row: also 24 h');
  assert.equal(hoursLeft('2026-10-27T22:30:00.000Z', new Date('2026-10-27T17:00:00.000Z')), 5.5);
  assert.equal(hoursLeft('2026-10-27T22:30:00.000Z', new Date('2026-10-28T00:30:00.000Z')), -2);
  const line = { status: 'checked_in' as const, form_c: { due_at: '2026-10-27T22:30:00.000Z' } };
  assert.equal(formCStatus(line, new Date('2026-10-27T22:29:00.000Z')), 'due');
  assert.equal(formCStatus(line, new Date('2026-10-27T22:31:00.000Z')), 'overdue');
  assert.equal(formCStatus({ ...line, form_c: { ...line.form_c, filed_at: 'x' } }, new Date()), 'filed');
  assert.equal(formCStatus({ status: 'checked_out', form_c: { ...line.form_c, filed_at: 'x' } }, new Date()), 'departed_not_updated');
  assert.equal(formCStatus({ status: 'checked_out', form_c: { ...line.form_c, filed_at: 'x', checkout_updated_at: 'y' } }, new Date()), 'done');
  assert.equal(formCStatus({ status: 'checked_in' }, new Date()), null);
});

test('rows: a foreign guest has one, an Indian guest none; filing clears it; the check-out tick follows departure', () => {
  setupHotel('2026-10-20');
  const at = new Date('2026-10-20T22:00:00');
  const f = stay(FOREIGN, at);
  stay(IN_GUEST, at, 'r102');
  const rows = formCRows(hotelDb.reservations(), hotelDb.guests(), new Date('2026-10-21T18:00:00'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'due');
  assert.equal(rows[0].due_at, new Date('2026-10-21T22:00:00').toISOString(), '22:00 check-in → 22:00 next day');
  assert.equal(rows[0].hours, 4);
  assert.equal(formCRows(hotelDb.reservations(), hotelDb.guests(), new Date('2026-10-21T22:30:00'))[0].status, 'overdue');
  // data sheet: personal, then FORM_C_FIELDS in order, then the stay
  const sheet = dataSheet(rows[0].guests[0], rows[0].res, rows[0].line, '101');
  assert.deepEqual(sheet.slice(4, 4 + FORM_C_FIELDS.length).map(([k]) => k), [...FORM_C_FIELDS]);
  assert.match(sheetText(sheet), /^name: Jane Doe\nnationality: GB/);
  assert.throws(() => markFiled(f.res.id, f.line.id, ' '), /reference/);
  assert.throws(() => markCheckoutUpdated(f.res.id, f.line.id), /check the guest out/);
  markFiled(f.res.id, f.line.id, 'FRRO-77', new Date('2026-10-21T10:00:00'));
  const filed = formCRows(hotelDb.reservations(), hotelDb.guests(), new Date('2026-10-22T10:00:00'));
  assert.equal(filed[0].status, 'filed');
  assert.equal(filed[0].line.form_c?.ref, 'FRRO-77');
  markCheckedOut(f.res.id, f.line.id, new Date('2026-10-22T10:00:00'));
  assert.equal(formCRows(hotelDb.reservations(), hotelDb.guests(), new Date())[0].status, 'departed_not_updated');
  markCheckoutUpdated(f.res.id, f.line.id);
  assert.equal(formCRows(hotelDb.reservations(), hotelDb.guests(), new Date())[0].status, 'done');
});

const data = (over: Record<string, unknown> = {}) => ({ reservations: hotelDb.reservations(), guests: hotelDb.guests(), settings: hotelDb.settings(), audited: true, ...over });

test('bell: Form C within 6 h (warning) / overdue (critical); filed clears it', () => {
  setupHotel('2026-10-20');
  const f = stay(FOREIGN, new Date('2026-10-20T22:00:00'));
  const ids = (now: string) => hotelNotices(data({ audited: false }), new Date(now)).filter((n) => n.id.startsWith('ht:fc')).map((n) => `${n.severity}`);
  assert.deepEqual(ids('2026-10-21T10:00:00'), [], 'more than 6 h left');
  assert.deepEqual(ids('2026-10-21T17:00:00'), ['warning']);
  assert.deepEqual(ids('2026-10-21T22:01:00'), ['critical']);
  markFiled(f.res.id, f.line.id, 'REF');
  assert.deepEqual(ids('2026-10-21T22:01:00'), []);
});

test('bell: arrivals after check-in time + 4 h, due-outs past check-out time, the missed night audit', () => {
  setupHotel('2026-10-20');
  const g = { guest: { name: 'Late' }, arrival: '2026-10-21', departure: '2026-10-22', guarantee: 'none', booked_on: '2026-10-20', source: 'phone', lines: [{ room_type_id: 'dlx', rate_plan_id: 'ep', adults: 1, children: 0, extra_beds: 0 }] };
  hotelDb.putReservations({ id: 'b1', number: 'RES/1', status: 'confirmed', ...g, lines: [{ id: 'x1', status: 'booked', nightly: [], ...g.lines[0] }] } as never);
  const pick = (now: string, audited = false) => hotelNotices(data({ audited }), new Date(now)).map((n) => n.id.split(':')[1]).filter((k) => k !== 'decl');
  assert.deepEqual(pick('2026-10-21T15:59:00'), [], 'check-in 12:00 + 4 h not reached');
  assert.deepEqual(pick('2026-10-21T16:00:00'), ['arr']);
  stay(IN_GUEST, new Date('2026-10-20T13:00:00'));
  assert.deepEqual(pick('2026-10-22T10:59:00'), ['arr']);
  assert.deepEqual(pick('2026-10-22T11:00:00'), ['arr', 'out']);
  assert.deepEqual(pick('2026-10-22T11:00:00', true), ['arr', 'out', 'audit'], 'business date 2026-10-20 < today');
});

test('bell: the declaration window notice only from 1 Jan to 31 Mar (once a year)', () => {
  setupHotel('2026-10-20');
  const decl = (now: string) => hotelNotices(data({ audited: false }), new Date(now)).filter((n) => n.id.startsWith('ht:decl')).map((n) => n.id);
  assert.deepEqual(decl('2027-01-01T09:00:00'), ['ht:decl:2027']);
  assert.deepEqual(decl('2027-03-31T09:00:00'), ['ht:decl:2027']);
  assert.deepEqual(decl('2027-04-01T09:00:00'), []);
  assert.deepEqual(decl('2026-12-31T09:00:00'), []);
});

test('pack gate: off → the provider reads no hotel table and raises nothing; the bell imports only behind the pack check', () => {
  setupHotel('2026-10-20');
  stay(FOREIGN, new Date('2026-10-19T08:00:00'));
  registerHotelAlerts();
  const now = new Date('2027-02-01T10:00:00');
  assert.ok(collectNotifications(buildContext(now)).some((n) => n.id.startsWith('ht:')), 'pack on: notices');
  setJson(`${DB_PREFIX}settings`, { ...getJson(`${DB_PREFIX}settings`, {}), industry_packs: [] });
  const seen = new Set<string>();
  const prev = setReadTrace(seen);
  let out: ReturnType<typeof collectNotifications>;
  try {
    out = collectNotifications(buildContext(now));
  } finally {
    setReadTrace(prev);
  }
  assert.ok(!out.some((n) => n.id.startsWith('ht:')));
  assert.deepEqual([...HOTEL_TABLES, 'hotel_settings'].filter((t) => seen.has(DB_PREFIX + t) || seen.has(t)), []);
  assert.ok(HOTEL_SETTINGS_KEY.endsWith('hotel_settings'));
  const bell = readFileSync(new URL('../src/components/command/NotificationBell.tsx', import.meta.url), 'utf8');
  assert.match(bell, /gate\('hotel', 'hotel', \(\) => import\('\.\.\/hotel\/hotel-lazy'\)/);
  assert.match(bell, /if \(twAlerts\[p\] \|\| !\(Array\.isArray\(s\?\.industry_packs\) \? s\.industry_packs\.includes\(p\) : s\?\.business_type === type\)\) return;\n\s+twAlerts\[p\] = 1;\n\s+load\(\)/, 'the pack check runs before the import');
});
