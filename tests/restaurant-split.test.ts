/**
 * R3-A3 · Split bill: equal payers settle exactly; item / seat splits keep GST exact; share lines keep
 * HSN / rate; consecutive numbering across an FY boundary; the order closes only when every part is
 * paid; cess and tax-inclusive pricing.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setTable } from '../src/lib/storage.ts';
import {
  addToOrder, openOrder, ordersDb, patchLine, payPayer, previewBill, previewParts, settleParts, startPayers,
} from '../src/lib/restaurant/orders-store.ts';
import { allocate, customPayerErrors, equalPayers, partLines, payersPaid, seatPicks, shareStep } from '../src/lib/restaurant/split-bill.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';
import type { OrderLine } from '../src/types/restaurant.ts';

const DAY = '2026-08-20';
const item = (id: string, name: string, rate: number, extra: Partial<InvoiceItem> = {}): InvoiceItem => ({ id, name, type: 'Product', hsn: '996331', unit: 'NOS', quantity: 1, rate, tax_rate: 5, amount: 0, ...extra });
const THALI = item('i-thali', 'Veg Thali', 333.67);
const NAAN = item('i-naan', 'Butter Naan', 45);
const COKE = item('i-coke', 'Cola 300 ml', 40, { hsn: '2202', tax_rate: 28, cess_rate: 12 });
const DAL = item('i-dal', 'Dal Makhani', 241);

beforeEach(() => {
  resetStorage();
  installSettings({ roundOff: false } as never);
  setTable('items_catalog', [THALI, NAAN, COKE, DAL]);
  freezeDate(`${DAY}T21:00:00`);
});
afterEach(() => thawDate());

test('equal split of ₹1,001 into 3 settles exactly, payer by payer; the order closes only when all are paid', () => {
  assert.deepEqual(equalPayers(1001, 3).map((p) => p.amount), [333.67, 333.67, 333.66]);
  assert.deepEqual(customPayerErrors(1001, [500, 501]), []);
  assert.match(customPayerErrors(1001, [500, 500])[0], /short by ₹1\.00/);

  const o = openOrder({ channel: 'dine_in', table_id: 'tbl_1', covers: 3 });
  // 3 × 333.67 = 1001.01 + 5% would not be 1001; build an order totalling exactly ₹1,001.00 instead.
  setTable('items_catalog', [item('i-x', 'Set menu', 953.33)]);
  addToOrder(o.id, item('i-x', 'Set menu', 953.33));
  const total = previewBill(ordersDb.get(o.id)!, DAY).total;
  assert.equal(total, 1001);
  startPayers(o.id, equalPayers(total, 3));
  const r1 = payPayer(o.id, 0, { method: 'Cash', amount: 0 }, { day: DAY });
  assert.ok(r1.ok, r1.errors.join('; '));
  assert.equal(ordersDb.get(o.id)!.status, 'open', 'partial settlement keeps the order open');
  assert.equal(localDb.invoices.getAll().length, 1, 'one invoice, no extra tax documents');
  assert.ok(payPayer(o.id, 1, { method: 'UPI', amount: 0 }, { day: DAY }).ok);
  assert.equal(payPayer(o.id, 1, { method: 'UPI', amount: 0 }, { day: DAY }).ok, false, 'already paid');
  const r3 = payPayer(o.id, 2, { method: 'Card', amount: 0 }, { day: DAY });
  assert.ok(r3.ok);
  const order = ordersDb.get(o.id)!;
  assert.equal(order.status, 'settled');
  assert.ok(payersPaid(order.payers));
  const inv = localDb.invoices.getById(order.invoice_ids![0])!;
  assert.equal(inv.status, 'Paid');
  const paid = localDb.payments.getAll().filter((p) => p.invoice_id === inv.id).reduce((s, p) => s + p.amount, 0);
  assert.equal(Math.round(paid * 100), 100100);
});

test('item split: sub-invoice GST adds up to the unsplit GST exactly, including a share line; HSN / rate kept', () => {
  const o = openOrder({ channel: 'dine_in', table_id: 'tbl_2' });
  addToOrder(o.id, DAL); // shared three ways (₹241: not divisible into equal paise of tax)
  addToOrder(o.id, NAAN, { qty: 3 }); // 1 naan each, by quantity
  addToOrder(o.id, COKE); // cess item, to part 2
  const ord = ordersDb.get(o.id)!;
  const [dal, naan, coke] = ord.lines;
  const picks = [
    { line_id: dal.id, part: 1, qty: 1 / 3 }, { line_id: dal.id, part: 2, qty: 1 / 3 }, { line_id: dal.id, part: 3, qty: 1 / 3 },
    { line_id: naan.id, part: 1, qty: 1 }, { line_id: naan.id, part: 2, qty: 1 }, { line_id: naan.id, part: 3, qty: 1 },
    { line_id: coke.id, part: 2 },
  ];
  const { records, recon } = previewParts(ord, picks, 3, DAY);
  assert.equal(records.length, 3);
  // Total GST + cess is exact; per-line CGST / SGST halves of 3 × ₹2.25 may swap a paisa (shown on the strip).
  assert.ok(recon.taxTotalExact, JSON.stringify(recon.diff));
  assert.ok(Math.abs(recon.diff.cgst) <= 0.01 && Math.abs(recon.diff.sgst) <= 0.01);
  assert.equal(recon.diff.taxable, 0);
  const shares = records.flatMap((r) => r.items.filter((i) => i.name === 'Dal Makhani'));
  assert.equal(shares.length, 3);
  assert.ok(shares.every((s) => s.hsn === '996331' && s.tax_rate === 5 && s.quantity === 1));
  assert.equal(Math.round(shares.reduce((s, x) => s + x.rate, 0) * 100), 24100);
  assert.ok(records.every((r) => r.items.filter((i) => i.name === 'Butter Naan').every((i) => i.quantity === 1)), 'naan split by whole quantity');
  assert.equal(records[1].cess_amount, recon.whole.cess, 'cess stays with its part');

  const res = settleParts(o.id, picks, 3, records.map((r) => [{ method: 'Cash' as const, amount: r.total }]), { day: DAY });
  assert.ok(res.ok, res.errors.join('; '));
  assert.deepEqual(res.records!.map((r) => r.split_of), [1, 2, 3].map((part) => ({ order_id: o.id, part, parts: 3 })));
  assert.deepEqual(res.records!.map((r) => r.invoice_number.slice(-4)), ['0001', '0002', '0003'], 'consecutive POS numbers');
  assert.ok(res.records!.every((r) => r.table_order_id === o.id && r.status === 'Paid'));
  assert.equal(ordersDb.get(o.id)!.status, 'settled');
});

test('seat split: one bill per seat; tax-inclusive pricing still adds up', () => {
  installSettings({ roundOff: false, priceIncludesTax: true } as never);
  const o = openOrder({ channel: 'dine_in', table_id: 'tbl_3' });
  addToOrder(o.id, DAL, { seat: 1 });
  addToOrder(o.id, THALI, { seat: 2 });
  addToOrder(o.id, NAAN, { qty: 2, seat: 2 });
  const ord = ordersDb.get(o.id)!;
  patchLine(o.id, ord.lines[0].id, { seat: 1 });
  const { picks, parts } = seatPicks(ordersDb.get(o.id)!.lines);
  assert.equal(parts, 2);
  const { records, recon } = previewParts(ordersDb.get(o.id)!, picks, parts, DAY);
  assert.equal(records.length, 2);
  assert.ok(recon.taxExact, JSON.stringify(recon.diff));
  // Inclusive share lines: a step whose base and GST are both exact paise.
  const step = shareStep(5, 0, true);
  assert.equal((step * 100) % 105, 0);
  const lines: OrderLine[] = [{ id: 'l', name: 'Biryani', type: 'Product', hsn: '996331', quantity: 1, rate: 299, tax_rate: 5, amount: 299 }];
  const split = partLines({ lines }, [{ line_id: 'l', part: 1, qty: 0.5 }, { line_id: 'l', part: 2, qty: 0.5 }], 2, true);
  assert.equal(Math.round((split[0][0].rate + split[1][0].rate) * 100), 29900);
  assert.equal(split[0][0].hsn, '996331');
});

test('numbering stays consecutive in the FY of the settle day (31 Mar → 1 Apr)', () => {
  for (const [day, fy] of [['2027-03-31', 'FY26-27'], ['2027-04-01', 'FY27-28']] as const) {
    freezeDate(`${day}T22:00:00`);
    const o = openOrder({ channel: 'takeaway' });
    addToOrder(o.id, NAAN);
    addToOrder(o.id, DAL);
    const ord = ordersDb.get(o.id)!;
    const picks = [{ line_id: ord.lines[0].id, part: 1 }, { line_id: ord.lines[1].id, part: 2 }];
    const { records } = previewParts(ord, picks, 2, day);
    const res = settleParts(o.id, picks, 2, records.map((r) => [{ method: 'UPI' as const, amount: r.total }]), { day });
    assert.ok(res.ok, res.errors.join('; '));
    assert.deepEqual(res.records!.map((r) => r.invoice_number.split('/').slice(1).join('/')), [`${fy}/0001`, `${fy}/0002`]);
  }
});

test('allocate: steps for all but the last share, remainder last; shareStep keeps GST and halves exact', () => {
  assert.deepEqual(allocate(24100, [1, 1, 1], 40), [8040, 8040, 8020]);
  assert.deepEqual(allocate(100, [1, 1, 1]), [33, 33, 34]);
  assert.equal(shareStep(18), 100);
  assert.equal(shareStep(5), 40);
  assert.equal(shareStep(0), 1);
  const s = shareStep(28, 12);
  assert.equal((s * 28) % 200, 0);
  assert.equal((s * 12) % 100, 0);
});
