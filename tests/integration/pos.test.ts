/**
 * POS quick bill (6.8) end to end through storage: split tender + change maths, a bill saved as a
 * normal invoice with payments and stock-out, FEFO auto-pick / split and the serial requirement,
 * composition profiles, the period lock, the Z report + day close, and backup of the new tables.
 */
import '../helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate, dumpStorage } from '../helpers/shim.ts';
import { SELLER, clientKA, installSettings } from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { DB_PREFIX } from '../../src/lib/storage.ts';
import { blankStockItem, loadPositions, stockDb } from '../../src/lib/inventory.ts';
import { computePurchaseTotals, purchasesDb } from '../../src/lib/purchases.ts';
import { clearOverrides } from '../../src/lib/period-lock.ts';
import {
  buildPosRecord, dayCloseDb, drawerCount, savePosBill, tenderSummary, zReport, zReportCsv, zReportHtml, WALK_IN_NAME,
  type Tender,
} from '../../src/lib/pos.ts';
import { priceLevelsDb, schemesDb, syncSchemeLines } from '../../src/lib/pricing.ts';
import { applyBackup, buildBackup, parseBackup, validateBackupData, wipeAppData } from '../../src/lib/backup.ts';
import type { InvoiceItem } from '../../src/types/invoice.ts';
import { useInvoiceStore } from '../../src/store/useInvoiceStore.ts';
import { addScannedCode, pickCatalogItem, setLineQuantity, setLineRate, repriceAll } from '../../src/components/creator/pricing-actions.ts';
import { KEYS, setTable } from '../../src/lib/storage.ts';
import type { PurchaseLine } from '../../src/types/purchases.ts';

const DAY = '2026-05-10';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

const line = (id: string, name: string, quantity: number, rate: number, tax_rate = 18, extra: Partial<InvoiceItem> = {}): InvoiceItem => ({
  id, name, type: 'Product', hsn: extra.hsn ?? '3401', unit: 'PCS', quantity, rate, tax_rate, discount_percent: 0, amount: quantity * rate, ...extra,
});

const build = (items: InvoiceItem[], party = {}) =>
  buildPosRecord({ items, party, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), templateId: 'classic_orange', day: DAY });

test('tender maths: split cash + UPI, change only from cash, short and over-paid non-cash', () => {
  const t = tenderSummary(1180, [{ method: 'Cash', amount: 1000 }, { method: 'UPI', amount: 200, reference: 'UTR1' }]);
  assert.deepEqual([t.tendered, t.change, t.due], [1200, 20, 0]);
  assert.deepEqual(t.payments, [{ method: 'Cash', amount: 980 }, { method: 'UPI', amount: 200, reference: 'UTR1' }]);
  const exact = tenderSummary(590, [{ method: 'Card', amount: 590 }]);
  assert.deepEqual([exact.change, exact.due, exact.payments.length], [0, 0, 1]);
  const short = tenderSummary(590, [{ method: 'Cash', amount: 500 }]);
  assert.equal(short.due, 90);
  const over = tenderSummary(590, [{ method: 'UPI', amount: 600 }, { method: 'Cash', amount: 100 }]);
  assert.equal(over.errors.length, 1);
  assert.equal(over.change, 0);
  // All change given back → no cash payment row at all; negatives count as zero.
  const allChange = tenderSummary(100, [{ method: 'UPI', amount: 100 }, { method: 'Cash', amount: -5 }]);
  assert.deepEqual(allChange.payments.map((p) => p.method), ['UPI']);
  // Several cash notes in one bill add up.
  assert.equal(tenderSummary(150, [{ method: 'Cash', amount: 100 }, { method: 'Cash', amount: 100 }]).change, 50);
});

