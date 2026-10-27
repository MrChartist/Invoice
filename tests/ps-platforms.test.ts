/** R14 PS-C4: platform receipts (gross receipt, fee expense, RCM for a non-resident platform, FX gain, short reason). */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { clientUS, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { purchasesDb, paymentsDb } from '../src/lib/purchases.ts';
import { supplierPayable } from '../src/lib/purchase-normalize.ts';
import { realisedFx } from '../src/lib/fx-gain.ts';
import { buildRegister } from '../src/lib/trade/export-register.ts';
import { brcRows } from '../src/lib/prof/ps-brc.ts';
import { exportCheck, verdict } from '../src/lib/prof/ps-export-check.ts';
import { loadPlatforms, planPlatformReceipt, receiveViaPlatform, savePlatforms } from '../src/lib/prof/ps-platforms.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  freezeDate('2026-11-20T10:00:00');
});
afterEach(() => thawDate());

const usdInvoice = () => createViaStore({ client: clientUS, date: '2026-10-31', currency: 'USD', supply: 'EXPORT_LUT', pos: '96', gstMode: 'IGST', lines: [{ name: 'Design', hsn: '998391', qty: 40, rate: 55, tax: 0 }], status: 'Sent', patch: { exchange_rate: 84 } });

test('platform list: cleaned, unique names, other prof_settings fields kept', () => {
  savePlatforms([{ name: 'Payoneer', kind: 'payoneer', non_resident: true }, { name: 'payoneer', kind: 'wise' }, { name: ' ', kind: 'paypal' }, { name: 'Odd', kind: 'zzz' as never }]);
  assert.deepEqual(loadPlatforms(), [{ name: 'Payoneer', kind: 'payoneer', non_resident: true }, { name: 'Odd', kind: 'other' }]);
});

test('plan: realised rate on the net, fee in rupees, RCM only for a non-resident platform of a registered company', () => {
  const p = planPlatformReceipt({ gross: 2200, fee: 55, inr: 182325, date: '2026-11-20' }, { non_resident: true }, true);
  assert.deepEqual([p.net, p.rate, p.grossInr, p.feeInr, p.rcm, p.igst], [2145, 85, 187000, 4675, true, 841.5]);
  assert.equal(planPlatformReceipt({ gross: 2200, fee: 55, inr: 182325, date: 'x' }, { non_resident: true }, false).rcm, false);
  assert.equal(planPlatformReceipt({ gross: 2200, fee: 55, inr: 182325, date: 'x' }, {}, true).rcm, false);
  assert.throws(() => planPlatformReceipt({ gross: 10, fee: 10, inr: 1, date: 'x' }, {}, true), /platGross/);
  assert.throws(() => planPlatformReceipt({ gross: 10, fee: 1, inr: 0, date: 'x' }, {}, true), /platInr/);
});

test('receive via platform: gross receipt at the realised rate, fee bill with import RCM paid from the bank, 5 / 5, short reason', () => {
  const inv = usdInvoice();
  assert.equal(inv.total, 2200);
  const out = receiveViaPlatform(inv, { name: 'Payoneer', kind: 'payoneer', non_resident: true }, { gross: 2200, fee: 55, inr: 182325, date: '2026-11-20', reference: 'PO-77' }, true);
  const pays = localDb.payments.getAll();
  assert.equal(pays.length, 1);
  assert.deepEqual([pays[0].amount, pays[0].realised_rate], [2200, 85]);
  const fx = realisedFx(pays[0], localDb.invoices.getById(inv.id) as InvoiceRecord)!;
  assert.equal(fx.gain, 2200, 'USD 2,200 × (85 − 84)');
  const bill = purchasesDb.get(out.billId!)!;
  assert.deepEqual([bill.kind, bill.vendor_name, bill.import_type, bill.taxable, bill.igst, bill.itc_eligible, bill.lines[0].hsn], ['EXPENSE', 'Payoneer', 'SERVICES', 4675, 841.5, true, '997159']);
  assert.equal(supplierPayable(bill), 4675);
  assert.equal(paymentsDb.forPurchase(bill.id)[0].amount, 4675, 'bank: ₹1,87,000 in, ₹4,675 out = ₹1,82,325 credited');
  assert.equal(verdict(exportCheck({ invoice: localDb.invoices.getById(inv.id)!, client: { ps: { country: 'US' } }, receipts: pays })), 'export');
  const rows = buildRegister({ invoices: localDb.invoices.getAll(), payments: pays, irms: [], writeoffs: [], today: '2026-11-20' });
  const [b] = brcRows(rows, localDb.invoices.getAll(), pays as Partial<Payment>[], []);
  assert.deepEqual([b.chargesFcy, b.chargesReason, b.unrealisedFcy, b.realisedInr], [55, 'platform', 0, 187000]);
});

test('a resident platform (no RCM) and a failure roll back everything', () => {
  const inv = usdInvoice();
  const out = receiveViaPlatform(inv, { name: 'Skydo', kind: 'skydo' }, { gross: 1000, fee: 10, inr: 84150, date: '2026-11-20' }, true);
  const bill = purchasesDb.get(out.billId!)!;
  assert.deepEqual([bill.igst, bill.import_type, bill.itc_eligible, bill.total], [0, undefined, false, 850]);
  const before = localDb.payments.getAll().length;
  const save = purchasesDb.save;
  purchasesDb.save = () => { throw new Error('boom'); };
  try {
    assert.throws(() => receiveViaPlatform(inv, { name: 'X', kind: 'other' }, { gross: 100, fee: 1, inr: 8000, date: '2026-11-20' }, true), /boom/);
  } finally {
    purchasesDb.save = save;
  }
  assert.equal(localDb.payments.getAll().length, before, 'the receipt was rolled back with the failed bill');
  assert.throws(() => receiveViaPlatform({ ...inv, currency: 'INR' }, { name: 'X', kind: 'other' }, { gross: 1, fee: 0, inr: 1, date: '2026-11-20' }, true), /platForeignOnly/);
});
