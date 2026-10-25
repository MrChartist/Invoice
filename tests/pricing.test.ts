/**
 * Price levels, quantity slabs, buy-X-get-Y schemes (6.9) and scan matching / qty increment (6.7).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  cleanSlabs, freeQty, levelForClient, levelRate, priceLevelsDb, pricingInUse, resolvePrice, schemeActive, schemeFor,
  schemesDb, slabFor, syncSchemeLines, validateLevel, validateScheme, type PriceLevel, type Scheme,
} from '../src/lib/pricing.ts';
import { addScannedLine, codeKey, findByCode, normalizeCode } from '../src/lib/scan.ts';
import { localDb } from '../src/lib/localDb.ts';
import { saveCatalogItem } from '../src/lib/catalog.ts';
import { KEYS, getTable, setTable } from '../src/lib/storage.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';
import type { StockItem } from '../src/lib/inventory.ts';

beforeEach(() => resetStorage());

const rice: InvoiceItem = {
  id: 'rice', name: 'Rice 5 kg', type: 'Product', hsn: '1006', unit: 'BAG', quantity: 1, rate: 400, tax_rate: 5, amount: 0,
  qty_slabs: [{ min_qty: 10, rate: 370 }, { min_qty: 25, rate: 350 }],
};
const wholesale: PriceLevel = { id: 'ws', name: 'Wholesale', percent_off: 10 };
const distributor: PriceLevel = { id: 'ds', name: 'Distributor', percent_off: 5, rates: { rice: 330 } };

test('resolution order: base → level (own rate beats % off) → slab; the lower of level and slab wins', () => {
  assert.deepEqual(resolvePrice(rice, 1), { rate: 400, source: 'base' });
  assert.deepEqual(resolvePrice(rice, 1, wholesale), { rate: 360, basis: 'Wholesale', source: 'level' });
  assert.deepEqual(resolvePrice(rice, 12), { rate: 370, basis: 'Qty ≥ 10', source: 'slab' });
  assert.deepEqual(resolvePrice(rice, 30), { rate: 350, basis: 'Qty ≥ 25', source: 'slab' });
  // Wholesale 360 beats the 10+ slab (370) but loses to the 25+ slab (350).
  assert.equal(resolvePrice(rice, 12, wholesale).basis, 'Wholesale');
  assert.equal(resolvePrice(rice, 30, wholesale).rate, 350);
  // An own level rate wins over the level's % off, and over any slab above it.
  assert.deepEqual(resolvePrice(rice, 30, distributor), { rate: 330, basis: 'Distributor', source: 'level' });
  assert.equal(levelRate(distributor, { id: 'other', rate: 100 }), 95);
  // A level with neither rate nor % sets nothing; a tie between level and slab keeps the level.
  assert.deepEqual(resolvePrice(rice, 1, { id: 'x', name: 'Empty' }), { rate: 400, source: 'base' });
  assert.equal(resolvePrice({ ...rice, qty_slabs: [{ min_qty: 2, rate: 360 }] }, 5, wholesale).basis, 'Wholesale');
});

test('slabs are cleaned and the highest qualifying slab applies', () => {
  assert.deepEqual(cleanSlabs([{ min_qty: 25, rate: 350 }, { min_qty: 0, rate: 1 }, { min_qty: 10, rate: -1 }, { min_qty: 10, rate: 370 }]), [
    { min_qty: 10, rate: 370 },
    { min_qty: 25, rate: 350 },
  ]);
  assert.equal(slabFor(rice.qty_slabs, 9.99), undefined);
  assert.equal(slabFor(rice.qty_slabs, 10)?.rate, 370);
  assert.equal(slabFor(undefined, 100), undefined);
});

const bogo: Scheme = { id: 'sch', item_id: 'rice', item_name: 'Rice 5 kg', buy_qty: 2, free_qty: 1, valid_from: '2026-05-01', valid_to: '2026-05-31' };

test('schemes: date window, pause, free quantity per full buy quantity', () => {
  assert.ok(schemeActive(bogo, '2026-05-01'));
  assert.ok(!schemeActive(bogo, '2026-04-30'));
  assert.ok(!schemeActive(bogo, '2026-06-01'));
  assert.ok(!schemeActive({ ...bogo, active: false }, '2026-05-10'));
  assert.equal(freeQty(bogo, 1), 0);
  assert.equal(freeQty(bogo, 2), 1);
  assert.equal(freeQty(bogo, 5), 2);
  assert.equal(freeQty({ buy_qty: 3, free_qty: 2 }, 6), 4);
  assert.equal(schemeFor([bogo], { name: 'rice 5 KG' }, '2026-05-10')?.id, 'sch');
  assert.equal(schemeFor([bogo], { id: 'rice', name: 'renamed' }, '2026-05-10')?.id, 'sch');
  assert.equal(schemeFor([bogo], { name: 'Dal' }, '2026-05-10'), undefined);
});

test('syncSchemeLines adds a ₹0 free line under the paid line, updates and removes it', () => {
  let n = 0;
  const id = () => `f${++n}`;
  const paid = { ...rice, id: 'l1', quantity: 4, amount: 1600 };
  let items = syncSchemeLines([paid, { ...rice, id: 'l2', name: 'Dal', quantity: 1, amount: 0 }], [bogo], '2026-05-10', id);
  assert.equal(items.length, 3);
  assert.deepEqual(
    { id: items[1].id, name: items[1].name, qty: items[1].quantity, rate: items[1].rate, free_of: items[1].free_of, scheme: items[1].scheme_id, tax: items[1].tax_rate },
    { id: 'f1', name: 'Rice 5 kg', qty: 2, rate: 0, free_of: 'l1', scheme: 'sch', tax: 5 },
  );
  assert.match(items[1].description ?? '', /Buy 2 get 1 free/);
  // Unchanged input → same array (no needless store updates).
  assert.equal(syncSchemeLines(items, [bogo], '2026-05-10', id), items);
  // Quantity up → free line follows (same id).
  items = syncSchemeLines(items.map((l) => (l.id === 'l1' ? { ...l, quantity: 7 } : l)), [bogo], '2026-05-10', id);
  assert.equal(items[1].id, 'f1');
  assert.equal(items[1].quantity, 3);
  // Below the buy quantity → free line removed; outside the window → removed too.
  assert.equal(syncSchemeLines(items.map((l) => (l.id === 'l1' ? { ...l, quantity: 1 } : l)), [bogo], '2026-05-10', id).length, 2);
  assert.equal(syncSchemeLines(items, [bogo], '2026-06-10', id).length, 2);
  // Paid line deleted → orphan free line dropped; no schemes and no free lines → untouched.
  assert.equal(syncSchemeLines(items.filter((l) => l.id !== 'l1'), [bogo], '2026-05-10', id).length, 1);
  const plain = [paid];
  assert.equal(syncSchemeLines(plain, [], '2026-05-10', id), plain);
});

test('the free line carries no taxable value: GST is on the price paid for the bundle', async () => {
  const { calculateInvoice } = await import('../src/lib/invoice-calc.ts');
  const items = syncSchemeLines([{ ...rice, id: 'l1', quantity: 2, amount: 800 }], [bogo], '2026-05-10', () => 'f');
  const t = calculateInvoice({
    items, gst_mode: 'CGST_SGST', discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0,
    round_off_enabled: false, amount_paid: 0,
  });
  assert.equal(t.taxable_value, 800);
  assert.equal(t.tax_amount, 40);
  assert.equal(t.lines[1].taxable, 0);
});

test('validation and storage of levels and schemes; deleting a level clears it from clients', () => {
  assert.match(validateLevel({ id: '', name: ' ' }, []), /name/);
  assert.match(validateLevel({ id: '', name: 'wholesale' }, [wholesale]), /already exists/);
  assert.match(validateLevel({ id: '', name: 'X', percent_off: 120 }, []), /between 0 and 100/);
  assert.match(validateScheme({ ...bogo, buy_qty: 1.5 }), /whole number/);
  assert.match(validateScheme({ ...bogo, valid_to: '2026-04-01' }), /ends before/);

  assert.equal(pricingInUse(), false, 'nothing defined: simple users see nothing new');
  const lvl = priceLevelsDb.save({ id: '', name: 'Wholesale', percent_off: 10 });
  priceLevelsDb.setItemRate(lvl.id, 'rice', 355);
  assert.equal(priceLevelsDb.all()[0].rates?.rice, 355);
  priceLevelsDb.setItemRate(lvl.id, 'rice', undefined);
  assert.equal(priceLevelsDb.all()[0].rates, undefined);
  assert.equal(pricingInUse(), true);
  const cid = localDb.clients.upsert({ name: 'Kirana Mart', email: '', address: '', city: '', zip: '', price_level: lvl.id });
  assert.equal(levelForClient(localDb.clients.getById(cid), priceLevelsDb.all())?.name, 'Wholesale');
  priceLevelsDb.remove(lvl.id);
  assert.equal(localDb.clients.getById(cid)?.price_level, undefined);
  assert.equal(levelForClient(localDb.clients.getById(cid), priceLevelsDb.all()), null);

  schemesDb.save({ ...bogo, id: '' });
  assert.equal(schemesDb.all().length, 1);
  assert.throws(() => schemesDb.save({ ...bogo, id: '', free_qty: 0 }), /Free quantity/);
  schemesDb.remove(schemesDb.all()[0].id);
  assert.equal(pricingInUse(), false);
  // A catalogue slab alone switches pricing on.
  setTable(KEYS.items, [rice]);
  assert.equal(pricingInUse(), true);
  assert.equal(getTable<InvoiceItem>(KEYS.items)[0].qty_slabs?.length, 2);
});

/* ── Scanning ─────────────────────────────────────────────────── */

