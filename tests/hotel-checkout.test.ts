/** R7-B3 check-out and interim invoices: bands per unit-night, place of supply, advances, interim dates, all-or-none. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { booking, setupHotel } from './helpers/hotel.ts';
import { clientKA, installSettings } from './helpers/world.ts';
import type { Folio, FolioLine } from '../src/types/hotel-r7.ts';
import { checkIn, walkIn } from '../src/lib/hotel/checkin.ts';
import { saveReservation, takeAdvance } from '../src/lib/hotel/reservations.ts';
import { hotelDb } from '../src/lib/hotel/hotel-store.ts';
import { runNight } from '../src/lib/hotel/night-audit.ts';
import { stayFolios } from '../src/lib/hotel/folio.ts';
import { interimDates } from '../src/lib/hotel/checkout.ts';
import { advancesFor, draftFor, saveCheckout } from '../src/lib/hotel/checkout-save.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { localDb } from '../src/lib/localDb.ts';

afterEach(() => setActorProvider(null));

let seq = 0;
const night = (n: string, amount: number, kind: FolioLine['kind'] = 'room', line = 'L1', over: Partial<FolioLine> = {}): FolioLine =>
  ({ id: `l${++seq}`, date: n, kind, desc: kind === 'room' ? 'Room 101 · Deluxe · CP' : kind, qty: 1, rate: amount, amount, room_no: '101', src: { night: n, line_id: line }, ...over });
const folio = (lines: FolioLine[], payer: Folio['payer'] = { kind: 'guest', name: 'Asha Rao' }): Folio =>
  ({ id: 'f1', name: 'RES/FY26-27/0001 · W1', window: 1, payer, opened_on: lines[0]?.date ?? '2026-10-20', lines, status: 'open' });
const rates = (lines: FolioLine[], day = '2026-10-23', payer?: Folio['payer']) => draftFor(folio(lines, payer), day).record.items.map((i) => i.tax_rate);

test('band per unit-night: ₹7,500.00 → 5%; ₹7,500.01 → 18%; an extra bed pushes ₹7,000 + ₹800 over the line', () => {
  setupHotel('2026-10-20');
  assert.deepEqual(rates([night('2026-10-20', 7500)]), [5]);
  assert.deepEqual(rates([night('2026-10-20', 7500.01)]), [18]);
  assert.deepEqual(rates([night('2026-10-20', 7000), night('2026-10-20', 800, 'extra_bed')]), [18, 18]);
});

test('composite CP meal inside the value; a night discount brings ₹8,000 to ₹7,200 → 5%; mixed bands → "mixed"', () => {
  setupHotel('2026-10-20');
  const d = draftFor(folio([night('2026-10-20', 8000, 'room', 'L1', { meal: 600 }), night('2026-10-20', 800, 'allowance', 'L1', { amount: -800, rate: -800 })]), '2026-10-23');
  assert.deepEqual(d.record.items.map((i) => [i.amount, i.tax_rate, i.hsn]), [[7200, 5, '996311']]);
  assert.equal(d.band, 'low');
  assert.equal(d.record.annexure?.rows.length, 1, 'night-wise annexure');
  const m = draftFor(folio([night('2026-10-20', 3500), night('2026-10-21', 8200)]), '2026-10-23');
  assert.equal(m.record.hotel_band, 'mixed');
  assert.deepEqual(m.record.items.map((i) => i.tax_rate), [5, 18]);
});

test('place of supply is the property: out-of-state company GSTIN and a foreign guest both get CGST + SGST', () => {
  setupHotel('2026-10-20');
  localDb.clients.upsert(clientKA);
  const co = draftFor(folio([night('2026-10-20', 4000)], { kind: 'client', client_id: 'c-ka', name: 'Karnataka Tech' }), '2026-10-23').record;
  assert.deepEqual([co.place_of_supply, co.gst_mode, co.igst_amount, co.cgst_amount, co.client.gstin], ['27', 'CGST_SGST', 0, 100, clientKA.gstin]);
  const foreign = draftFor(folio([night('2026-10-20', 4000)], { kind: 'guest', name: 'Jean Dupont' }), '2026-10-23').record;
  assert.deepEqual([foreign.place_of_supply, foreign.gst_mode, foreign.tax_amount], ['27', 'CGST_SGST', 200]);
});

test('22 Sep 2025: a 20–23 Sep stay invoiced on 23 Sep is 5% with the rate-change chip; a document of 21 Sep is 12%', () => {
  setupHotel('2025-09-20');
  const lines = [night('2025-09-20', 3500), night('2025-09-21', 3500), night('2025-09-22', 3500)];
  const d = draftFor(folio(lines), '2025-09-23');
  assert.deepEqual(d.record.items.map((i) => [i.quantity, i.tax_rate]), [[3, 5]]);
  assert.deepEqual(d.rateChange, { from: '2025-09-22', nights: 2 });
  assert.deepEqual(rates([night('2025-09-20', 3500)], '2025-09-21'), [12]);
});

test('check-out: advance applied as a payment with advance_id, balance by UPI, room dirty, folio invoiced', () => {
  setupHotel('2026-10-20');
  const { res } = saveReservation(booking('2026-10-20', '2026-10-22'));
  const adv = takeAdvance(res.id, { amount: 5000, method: 'UPI', date: '2026-10-19' });
  const { line } = checkIn({ resId: res.id, lineId: res.lines[0].id, roomId: 'r101', guests: [{ name: 'Asha Rao', nationality: 'IN' }], at: new Date('2026-10-20T13:00:00') });
  runNight('2026-10-20');
  runNight('2026-10-21');
  const [w1] = stayFolios(hotelDb.folios(), res.id);
  const open = advancesFor(w1, hotelDb.reservation(res.id));
  assert.deepEqual(open.map((a) => [a.id, a.open]), [[adv.id, 5000]]);
  const [inv] = saveCheckout({ windows: [{ folioId: w1.id, advances: open.map((a) => ({ id: a.id, amount: a.open })), pay: { method: 'UPI', amount: 2350 } }], checkout: { resId: res.id, lineId: line.id } });
  assert.equal(inv.total, 7350);
  assert.equal(inv.status, 'Paid');
  assert.deepEqual([inv.folio_id, inv.reservation_id, inv.hotel_band, inv.stay?.nights, inv.stay?.rooms], [w1.id, res.id, 'low', 2, ['101']]);
  const pays = localDb.payments.getAll().filter((p) => p.invoice_id === inv.id);
  assert.deepEqual(pays.map((p) => [p.amount, p.advance_id ?? '']), [[5000, adv.id], [2350, '']]);
  assert.equal(hotelDb.folios().find((f) => f.id === w1.id)?.status, 'invoiced');
  assert.equal(hotelDb.reservation(res.id)?.lines[0].status, 'checked_out');
  assert.equal(hotelDb.rooms().find((r) => r.id === 'r101')?.hk_status, 'dirty');
  assert.match(inv.invoice_number, /FY26-27/);
});

test('interim then final: no line is billed twice; interim dates every 30 days and on 31 March', () => {
  setupHotel('2026-10-20');
  const { res, line } = walkIn({ booking: { guest: { name: 'Asha Rao' }, arrival: '2026-10-20', departure: '2026-10-23', guarantee: 'none', lines: [{ room_type_id: 'dlx', rate_plan_id: 'ep', adults: 2, children: 0, extra_beds: 0 }] } as never, roomId: 'r101', guests: [{ name: 'Asha Rao', nationality: 'IN' }], at: new Date('2026-10-20T13:00:00') });
  runNight('2026-10-20');
  runNight('2026-10-21');
  const [w1] = stayFolios(hotelDb.folios(), res.id);
  const [a] = saveCheckout({ windows: [{ folioId: w1.id }], interim: true });
  assert.equal(a.items[0].quantity, 2);
  assert.equal(hotelDb.folios().find((f) => f.id === w1.id)?.status, 'open');
  runNight('2026-10-22');
  const [b] = saveCheckout({ windows: [{ folioId: w1.id }], checkout: { resId: res.id, lineId: line.id } });
  assert.equal(b.items[0].quantity, 1, 'only the night after the interim invoice');
  assert.equal(hotelDb.folios().find((f) => f.id === w1.id)?.invoice_ids?.length, 2);
  assert.deepEqual(interimDates('2026-01-01', '2026-04-15', 30, true), ['2026-01-31', '2026-03-02', '2026-03-31', '2026-04-01']);
  assert.deepEqual(interimDates('2026-03-20', '2026-04-05', 30, false), []);
  assert.deepEqual(interimDates('2026-03-20', '2026-04-05', 30, true), ['2026-03-31']);
});

test('all or none: a period-lock refusal or a refused second window leaves no invoice and no stamped line', () => {
  setupHotel('2026-10-20');
  const { res, line } = walkIn({ booking: { guest: { name: 'Asha Rao' }, arrival: '2026-10-20', departure: '2026-10-21', guarantee: 'none', lines: [{ room_type_id: 'dlx', rate_plan_id: 'ep', adults: 2, children: 0, extra_beds: 0 }] } as never, roomId: 'r101', guests: [{ name: 'Asha Rao', nationality: 'IN' }], at: new Date('2026-10-20T13:00:00') });
  runNight('2026-10-20');
  const [w1] = stayFolios(hotelDb.folios(), res.id);
  assert.throws(() => saveCheckout({ windows: [{ folioId: w1.id }, { folioId: 'gone' }] }), /already billed/);
  assert.equal(localDb.invoices.getAll().length, 0, 'the first window was rolled back');
  installSettings({ industry_packs: ['hotel'], lock_until: '2026-10-31' } as never);
  assert.throws(() => saveCheckout({ windows: [{ folioId: w1.id }], checkout: { resId: res.id, lineId: line.id } }), /lock/i);
  assert.equal(localDb.invoices.getAll().length, 0);
  assert.ok(hotelDb.folios().find((f) => f.id === w1.id)!.lines.every((l) => !l.src?.invoice_id));
  assert.equal(hotelDb.reservation(res.id)?.lines[0].status, 'checked_in');
});

test('unregistered hotel: Bill of Supply, no tax', () => {
  setupHotel('2026-10-20');
  const s = localDb.settings.get();
  localDb.settings.save({ ...s, profiles: s.profiles.map((p) => ({ ...p, companyGstin: '' })) });
  const r = draftFor(folio([night('2026-10-20', 9000)]), '2026-10-23').record;
  assert.deepEqual([r.doc_type, r.tax_amount, r.total], ['BILL_OF_SUPPLY', 0, 9000]);
});
