/** RT-A4 short book: add / close on arrival, PO grouping by each item's last supplier, the WhatsApp link. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { addShortBook, arrivedRows, backInStockLink, closeShortBook, groupBySupplier, lastSuppliers, loadShortBook, makePurchaseOrders } from '../src/lib/retail/rt-short-book.ts';
import type { PurchaseOrder } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
const DAY = '2026-07-20';
const bill = (id: string, vendor: string, date: string, item: string, rate: number) => ({ id, kind: 'PURCHASE', vendor_id: `v-${vendor}`, vendor_name: vendor, bill_number: id, date, status: 'unpaid', lines: [{ id: `${id}-l`, name: item, hsn: '1006', unit: 'KG', quantity: 10, rate, tax_rate: 5 }], taxable: 10 * rate, cgst: 0, sgst: 0, igst: 0, total: 10 * rate, amount_paid: 0 });

test('add, close on arrival or by hand', () => {
  const a = addShortBook({ date: DAY, name: 'Basmati rice', qty: 2, phone: '98000 00002' });
  addShortBook({ date: DAY, name: 'Ghee' });
  assert.throws(() => addShortBook({ date: DAY, name: ' ' }), /Type the item/);
  assert.equal(loadShortBook().length, 2);
  const arrived = arrivedRows(loadShortBook(), (r) => (r.name === 'Basmati rice' ? 5 : 0));
  assert.deepEqual(arrived.map((r) => r.id), [a.id]);
  assert.equal(closeShortBook(arrived.map((r) => r.id), 'arrived', DAY), 1);
  assert.deepEqual(loadShortBook().map((r) => r.status), ['closed', 'open']);
  assert.equal(loadShortBook()[0].closed_how, 'arrived');
  assert.equal(backInStockLink(a, 'Back in stock'), 'https://wa.me/919800000002?text=Back%20in%20stock');
  assert.equal(backInStockLink({ name: 'x' }, 'm'), undefined);
});

test('PO grouping by the last supplier (latest bill wins); unknown items on one order', async () => {
  const purchases = [bill('B1', 'Old Traders', '2026-06-01', 'Basmati rice', 90), bill('B2', 'New Traders', '2026-07-01', 'Basmati rice', 95), bill('B3', 'Old Traders', '2026-06-10', 'Ghee', 500)];
  setTable('purchases', purchases);
  const map = lastSuppliers(purchases);
  addShortBook({ date: DAY, name: 'Basmati rice', qty: 2 });
  addShortBook({ date: DAY, name: 'basmati rice', qty: 1 });
  addShortBook({ date: DAY, name: 'Ghee', qty: 3 });
  addShortBook({ date: DAY, name: 'Unknown pickle' });
  const groups = groupBySupplier(loadShortBook(), map);
  assert.deepEqual([...groups.values()].map((g) => [g.supplier?.vendorName ?? '', g.rows.length]), [['New Traders', 2], ['Old Traders', 1], ['', 1]]);
  assert.equal(await makePurchaseOrders(DAY), 3);
  const pos = getTable<PurchaseOrder>('purchase_orders');
  const nt = pos.find((p) => p.vendor_name === 'New Traders')!;
  assert.deepEqual(nt.lines.map((l) => [l.name, l.quantity, l.rate]), [['Basmati rice', 3, 95]], 'one line per item, quantities summed, last rate');
  assert.match(nt.po_number, /^PO\/FY26-27\/\d+$/);
  assert.ok(pos.some((p) => p.vendor_name === 'Supplier to be chosen'));
  assert.ok(loadShortBook().every((r) => r.status === 'ordered' && r.po_id));
  await assert.rejects(() => makePurchaseOrders(DAY), /No open rows/);
});
