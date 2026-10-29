/**
 * R21-A3 the POS fuel line: ₹ ↔ litres (the amount stays exact, litres to three decimals — FU8), the non-GST column
 * (GSTR-1 Table 8 / GSTR-3B 3.1(e)), a fuel-only bill is a Bill of Supply, a mixed bill to a buyer without a GSTIN
 * takes the Rule 46A title, a mixed bill to a GSTIN buyer is split; the `fu` snapshot survives save and prints from
 * itself only (a later price change never reprints an old bill).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { SELLER, clientMH, clientRetail, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { calcInputFromRecord, calculateInvoice } from '../src/lib/invoice-calc.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { svDocTitle } from '../src/components/templates/paper-helpers.ts';
import { fuDocPatch, fuSplit, fuelLine, isNonGst, litresFor, priceAt } from '../src/lib/fuel/fu-line.ts';
import { applyFuelKind, fuelLanding } from '../src/lib/shop-presets.ts';
import { withTotals } from '../src/lib/pos.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';
import type { FuelNozzle, FuelPrice } from '../src/types/fuel-r21.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const price: FuelPrice = { id: 'p1', item_id: 'ms', date: '2026-10-29', time: '06:00', rsp: 94.72 };
const nozzle: FuelNozzle = { id: 'n1', du_no: '2', nozzle_no: 'B', tank_id: 't1', item_id: 'ms', totaliser_start: 0, active: true };

test('₹500 of petrol at ₹94.72: 5.279 L, the amount stays ₹500.00; litres typed take the price; non-GST by date', () => {
  assert.deepEqual(litresFor(500, 94.72), { litres: 5.279, rate: 94.714908 });
  for (const amt of [100, 500, 1234.5, 2000, 9999]) {
    const r = litresFor(amt, 94.72);
    assert.equal(Math.round(r.litres * r.rate * 100) / 100, amt, `₹${amt} exact`);
  }
  const line = { id: 'l1', name: 'Petrol (MS)', quantity: 1, rate: 0, tax_rate: 18, amount: 0 } as InvoiceItem;
  const a = fuelLine(line, { product: 'ms', price, nozzle, amount: 500, day: '2026-10-29' });
  assert.deepEqual([a.line.quantity, a.line.amount, a.line.tax_rate, a.line.sv?.exempt], [5.279, 500, 0, 'NON_GST']);
  assert.deepEqual(a.fu, { litres: 5.279, price_id: 'p1', rsp: 94.72, at: '2026-10-29 06:00', nozzle_id: 'n1', nozzle: '2-B' });
  const b = fuelLine({ ...line, quantity: 41.23 }, { product: 'ms', price, day: '2026-10-29' });
  assert.deepEqual([b.line.quantity, b.line.rate, b.line.amount], [41.23, 94.72, 3905.31]);
  const lube = fuelLine({ ...line, name: 'Engine oil' }, { product: 'lube', price, day: '2026-10-29' });
  assert.equal(lube.line.tax_rate, 18, 'a lubricant keeps its slab');
  assert.equal(lube.line.sv, undefined);
  assert.equal(isNonGst('cng', '2026-10-29'), true);
  assert.equal(isNonGst('ms', '2017-06-30'), false, 'before GST there is no row');
});

function fuelBill(client = clientRetail, withLube = false): InvoiceRecord {
  const rec = createViaStore({ client, date: '2026-10-29', lines: [{ name: 'Petrol (MS)', rate: 94.72, qty: 1, tax: 18 }, ...(withLube ? [{ name: 'Engine oil 1 L', rate: 400, qty: 1, tax: 18 }] : [])] });
  const f = fuelLine(rec.items[0], { product: 'ms', price, nozzle, amount: 500, day: '2026-10-29' });
  const items = rec.items.map((l, i) => (i === 0 ? f.line : l));
  const { patch, split } = fuDocPatch({ ...rec, items }, { [f.line.id]: f.fu });
  assert.equal(split, withLube && !!client.gstin);
  return withTotals({ ...rec, items, ...patch }); // the POS retotals the bill (savePosBill)
}

test('a fuel-only bill is a Bill of Supply (non-GST); in Table 8 non-GST and 3.1(e); the snapshot survives save', () => {
  const saved = localDb.invoices.save(fuelBill());
  assert.equal(saved.doc_type, 'BILL_OF_SUPPLY');
  assert.equal(saved.exempt_kind, 'NON_GST');
  assert.equal(saved.total, 500);
  const back = localDb.invoices.getById(saved.id)!;
  assert.equal(back.fu?.lines?.[back.items[0].id]?.nozzle, '2-B');
  assert.equal(back.items[0].sv?.exempt, 'NON_GST');
  const rep = buildGstReport(getTable<InvoiceRecord>('invoices'), [], { period: { kind: 'month', fyStart: 2026, month: 10 }, gstin: SELLER.companyGstin });
  assert.equal(rep.gstr1.nil.reduce((t, r) => t + r.nonGst, 0), 500);
  assert.equal(rep.gstr3b.outward.nonGst, 500);
});

test('mixed bill: no GSTIN → Rule 46A title, fuel to Table 8 non-GST, the lubricant taxed; GSTIN → split in two', () => {
  const mixed = fuelBill(clientRetail, true);
  assert.equal(mixed.doc_type, 'INVOICE');
  assert.equal(mixed.sv?.rule46a, true);
  assert.equal(svDocTitle(mixed), 'Invoice-cum-Bill of Supply');
  const saved = localDb.invoices.save(mixed);
  const rep = buildGstReport(getTable<InvoiceRecord>('invoices'), [], { period: { kind: 'month', fyStart: 2026, month: 10 }, gstin: SELLER.companyGstin });
  assert.equal(rep.gstr3b.outward.nonGst, 500);
  assert.ok(rep.gstr3b.outward.taxable.taxable > 0, 'the lubricant is taxed');
  assert.equal(calculateInvoice(calcInputFromRecord(saved)).lines[0].taxable, 500);
  const b2b = fuelBill(clientMH, true);
  assert.equal(b2b.sv?.rule46a, undefined);
  const [bos, inv] = fuSplit(b2b);
  assert.deepEqual([bos.doc_type, bos.exempt_kind, bos.items.length, Object.keys(bos.fu?.lines ?? {}).length], ['BILL_OF_SUPPLY', 'NON_GST', 1, 1]);
  assert.deepEqual([inv.doc_type, inv.items.map((i) => i.name), inv.fu], ['INVOICE', ['Engine oil 1 L'], undefined]);
});

test('price snapshot: a later price row never changes an old bill; profile card: kirana + explicit modules and packs', () => {
  const saved = localDb.invoices.save(fuelBill());
  const later: FuelPrice[] = [price, { ...price, id: 'p2', date: '2026-10-30', rsp: 96 }];
  assert.equal(priceAt(later, 'ms', '2026-10-30', '07:00')?.rsp, 96);
  assert.equal(localDb.invoices.getById(saved.id)!.fu?.lines?.[saved.items[0].id]?.rsp, 94.72);
  const p = applyFuelKind('pump_lpg', { currentPacks: ['marketplace'] });
  assert.equal(p.business_type, 'kirana');
  assert.deepEqual([...p.modules!].sort(), ['accounts', 'banking', 'gst', 'inventory', 'payroll', 'pos', 'purchases', 'reports', 'tds']);
  assert.deepEqual(p.industry_packs, ['marketplace', 'fuel', 'lpg']);
  assert.equal('retail_kind' in p, false, 'no retail desk');
  assert.deepEqual(applyFuelKind('lpg').industry_packs, ['lpg']);
  assert.equal(fuelLanding('pump'), '/inventory?tab=fuel&view=shift');
  assert.equal(fuelLanding('lpg'), '/inventory?tab=fuel&view=lpg');
});
