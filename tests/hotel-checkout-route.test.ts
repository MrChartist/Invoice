/**
 * PENDING 9: check-out from the Reservations list / night audit goes through the folio's check-out (billing) while the
 * stay has anything to bill (`folioToBill`); a billed or comp line is closed by status only.
 */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { booking, checkOutStay, setupHotel } from './helpers/hotel.ts';
import { hotelDb } from '../src/lib/hotel/hotel-store.ts';
import { saveReservation } from '../src/lib/hotel/reservations.ts';
import { checkIn, folioToBill, markCheckedOut } from '../src/lib/hotel/checkin.ts';
import { runNight } from '../src/lib/hotel/night-audit.ts';
import { stayFolios } from '../src/lib/hotel/folio.ts';
import { setActorProvider } from '../src/lib/access.ts';

afterEach(() => setActorProvider(null));
const at = (d: string) => new Date(`${d}T10:00:00`);

function stay(arr: string, dep: string, line: Record<string, unknown> = {}) {
  const { res } = saveReservation(booking(arr, dep, line as never));
  checkIn({ resId: res.id, lineId: res.lines[0].id, roomId: 'r101', guests: [{ name: 'Asha Rao', nationality: 'IN' }], at: new Date(`${arr}T13:00:00`), force: true });
  return hotelDb.reservation(res.id)!;
}

test('PENDING 9: an unbilled stay names its window-1 folio to bill (nights not posted yet)', () => {
  setupHotel('2026-10-20');
  const r = stay('2026-10-20', '2026-10-22');
  const w1 = stayFolios(hotelDb.folios(), r.id).find((f) => f.window === 1)!;
  assert.equal(folioToBill(r, r.lines[0], at('2026-10-22')), w1.id);
  assert.throws(() => markCheckedOut(r.id, r.lines[0].id, at('2026-10-22')), /Bill the stay first/, 'status-only check-out still refused');
});

test('PENDING 9: posted but unbilled nights also send the check-out to the folio; billing through it closes the line', () => {
  setupHotel('2026-10-20');
  const r = stay('2026-10-20', '2026-10-22');
  runNight('2026-10-20');
  runNight('2026-10-21');
  const id = folioToBill(hotelDb.reservation(r.id)!, r.lines[0], at('2026-10-22'));
  assert.ok(id);
  const invs = checkOutStay(r.id, r.lines[0].id, at('2026-10-22'));
  assert.equal(invs.length, 1);
  assert.equal(hotelDb.reservation(r.id)!.lines[0].status, 'checked_out');
});

test('PENDING 9: a comp stay has nothing to bill — the list button closes it by status', () => {
  setupHotel('2026-10-20');
  const r = stay('2026-10-20', '2026-10-21', { comp: 'complimentary' });
  runNight('2026-10-20');
  const res = hotelDb.reservation(r.id)!;
  if (folioToBill(res, res.lines[0], at('2026-10-21'))) return assert.fail('comp stay should not need billing');
  assert.equal(markCheckedOut(r.id, r.lines[0].id, at('2026-10-21')).lines[0].status, 'checked_out');
});

test('PENDING 9: Reservations and night-audit buttons use the folio path; the folios view opens its check-out', () => {
  const desk = readFileSync(new URL('../src/components/hotel/FrontDesk.tsx', import.meta.url), 'utf8');
  assert.match(desk, /folioToBill\(res, line\)/);
  assert.match(desk, /ctx\.go\('folios', \{ folio, checkout: '1' \}\)/);
  assert.equal((desk.match(/<CheckOutBtn /g) ?? []).length, 2, 'Reservations list and night audit due-outs');
  assert.doesNotMatch(desk, /onClick=\{\(\) => ctx\.run\(\(\) => markCheckedOut\(r\.id|markCheckedOut\(x\.res\.id/);
  const folio = readFileSync(new URL('../src/components/hotel/FolioView.tsx', import.meta.url), 'utf8');
  assert.match(folio, /params\.get\('checkout'\) === '1'/);
  assert.match(folio, /useState\(out0\)/);
});
