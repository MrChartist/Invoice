/**
 * R3-A2 · KOT: only new lines print, station routing with a Kitchen fallback, cancellations need a reason
 * and print a cancellation ticket, daily K-number reset (local time), register + leakage, clerk PIN cap,
 * ticket width 32 / 48 columns.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setTable } from '../src/lib/storage.ts';
import {
  addToOrder, changeLineQty, isOwnerPinRequired, moveToTable, openOrder, ordersDb, restaurantDb, sendOrderKot,
} from '../src/lib/restaurant/orders-store.ts';
import {
  byStation, cancelNeedsReason, changeQty, kotRegister, needsOwnerPin, nextKotNumber, registerSheet, sendKot, sentQty,
  stationFor, ticketLines,
} from '../src/lib/restaurant/kot.ts';
import { ticketBytes } from '../src/lib/escpos.ts';
import { setActorProvider } from '../src/lib/access.ts';
import type { TableOrder } from '../src/types/restaurant.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';

const DAY = '2026-07-01';
const TIKKA: InvoiceItem & { group_id: string } = { id: 'i-tikka', name: 'Chicken Tikka', type: 'Product', hsn: '996331', unit: 'NOS', quantity: 1, rate: 320, tax_rate: 5, amount: 0, group_id: 'g-tandoor' };
const NOODLES: InvoiceItem & { group_id: string } = { id: 'i-noodles', name: 'Hakka Noodles', type: 'Product', hsn: '996331', unit: 'NOS', quantity: 1, rate: 220, tax_rate: 5, amount: 0, group_id: 'g-chinese' };
const WATER: InvoiceItem = { id: 'i-water', name: 'Mineral Water', type: 'Product', hsn: '2201', unit: 'NOS', quantity: 1, rate: 20, tax_rate: 18, amount: 0 };

beforeEach(() => {
  resetStorage();
  installSettings();
  setTable('items_catalog', [TIKKA, NOODLES, WATER]);
  restaurantDb.saveSettings({ ...restaurantDb.settings(), stations: { 'g-tandoor': 'Tandoor', 'g-chinese': 'Chinese' } });
  freezeDate(`${DAY}T20:00:00`);
});
afterEach(() => thawDate());

test('send KOT prints only lines added since the last ticket, grouped by station (unmapped → Kitchen)', () => {
  const o = openOrder({ channel: 'dine_in', table_id: 'tbl_1', covers: 3 });
  addToOrder(o.id, TIKKA, { qty: 2 });
  addToOrder(o.id, NOODLES);
  addToOrder(o.id, WATER, { qty: 3 });
  const first = sendOrderKot(o.id);
  assert.deepEqual(first.kots.map((k) => [k.number, k.station]), [['K1', 'Tandoor'], ['K2', 'Chinese'], ['K3', 'Kitchen']]);
  assert.equal(sendOrderKot(o.id).kots.length, 0, 'nothing new');
  addToOrder(o.id, TIKKA); // +1 on the same line
  const second = sendOrderKot(o.id);
  assert.equal(second.kots.length, 1);
  assert.equal(second.kots[0].station, 'Tandoor');
  assert.deepEqual(second.kots[0].lines.map((l) => [l.name, l.qty]), [['Chicken Tikka', 1]]);
  assert.equal(stationFor({ group_id: 'g-other' }, restaurantDb.settings()), 'Kitchen');
  assert.equal(stationFor({}, null), 'Kitchen');
});

test('cancellations of sent quantity need a reason and print a cancellation ticket to the station', () => {
  const o = openOrder({ channel: 'dine_in', table_id: 'tbl_2' });
  addToOrder(o.id, TIKKA, { qty: 3 });
  sendOrderKot(o.id);
  const line = ordersDb.get(o.id)!.lines[0];
  assert.ok(cancelNeedsReason(ordersDb.get(o.id)!, line.id, 2));
  assert.throws(() => changeLineQty(o.id, line.id, 2), /reason/);
  const r = changeLineQty(o.id, line.id, 2, { reason: 'customer_cancelled' });
  assert.equal(r.kot?.kind, 'cancel');
  assert.equal(r.kot?.station, 'Tandoor');
  assert.equal(r.kot?.lines[0].qty, 1);
  const log = r.order.log.find((e) => e.kind === 'cancel')!;
  assert.deepEqual([log.line, log.qty, log.value, log.reason], ['Chicken Tikka', 1, 320, 'customer_cancelled']);
  assert.equal(sentQty(r.order, line.id), 2);
  assert.match(ticketLines(r.kot!, { where: 'Table 2', time: '8:00 pm' }, 80).join('\n'), /CANCEL KOT K2[\s\S]*Reason: customer cancelled[\s\S]*Chicken Tikka\s+-1/);
});

test('KOT numbers restart each local day', () => {
  freezeDate(`${DAY}T23:50:00`);
  const o = openOrder({ channel: 'takeaway' });
  addToOrder(o.id, WATER);
  assert.equal(sendOrderKot(o.id).kots[0].number, 'K1');
  addToOrder(o.id, NOODLES);
  assert.equal(sendOrderKot(o.id).kots[0].number, 'K2');
  freezeDate('2026-07-02T00:05:00');
  addToOrder(o.id, TIKKA);
  const k = sendOrderKot(o.id).kots[0];
  assert.equal(k.number, 'K1');
  assert.equal(k.day, '2026-07-02');
  assert.equal(nextKotNumber(ordersDb.all(), DAY), 3);
});

test('register totals and leakage rows (cancellations, moves)', () => {
  const o = openOrder({ channel: 'dine_in', table_id: 'tbl_1' });
  addToOrder(o.id, TIKKA, { qty: 2 });
  addToOrder(o.id, NOODLES);
  sendOrderKot(o.id);
  changeLineQty(o.id, ordersDb.get(o.id)!.lines[1].id, 0, { reason: 'out_of_stock' });
  moveToTable(o.id, 'tbl_9');
  const reg = kotRegister(ordersDb.all(), { from: DAY, to: DAY });
  assert.equal(reg.totals.kots, 2);
  assert.equal(reg.totals.cancels, 1);
  assert.equal(reg.totals.cancelValue, 220);
  assert.equal(reg.totals.moves, 1);
  assert.equal(reg.byStation.Chinese.cancels, 1);
  assert.equal(reg.byStation.Tandoor.qty, 2);
  assert.deepEqual(reg.leakage.map((r) => r.kind), ['cancel', 'move']);
  const sheet = registerSheet(reg);
  assert.ok(sheet.some((r) => r[5] === 'Cancellation'));
  assert.equal(kotRegister(ordersDb.all(), { from: DAY, to: DAY, station: 'Tandoor' }).rows.length, 1);
});

test('PIN cap: a clerk past 2 lines or ₹500 of cancellations needs the owner; the owner never does', () => {
  const order = { log: [{ at: '', by: 'x', kind: 'cancel', value: 300 }, { at: '', by: 'x', kind: 'cancel', value: 100 }] } as unknown as Pick<TableOrder, 'log'>;
  assert.equal(needsOwnerPin('owner', order, 10_000), false);
  assert.equal(needsOwnerPin('clerk', { log: [] }, 200), false);
  assert.equal(needsOwnerPin('clerk', { log: [] }, 600), true, 'over ₹500');
  assert.equal(needsOwnerPin('clerk', order, 50), true, 'a third line');
  assert.equal(needsOwnerPin('clerk', { log: [order.log[0]] }, 150), false);
  assert.equal(needsOwnerPin('clerk', { log: [order.log[0]] }, 250), true, '300 + 250 > 500');
});

test('owner-PIN error is raised by the store for a clerk (and skipped with ownerOk)', () => {
  const o = openOrder({ channel: 'dine_in', table_id: 'tbl_3' });
  addToOrder(o.id, TIKKA, { qty: 2 });
  sendOrderKot(o.id);
  const line = ordersDb.get(o.id)!.lines[0];
  setActorProvider(() => ({ id: 'u1', name: 'Ravi', role: 'clerk' }));
  try {
    let caught: unknown;
    try {
      changeLineQty(o.id, line.id, 0, { reason: 'other' });
    } catch (err) {
      caught = err;
    }
    assert.ok(isOwnerPinRequired(caught), '₹640 is above the ₹500 cap');
    const r = changeLineQty(o.id, line.id, 0, { reason: 'other', ownerOk: true });
    assert.equal(r.kot?.kind, 'cancel');
  } finally {
    setActorProvider(null);
  }
});

test('ticket text fits 32 / 48 columns with no prices; ESC/POS bytes wrap to the roll', () => {
  const o: TableOrder = { id: 'o', day: DAY, area_id: 'a', channel: 'dine_in', covers: 2, lines: [
    { id: 'l1', name: 'Paneer Butter Masala with extra gravy and jeera rice combo', type: 'Product', quantity: 2, rate: 350, amount: 700, note: 'less spicy, no onion' },
  ], kots: [], log: [], status: 'open', opened_at: `${DAY}T20:00:00` };
  const { kots } = sendKot(o, [], null, { by: 'Asha', at: `${DAY}T20:00:00`, day: DAY, newId: () => 'k1' });
  for (const width of [58, 80] as const) {
    const lines = ticketLines(kots[0], { where: 'Table 12', covers: 2, captain: 'Asha', time: '8:00 pm', duplicate: true }, width);
    const cols = width === 58 ? 32 : 48;
    assert.ok(lines.every((l) => l.length <= cols), `${width} mm: every line ≤ ${cols}`);
    assert.match(lines[0], /DUPLICATE/);
    assert.ok(!lines.join('\n').includes('350'), 'no prices on a KOT');
    assert.ok(lines.some((l) => l.includes('* less spicy')));
  }
  const bytes = ticketBytes(['x'.repeat(60)], 58);
  assert.equal(bytes[0], 0x1b);
  assert.ok(bytes.length > 60);
  assert.equal(byStation(o, null).get('Kitchen')?.length, 1);
  assert.equal(changeQty({ ...kots.length ? { ...o, kots } : o }, [], null, { lineId: 'l1', qty: 3, by: 'a', at: '', day: DAY, newId: () => 'k2' }).kot, undefined, 'raising a quantity is not a cancellation');
});
