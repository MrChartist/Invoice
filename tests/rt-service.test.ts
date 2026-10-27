/** RT-D4: repair job sheets — numbering, status flow, warranty from the serial, claim → no sale, billing with parts + advance. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { clientRetail, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { blankStockItem, stockDb } from '../src/lib/inventory.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { loadTracking, serialsInStock } from '../src/lib/stock-tracking.ts';
import { saveAdvance } from '../src/lib/advances.ts';
import { getTable } from '../src/lib/storage.ts';
import {
  addJob, billJob, canMove, deleteJob, jobLines, loadJobs, moveJob, nextServiceStatus, overdueJobs, repairRule, replacementSwap, setClaim, updateJob, warrantyFor,
} from '../src/lib/retail/rt-service-jobs.ts';

const DAY = '2026-07-20';
const IMEI = '490154203237518';
beforeEach(() => {
  resetStorage();
  installSettings();
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

function stock() {
  const phone = blankStockItem({ name: 'Redmi 13', hsn: '8517', track_serials: true, warranty_months: 12, sale_rate: 13999, tax_rate: 18 });
  const screen = blankStockItem({ name: 'Redmi 13 display', hsn: '8517', opening_qty: 5, opening_rate: 1500, sale_rate: 2500, tax_rate: 18 });
  stockDb.saveItem(phone);
  stockDb.saveItem(screen);
  purchasesDb.save({ kind: 'PURCHASE', vendor_name: 'Distributor', bill_number: 'D-1', date: '2026-01-02', category: 'Purchases', lines: [{ id: 'l', name: 'Redmi 13', item_id: phone.id, hsn: '8517', quantity: 1, rate: 11000, tax_rate: 18, serials: [IMEI] }], taxable: 11000, cgst: 990, sgst: 990, igst: 0, total: 12980, amount_paid: 0, itc_eligible: true });
  const sale = createViaStore({ client: clientRetail, date: '2026-02-01', lines: [{ name: 'Redmi 13', hsn: '8517', qty: 1, rate: 13999, tax: 18 }], status: 'Sent' });
  localDb.invoices.save({ ...sale, items: sale.items.map((l) => ({ ...l, serials: [IMEI], warranty_months: 12 })) });
  return { phone, screen, sale };
}
const job = (over: Partial<Parameters<typeof addJob>[0]> = {}) => addJob({ date: DAY, customer: clientRetail.name, phone: '9800000010', asset: { model: 'Redmi 13', serial: IMEI }, complaint: 'Broken screen', estimate: 3200, due: '2026-07-24', ...over }, loadTracking());

test('numbering SVC/FY…, status flow, overdue', () => {
  const a = job();
  const b = job();
  assert.deepEqual([a.number, b.number], ['SVC/FY26-27/0001', 'SVC/FY26-27/0002']);
  assert.ok(canMove('received', 'diagnosed') && canMove('approved', 'in_repair') && canMove('approved', 'at_service_centre') && canMove('at_service_centre', 'ready'));
  assert.ok(!canMove('received', 'ready') && !canMove('delivered', 'returned') && canMove('diagnosed', 'returned'));
  assert.equal(nextServiceStatus('in_repair'), 'ready');
  moveJob(a.id, 'diagnosed', DAY);
  assert.throws(() => moveJob(a.id, 'delivered', DAY), /cannot move/);
  assert.deepEqual(loadJobs()[0].history.map((h) => h.status), ['received', 'diagnosed']);
  assert.equal(overdueJobs(loadJobs(), '2026-07-25').length, 2);
  deleteJob(b.id);
  assert.equal(job().number, 'SVC/FY26-27/0003', 'a deleted number is never reused');
  assert.deepEqual(repairRule('phone', DAY), { sac: '998716', rate: 18 });
  assert.deepEqual(repairRule('vehicle', DAY), { sac: '998714', rate: 18 }, 'generic: workshops (SV-D)');
});

test('warranty status from the serial (sale date + months); claim approved → the free part is no sale', () => {
  const { screen, sale } = stock();
  const w = warrantyFor(loadTracking(), IMEI, DAY);
  assert.deepEqual([w.status, w.until, w.saleInvoiceId], ['active', '2027-01-31', sale.id]);
  assert.equal(warrantyFor(loadTracking(), IMEI, '2027-03-01').status, 'expired');
  assert.equal(warrantyFor(loadTracking(), 'NOPE', DAY).status, 'none');
  const j = job();
  assert.equal(j.warranty?.status, 'active');
  assert.equal(j.asset.sale_invoice_id, sale.id, 'linked to our sale');
  updateJob(j.id, { parts: [{ id: '', item_id: screen.id, name: screen.name, hsn: '8517', qty: 1, rate: 2500, tax_rate: 18, warranty: true }], labour: 0 });
  setClaim(j.id, { vendor_name: 'Xiaomi service centre', claim_no: 'CLM-9', status: 'sent', date: DAY });
  assert.throws(() => setClaim(j.id, { vendor_name: 'Xiaomi service centre', status: 'settled', date: DAY }), /approved claim/);
  setClaim(j.id, { vendor_name: 'Xiaomi service centre', claim_no: 'CLM-9', status: 'approved', date: DAY });
  const before = localDb.invoices.getAll().length;
  assert.equal(billJob(j.id, DAY), undefined, 'nothing chargeable: no invoice, no GST');
  assert.equal(localDb.invoices.getAll().length, before);
  const pos = [...loadTracking().values()].find((t) => t.item.id === screen.id)!;
  assert.equal(pos.qty, 4, 'the free part left stock at no value');
});

test('billed job: SAC 998716 labour + parts at their own rates, out of stock, advance adjusted', () => {
  const { screen } = stock();
  const adv = saveAdvance({ date: DAY, client: { name: clientRetail.name }, place_of_supply: '27', supply: 'services', tax_rate: 18, amount: 1000, method: 'Cash' });
  const j = job({ advance_id: adv.id });
  moveJob(j.id, 'diagnosed', DAY);
  updateJob(j.id, { parts: [{ id: '', item_id: screen.id, name: screen.name, hsn: '8517', qty: 1, rate: 2500, tax_rate: 18 }], labour: 700, warranty: { status: 'expired' } });
  const lines = jobLines(loadJobs()[0], DAY);
  assert.deepEqual(lines.map((l) => [l.hsn, l.rate, l.tax_rate, l.type]), [['998716', 700, 18, 'Service'], ['8517', 2500, 18, 'Product']]);
  const inv = billJob(j.id, DAY)!;
  assert.equal(inv.total, 3776);
  assert.equal(inv.balance_due, 2776, 'the ₹1,000 advance adjusted');
  assert.equal(loadJobs()[0].invoice_number, inv.invoice_number);
  assert.throws(() => billJob(j.id, DAY), /already billed/);
  assert.throws(() => deleteJob(j.id), /billed/);
  const pos = [...loadTracking().values()].find((t) => t.item.id === screen.id)!;
  assert.equal(pos.qty, 4, 'the part is out of stock through the sale');
});

test('replacement swap keeps stock counts (old serial out, new serial in, no value)', () => {
  const { phone } = stock();
  purchasesDb.save({ kind: 'PURCHASE', vendor_name: 'Distributor', bill_number: 'D-2', date: '2026-03-01', category: 'Purchases', lines: [{ id: 'l2', name: 'Redmi 13', item_id: phone.id, hsn: '8517', quantity: 1, rate: 11000, tax_rate: 18, serials: ['490154203237526'] }], taxable: 11000, cgst: 990, sgst: 990, igst: 0, total: 12980, amount_paid: 0, itc_eligible: true });
  const j = job();
  const before = [...loadTracking().values()].find((t) => t.item.id === phone.id)!;
  replacementSwap(j.id, { itemId: phone.id, outSerial: '490154203237526', inSerial: '358240051111110', date: DAY });
  const after = [...loadTracking().values()].find((t) => t.item.id === phone.id)!;
  assert.equal(after.qty, before.qty);
  assert.deepEqual(serialsInStock(after), ['358240051111110']);
  assert.equal(loadJobs()[0].swap_move_ids?.length, 2);
  assert.ok(getTable<{ rate: number }>('stock_moves').every((m) => m.rate === 0));
});
