/** TR-B1 weight and bag billing: net = gross − tare − dhalta, net is the line quantity, stock and HSN unchanged. */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blankWeight, kgPer, lineBags, weighNet, weightText, wtHolds, wtQuantity } from '../src/lib/trade/tr-weight.ts';
import { trackingText } from '../src/components/templates/paper-helpers.ts';
import { collectEvents } from '../src/lib/inventory.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import type { LineWeight } from '../src/types/trade-r8.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const wheat: LineWeight = { packages: 120, kind: 'BAG', gross: 6072, tare_per_package: 0.6, deduction: { basis: 'per_qtl', value: 1 }, gross_unit: 'KG' };

test('the wheat example: 6,072 kg − 72 kg tare − 60 kg dhalta = 5,940 kg = 59.400 QTL', () => {
  assert.deepEqual(weighNet(wheat), { gross: 6072, tare: 72, ded: 60, net: 5940 });
  assert.equal(wtQuantity(wheat, 'QTL'), 59.4);
  assert.equal(wtQuantity(wheat, 'KG'), 5940);
  assert.equal(wtQuantity(wheat, 'MT'), 5.94);
  assert.equal(weightText(wheat), '120 BAG · gross 6,072 kg − tare 72 kg − dhalta 60 kg = 5,940 kg');
  assert.equal(trackingText({ wt: wheat }), weightText(wheat), 'printed under the item on the standard layouts');
});

test('per-bag and % deductions are taken after tare; gross in QTL / MT; rounding to the gram', () => {
  assert.equal(weighNet({ ...wheat, deduction: { basis: 'per_package', value: 0.25 } }).net, 5970);
  assert.equal(weighNet({ ...wheat, deduction: { basis: 'percent', value: 0.5 } }).net, 5970);
  assert.equal(weighNet({ ...wheat, gross: 60.72, gross_unit: 'QTL' }).net, 5940);
  assert.equal(weighNet({ ...wheat, packages: 3, gross: 100.0004, tare_per_package: 0.3333, deduction: { basis: 'per_qtl', value: 0 } }).net, 99, 'gross and tare rounded to the gram');
  assert.equal(wtQuantity({ ...wheat, gross: 100.0004, packages: 3, tare_per_package: 0.3333, deduction: { basis: 'per_qtl', value: 0 } }, 'QTL'), 0.99, '3 decimals');
  assert.equal(weighNet({ ...wheat, tare_per_package: 100 }).net, 0, 'never below zero');
  assert.equal(wtQuantity(wheat, 'BAG'), null, 'not a weight unit');
  assert.equal(kgPer('quintal'), 100);
  assert.equal(weightText(blankWeight()), '');
});

test('a typed quantity no longer matches the weighing (the line becomes manual); bags and quintals for bases', () => {
  assert.equal(wtHolds({ wt: wheat, quantity: 59.4, unit: 'QTL' }), true);
  assert.equal(wtHolds({ wt: wheat, quantity: 60, unit: 'QTL' }), false);
  assert.deepEqual(lineBags({ wt: wheat, quantity: 59.4, unit: 'QTL' }), { bags: 120, qtl: 59.4 });
  assert.deepEqual(lineBags({ quantity: 10, unit: 'BAG' }), { bags: 10, qtl: 0 });
  assert.deepEqual(lineBags({ quantity: 250, unit: 'KG' }), { bags: 0, qtl: 2.5 });
});

test('stock moves equal net × unit factor; the editor keeps the weighing snapshot', () => {
  const inv = {
    id: 'w1', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-10-05', invoice_number: 'INV/1', client: { name: 'Buyer' },
    items: [{ id: 'l1', name: 'Wheat', type: 'Goods', hsn: '1001', unit: 'QTL', unit_factor: 100, quantity: wtQuantity(wheat, 'QTL'), rate: 2450, tax_rate: 0, amount: 0, wt: wheat }],
  } as unknown as InvoiceRecord;
  const ev = collectEvents({ items: [{ id: 'w', name: 'Wheat', hsn: '1001', unit: 'KG', track_stock: true, opening_qty: 10000, opening_rate: 20, reorder_level: 0, alt_units: [{ unit: 'QTL', factor: 100 }] } as never], moves: [], invoices: [inv] });
  const sold = ev.get('w')!.filter((e) => e.refId === 'w1');
  assert.equal(sold.length, 1);
  assert.equal(Math.abs(sold[0].qty), 5940, 'net 59.4 QTL × 100 = 5,940 KG out');
  assert.deepEqual(normalizeRecord(inv).items[0].wt, wheat);
});

test('the TR-B editor parts follow the commodity / agency packs', () => {
  // Each host mounts the one lazy TR-B chunk only behind the pack gate (no TR-B module in the hosts' own chunks).
  for (const f of ['creator/ItemsTable.tsx', 'creator/SummaryPanel.tsx', 'purchases/BillModal.tsx']) {
    const src = readFileSync(new URL(`../src/components/${f}`, import.meta.url), 'utf8');
    assert.match(src, /impliedPacks\(localDb\.settings\.get\(\)\)\.some\(\(p\) => p === 'commodity' \|\| p === 'agency'\)/, f);
    assert.match(src, /import\('\.\.\/trade\/tr-b-hub'\)/, f);
    assert.doesNotMatch(src, /from '\.\.\/(\.\.\/lib\/)?trade\/tr-(weight|charges|brokers)'/, f);
  }
});
