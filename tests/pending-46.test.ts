/**
 * PENDING 46 (ROADMAP 7.158, 7U follow-ups): EEFC supplier payments in the currency, revaluation reversal,
 * per-customer and combo offers, ESC/POS QR / logo raster.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { bankAccountsDb } from '../src/lib/bank-accounts.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { buildLedger, loadLedgerInput } from '../src/lib/ledger/index.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { deleteFxMove, fcyBalanceAt, forexSummary, fxMovements, ledgerInrBalance, liveForexData, loadFxMoves, payVendorFromForex, recordFxMove, setAccountCurrency } from '../src/lib/forex-bank.ts';
import { paymentsDb, purchasesDb } from '../src/lib/purchases.ts';
import { vendorPaymentsDb } from '../src/lib/billwise.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { schemeLabel, schemesDb, syncSchemeLines, validateScheme, type Scheme } from '../src/lib/pricing.ts';
import { applyBillOffer, bestBillOffer, comboSaving } from '../src/lib/offers.ts';
import { escposBytes, qrBytes, rasterBytes, toMono } from '../src/lib/escpos.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const ledgerNow = () => buildLedger(loadLedgerInput(undefined, '2026-10-25'));
function bal(account: string, date = '2099-12-31'): number {
  let p = 0;
  for (const v of ledgerNow().vouchers) if (v.date <= date) for (const l of v.lines) if (l.account === account) p += l.dr - l.cr;
  return p / 100;
}

const importBill = (vendorId: string, vendorName: string, total: number): Omit<PurchaseRecord, 'id'> => ({
  kind: 'EXPENSE', vendor_id: vendorId, vendor_name: vendorName, bill_number: 'IMP-1', date: '2026-05-10', category: 'Software',
  lines: [{ id: 'l1', name: 'Licence', quantity: 1, rate: total, tax_rate: 0 }],
  taxable: total, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total, amount_paid: 0,
} as Omit<PurchaseRecord, 'id'>);

function eefc() {
  bankAccountsDb.save({ id: 'eefc', name: 'HDFC EEFC USD', opening: 83000, opening_as_of: '2026-04-01' });
  setAccountCurrency('eefc', 'USD', 1000);
  return bankAccountsDb.all().find((a) => a.id === 'eefc')!;
}

test('EEFC: a supplier paid in USD — bills settled in rupees, bank relieved at carrying value, realised loss', () => {
  const acc = eefc();
  const v = vendorsDb.save({ name: 'Acme Inc (US)' } as never);
  const bill = purchasesDb.save(importBill(v.id, v.name, 41000)); // USD 500 booked @ 82
  assert.throws(() => payVendorFromForex({ bank_account_id: 'eefc', date: '2026-06-01', vendor_id: v.id, vendor_name: v.name, fcy: 5000, rate: 84 }), /Only 1000.00/);

  const move = payVendorFromForex({ bank_account_id: 'eefc', date: '2026-06-01', vendor_id: v.id, vendor_name: v.name, fcy: 500, rate: 84, settle: 41000 });
  assert.equal(move.carrying, 41500, 'USD 500 at the carrying rate 83');
  assert.equal(move.diff, -500, 'realised loss');
  assert.equal(purchasesDb.get(bill.id)!.amount_paid, 41000, 'the rupee bill is paid in full');
  const pays = paymentsDb.all();
  assert.equal(pays.length, 1);
  assert.equal(pays[0].bank_account_id, 'eefc');
  assert.equal(pays[0].group_id, move.payment_group_id);
  assert.equal(fcyBalanceAt(acc, liveForexData(), '2026-06-30'), 500);
  assert.equal(ledgerInrBalance('eefc', '2026-06-30'), 83000 - 41500, 'payment + difference journal = carrying value');
  assert.equal(bal(A.fxGain), 500, 'loss is a debit on 4930');
  const sum = forexSummary(acc, { from: '2026-04-01', to: '2026-06-30' });
  assert.equal(sum.inrOnly, 0, 'the linked supplier payment is not an "INR-only" posting');
  assert.equal(sum.realised, -500);

  // A payment beyond the open bills goes on account; deleting the entry takes every row back.
  const more = payVendorFromForex({ bank_account_id: 'eefc', date: '2026-06-02', vendor_id: v.id, vendor_name: v.name, fcy: 100, rate: 83 });
  assert.equal(more.voucher_id, '', 'settled exactly at the carrying value: no difference journal');
  assert.equal(vendorPaymentsDb.all().length, 1);
  deleteFxMove(more.id);
  deleteFxMove(move.id);
  assert.equal(loadFxMoves().length, 0);
  assert.equal(paymentsDb.all().length, 0);
  assert.equal(vendorPaymentsDb.all().length, 0);
  assert.equal(purchasesDb.get(bill.id)!.amount_paid, 0);
  assert.equal(loadVouchers().length, 0);
  assert.equal(ledgerInrBalance('eefc', '2026-06-30'), 83000);
});

test('EEFC: revaluation with a reversal date is undone on that day', () => {
  const acc = eefc();
  assert.throws(() => recordFxMove({ bank_account_id: 'eefc', date: '2026-06-30', kind: 'revalue', rate: 85, reverse_on: '2026-06-30' }), /reversal date after/);
  const rv = recordFxMove({ bank_account_id: 'eefc', date: '2026-06-30', kind: 'revalue', rate: 85, reverse_on: '2026-07-01' });
  assert.equal(rv.diff, 2000);
  assert.equal(rv.reverse_on, '2026-07-01');
  assert.equal(ledgerInrBalance('eefc', '2026-06-30'), 85000);
  assert.equal(ledgerInrBalance('eefc', '2026-07-01'), 83000, 'back to the carrying value');
  assert.equal(bal(A.fxGain, '2026-07-31'), 0);
  assert.deepEqual(fxMovements(acc, liveForexData()).map((r) => [r.kind, r.inr]), [['opening', 83000], ['revalue', 2000], ['reversal', -2000]]);
  assert.equal(forexSummary(acc, { from: '2026-04-01', to: '2026-06-30' }).unrealised, 2000);
  assert.equal(forexSummary(acc, { from: '2026-07-01', to: '2026-07-31' }).unrealised, -2000);
  deleteFxMove(rv.id);
  assert.equal(ledgerInrBalance('eefc', '2026-06-30'), 83000);
});

/* ── Offers: per customer, combo price ─────────────────────── */

