/**
 * R21-D2 Rule 42 for pumps: E and F from the R5-C GSTR-3B reading, then less Σ (excise + VAT per litre of the price
 * each fuel line was sold at) × litres (FU12, a working paper); "Leave duties in" restores them; the reversal is smaller
 * with the exclusion; a company without fuel lines is unchanged (the `adjust` argument is optional); the 3B 3.1(e) check.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { blankStockItem, stockDb } from '../src/lib/inventory.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { headsTotal, inputsFor, rule42, turnoverOf } from '../src/lib/institutions/common-credit.ts';
import { readPrices, savePrice } from '../src/lib/fuel/fu-price.ts';
import { saveSlip } from '../src/lib/fuel/fu-slips.ts';
import { billSlips } from '../src/lib/fuel/fu-recv-io.ts';
import { check31e, dutyAdjust, dutyOf } from '../src/lib/fuel/fu-rule42.ts';
import { RULE42_DUTY_EXCLUSION_RULES } from '../src/lib/fuel-rules.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const P = { kind: 'month' as const, fyStart: 2026, month: 10 };
const common = [{ id: 'B1', kind: 'EXPENSE', vendor_name: 'Power co', bill_number: 'E1', date: '2026-10-05', category: 'Electricity', taxable: 10000, cgst: 900, sgst: 900, igst: 0, itc_eligible: true, total: 11800, amount_paid: 0 }];

function pump() {
  stockDb.saveItem(blankStockItem({ id: 'hsd', name: 'Diesel (HSD)', unit: 'LTR', fu: { product: 'hsd', unit: 'L' } }));
  savePrice({ item_id: 'hsd', date: '2026-10-01', time: '06:00', rsp: 90, build: { excise: 16, vat: 14 } });
  localDb.clients.upsert(clientMH);
  saveSlip({ slip_no: '1', date: '2026-10-10', client_id: 'c-mh', vehicle_no: 'MH12AB1234', item_id: 'hsd', litres: 1000, amount: 90000 });
  billSlips('2026-10-31');
  createViaStore({ date: '2026-10-12', lines: [{ qty: 100, rate: 100, tax: 18 }] }); // ₹10,000 taxable (lubricants)
}

test('E / F with and without the duty exclusion; the reversal is smaller with it', () => {
  pump();
  const docs = localDb.invoices.getAll();
  const g3 = buildGstReport(docs, [], { period: P }).gstr3b;
  const plain = turnoverOf(g3);
  assert.deepEqual(plain, { E: 90000, F: 100000 }, 'non-GST fuel is E (FU11)');
  const w = dutyOf(docs, readPrices(), '2026-10-01', '2026-10-31');
  assert.deepEqual(w, { litres: 1000, duty: 30000, value: 90000, missing: 0 });
  const ex = turnoverOf(g3, dutyAdjust(w, '2026-10-01', false));
  assert.deepEqual([ex.E, ex.F], [60000, 70000]);
  assert.match(ex.note ?? '', /30000\.00/);
  const left = turnoverOf(g3, dutyAdjust(w, '2026-10-01', true));
  assert.deepEqual([left.E, left.F], [90000, 100000], 'Leave duties in');
  const i = inputsFor(common, '2026-10-01', '2026-10-31');
  const a = headsTotal(rule42(i, plain.E, plain.F, '2026-10').reverse);
  const b = headsTotal(rule42(i, ex.E, ex.F, '2026-10').reverse);
  assert.equal(a, 1620);
  assert.ok(b < a, `${b} < ${a}`);
  assert.equal(b, 1542.86);
  assert.equal(check31e(w, g3.outward.nonGst), '', '3.1(e) agrees with the fuel sales');
  assert.match(check31e(w, 80000), /differ/);
  assert.equal(RULE42_DUTY_EXCLUSION_RULES[0].verified, false);
});

test('no change for a company without fuel lines (and before the rule row)', () => {
  createViaStore({ date: '2026-10-12', lines: [{ qty: 100, rate: 100, tax: 18 }] });
  const docs = localDb.invoices.getAll();
  const g3 = buildGstReport(docs, [], { period: P }).gstr3b;
  const w = dutyOf(docs, readPrices(), '2026-10-01', '2026-10-31');
  assert.equal(w.duty, 0);
  assert.deepEqual(turnoverOf(g3, dutyAdjust(w, '2026-10-01', false)), { ...turnoverOf(g3), note: '' });
  assert.deepEqual(turnoverOf(g3), { E: 0, F: 10000 });
  const fake = { litres: 1, duty: 30, value: 90, missing: 0 };
  assert.deepEqual(dutyAdjust(fake, '2017-06-30', false)(100, 200).E, 100, 'no exclusion before the rule row');
});