const soap: InvoiceItem = { id: 'soap', name: 'Soap 100 g', type: 'Product', hsn: '3401', unit: 'PCS', quantity: 1, rate: 40, tax_rate: 18, amount: 0, barcode: '8901030865275', sku: 'SOAP-100' };
const pen: StockItem = { id: 'st-pen', name: 'Pen Blue', unit: 'NOS', track_stock: true, opening_qty: 10, opening_rate: 5, reorder_level: 0, sale_rate: 10, tax_rate: 12, barcode: '036000291452', hsn: '9608' };

test('codes: scanner noise stripped; UPC-A matches its EAN-13 form; SKU case-insensitive', () => {
  assert.equal(normalizeCode(' 8901030865275\r\n'), '8901030865275');
  assert.equal(normalizeCode('AB\tC\u001d'), 'ABC');
  assert.equal(codeKey('0036000291452'), codeKey('036000291452'));
  assert.equal(findByCode('8901030865275\n', [soap])?.item.id, 'soap');
  assert.equal(findByCode('soap-100', [soap])?.via, 'sku');
  assert.equal(findByCode('nope', [soap]), null);
  assert.equal(findByCode('', [soap]), null);
  // Stock item barcode: no catalogue row → a catalogue-shaped line source with the sale rate.
  const m = findByCode('0036000291452', [soap], [pen]);
  assert.equal(m?.item.name, 'Pen Blue');
  assert.equal(m?.item.rate, 10);
  assert.equal(m?.item.tax_rate, 12);
  assert.equal(m?.stock?.id, 'st-pen');
  // …and the catalogue row of the same name wins when it exists.
  const penCat = { ...soap, id: 'pen-cat', name: 'pen blue', barcode: undefined, sku: undefined, rate: 11 };
  assert.equal(findByCode('036000291452', [penCat], [pen])?.item.id, 'pen-cat');
});