test('a walk-in bill saves as a normal invoice: FY number, home-state GST, payments per tender, stock out, Paid', () => {
  stockDb.saveItem(blankStockItem({ id: 'soap', name: 'Soap 100 g', hsn: '3401', opening_qty: 50, opening_rate: 20 }));
  const rec = build([line('a', 'Soap 100 g', 3, 40), line('b', 'Comb', 1, 50, 12, { hsn: '9615' })], { phone: '9876543210' });
  assert.equal(rec.client.name, WALK_IN_NAME);
  assert.equal(rec.client.phone, '9876543210');
  assert.equal(rec.place_of_supply, '27');
  assert.equal(rec.gst_mode, 'CGST_SGST');
  assert.equal(rec.doc_type, 'INVOICE');
  assert.equal(rec.pos, true);
  // 120 @18% + 50 @12% = 120 + 21.6 + 50 + 6 = 197.6 → rounded 198
  assert.equal(rec.total, 198);

  const tenders: Tender[] = [{ method: 'Cash', amount: 100 }, { method: 'UPI', amount: 98, reference: 'UTR9' }];
  const res = savePosBill({ record: rec, tenders });
  assert.ok(res.ok, res.errors.join('; '));
  const saved = res.record!;
  assert.equal(saved.invoice_number, 'INV/FY26-27/0001');
  assert.equal(saved.status, 'Paid');
  assert.equal(saved.balance_due, 0);
  assert.equal(saved.pos, true);
  const pays = localDb.payments.listFor(saved.id);
  assert.deepEqual(pays.map((p) => [p.method, p.amount, p.date]), [['Cash', 100, DAY], ['UPI', 98, DAY]]);
  assert.equal(pays[1].reference, 'UTR9');
  // Stock is derived from invoice lines: 50 − 3.
  assert.equal(loadPositions().find((p) => p.item.id === 'soap')?.qty, 47);
  // Same save path as the editor: catalogue learned, client upserted.
  assert.ok(localDb.items.getAll().some((i) => i.name === 'Comb'));
  // A second bill takes the next number.
  const again = savePosBill({ record: build([line('c', 'Comb', 1, 50, 12)]), tenders: [{ method: 'Cash', amount: 100 }] });
  assert.equal(again.record?.invoice_number, 'INV/FY26-27/0002');
  assert.equal(again.summary?.change, 44);
  assert.equal(localDb.payments.listFor(again.record!.id)[0].amount, 56);
});

test('walk-ins pay in full; a saved client may leave a balance; another state is IGST', () => {
  const short = savePosBill({ record: build([line('a', 'Comb', 2, 50, 12)]), tenders: [{ method: 'Cash', amount: 50 }] });
  assert.equal(short.ok, false);
  assert.match(short.errors[0], /still unpaid/);
  assert.equal(localDb.invoices.getAll().length, 0, 'nothing written');

  const rec = build([line('a', 'Comb', 2, 50, 12)], { client: clientKA });
  assert.equal(rec.place_of_supply, '29');
  assert.equal(rec.gst_mode, 'IGST');
  const ok = savePosBill({ record: rec, tenders: [{ method: 'Card', amount: 50 }], allowCredit: true });
  assert.ok(ok.ok, ok.errors.join('; '));
  assert.equal(ok.record!.status, 'Partially Paid');
  assert.equal(ok.record!.balance_due, 62);
  assert.equal(ok.record!.client.name, clientKA.name);
});

function saveBill(lines: PurchaseLine[]) {
  const t = computePurchaseTotals(lines, { placeOfSupply: '27', businessState: '27' });
  return purchasesDb.save({
    kind: 'PURCHASE', vendor_name: 'Mumbai Pharma', bill_number: 'MP/1', date: '2026-03-05', category: 'Purchases', lines,
    taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, itc_eligible: true, total: t.total, amount_paid: 0,
  });
}

