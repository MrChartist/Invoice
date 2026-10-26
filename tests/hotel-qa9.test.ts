/**
 * QA round 9 regressions (docs/prd/qa-round-9.md, H1–H16): the hotel pack's probes turned into tests. Every check-out
 * passes `at` so the day the guest leaves (business date vs the device's day) is fixed.
 */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { EP, booking, checkOutStay, setupHotel } from './helpers/hotel.ts';
import { SELLER, clientKA, BUYER_KA, installSettings } from './helpers/world.ts';
import { HOTEL_SETTINGS_KEY, hotelDb } from '../src/lib/hotel/hotel-store.ts';
import { getJson, getTable, setJson, setTable } from '../src/lib/storage.ts';
import { closeReservation, saveReservation, takeAdvance } from '../src/lib/hotel/reservations.ts';
import { checkIn, markCheckedOut, walkIn } from '../src/lib/hotel/checkin.ts';
import { nightStats, runAudit, runNight } from '../src/lib/hotel/night-audit.ts';
import { postCharge, stayFolios, voidLine } from '../src/lib/hotel/folio.ts';
import { advancesFor, draftFor, nightsToPost, saveCheckout, yearEndInterims } from '../src/lib/hotel/checkout-save.ts';
import { spread } from '../src/lib/hotel/checkout.ts';
import { invoiceProperty, premisesNow } from '../src/lib/hotel/premises.ts';
import { hotelGuards } from '../src/lib/hotel/hotel-gst.ts';
import { chargeCancellation } from '../src/lib/hotel/cancellation.ts';
import { chargeOrderToRoom, chargePosToRoom, inHouseRooms, undoRoomCharge } from '../src/lib/hotel/charge-to-room.ts';
import { occupancyByDay } from '../src/lib/hotel/hotel-reports.ts';
import { addToOrder, openOrder, ordersDb, sendOrderKot } from '../src/lib/restaurant/orders-store.ts';
import { localDb } from '../src/lib/localDb.ts';
import { loadAdvances } from '../src/lib/advances.ts';
import { genericChanges } from '../src/lib/audit-edits.ts';
import { computeStock, stockDb } from '../src/lib/inventory.ts';
import { restoreEntries } from '../src/lib/trust/recycle-bin.ts';
import { setActorProvider } from '../src/lib/access.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';
import type { RatePlan } from '../src/types/hotel-r7.ts';

afterEach(() => setActorProvider(null));

const at = (d: string) => new Date(`${d}T10:00:00`);
const setDay = (d: string) => setJson(HOTEL_SETTINGS_KEY, { ...getJson(HOTEL_SETTINGS_KEY, {}), business_date: d });
const rate = (n: number) => ({ room_type_id: 'dlx', single: n, double: n, extra_adult: 0, extra_child: 0, extra_bed: 0 });

function stay(arr: string, dep: string, line: Record<string, unknown> = {}, over: Record<string, unknown> = {}, roomId = 'r101') {
  const { res } = saveReservation(booking(arr, dep, line as never, over as never));
  checkIn({ resId: res.id, lineId: res.lines[0].id, roomId, guests: [{ name: 'Asha Rao', nationality: 'IN' }], at: new Date(`${arr}T13:00:00`), force: true });
  return hotelDb.reservation(res.id)!;
}
const out = (r: { id: string; lines: { id: string }[] }, day: string) => checkOutStay(r.id, r.lines[0].id, at(day));
/** F&B rate a check-out on `day` charges (an F&B charge on a fresh in-house stay of that premises). */
function checkoutFnb(day: string, roomId: string, over: Record<string, unknown> = {}, line: Record<string, unknown> = {}): number {
  setDay(day);
  const r = stay(day, '2026-12-30', line, over, roomId);
  const f = postCharge({ resId: r.id, lineId: r.lines[0].id }, { kind: 'fnb', qty: 1, rate: 1000, desc: 'Dinner' }, day);
  return draftFor(f, day).record.items.find((i) => i.name === 'Dinner')!.tax_rate;
}

/* ── H1 (P0) ─────────────────────────────────────────────────── */

