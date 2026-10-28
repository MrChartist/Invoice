/**
 * R3-A1 · Tables & running orders: masters, move / merge / transfer, settle through savePosBill,
 * area price level, optional service charge, aggregator (Sec 9(5)) orders, day-close guard, daily
 * tokens and the period lock.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { gstin, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setTable } from '../src/lib/storage.ts';
import {
  addToOrder, changeLineQty, mergeInto, moveToTable, openOrder, ordersDb, previewBill, printBill, reopenOrder,
  restaurantDb, sendOrderKot, setServiceCharge, settleOrder, transferTo,
} from '../src/lib/restaurant/orders-store.ts';
import { floor, nextToken, orderSubtotal, starterMasters } from '../src/lib/restaurant/tables.ts';
import { sentQty } from '../src/lib/restaurant/kot.ts';
import { dayCloseDb, openOrdersBlocker, zReport } from '../src/lib/pos.ts';
import { shiftsDb } from '../src/lib/pos-shifts.ts';
import { buildGstr1 } from '../src/lib/gst-reports.ts';
import { buildBackup } from '../src/lib/backup.ts';
import { isSyncedKey } from '../src/lib/sync-engine.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';

const DAY = '2026-06-12';
const PANEER: InvoiceItem = { id: 'i-paneer', name: 'Paneer Tikka', type: 'Product', hsn: '996331', unit: 'NOS', quantity: 1, rate: 280, tax_rate: 5, amount: 0 };
const NAAN: InvoiceItem = { id: 'i-naan', name: 'Butter Naan', type: 'Product', hsn: '996331', unit: 'NOS', quantity: 1, rate: 60, tax_rate: 5, amount: 0 };
const LASSI: InvoiceItem = { id: 'i-lassi', name: 'Lassi', type: 'Product', hsn: '996331', unit: 'NOS', quantity: 1, rate: 90, tax_rate: 5, amount: 0 };

beforeEach(() => {
  resetStorage();
  installSettings();
  setTable('items_catalog', [PANEER, NAAN, LASSI]);
  freezeDate(`${DAY}T13:00:00`);
});
afterEach(() => thawDate());

const open = (table = 'tbl_1') => openOrder({ channel: 'dine_in', table_id: table, covers: 2 });

test('starter masters: one Dine-in area with tables 1–10 until saved', () => {
  const m = starterMasters();
  assert.equal(m.areas.length, 1);
  assert.equal(m.areas[0].name, 'Dine-in');
  assert.deepEqual(m.tables.map((t) => t.name), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.equal(restaurantDb.tables().length, 10);
  const o = open('tbl_3');
  const rows = floor(restaurantDb.tables(), ordersDb.all(), o.area_id, new Date(`${DAY}T13:25:00`));
  const t3 = rows.find((r) => r.table.id === 'tbl_3')!;
  assert.equal(t3.state, 'occupied');
  assert.equal(t3.minutes, 25);
  assert.equal(rows.find((r) => r.table.id === 'tbl_1')!.state, 'free');
  assert.throws(() => open('tbl_3'), /already has an order/);
});

test('move / merge / transfer keep line totals and KOT history', () => {
  const a = open('tbl_1');
  addToOrder(a.id, PANEER, { qty: 2 });
  addToOrder(a.id, NAAN, { qty: 3 });
  sendOrderKot(a.id);
  const before = orderSubtotal(ordersDb.get(a.id)!);
  assert.equal(before, 740);

  // Move to a free table.
  const moved = moveToTable(a.id, 'tbl_5');
  assert.equal(moved.table_id, 'tbl_5');
  assert.equal(orderSubtotal(moved), before);
  assert.equal(moved.kots.length, 1);
  assert.ok(moved.log.some((e) => e.kind === 'move' && e.from === 'tbl_1' && e.to === 'tbl_5'));

  // Merge another table's order (with its own KOT) into it.
  const b = open('tbl_2');
  addToOrder(b.id, LASSI, { qty: 2 });
  sendOrderKot(b.id);
  assert.throws(() => moveToTable(b.id, 'tbl_5'), /not free/);
  const merged = mergeInto(a.id, b.id);
  assert.equal(orderSubtotal(merged), before + 180);
  assert.equal(merged.kots.length, 2, 'both KOT histories kept');
  assert.equal(merged.covers, 4);
  assert.equal(ordersDb.get(b.id)!.status, 'void');
  assert.equal(sentQty(merged, merged.lines.find((l) => l.name === 'Lassi')!.id), 2, 'merged lines stay sent');

  // Transfer 1 of 3 naan to a new table: nothing is re-sent to the kitchen.
  const c = open('tbl_7');
  const naan = merged.lines.find((l) => l.name === 'Butter Naan')!;
  const r = transferTo(a.id, c.id, [{ line_id: naan.id, qty: 1 }]);
  assert.equal(orderSubtotal(r.from) + orderSubtotal(r.to), before + 180, 'totals kept across the transfer');
  assert.equal(r.to.lines[0].quantity, 1);
  assert.equal(sentQty(r.to, r.to.lines[0].id), 1);
  assert.equal(sentQty(r.from, naan.id), 2);
  assert.equal(sendOrderKot(c.id).kots.length, 0, 'transferred quantity is already with the kitchen');
  assert.ok(r.from.log.some((e) => e.kind === 'transfer' && e.qty === 1));
});

test('settle → one POS invoice with table_order_id and correct CGST / SGST; print freezes, reopen logs', () => {
  const o = open();
  addToOrder(o.id, PANEER, { qty: 2 });
  addToOrder(o.id, NAAN, { qty: 2 });
  const printed = printBill(o.id);
  assert.equal(printed.order.status, 'printed');
  assert.equal(printed.kots.length, 1, 'unsent lines go to the kitchen on Print bill');
  assert.throws(() => addToOrder(o.id, LASSI), /reopen/);
  reopenOrder(o.id);
  assert.ok(ordersDb.get(o.id)!.log.some((e) => e.kind === 'reopen'));

  const total = previewBill(ordersDb.get(o.id)!, DAY).total;
  const res = settleOrder(o.id, [{ method: 'UPI', amount: total }], { day: DAY });
  assert.ok(res.ok, res.errors.join('; '));
  const inv = res.record!;
  assert.equal(inv.table_order_id, o.id);
  assert.ok(inv.pos);
  assert.match(inv.invoice_number, /FY26-27\/0001$/);
  assert.equal(inv.taxable_value, 680);
  assert.equal(inv.cgst_amount, 17);
  assert.equal(inv.sgst_amount, 17);
  assert.equal(inv.status, 'Paid');
  const order = ordersDb.get(o.id)!;
  assert.equal(order.status, 'settled');
  assert.deepEqual(order.invoice_ids, [inv.id]);
  const z = zReport(DAY, localDb.invoices.getAll(), localDb.payments.getAll());
  assert.equal(z.bills, 1);
  assert.equal(z.tenders.upi, total);
});

test('area price level applies to lines ordered there', () => {
  setTable('price_levels', [{ id: 'lvl-ac', name: 'AC hall', percent_off: -10 }, { id: 'lvl-terrace', name: 'Terrace', rates: { 'i-paneer': 320 } }]);
  restaurantDb.saveAreas([{ id: 'a1', name: 'Indoor' }, { id: 'a2', name: 'Terrace', price_level_id: 'lvl-terrace' }]);
  restaurantDb.saveTables([{ id: 't1', name: '1', seats: 4, area_id: 'a1' }, { id: 't2', name: 'T1', seats: 4, area_id: 'a2' }]);
  const indoor = openOrder({ channel: 'dine_in', table_id: 't1' });
  addToOrder(indoor.id, PANEER);
  assert.equal(ordersDb.get(indoor.id)!.lines[0].rate, 280);
  const terrace = openOrder({ channel: 'dine_in', table_id: 't2' });
  addToOrder(terrace.id, PANEER);
  const line = ordersDb.get(terrace.id)!.lines[0];
  assert.equal(line.rate, 320);
  assert.equal(line.price_basis, 'Terrace');
  // Moving the indoor party to the terrace re-prices its lines.
  restaurantDb.saveTables([{ id: 't1', name: '1', seats: 4, area_id: 'a1' }, { id: 't2', name: 'T1', seats: 4, area_id: 'a2' }, { id: 't3', name: 'T2', seats: 4, area_id: 'a2' }]);
  assert.equal(moveToTable(indoor.id, 't3').lines[0].rate, 320);
});

test('service charge: off by default, optional per area, removable, taxed per the charges rule', () => {
  const plain = open('tbl_1');
  addToOrder(plain.id, PANEER);
  assert.equal(previewBill(ordersDb.get(plain.id)!, DAY).other_charges, 0, 'off by default');

  restaurantDb.saveAreas([{ id: 'area_dine_in', name: 'Dine-in', service_charge_pct: 10 }]);
  const o = open('tbl_2');
  addToOrder(o.id, PANEER, { qty: 2 });
  let bill = previewBill(ordersDb.get(o.id)!, DAY);
  assert.equal(bill.other_charges, 56);
  assert.equal(bill.charges_taxable, true);
  assert.match(bill.notes, /Service charge \(optional\)/);
  // Taxed like the food it follows: 5% on 560 + 56.
  assert.equal(bill.taxable_value, 616);
  assert.equal(bill.tax_amount, 30.8);
  setServiceCharge(o.id, true);
  bill = previewBill(ordersDb.get(o.id)!, DAY);
  assert.equal(bill.other_charges, 0, 'the cashier removed it');
  assert.equal(bill.taxable_value, 560);
});

test('aggregator order carries the operator under Sec 9(5) and lands in GSTR-1 Table 14(b)', () => {
  const swiggy = gstin('29AAFCB7707D1Z');
  const o = openOrder({ channel: 'aggregator', eco_gstin: swiggy, eco_name: 'Swiggy', ref: 'SW-4411' });
  assert.equal(o.token, 1);
  addToOrder(o.id, PANEER, { qty: 2 });
  const total = previewBill(ordersDb.get(o.id)!, DAY).total;
  const res = settleOrder(o.id, [{ method: 'Card', amount: total }], { day: DAY });
  assert.ok(res.ok, res.errors.join('; '));
  const inv = res.record!;
  assert.equal(inv.eco_gstin, swiggy);
  assert.equal(inv.eco_section, 'PAY_9_5');
  assert.equal(inv.tax_amount, 0, 'the operator pays the GST');
  assert.equal(inv.total, 560);
  const g1 = buildGstr1(localDb.invoices.getAll(), { period: { kind: 'month', fyStart: 2026, month: 6 } });
  const row = g1.gstr1.eco?.pay95.find((r) => r.etin === swiggy);
  assert.ok(row, 'Table 14(b) row for the operator');
  assert.equal(row!.value, 560);
  assert.equal(row!.cgst + row!.sgst + row!.igst, 0);
});

test('day close and shift close are refused while orders are open', () => {
  const o = open('tbl_4');
  addToOrder(o.id, NAAN);
  assert.match(openOrdersBlocker(DAY), /1 restaurant order is still open \(table 4\)/);
  const z = zReport(DAY, [], []);
  assert.throws(() => dayCloseDb.close(z, 0, 0), /still open/);
  const s = shiftsDb.open(0, DAY);
  assert.throws(() => shiftsDb.close(s.id, z, 0, 0), /still open/);
  const total = previewBill(ordersDb.get(o.id)!, DAY).total;
  assert.ok(settleOrder(o.id, [{ method: 'Cash', amount: total }], { day: DAY }).ok);
  assert.equal(openOrdersBlocker(DAY), '');
  assert.doesNotThrow(() => dayCloseDb.close(zReport(DAY, localDb.invoices.getAll(), localDb.payments.getAll()), 0, total));
});

test('tokens restart on the next local day (across midnight)', () => {
  freezeDate(`${DAY}T23:58:00`);
  const t1 = openOrder({ channel: 'takeaway' });
  const t2 = openOrder({ channel: 'delivery' });
  assert.deepEqual([t1.token, t2.token], [1, 2]);
  assert.equal(t1.day, DAY);
  freezeDate('2026-06-13T00:02:00');
  const t3 = openOrder({ channel: 'takeaway' });
  assert.equal(t3.token, 1);
  assert.equal(t3.day, '2026-06-13');
  assert.equal(nextToken(ordersDb.all(), DAY), 3);
});

test('period lock is respected on settle (nothing written)', () => {
  installSettings({ lock_until: '2026-06-30' } as never);
  const o = open();
  addToOrder(o.id, PANEER);
  const total = previewBill(ordersDb.get(o.id)!, DAY).total;
  const res = settleOrder(o.id, [{ method: 'Cash', amount: total }], { day: DAY });
  assert.equal(res.ok, false);
  assert.ok(res.locked);
  assert.equal(localDb.invoices.getAll().length, 0);
  assert.equal(localDb.payments.getAll().length, 0);
  assert.equal(ordersDb.get(o.id)!.status, 'open');
});

test('orders are company data: backed up and synced; reducing an unsent line needs no reason', () => {
  const o = open();
  addToOrder(o.id, NAAN, { qty: 2 });
  changeLineQty(o.id, ordersDb.get(o.id)!.lines[0].id, 1);
  assert.equal(ordersDb.get(o.id)!.lines[0].quantity, 1);
  const { data } = buildBackup();
  assert.ok(data['mrchartist_inv_table_orders']);
  assert.ok(isSyncedKey('mrchartist_inv_table_orders'));
});