test('FEFO: batches auto-picked and split; serial items must have serials picked', () => {
  stockDb.saveItem(blankStockItem({ id: 'syr', name: 'Cough Syrup', hsn: '3004', track_batches: true }));
  stockDb.saveItem(blankStockItem({ id: 'ph', name: 'Phone X', hsn: '8517', track_serials: true, warranty_months: 12 }));
  saveBill([
    { id: 'a', name: 'Cough Syrup', hsn: '3004', quantity: 10, rate: 50, tax_rate: 12, batch_no: 'LATE', expiry_date: '2027-03-31' },
    { id: 'b', name: 'Cough Syrup', hsn: '3004', quantity: 5, rate: 50, tax_rate: 12, batch_no: 'SOON', expiry_date: '2026-07-31' },
    { id: 'c', name: 'Phone X', hsn: '8517', quantity: 2, rate: 10000, tax_rate: 18, serials: ['IMEI111', 'IMEI222'] },
  ]);
  const syrup = line('s', 'Cough Syrup', 7, 80, 12, { hsn: '3004' });
  const noSerial = savePosBill({ record: build([syrup, line('p', 'Phone X', 1, 15000, 18, { hsn: '8517' })]), tenders: [{ method: 'Cash', amount: 20000 }] });
  assert.equal(noSerial.ok, false);
  assert.match(noSerial.errors.join(' '), /Phone X: pick 1 serial number/);

  const res = savePosBill({
    record: build([syrup, line('p', 'Phone X', 1, 15000, 18, { hsn: '8517', serials: ['IMEI222'] })]),
    tenders: [{ method: 'Cash', amount: 20000 }],
  });
  assert.ok(res.ok, res.errors.join('; '));
  const batches = res.record!.items.filter((i) => i.name === 'Cough Syrup').map((i) => [i.batch_no, i.quantity, i.batch_expiry]);
  assert.deepEqual(batches, [['SOON', 5, '2026-07-31'], ['LATE', 2, '2027-03-31']], 'earliest expiry first, split across batches');
  assert.equal(res.record!.items[0].id, 's', 'the first part keeps the line id');
  // The serial is now sold: selling it again is refused.
  const twice = savePosBill({ record: build([line('p', 'Phone X', 1, 15000, 18, { hsn: '8517', serials: ['IMEI222'] })]), tenders: [{ method: 'Cash', amount: 17700 }] });
  assert.match(twice.errors.join(' '), /IMEI222 is not in stock/);
});

test('scheme free line goes out of stock at ₹0 and is not taxed; level rates flow through', () => {
  stockDb.saveItem(blankStockItem({ id: 'rice', name: 'Rice 5 kg', hsn: '1006', opening_qty: 20, opening_rate: 300 }));
  const lvl = priceLevelsDb.save({ id: '', name: 'Wholesale', percent_off: 10 });
  void lvl;
  schemesDb.save({ id: '', item_id: 'rice-cat', item_name: 'Rice 5 kg', buy_qty: 2, free_qty: 1 });
  const items = syncSchemeLines([line('r', 'Rice 5 kg', 4, 360, 5, { hsn: '1006', price_basis: 'Wholesale' })], schemesDb.all(), DAY);
  const rec = build(items);
  assert.equal(rec.items.length, 2);
  assert.equal(rec.taxable_value, 1440);
  const res = savePosBill({ record: rec, tenders: [{ method: 'UPI', amount: rec.total }] });
  assert.ok(res.ok, res.errors.join('; '));
  assert.equal(res.record!.items[0].price_basis, 'Wholesale');
  assert.equal(res.record!.items[1].rate, 0);
  assert.equal(res.record!.items[1].free_of, 'r');
  assert.equal(loadPositions().find((p) => p.item.id === 'rice')?.qty, 14, '4 sold + 2 free');
  // The catalogue never learns the ₹0 rate from the free line.
  assert.notEqual(localDb.items.getAll().find((i) => i.name === 'Rice 5 kg')?.rate, 0);
});

test('composition profile bills a Bill of Supply with no tax; the period lock is respected', () => {
  installSettings({ profiles: [{ ...SELLER, gst_scheme: 'composition', composition_category: 'trader' }] });
  const rec = build([line('a', 'Comb', 2, 50, 12)]);
  assert.equal(rec.doc_type, 'BILL_OF_SUPPLY');
  assert.equal(rec.tax_amount, 0);
  assert.equal(rec.total, 100);
  const res = savePosBill({ record: rec, tenders: [{ method: 'Cash', amount: 100 }] });
  assert.ok(res.ok, res.errors.join('; '));
  assert.match(res.record!.invoice_number, /^BOS\/FY26-27\/0001$/);

  installSettings({ lock_until: '2026-05-31' });
  const locked = savePosBill({ record: build([line('a', 'Comb', 1, 50, 12)]), tenders: [{ method: 'Cash', amount: 56 }] });
  assert.equal(locked.ok, false);
  assert.equal(locked.locked, true);
  assert.equal(localDb.payments.getAll().length, 1, 'no payment recorded for the refused bill');
});