test('QA9 H1: check-out after a missed audit posts and bills every stayed night; the catch-up then finds nothing', () => {
  setupHotel('2026-10-20');
  const r = stay('2026-10-20', '2026-10-23');
  runNight('2026-10-20'); // the audits of 21 and 22 are missed
  const f = stayFolios(hotelDb.folios(), r.id)[0];
  assert.deepEqual(nightsToPost(f, false, '2026-10-21').length, 2, 'the dialog shows the nights it will post (at = now ≥ 23)');
  const [inv] = out(r, '2026-10-23');
  assert.deepEqual([inv.taxable_value, inv.stay?.nights], [10500, 3]);
  assert.deepEqual(runAudit({ today: '2026-10-24' }).done.flatMap((d) => d.audit.posted_keys), []);
  assert.ok(hotelDb.folios().flatMap((f) => f.lines).every((l) => l.src?.invoice_id), 'nothing left unbilled');
});

test('QA9 H1: no audit at all → the check-out still bills the stay; a status-only check-out is refused', () => {
  setupHotel('2026-10-20');
  const r = stay('2026-10-20', '2026-10-22');
  assert.throws(() => markCheckedOut(r.id, r.lines[0].id, at('2026-10-22')), /Bill the stay first/);
  const invs = out(r, '2026-10-22');
  assert.deepEqual(invs.map((i) => i.taxable_value), [7000]);
  assert.equal(hotelDb.reservation(r.id)!.lines[0].status, 'checked_out');
});

/* ── H2 (P0) ─────────────────────────────────────────────────── */

function inclusive(day: string, nights: string[], gross: number, dep: string): InvoiceRecord {
  setupHotel(day);
  hotelDb.saveRatePlans([{ ...EP, weekend_pct: 0, tax_inclusive: true, rates: [rate(gross), EP.rates[1]] }]);
  const r = stay(nights[0], dep);
  for (const n of nights) runNight(n);
  return out(r, dep)[0];
}

test('QA9 H2: a tax-inclusive night in the band gap bills the agreed price (18% on the solved value)', () => {
  const inv = inclusive('2026-10-20', ['2026-10-20', '2026-10-21'], 8000, '2026-10-22');
  assert.deepEqual([inv.items.map((i) => i.tax_rate), inv.taxable_value, inv.total], [[18], 13559.32, 16000]);
  assert.equal(inv.hotel_band, 'high');
  assert.deepEqual(hotelGuards([inv], [], () => false, '2026-04-01', '2027-03-31'), [], 'the gap night is not a wrong band');
  const nine = inclusive('2026-10-20', ['2026-10-20'], 9000, '2026-10-21');
  assert.deepEqual([nine.items[0].tax_rate, nine.total], [18, 9000]);
});

test('QA9 H2: inclusive nights solved at 12% before 22 Sep 2025 and invoiced after keep the agreed price at 5%', () => {
  const inv = inclusive('2025-09-20', ['2025-09-20', '2025-09-21', '2025-09-22'], 7000, '2025-09-23');
  assert.deepEqual([inv.items.map((i) => i.tax_rate), inv.total], [[5], 21000]);
  assert.ok(Math.abs(inv.taxable_value + inv.tax_amount - 21000) < 0.05);
});

/* ── H3 (P0) ─────────────────────────────────────────────────── */

const MAP = { id: 'map', name: 'MAP', code: 'MAP', meal_plan: 'MAP', audience: 'public', meals_separate: true, meal_per_adult: 500, rates: [rate(8000)] } as unknown as RatePlan;

test('QA9 H3: meals priced separately post the meal once — the folio and the invoice equal the plan total', () => {
  setupHotel('2026-03-10');
  hotelDb.saveRatePlans([EP, MAP]);
  const r = stay('2026-03-10', '2026-03-11', { rate_plan_id: 'map' });
  runNight('2026-03-10');
  const lines = stayFolios(hotelDb.folios(), r.id).flatMap((f) => f.lines);
  assert.deepEqual(lines.map((l) => [l.kind, l.amount]), [['room', 7000], ['fnb', 1000]]);
  const [inv] = out(r, '2026-03-11');
  assert.equal(inv.taxable_value, 8000);
});

/* ── H4 (P1) ─────────────────────────────────────────────────── */

test('QA9 H4: meals separate — check-out F&B and the GST tab agree (FY 2025-26 night ₹7,000 → not specified)', () => {
  setupHotel('2026-03-10');
  hotelDb.saveRatePlans([EP, MAP]);
  const r = stay('2026-03-10', '2026-03-11', { rate_plan_id: 'map' });
  runNight('2026-03-10');
  out(r, '2026-03-11');
  assert.equal(premisesNow(2026).specified, false);
  assert.equal(checkoutFnb('2026-10-20', 'r102'), 5);
});

