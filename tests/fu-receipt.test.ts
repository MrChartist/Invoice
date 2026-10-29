/** R21-C2 tank-lorry receipt: invoice vs observed density (± 3.0 kg/m³, MDG), short receipt, the debit-note suggestion, the OMC bill's litres. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { billLitres, debitFor, densityTol, receiptCheck } from '../src/lib/fuel/fu-receipt.ts';
import { readPurchaseLines } from '../src/lib/purchase-normalize.ts';

test('density tolerance ± 3.0 from the 2022 MDG text; flags outside it only', () => {
  assert.equal(densityTol('2026-10-29'), 3);
  const c = receiptCheck({ compartments: [{ invoice_l: 4000, invoice_density: 742, observed_density: 746.5 }, { invoice_l: 4000, invoice_density: 742, observed_density: 744.9 }, { invoice_l: 4000 }] }, 3);
  assert.deepEqual(c.flags, [{ i: 0, diff: 4.5 }]);
  assert.equal(c.invoice_l, 12000);
  assert.equal(c.short_l, null, 'no dips, no short receipt');
});

test('short receipt = invoice − (after − before + sold while decanting); a debit note is only suggested', () => {
  const c = receiptCheck({ compartments: [{ invoice_l: 6000 }, { invoice_l: 6000 }], before_l: 2000, after_l: 13900, sold_l: 60 }, 3);
  assert.equal(c.received_l, 11960);
  assert.equal(c.short_l, 40);
  assert.equal(debitFor(c.short_l, 91.25), 3650);
  assert.equal(debitFor(-10, 91.25), 0, 'an excess suggests nothing');
});

test('the bill litres of a product: by item id, else by name; alternate units converted', () => {
  const lines = readPurchaseLines({ lines: [{ name: 'Petrol', item_id: 'ms', quantity: 12, unit: 'KL', unit_factor: 1000, rate: 91250 }, { name: 'Diesel', quantity: 4000, rate: 88 }, { name: 'Lube', item_id: 'lb', quantity: 10, rate: 300 }] });
  assert.deepEqual(billLitres(lines, { id: 'ms', name: 'x' }), { litres: 12000, rate: 91.25 });
  assert.deepEqual(billLitres(lines, { id: 'hsd', name: 'diesel' }), { litres: 4000, rate: 88 });
  assert.deepEqual(billLitres(lines, { id: 'cng', name: 'CNG' }), { litres: 0, rate: 0 });
});