test('Z report: bills, gross, discounts, tax by rate, tenders, drawer count, CSV and 80 mm print', () => {
  const b1 = savePosBill({ record: build([line('a', 'Soap', 2, 100, 18, { discount_percent: 10 })]), tenders: [{ method: 'Cash', amount: 300 }] });
  const b2 = savePosBill({ record: build([line('b', 'Comb', 1, 50, 12), line('c', 'Soap', 1, 100, 18)]), tenders: [{ method: 'UPI', amount: 100 }, { method: 'Card', amount: 74 }] });
  const b3 = savePosBill({ record: build([line('d', 'Comb', 1, 50, 12)]), tenders: [{ method: 'Cash', amount: 56 }] });
  assert.ok(b1.ok && b2.ok && b3.ok);
  localDb.invoices.setStatus(b3.record!.id, 'Cancelled');
  // A non-POS invoice the same day is not in the Z report.
  localDb.invoices.save({ ...build([line('x', 'Big job', 1, 10000)]), pos: undefined, invoice_number: '' });

  const z = zReport(DAY, localDb.invoices.getAll(), localDb.payments.getAll());
  assert.equal(z.bills, 2);
  assert.equal(z.cancelled, 1);
  assert.equal(z.firstNumber, 'INV/FY26-27/0001');
  assert.equal(z.lastNumber, 'INV/FY26-27/0002');
  // b1: gross 200, disc 20, taxable 180, GST 32.4 → 212.4 → 212; b2: 150 gross, 50@12 + 100@18 = 6 + 18 → 174
  assert.equal(z.gross, 350);
  assert.equal(z.discounts, 20);
  assert.equal(z.taxable, 330);
  assert.equal(z.tax, 56.4);
  assert.equal(z.net, 386);
  assert.deepEqual(z.taxByRate.map((s) => [s.rate, s.taxable, s.cgst, s.sgst, s.tax]), [[12, 50, 3, 3, 6], [18, 280, 25.2, 25.2, 50.4]]);
  assert.deepEqual(z.tenders, { cash: 212, upi: 100, card: 74, other: 0 }, 'cash net of the ₹88 change; the cancelled bill\'s cash is not counted');
  assert.equal(z.received, 386);
  assert.equal(z.credit, 0);

  assert.deepEqual(drawerCount(z, 500, 700), { expected: 712, difference: -12 });
  const close = dayCloseDb.close(z, 500, 700, 'short by 12');
  assert.equal(close.expected_cash, 712);
  assert.equal(close.difference, -12);
  assert.equal(dayCloseDb.forDay(DAY)?.counted_cash, 700);
  dayCloseDb.close(z, 500, 712);
  assert.equal(dayCloseDb.all().length, 1, 're-closing a day replaces its record');
  assert.equal(dayCloseDb.forDay(DAY)?.difference, 0);

  const csv = zReportCsv(z, dayCloseDb.forDay(DAY));
  assert.match(csv, /Net sales,386/);
  assert.match(csv, /Cash,212/);
  assert.match(csv, /Expected cash,712/);
  const html = zReportHtml(z, { business: SELLER.companyName, close: dayCloseDb.forDay(DAY), printedAt: 'now' });
  assert.match(html, /size: 80mm auto/);
  assert.match(html, /Z REPORT/);
  assert.ok(!/<script/i.test(html));
});