test('QA9 H4 / H9: an early check-out counts only the nights stayed for the previous-FY test', () => {
  setupHotel('2026-03-12');
  hotelDb.saveRatePlans([{ ...EP, rates: [rate(7000), EP.rates[1]] }]); // Thu ₹7,000, Fri ₹8,400 (weekend)
  const r = stay('2026-03-12', '2026-03-14');
  runNight('2026-03-12');
  out(r, '2026-03-13'); // left on Friday morning
  const line = hotelDb.reservation(r.id)!.lines[0];
  assert.deepEqual([line.departure, line.booked_departure, line.nightly.length], ['2026-03-13', '2026-03-14', 1]);
  assert.deepEqual([premisesNow(2026).specified, premisesNow(2026).prev?.value], [false, 7000]);
  assert.equal(checkoutFnb('2026-10-20', 'r102'), 5);
});

test('QA9 H4: branch premises — each premises on its own evidence, at check-out and in the GST tab guard', () => {
  setupHotel('2026-03-10');
  installSettings({ industry_packs: ['hotel'], profiles: [SELLER, { ...SELLER, id: 'branch', companyName: 'Branch', city: 'Pune' }] } as never);
  const r = stay('2026-03-10', '2026-03-11', { room_type_id: 'ste' }, { property_id: 'branch' }, 'r201');
  runNight('2026-03-10');
  out(r, '2026-03-11');
  assert.deepEqual([premisesNow(2026).specified, premisesNow(2026, 'branch').specified], [false, true]);
  assert.equal(checkoutFnb('2026-10-20', 'r102'), 5, 'main premises');
  assert.equal(checkoutFnb('2026-10-20', 'r201', { property_id: 'branch' }, { room_type_id: 'ste' }), 18, 'branch premises');
  // Bill both F&B stays and judge every invoice by its own premises.
  for (const res of hotelDb.reservations().filter((x) => x.status === 'checked_in')) {
    saveCheckout({ windows: stayFolios(hotelDb.folios(), res.id).map((f) => ({ folioId: f.id })), interim: true, day: '2026-10-20' });
  }
  const all = getTable<InvoiceRecord>('invoices').filter((i) => i.issue_date >= '2026-04-01');
  assert.deepEqual(all.map(invoiceProperty).sort(), ['branch', undefined].sort());
  assert.deepEqual(hotelGuards(all, [], (y, i) => premisesNow(y, invoiceProperty(i)).specified, '2026-04-01', '2027-03-31'), []);
});

/* ── H5 / H6 (P1) ────────────────────────────────────────────── */

test('QA9 H5: an allowance posted from the folio lowers the night before banding (₹8,000 less ₹1,000 → 5%)', () => {
  setupHotel('2026-10-20');
  hotelDb.saveRatePlans([{ ...EP, rates: [rate(8000), EP.rates[1]] }]);
  const r = stay('2026-10-20', '2026-10-21');
  runNight('2026-10-20');
  postCharge({ resId: r.id, lineId: r.lines[0].id }, { kind: 'allowance', qty: 1, rate: 1000, desc: 'Goodwill discount' }, '2026-10-21');
  const [inv] = out(r, '2026-10-21');
  assert.deepEqual([inv.items.map((i) => [i.amount, i.tax_rate]), inv.discount_rate, inv.taxable_value, inv.tax_amount, inv.hotel_band], [[[7000, 5]], 0, 7000, 350, 'low']);
  assert.deepEqual(hotelGuards([inv], [], () => false, '2026-04-01', '2027-03-31'), []);
  assert.deepEqual(spread(-100, [300, 100]), [-75, -25]);
  assert.deepEqual(spread(-500, [300]), [-300], 'never below zero');
});

test('QA9 H6: an allowance on a company-billed stay follows the room to window 2 (linked or not)', () => {
  for (const linked of [true, false]) {
    setupHotel('2026-10-20');
    localDb.clients.upsert({ id: 'co', name: 'Acme', company: 'Acme', gstin: '', state_code: '27', email: '', phone: '', address: '', city: '', zip: '' } as never);
    const r = stay('2026-10-20', '2026-10-21', {}, { bill_to: { client_id: 'co', name: 'Acme' } });
    runNight('2026-10-20');
    postCharge({ resId: r.id, lineId: r.lines[0].id }, { kind: 'allowance', qty: 1, rate: 500, desc: 'Rate correction', ...(linked ? { src: { night: '2026-10-20', line_id: r.lines[0].id } } : {}) }, '2026-10-21');
    const fs = stayFolios(hotelDb.folios(), r.id);
    assert.deepEqual(fs.map((f) => [f.window, f.lines.map((l) => l.amount)]), [[1, []], [2, [3500, -500]]]);
    const invs = out(r, '2026-10-21');
    assert.deepEqual(invs.map((i) => [i.client.name, i.taxable_value]), [['Acme', 3000]]);
  }
});