test('offers: a bill-value offer limited to some customers applies only to them', () => {
  const bv = schemesDb.save({ id: '', kind: 'bill_value', item_id: '', item_name: '', buy_qty: 0, free_qty: 0, label: 'Key accounts', slabs: [{ min_value: 1000, percent: 10 }], client_ids: ['c-mh', 'c-mh'] });
  assert.deepEqual(bv.client_ids, ['c-mh']);
  const inv = createViaStore({ date: '2026-05-01', lines: [{ qty: 20, rate: 100, tax: 18 }] }); // client c-mh
  assert.equal(applyBillOffer(inv, [bv], { retotalRecord: true }).offer?.value, 200);
  const other = { ...inv, client: { ...inv.client, id: 'c-other' } };
  assert.equal(applyBillOffer(other, [bv], { retotalRecord: true }).offer, undefined);
  assert.equal(bestBillOffer([bv], 2000, '2026-05-01', { items: inv.items, client: { ...inv.client, id: '' } }), null, 'walk-in: no customer offer');
});

test('offers: a combo price discounts every full set on the bill and is the best single offer', () => {
  const combo: Scheme = { id: '', kind: 'bill_value', item_id: '', item_name: '', buy_qty: 0, free_qty: 0, label: 'Breakfast', combo: { items: [{ item_id: 'a', item_name: 'Tea', qty: 1 }, { item_id: 'b', item_name: 'Biscuit', qty: 2 }], price: 50 } };
  assert.equal(validateScheme({ ...combo, combo: { items: [{ item_id: 'a', item_name: 'Tea', qty: 1 }], price: 50 } }), 'A combo needs two items, or two or more of one item.');
  assert.equal(validateScheme({ ...combo, combo: { ...combo.combo!, price: 0 } }), 'Enter the combo price.');
  const saved = schemesDb.save(combo);
  assert.equal(saved.slabs, undefined);
  assert.equal(schemeLabel(saved), 'Breakfast: 1 × Tea + 2 × Biscuit for ₹50');
  // Tea 30 × 3, Biscuit 20 × 5 (10% line discount → 18): 2 full sets; a set is worth 30 + 36 = 66 → saving 2 × 16.
  const items = [
    { name: 'Tea', quantity: 3, rate: 30 },
    { name: 'biscuit ', quantity: 5, rate: 20, discount_percent: 10 },
    { name: 'Biscuit', quantity: 2, rate: 0, free_of: 'x' },
  ] as InvoiceRecord['items'];
  assert.deepEqual(comboSaving(saved.combo!, items), { sets: 2, value: 32 });
  assert.deepEqual(comboSaving(saved.combo!, items.slice(0, 1)), { sets: 0, value: 0 }, 'an item missing: no set');
  const slab = schemesDb.save({ id: '', kind: 'bill_value', item_id: '', item_name: '', buy_qty: 0, free_qty: 0, slabs: [{ min_value: 100, amount: 10 }] });
  const best = bestBillOffer([slab, saved], 180, '2026-05-01', { items, client: clientMH });
  assert.equal(best!.scheme.id, saved.id);
  assert.equal(best!.value, 32);
  assert.match(best!.label, /^Breakfast: 2 × 1 Tea \+ 2 Biscuit @ ₹50$/);
  const inv = createViaStore({ date: '2026-05-01', lines: [{ name: 'Tea', qty: 2, rate: 30, tax: 5 }, { name: 'Biscuit', qty: 4, rate: 20, tax: 18 }] });
  const out = applyBillOffer(inv, [saved], { retotalRecord: true });
  assert.equal(out.offer!.value, 40, '2 sets × (70 − 50)');
  assert.equal(out.discount_type, 'AMOUNT');
  // A combo is a bill offer, never a free line.
  assert.equal(syncSchemeLines(inv.items, [saved], '2026-05-01').length, inv.items.length);
});

