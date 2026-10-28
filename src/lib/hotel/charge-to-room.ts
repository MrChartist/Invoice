/**
 * R7-B2 charge to room from the restaurant (Tables) and the POS. One `fnb` line per order (not per item) for the
 * pre-GST total, with the KOT numbers; the order is settled with `folio_id` (`settleToFolio`, so the day-close blocker
 * treats it as settled) and no invoice is made. The POS "Room" tender posts one line per item (QA9 H12) and saves no
 * POS bill, so the Z report counts no cash. Tax is charged by the check-out invoice (B3) at
 * the C1 restaurant rate. Idempotent: an order already on a folio is not posted again (key `order:<id>`). "Undo"
 * (until the folio line is invoiced) removes the line and reopens the order, logged; voiding the line does the same
 * (QA9 H13, `voidLine`).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { Folio } from '../../types/hotel-r7';
import type { TableOrder } from '../../types/restaurant';
import { round2 } from '../invoice-calc';
import { withTablesRollback } from '../table-txn';
import { ordersDb, settleToFolio } from '../restaurant/orders-store';
import { hotelDb, HT } from './hotel-store';
import { HotelError } from './reservations';
import { reopenOrder, routeCharge } from './folio';

export interface RoomOption {
  resId: string;
  lineId: string;
  room: string;
  guest: string;
}

/** In-house rooms with the primary guest's surname (the picker list). */
export function inHouseRooms(): RoomOption[] {
  const rooms = hotelDb.rooms();
  return hotelDb.reservations().flatMap((r) => r.lines.filter((l) => l.status === 'checked_in' && l.room_id).map((l) => ({
    resId: r.id, lineId: l.id, room: rooms.find((x) => x.id === l.room_id)?.number ?? '', guest: r.guest.name.trim().split(/\s+/).pop() ?? '',
  }))).sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }));
}

const orderKey = (id: string) => `order:${id}`;
const findLine = (key: string) => hotelDb.folios().find((f) => f.lines.some((l) => l.key === key && !l.void));

function post(target: Pick<RoomOption, 'resId' | 'lineId'>, line: Parameters<typeof routeCharge>[3]): Folio {
  const res = hotelDb.reservation(target.resId);
  const stay = res?.lines.find((l) => l.id === target.lineId);
  if (!res || stay?.status !== 'checked_in') throw new HotelError('Pick an in-house room.');
  const room = hotelDb.rooms().find((r) => r.id === stay.room_id)?.number;
  const f = routeCharge(hotelDb.folios(), res, stay.id, { ...line, room_no: room, sac: line.kind === 'fnb' ? hotelDb.settings().sac_fnb : line.sac }, hotelDb.settings().business_date);
  hotelDb.putFolios(f);
  return f;
}

/** Restaurant order → the room's folio. Returns the settled order (an order already charged is returned as is). */
export function chargeOrderToRoom(orderId: string, target: Pick<RoomOption, 'resId' | 'lineId'>): TableOrder {
  const done = ordersDb.get(orderId);
  if (done?.folio_id && findLine(orderKey(orderId))) return done;
  return settleToFolio(orderId, (o, preTax) => post(target, {
    kind: 'fnb', qty: 1, rate: preTax, key: orderKey(o.id), src: { table_order_id: o.id },
    desc: `Restaurant${o.kots.length ? ` · KOT ${o.kots.map((k) => k.number).join(', ')}` : ''}`,
  }).id);
}

/** Undo a room charge (until invoiced): the folio line is removed and the order reopens (logged). */
export function undoRoomCharge(orderId: string): TableOrder {
  const order = ordersDb.get(orderId);
  const f = findLine(orderKey(orderId));
  const line = f?.lines.find((l) => l.key === orderKey(orderId));
  if (!order || !f || !line || order.status !== 'settled') throw new HotelError('This order is not on a folio.');
  if (line.src?.invoice_id || f.status === 'invoiced') throw new HotelError('The folio is already invoiced.');
  return withTablesRollback([HT.folios, 'table_orders'], () => {
    hotelDb.putFolios({ ...f, lines: f.lines.filter((l) => l.id !== line.id) });
    return reopenOrder(order, `Room charge undone (${f.name})`);
  });
}

/**
 * POS "Room" tender (no POS invoice, no Z-report cash). QA9 H12: one folio line per bill item, with its own quantity,
 * HSN and GST rate and its share of the bill's pre-GST value (item and bill discounts spread by value), so the
 * check-out invoice taxes each at its own rate and its goods leave stock like a sale (matched by name + HSN). Items
 * with a restaurant SAC (or none) are F&B at the C1 restaurant rate.
 */
export function chargePosToRoom(rec: Pick<InvoiceRecord, 'items' | 'taxable_value'>, target: Pick<RoomOption, 'resId' | 'lineId'>): Folio {
  const total = round2(rec.taxable_value);
  const items = rec.items.filter((i) => (Number(i.quantity) || 0) > 0);
  const gross = items.map((i) => (Number(i.quantity) || 0) * (Number(i.rate) || 0) * (1 - (Number(i.discount_percent) || 0) / 100));
  const sum = gross.reduce((s, x) => s + x, 0);
  if (!(total > 0) || !(sum > 0)) throw new HotelError('The bill is empty.');
  const amounts = gross.map((x) => round2((x * total) / sum));
  amounts[0] = round2(amounts[0] + total - amounts.reduce((s, x) => s + x, 0));
  const res = hotelDb.reservation(target.resId);
  const stay = res?.lines.find((l) => l.id === target.lineId);
  if (!res || stay?.status !== 'checked_in') throw new HotelError('Pick an in-house room.');
  const room = hotelDb.rooms().find((r) => r.id === stay.room_id)?.number;
  const day = hotelDb.settings().business_date;
  let folios = hotelDb.folios();
  const changed = new Map<string, Folio>();
  items.forEach((i, k) => {
    const hsn = String(i.hsn ?? '').trim();
    const fnb = !hsn || hsn.startsWith('9963');
    const qty = Number(i.quantity);
    const f = routeCharge(folios, res, stay.id, {
      kind: fnb ? 'fnb' : 'misc', desc: i.name, qty, rate: round2(amounts[k] / qty), room_no: room,
      sac: fnb ? hsn || hotelDb.settings().sac_fnb : hsn, ...(fnb ? {} : { tax_rate: Number(i.tax_rate) || 0 }),
    }, day);
    const last = f.lines[f.lines.length - 1];
    if (last.amount !== amounts[k]) f.lines[f.lines.length - 1] = { ...last, amount: amounts[k] };
    changed.set(f.id, f);
    folios = [...folios.filter((x) => x.id !== f.id), f];
  });
  hotelDb.putFolios(...changed.values());
  return [...changed.values()].pop()!;
}