/* ── H7 / H8 (P1) ────────────────────────────────────────────── */

test('QA9 H7: cancelling a company-billed booking the company paid for invoices the company and adjusts its advance', () => {
  setupHotel('2026-10-20');
  localDb.clients.upsert({ ...clientKA, id: 'ka' });
  hotelDb.saveRatePlans([{ ...EP, policy: { free_until_hours: 24, charge: 'first_night', no_show: 'first_night' } } as never]);
  const { res } = saveReservation(booking('2026-10-21', '2026-10-23', {}, { bill_to: { client_id: 'ka', name: clientKA.name }, guarantee: 'company' }));
  const a = takeAdvance(res.id, { amount: 7350, method: 'Bank transfer', date: '2026-10-20' });
  closeReservation(res.id, 'cancelled', 'plans changed');
  const { invoice } = chargeCancellation(res.id, { refund: { method: 'Bank transfer' }, at: new Date('2026-10-21T10:00:00') });
  assert.deepEqual([invoice?.client.gstin, invoice?.total, invoice?.status], [BUYER_KA, 3675, 'Paid']);
  assert.deepEqual(localDb.payments.getAll().filter((p) => p.invoice_id === invoice?.id).map((p) => [p.amount, p.advance_id]), [[3675, a.id]]);
  const adv = loadAdvances().find((x) => x.id === a.id)!;
  assert.deepEqual(adv.refunds?.map((x) => x.amount), [3675], 'only the rest is refunded');
});

test('QA9 H8: only the booking\'s own advances (and unbooked ones) are offered; only its own are pre-ticked', () => {
  setupHotel('2026-10-20');
  const { res: a } = saveReservation(booking('2026-10-20', '2026-10-22'));
  const { res: b } = saveReservation(booking('2026-11-05', '2026-11-07', {}, { guest: { name: 'Asha Rao', phone: '9123456780' } }));
  const advA = takeAdvance(a.id, { amount: 2000, method: 'UPI', date: '2026-10-19' });
  takeAdvance(b.id, { amount: 5000, method: 'UPI', date: '2026-10-19' });
  checkIn({ resId: a.id, lineId: a.lines[0].id, roomId: 'r101', guests: [{ name: 'Asha Rao', nationality: 'IN' }], at: new Date('2026-10-20T13:00:00') });
  runNight('2026-10-20');
  runNight('2026-10-21');
  const [w1] = stayFolios(hotelDb.folios(), a.id);
  const offered = advancesFor(w1, hotelDb.reservation(a.id));
  assert.deepEqual(offered.map((x) => [x.number, x.open, x.own]), [[advA.number, 2000, true]]);
});

/* ── H9 (P1) ─────────────────────────────────────────────────── */

test('QA9 H9: an early check-out frees the room from the day the guest left (occupancy, ADR, resale)', () => {
  setupHotel('2026-10-20');
  const r = stay('2026-10-20', '2026-10-23');
  runNight('2026-10-20');
  out(r, '2026-10-21'); // leaves on the 21st morning
  stay('2026-10-21', '2026-10-22', {}, {}, 'r101'); // resold
  runNight('2026-10-21');
  const a = hotelDb.audits().find((x) => x.business_date === '2026-10-21')!;
  assert.deepEqual([a.stats.occupied, a.stats.room_revenue, a.stats.adr], [1, 3500, 3500]);
  assert.equal(nightStats('2026-10-22', hotelDb.rooms(), hotelDb.reservations(), hotelDb.folios()).occupied, 0);
  assert.deepEqual(occupancyByDay('2026-10-22', '2026-10-22', { audits: [], rooms: hotelDb.rooms(), reservations: hotelDb.reservations(), folios: hotelDb.folios() }).map((x) => x.occupied), [0]);
});

/* ── H10 (P1) ────────────────────────────────────────────────── */