test('wedge scan adds a line, then increments the same line; fills an empty trailing row', () => {
  let n = 0;
  const id = () => `n${++n}`;
  const empty: InvoiceItem = { id: 'e', name: '', type: 'Service', quantity: 1, rate: 0, amount: 0 };
  let r = addScannedLine([empty], soap, { newId: id });
  assert.equal(r.items.length, 1);
  assert.equal(r.incremented, false);
  assert.deepEqual([r.items[0].name, r.items[0].quantity, r.items[0].rate, r.items[0].tax_rate, r.items[0].amount], ['Soap 100 g', 1, 40, 18, 40]);
  r = addScannedLine(r.items, soap, { newId: id });
  assert.equal(r.incremented, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].quantity, 2);
  assert.equal(r.items[0].amount, 80);
  // A different item appends; a free scheme line or a line with serials is never merged into.
  r = addScannedLine(r.items, { ...soap, id: 'x', name: 'Shampoo', hsn: '3305' }, { newId: id });
  assert.equal(r.items.length, 2);
  const withFree = [{ ...r.items[0], id: 'free', free_of: 'n1', rate: 0 }];
  assert.equal(addScannedLine(withFree, soap, { newId: id }).items.length, 2);
  const serialLine = [{ ...r.items[0], serials: ['S1'] }];
  assert.equal(addScannedLine(serialLine, soap, { newId: id }).items.length, 2);
  // HSN disagreement means a different item.
  assert.equal(addScannedLine([{ ...r.items[0], hsn: '9999' }], soap, { newId: id }).items.length, 2);
});