test('backup round-trip carries price levels, schemes and day-close records', () => {
  priceLevelsDb.save({ id: '', name: 'Wholesale', percent_off: 8, rates: { x: 10 } });
  schemesDb.save({ id: '', item_id: 'x', item_name: 'Soap', buy_qty: 3, free_qty: 1 });
  const z = zReport(DAY, [], []);
  dayCloseDb.close(z, 1000, 1000);
  const before = dumpStorage();
  const { data } = parseBackup(JSON.stringify(buildBackup()));
  validateBackupData(data);
  for (const t of ['price_levels', 'schemes', 'pos_day_close']) assert.ok(data[DB_PREFIX + t], `${t} in backup`);
  wipeAppData();
  assert.equal(priceLevelsDb.all().length, 0);
  applyBackup(data);
  for (const t of ['price_levels', 'schemes', 'pos_day_close']) assert.equal(dumpStorage()[DB_PREFIX + t], before[DB_PREFIX + t]);
  // A damaged row (no id) is refused.
  assert.throws(() => validateBackupData({ ...data, [DB_PREFIX + 'schemes']: JSON.stringify([{ item_name: 'x' }]) }), /schemes/);
});

test('editor: a scanned code adds the item at the client\'s level, increments, keeps scheme lines; a typed rate wins', () => {
  setTable(KEYS.items, [
    { id: 'soap', name: 'Neem Soap', type: 'Product', hsn: '3401', unit: 'PCS', quantity: 1, rate: 40, tax_rate: 18, amount: 0, sku: 'SOAP-1', qty_slabs: [{ min_qty: 10, rate: 30 }] },
  ]);
  const lvl = priceLevelsDb.save({ id: '', name: 'Wholesale', percent_off: 10 });
  schemesDb.save({ id: '', item_id: 'soap', item_name: 'Neem Soap', buy_qty: 2, free_qty: 1 });
  const cid = localDb.clients.upsert({ name: 'Gupta Stores', email: '', address: '', city: '', zip: '', state_code: '27', price_level: lvl.id });
  const st = () => useInvoiceStore.getState();
  st().newDraft('INVOICE');
  st().setSender(SELLER);
  st().setClient({ ...localDb.clients.getById(cid)!, id: cid });

  assert.equal(addScannedCode('nope').ok, false);
  const first = addScannedCode('soap-1');
  assert.ok(first.ok);
  assert.match(first.message, /Neem Soap × 1 · Wholesale price/);
  assert.equal(st().items.length, 1, 'the empty starter row is reused');
  assert.deepEqual([st().items[0].rate, st().items[0].price_basis], [36, 'Wholesale']);
  addScannedCode('SOAP-1');
  assert.equal(st().items[0].quantity, 2);
  assert.equal(st().items.length, 2, 'buy 2 get 1: a free line follows');
  assert.deepEqual([st().items[1].quantity, st().items[1].rate, st().items[1].free_of], [1, 0, st().items[0].id]);
  // Quantity 10 reaches the slab (30 < 36); the free line follows the quantity.
  setLineQuantity(st().items[0].id, 10);
  assert.deepEqual([st().items[0].rate, st().items[0].price_basis, st().items[1].quantity], [30, 'Qty ≥ 10', 5]);
  // A typed rate wins and is not re-priced by a quantity change…
  setLineRate(st().items[0].id, 33);
  setLineQuantity(st().items[0].id, 12);
  assert.deepEqual([st().items[0].rate, st().items[0].price_basis], [33, undefined]);
  // …until the user asks to re-price.
  assert.equal(repriceAll(), 1);
  assert.equal(st().items[0].rate, 30);
  const saved = st().saveInvoice();
  assert.ok(saved.ok, saved.errors.join('; '));
  assert.equal(saved.record!.items[0].price_basis, 'Qty ≥ 10');
  assert.equal(saved.record!.taxable_value, 360);

  // Credit notes are never re-priced; a picked item with no pricing set up keeps its catalogue rate.
  st().newDraft('CREDIT_NOTE');
  pickCatalogItem(st().items[0].id, localDb.items.getAll()[0]);
  assert.deepEqual([st().items[0].rate, st().items[0].price_basis], [40, undefined]);
});