test('QA9 H10: the year-end interim is taken on 31 March before the roll, dated 31 March in the old FY', () => {
  setupHotel('2027-03-30');
  const r = stay('2027-03-30', '2027-04-02');
  runNight('2027-03-30');
  assert.throws(() => yearEndInterims('2027-03-30'), /31 March/);
  const interim = yearEndInterims('2027-03-31', new Date('2027-03-31T18:00:00'));
  assert.deepEqual(interim.map((i) => [i.invoice_number, i.issue_date, i.taxable_value, i.annexure?.rows.map((x) => x.date)]), [['INV/FY26-27/0001', '2027-03-31', 7000, ['2027-03-30', '2027-03-31']]]);
  assert.equal(runNight('2027-03-31').yearEnd, true);
  runNight('2027-04-01');
  const fin = out(r, '2027-04-02');
  assert.deepEqual(fin.map((i) => [i.invoice_number, i.issue_date, i.taxable_value]), [['INV/FY27-28/0001', '2027-04-02', 3500]]);
});

/* ── H11 (P1) ────────────────────────────────────────────────── */

test('QA9 H11: deleting a check-out invoice reopens its folio lines; a restore after a re-bill is refused', () => {
  setupHotel('2026-10-20');
  const r = stay('2026-10-20', '2026-10-21');
  runNight('2026-10-20');
  const [inv] = out(r, '2026-10-21');
  localDb.invoices.remove(inv.id);
  const fs = stayFolios(hotelDb.folios(), r.id);
  const again = saveCheckout({ windows: fs.map((f) => ({ folioId: f.id })) });
  assert.deepEqual(again.map((i) => i.taxable_value), [3500]);
  const bin = getTable<{ id: string; table: string; row_id: string }>('recycle_bin').find((b) => b.table === 'invoices' && b.row_id === inv.id)!;
  assert.throws(() => restoreEntries([bin.id]), /billed again/);
});

test('QA9 H11: a deleted check-out invoice restored before any re-bill gets its lines back', () => {
  setupHotel('2026-10-20');
  const r = stay('2026-10-20', '2026-10-21');
  runNight('2026-10-20');
  const [inv] = out(r, '2026-10-21');
  localDb.invoices.remove(inv.id);
  const f = stayFolios(hotelDb.folios(), r.id)[0];
  assert.equal(draftFor(f, '2026-10-21').lineIds.length, 0, 'nothing reconciled yet');
  saveCheckout({ windows: [] }); // any save reconciles first
  assert.equal(hotelDb.folios().find((x) => x.id === f.id)!.status, 'open');
  const bin = getTable<{ id: string; table: string; row_id: string }>('recycle_bin').find((b) => b.table === 'invoices' && b.row_id === inv.id)!;
  restoreEntries([bin.id]);
  saveCheckout({ windows: [] });
  const back = hotelDb.folios().find((x) => x.id === f.id)!;
  assert.deepEqual(back.lines.map((l) => l.src?.invoice_id), [inv.id]);
  assert.equal(back.status, 'invoiced');
});

/* ── H12 / H13 (P1) ──────────────────────────────────────────── */

test('QA9 H12: the POS "Room" tender posts one line per item at its own rate and HSN; stock leaves on the invoice', () => {
  setupHotel('2026-10-20');
  stockDb.saveItem({ id: 's1', name: 'Packaged water', hsn: '2201', unit: 'NOS', track_stock: true, opening_qty: 10, opening_rate: 20, reorder_level: 0 } as never);
  const r = stay('2026-10-20', '2026-10-21');
  const f = chargePosToRoom({ items: [
    { id: 'a', name: 'Packaged water', hsn: '2201', quantity: 2, rate: 50, tax_rate: 18, amount: 100 },
    { id: 'b', name: 'Biscuits', hsn: '1905', quantity: 1, rate: 100, tax_rate: 5, amount: 100 },
  ], taxable_value: 200 } as never, { resId: r.id, lineId: r.lines[0].id });
  assert.deepEqual(f.lines.map((l) => [l.kind, l.qty, l.amount, l.tax_rate, l.sac]), [['misc', 2, 100, 18, '2201'], ['misc', 1, 100, 5, '1905']]);
  runNight('2026-10-20');
  const [inv] = out(r, '2026-10-21');
  assert.deepEqual(inv.items.slice(1).map((i) => [i.name, i.quantity, i.amount, i.tax_rate, i.hsn, i.type]), [['Packaged water', 2, 100, 18, '2201', 'Product'], ['Biscuits', 1, 100, 5, '1905', 'Product']]);
  assert.equal(inv.tax_amount, 198);
  const pos = computeStock({ items: getTable('stock_items'), invoices: localDb.invoices.getAll(), moves: getTable('stock_moves'), purchases: getTable('purchases') } as never);
  assert.deepEqual(pos.map((p: { item: { name: string }; qty: number }) => [p.item.name, p.qty]), [['Packaged water', 8]]);
});

