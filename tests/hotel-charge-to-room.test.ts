/** R7-B2 charge to room from Tables and the POS: one pre-GST fnb line, no invoice, idempotent, undo, no Z-report cash. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupHotel } from './helpers/hotel.ts';
import { setTable } from '../src/lib/storage.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';
import { walkIn } from '../src/lib/hotel/checkin.ts';
import { hotelDb, HOTEL_SETTINGS_KEY } from '../src/lib/hotel/hotel-store.ts';
import { chargeOrderToRoom, chargePosToRoom, inHouseRooms, undoRoomCharge } from '../src/lib/hotel/charge-to-room.ts';
import { stayFolios } from '../src/lib/hotel/folio.ts';
import { draftFor } from '../src/lib/hotel/checkout-save.ts';
import { addToOrder, openOrder, ordersDb, sendOrderKot } from '../src/lib/restaurant/orders-store.ts';
import { buildPosRecord, openOrdersBlocker, zReport } from '../src/lib/pos.ts';
import { getJson, setJson } from '../src/lib/storage.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { localDb } from '../src/lib/localDb.ts';

afterEach(() => setActorProvider(null));

const TIKKA: InvoiceItem = { id: 'i-tikka', name: 'Chicken Tikka', type: 'Product', hsn: '996331', unit: 'NOS', quantity: 1, rate: 320, tax_rate: 5, amount: 0 };
const NOODLES: InvoiceItem = { id: 'i-noodles', name: 'Hakka Noodles', type: 'Product', hsn: '996331', unit: 'NOS', quantity: 1, rate: 220, tax_rate: 5, amount: 0 };

function world() {
  setupHotel('2026-10-20');
  setTable('items_catalog', [TIKKA, NOODLES]);
  const s = walkIn({ booking: { guest: { name: 'Asha Rao' }, arrival: '2026-10-20', departure: '2026-10-22', guarantee: 'none', lines: [{ room_type_id: 'dlx', rate_plan_id: 'ep', adults: 2, children: 0, extra_beds: 0 }] } as never, roomId: 'r101', guests: [{ name: 'Asha Rao', nationality: 'IN' }], at: new Date('2026-10-20T13:00:00') });
  const o = openOrder({ channel: 'dine_in', table_id: 'tbl_1', covers: 2 });
  addToOrder(o.id, TIKKA, { qty: 2 });
  addToOrder(o.id, NOODLES);
  sendOrderKot(o.id);
  return { ...s, order: o };
}

test('an order becomes one fnb line for its pre-GST total; the order is settled, no invoice, day close not blocked', () => {
  const { res, order } = world();
  assert.deepEqual(inHouseRooms().map((r) => [r.room, r.guest]), [['101', 'Rao']]);
  const out = chargeOrderToRoom(order.id, inHouseRooms()[0]);
  assert.equal(out.status, 'settled');
  const [w1] = stayFolios(hotelDb.folios(), res.id);
  assert.equal(out.folio_id, w1.id);
  assert.deepEqual(w1.lines.map((l) => [l.kind, l.amount, l.src?.table_order_id, l.sac]), [['fnb', 860, order.id, '996331']]);
  assert.match(w1.lines[0].desc, /KOT K\d+/);
  assert.equal(localDb.invoices.getAll().length, 0);
  assert.equal(openOrdersBlocker(), '');
  // idempotent: a second charge (double tap / retry) posts nothing new
  chargeOrderToRoom(order.id, inHouseRooms()[0]);
  assert.equal(hotelDb.folios().flatMap((f) => f.lines).length, 1);
});

test('the check-out invoice charges F&B at the restaurant rate: 5% normally, 18% in specified premises', () => {
  const { res, order } = world();
  chargeOrderToRoom(order.id, inHouseRooms()[0]);
  const [w1] = stayFolios(hotelDb.folios(), res.id);
  assert.deepEqual(draftFor(w1, '2026-10-21').record.items.map((i) => [i.hsn, i.tax_rate]), [['996331', 5]]);
  setJson(HOTEL_SETTINGS_KEY, { ...getJson(HOTEL_SETTINGS_KEY, {}), prev_fy_max_value: { '2025-26': 7600 } });
  assert.deepEqual(draftFor(w1, '2026-10-21').record.items.map((i) => i.tax_rate), [18]);
});

test('undo removes the folio line and reopens the order (logged); refused once invoiced', () => {
  const { res, order } = world();
  chargeOrderToRoom(order.id, inHouseRooms()[0]);
  const back = undoRoomCharge(order.id);
  assert.equal(back.status, 'open');
  assert.equal(back.folio_id, undefined);
  assert.match(back.log[back.log.length - 1].note ?? '', /Room charge undone/);
  assert.equal(stayFolios(hotelDb.folios(), res.id)[0].lines.length, 0);
  assert.notEqual(openOrdersBlocker(), '', 'open again → blocks the day close');
  assert.throws(() => undoRoomCharge(order.id), /not on a folio/);
  assert.equal(ordersDb.get(order.id)?.status, 'open');
});

test('POS "Room" tender: one line, no POS invoice, no Z-report cash', () => {
  const { res } = world();
  const rec = buildPosRecord({ items: [{ ...TIKKA, quantity: 1, amount: 320 }], party: {}, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), day: '2026-10-20' });
  chargePosToRoom(rec, inHouseRooms()[0]);
  const lines = stayFolios(hotelDb.folios(), res.id)[0].lines;
  assert.deepEqual(lines.map((l) => [l.kind, l.amount]), [['fnb', 320]]);
  const z = zReport('2026-10-20', localDb.invoices.getAll(), localDb.payments.getAll());
  assert.deepEqual([z.bills, z.received, z.tenders.cash], [0, 0, 0]);
  const misc = buildPosRecord({ items: [{ ...TIKKA, name: 'Toothbrush', hsn: '9603', tax_rate: 18, quantity: 2, rate: 50, amount: 100 }], party: {}, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), day: '2026-10-20' });
  const f = chargePosToRoom(misc, inHouseRooms()[0]);
  assert.deepEqual(f.lines.map((l) => [l.kind, l.amount, l.tax_rate]).slice(-1), [['misc', 100, 18]]);
});