const errMsg = (r: object) => ('error' in r ? (r.error as { message: string }).message : '');

test('catalogue item form: barcode / SKU / MRP / slabs saved; bad EAN check digit and duplicates refused; blank clears', () => {
  const base = { name: 'Soap', type: 'Product', hsn: '3401', unit: 'PCS', rate: 40, tax_rate: 18 };
  const bad = saveCatalogItem({ ...base, barcode: '8901030865271' });
  assert.equal(bad.ok, false);
  assert.match(errMsg(bad), /should end in 5/);
  const ok = saveCatalogItem({ ...base, barcode: '8901030865275', sku: 'SOAP-1', mrp: 45, qty_slabs: [{ min_qty: 12, rate: 36 }, { min_qty: 0, rate: 1 }] });
  assert.ok(ok.ok);
  const row = localDb.items.getAll()[0];
  assert.deepEqual([row.barcode, row.sku, row.mrp, row.qty_slabs], ['8901030865275', 'SOAP-1', 45, [{ min_qty: 12, rate: 36 }]]);
  const twin = saveCatalogItem({ ...base, name: 'Other', barcode: '8901030865275' });
  assert.match(errMsg(twin), /already has this barcode/);
  const twinSku = saveCatalogItem({ ...base, name: 'Other', sku: 'soap-1' });
  assert.match(errMsg(twinSku), /already uses this SKU/);
  // Editing with blanks removes the fields; a draft without them leaves them alone.
  saveCatalogItem({ ...base, id: row.id, barcode: '', sku: '', mrp: 0, qty_slabs: [] });
  const cleared = localDb.items.getAll()[0];
  for (const k of ['barcode', 'sku', 'mrp', 'qty_slabs']) assert.ok(!(k in cleared), `${k} cleared`);
  saveCatalogItem({ ...base, id: row.id, barcode: '8901030865275' });
  saveCatalogItem({ ...base, id: row.id, rate: 42 });
  assert.equal(localDb.items.getAll()[0].barcode, '8901030865275');
});

test('POS shortcuts and fill-the-rest', async () => {
  const { posShortcut, fillRest } = await import('../src/lib/pos.ts');
  assert.equal(posShortcut({ key: 'F9' }), 'save');
  assert.equal(posShortcut({ key: 'Enter', ctrlKey: true }), 'save');
  assert.equal(posShortcut({ key: 'F2' }), 'search');
  assert.equal(posShortcut({ key: 'F6' }), 'upi');
  assert.equal(posShortcut({ key: 'F9', altKey: true }), null);
  assert.equal(posShortcut({ key: 'a' }), null);
  assert.equal(fillRest(236, [{ method: 'Cash', amount: 100 }, { method: 'UPI', amount: 50 }], 'UPI'), 136);
  assert.equal(fillRest(236, [{ method: 'Cash', amount: 300 }], 'Card'), 0);
});