const TIKKA: InvoiceItem = { id: 'i-tikka', name: 'Chicken Tikka', type: 'Product', hsn: '996331', unit: 'NOS', quantity: 1, rate: 320, tax_rate: 5, amount: 0 };

test('QA9 H13: voiding a restaurant room charge reopens the order; undo works from the folio line', () => {
  setupHotel('2026-10-20');
  setTable('items_catalog', [TIKKA]);
  const s = walkIn({ booking: { guest: { name: 'Asha Rao' }, departure: '2026-10-22', guarantee: 'none', lines: [{ room_type_id: 'dlx', rate_plan_id: 'ep', adults: 2, children: 0, extra_beds: 0 }] } as never, roomId: 'r101', guests: [{ name: 'Asha Rao', nationality: 'IN' }], at: new Date('2026-10-20T13:00:00') });
  const charge = () => {
    const o = openOrder({ channel: 'dine_in', table_id: 'tbl_1', covers: 2 });
    addToOrder(o.id, TIKKA);
    sendOrderKot(o.id);
    chargeOrderToRoom(o.id, inHouseRooms()[0]);
    return o.id;
  };
  const a = charge();
  const w1 = () => stayFolios(hotelDb.folios(), s.res.id)[0];
  voidLine(w1().id, w1().lines.find((l) => l.src?.table_order_id === a)!.id, 'guest pays cash at the restaurant');
  assert.deepEqual([ordersDb.get(a)?.status, ordersDb.get(a)?.folio_id], ['open', undefined]);
  chargeOrderToRoom(a, inHouseRooms()[0]); // can be charged again
  assert.equal(ordersDb.get(a)?.status, 'settled');
  undoRoomCharge(a);
  assert.equal(ordersDb.get(a)?.status, 'open');
});

/* ── H14–H16 (P2) ────────────────────────────────────────────── */

test('QA9 H14: the edit log never shows a reservation guest\'s phone or email', () => {
  const before = { id: 'r', number: 'RES/1', guest: { name: 'Asha Rao', phone: '9876543210', email: 'asha@example.com' } };
  const text = JSON.stringify(genericChanges(before, { ...before, guest: { ...before.guest, guest_id: 'g1' } }));
  assert.doesNotMatch(text, /9876543210|asha@example/);
  assert.match(text, /Asha Rao/);
});

test('QA9 H15: night audit payments by mode include desk advances and net their refunds', () => {
  setupHotel('2026-10-20');
  const { res } = saveReservation(booking('2026-10-20', '2026-10-22'));
  takeAdvance(res.id, { amount: 5000, method: 'Cash', date: '2026-10-20' });
  checkIn({ resId: res.id, lineId: res.lines[0].id, roomId: 'r101', guests: [{ name: 'Asha Rao', nationality: 'IN' }], at: new Date('2026-10-20T13:00:00') });
  const r = runNight('2026-10-20');
  assert.deepEqual([r.audit.payments_by_mode, r.audit.advances_held], [{ Cash: 5000 }, 5000]);
});

test('QA9 H16: an in-house long stay can be extended past a locked arrival month; locked nights stay locked', () => {
  setupHotel('2026-09-25');
  const { res } = saveReservation(booking('2026-09-25', '2026-10-20'));
  checkIn({ resId: res.id, lineId: res.lines[0].id, roomId: 'r101', guests: [{ name: 'Asha Rao', nationality: 'IN' }], at: new Date('2026-09-25T13:00:00') });
  installSettings({ industry_packs: ['hotel'], lock_until: '2026-09-30' } as never);
  const cur = hotelDb.reservation(res.id)!;
  saveReservation({ ...cur, departure: '2026-10-25', lines: cur.lines.map((l) => ({ ...l })) } as never);
  assert.equal(hotelDb.reservation(res.id)!.departure, '2026-10-25');
  const now = hotelDb.reservation(res.id)!;
  assert.throws(() => saveReservation({ ...now, lines: now.lines.map((l) => ({ ...l, adults: 1 })) } as never, { reprice: true }), /locked/i);
});
