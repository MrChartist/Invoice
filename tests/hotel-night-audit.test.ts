/** R7-A6 night audit: idempotent post, catch-up, pre-checks, statistics, period lock, 31 March, roles. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { booking, setupHotel } from './helpers/hotel.ts';
import { walkIn } from '../src/lib/hotel/checkin.ts';
import { closeReservation, saveReservation } from '../src/lib/hotel/reservations.ts';
import { hotelDb } from '../src/lib/hotel/hotel-store.ts';
import { blocking, nightStats, preCheck, runAudit, runNight, statsOf } from '../src/lib/hotel/night-audit.ts';
import { auditNights, isYearEnd } from '../src/lib/hotel/business-date.ts';
import { folioBalance, isPosted, nightLines, postNight, windowFor } from '../src/lib/hotel/room-post.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { localDb } from '../src/lib/localDb.ts';

afterEach(() => setActorProvider(null));

function stay(arrival: string, departure: string, line: Record<string, unknown> = {}, roomId = 'r101') {
  return walkIn({ booking: { guest: { name: 'Asha Rao' }, arrival, departure, guarantee: 'none', lines: [{ room_type_id: 'dlx', rate_plan_id: 'ep', adults: 2, children: 0, extra_beds: 0, ...line }] } as never, roomId, guests: [{ name: 'Asha Rao', nationality: 'IN' }], at: new Date(`${arrival}T13:00:00`) });
}
const roomLines = () => hotelDb.folios().flatMap((f) => f.lines);

test('business-date nights: tonight, catch-up up to yesterday, nothing when already ahead', () => {
  assert.deepEqual(auditNights('2026-10-20', '2026-10-20'), ['2026-10-20']);
  assert.deepEqual(auditNights('2026-10-20', '2026-10-21'), ['2026-10-20'], 'a 2 AM audit still closes yesterday');
  assert.deepEqual(auditNights('2026-10-20', '2026-10-23'), ['2026-10-20', '2026-10-21', '2026-10-22']);
  assert.deepEqual(auditNights('2026-10-21', '2026-10-20'), []);
  assert.equal(isYearEnd('2027-03-31'), true);
});

test('post once; a re-run of the same night posts nothing new and replaces its audit row', () => {
  setupHotel('2026-10-20');
  stay('2026-10-20', '2026-10-22', { extra_beds: 1, adults: 3 });
  const r1 = runNight('2026-10-20');
  assert.equal(hotelDb.settings().business_date, '2026-10-21');
  assert.deepEqual(roomLines().map((l) => [l.kind, l.amount, l.key?.split(':').slice(2).join(':')]), [['room', 3500, '2026-10-20'], ['extra_bed', 700, '2026-10-20:bed'], ['extra_person', 800, '2026-10-20:person']]);
  assert.equal(r1.audit.posted_keys.length, 3);
  hotelDb.setBusinessDate('2026-10-20'); // re-run the same night
  const r2 = runNight('2026-10-20');
  assert.equal(roomLines().length, 3);
  assert.deepEqual(r2.audit.posted_keys, []);
  assert.equal(hotelDb.audits().length, 1);
});

test('catch-up: three missed nights are closed one by one', () => {
  setupHotel('2026-10-20');
  stay('2026-10-20', '2026-10-24');
  const run = runAudit({ today: '2026-10-23' });
  assert.deepEqual(run.nights, ['2026-10-20', '2026-10-21', '2026-10-22']);
  assert.equal(run.done.length, 3);
  assert.equal(run.stopped, undefined);
  assert.deepEqual(roomLines().map((l) => l.date), ['2026-10-20', '2026-10-21', '2026-10-22']);
  assert.equal(hotelDb.settings().business_date, '2026-10-23');
  assert.deepEqual(runAudit({ today: '2026-10-22' }).nights, [], 'already ahead');
});

test('pre-checks: a due-out and an un-guaranteed arrival block; guaranteed ones are late arrivals; no-show hand-off', () => {
  setupHotel('2026-10-20');
  stay('2026-10-19', '2026-10-20');
  const late = saveReservation(booking('2026-10-20', '2026-10-21', { room_type_id: 'ste' }, { guarantee: 'advance' })).res;
  const walk = saveReservation(booking('2026-10-20', '2026-10-21')).res;
  const pc = preCheck('2026-10-20', hotelDb.reservations(), hotelDb.guests());
  assert.equal(pc.dueOuts.length, 1);
  assert.deepEqual(pc.arrivals.map((x) => x.res.id), [walk.id]);
  assert.deepEqual(pc.late.map((x) => x.res.id), [late.id]);
  assert.equal(blocking(pc), true);
  const run = runAudit({ today: '2026-10-20' });
  assert.equal(run.done.length, 0);
  assert.match(run.stopped!.reason, /1 due-out\(s\) and 1 arrival/);
  assert.equal(hotelDb.settings().business_date, '2026-10-20', 'nothing rolled');
  // Resolve: extend the due-out, mark the walk-up a no-show.
  const due = hotelDb.reservations().find((r) => r.status === 'checked_in')!;
  saveReservation({ ...due, departure: '2026-10-21' });
  closeReservation(walk.id, 'no_show');
  const ok = runNight('2026-10-20');
  assert.deepEqual(ok.audit.no_shows, [walk.number]);
  assert.deepEqual(ok.audit.late_arrivals, [late.number]);
});

test('statistics: ADR excludes complimentary, occupancy counts it; RevPAR over rooms available (active − OOO)', () => {
  assert.deepEqual(statsOf({ available: 10, occupied: 5, complimentary: 1, house: 0, ooo: 0, room_revenue: 12000 }), { available: 10, occupied: 5, complimentary: 1, house: 0, ooo: 0, room_revenue: 12000, adr: 3000, revpar: 1200, occupancy: 50 });
  assert.equal(statsOf({ available: 0, occupied: 0, complimentary: 0, house: 0, ooo: 3, room_revenue: 0 }).occupancy, 0);
  setupHotel('2026-10-20');
  stay('2026-10-20', '2026-10-21');
  stay('2026-10-20', '2026-10-21', { comp: 'complimentary' }, 'r102');
  hotelDb.patchRooms({ r201: { ooo: { from: '2026-10-20', to: '2026-10-20', reason: 'x' }, hk_status: 'ooo' } });
  const { audit } = runNight('2026-10-20');
  assert.deepEqual(audit.stats, { available: 2, occupied: 2, complimentary: 1, house: 0, ooo: 1, room_revenue: 3500, adr: 3500, revpar: 1750, occupancy: 100 });
  assert.equal(audit.revenue_by_kind.room, 3500);
  assert.equal(audit.guest_ledger, 3500);
  assert.equal(nightStats('2026-10-20', hotelDb.rooms(), hotelDb.reservations(), hotelDb.folios()).room_revenue, 3500);
  // Occupied rooms are dirty after the audit.
  assert.equal(hotelDb.rooms().find((r) => r.id === 'r101')!.hk_status, 'dirty');
});

test('payments by mode skip receipts that moved no cash; advances held', () => {
  setupHotel('2026-10-20');
  stay('2026-10-20', '2026-10-21');
  const pays = [
    { id: 'p1', invoice_id: 'i', amount: 1000, method: 'UPI', date: '2026-10-20' },
    { id: 'p2', invoice_id: 'i', amount: 500, method: 'UPI', date: '2026-10-20', advance_id: 'a' },
    { id: 'p3', invoice_id: 'i', amount: 200, method: 'Cash', date: '2026-10-19' },
  ];
  const real = localDb.payments.getAll;
  localDb.payments.getAll = () => pays as never;
  try {
    assert.deepEqual(runNight('2026-10-20').audit.payments_by_mode, { UPI: 1000 });
  } finally {
    localDb.payments.getAll = real;
  }
});

test('posting into a locked period is refused and the audit stops at that date', () => {
  setupHotel('2026-10-20', { lock_until: '2026-10-20' });
  stay('2026-10-21', '2026-10-22');
  const run = runAudit({ today: '2026-10-22' });
  assert.equal(run.done.length, 0);
  assert.deepEqual([run.stopped?.night, run.stopped?.locked], ['2026-10-20', true]);
  assert.equal(hotelDb.settings().business_date, '2026-10-20');
});

test('31 March with guests in house offers interim invoices; a clerk may run the audit', () => {
  setupHotel('2027-03-31');
  stay('2027-03-31', '2027-04-02');
  setActorProvider(() => ({ id: 'c', name: 'Clerk', role: 'clerk' }));
  const r = runNight('2027-03-31');
  assert.equal(r.yearEnd, true);
  assert.equal(r.audit.by, 'Clerk');
  assert.equal(hotelDb.settings().business_date, '2027-04-01');
  setActorProvider(() => ({ id: 'v', name: 'Viewer', role: 'viewer' }));
  assert.throws(() => runNight('2027-04-01'), /cannot/i);
});

test('room post: keys, routing to the company window, meals priced separately, complimentary posts nothing', () => {
  setupHotel('2026-10-20');
  const out = stay('2026-10-20', '2026-10-21');
  const res = { ...out.res, bill_to: { client_id: 'c1', name: 'Acme' } };
  assert.equal(windowFor(res, 'room'), 2);
  assert.equal(windowFor(res, 'laundry'), 1);
  assert.equal(windowFor({ ...res, routing: [{ kinds: ['room'], window: 3 }] }, 'room'), 3);
  const p = postNight(res, out.line, '2026-10-20', [], { roomNo: '101', typeName: 'Deluxe', sacRoom: '996311', sacFnb: '996331' });
  assert.deepEqual(p.changed.map((f) => [f.window, f.payer.kind, f.lines.length]), [[2, 'client', 1]]);
  assert.equal(isPosted(p.changed, out.line.id, '2026-10-20'), true);
  assert.equal(postNight(res, out.line, '2026-10-20', p.changed, { roomNo: '101', typeName: 'Deluxe', sacRoom: '996311', sacFnb: '996331' }).changed.length, 0);
  const price = { night: '2026-10-20', room: 3500, extra_adult: 0, extra_child: 0, extra_bed: 0, meal: 600, total: 3500 };
  const sep = nightLines({ id: 'l' }, price, '2026-10-20', { roomNo: '1', typeName: 'D', plan: { code: 'CP', meal_plan: 'CP', meals_separate: true }, sacRoom: '996311', sacFnb: '996331' });
  assert.deepEqual(sep.map((l) => [l.kind, l.amount, l.sac]), [['room', 2900, '996311'], ['fnb', 600, '996331']], 'QA9 H3: the meal is inside the rate, posted once');
  const comp = nightLines({ id: 'l', comp: 'complimentary' }, price, '2026-10-20', { roomNo: '1', typeName: 'D', sacRoom: '', sacFnb: '' });
  assert.deepEqual(comp, []);
  assert.equal(folioBalance({ lines: [{ id: 'a', date: '', kind: 'room', desc: '', qty: 1, rate: 100, amount: 100 }, { id: 'b', date: '', kind: 'room', desc: '', qty: 1, rate: 50, amount: 50, void: { by: '', at: '', reason: '' } }], applied: [{ kind: 'advance', id: 'x', amount: 30, date: '' }] }), 70);
});