/* ── ESC/POS: QR and logo raster ───────────────────────────── */

test('ESC/POS: GS ( k QR (model 2) and GS v 0 raster logo around the receipt', () => {
  const qr = qrBytes('upi://pay?pa=shop@okicici&am=10.00&cu=INR');
  const hex = (a: readonly number[]) => a.map((b) => b.toString(16).padStart(2, '0')).join(' ');
  assert.match(hex(qr), /^1b 61 01 1d 28 6b 04 00 31 41 32 00 1d 28 6b 03 00 31 43 06 1d 28 6b 03 00 31 45 31 1d 28 6b 2c 00 31 50 30 /);
  assert.match(hex(qr), /1d 28 6b 03 00 31 51 30 0a 1b 61 00$/);
  assert.deepEqual(qrBytes(''), []);
  assert.deepEqual(qrBytes('₹ upi'), [], 'non-ASCII data is refused, never mangled');
  // 10 × 2 image: left dot black in row 0, right-most dot black in row 1.
  const dots = new Uint8Array(20);
  dots[0] = 1;
  dots[19] = 1;
  const r = rasterBytes({ width: 10, height: 2, dots });
  assert.equal(hex(r.slice(0, 11)), '1b 61 01 1d 76 30 00 02 00 02 00');
  assert.deepEqual(r.slice(11, 15), [0x80, 0x00, 0x00, 0x40]);
  // A transparent pixel is paper; a dark opaque one is a dot.
  assert.deepEqual([...toMono([0, 0, 0, 0, 10, 10, 10, 255, 250, 250, 250, 255], 3, 1).dots], [0, 1, 0]);
  const bytes = [...escposBytes(['Hello'], { qr: 'upi://pay?pa=a@b&cu=INR', logo: { width: 8, height: 1, dots: new Uint8Array(8).fill(1) } })];
  assert.equal(hex(bytes.slice(0, 2)), '1b 40');
  assert.equal(hex(bytes.slice(2, 13)), '1b 61 01 1d 76 30 00 01 00 01 00', 'the logo comes first');
  const text = bytes.indexOf(0x48); // 'H'
  const qrAt = bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x28 && bytes[i + 2] === 0x6b);
  assert.ok(text > 13 && qrAt > text, 'the QR follows the lines');
  assert.equal([...escposBytes(['Hello'])].includes(0x76), false, 'no raster unless asked');
});
