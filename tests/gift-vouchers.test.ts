/**
 * R4-B1 gift vouchers: codes (Luhn digit + random check), sale as a liability with no invoice, partial redemption on
 * the POS and on an invoice, expiry refused, promotional voucher as a discount, breakage journal + undo, cancel refused
 * after redemption, the Z report's voucher row, the cash book and a balanced trial balance.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings, createViaStore, clientMH } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { setActorProvider, type Role } from '../src/lib/access.ts';
import {
  CHECK_ALPHABET, GV_LIABILITY_ACCOUNT, applyPromoDiscount, codeShapeIssue, expiryFrom, giftVouchersDb, gvRegister, gvRegisterCsv, luhnDigit,
  makeVoucherCode, randomCheck, redeemIssue, redeemOnInvoice, voucherNumberDigits, voucherState,
} from '../src/lib/retail/gift-vouchers.ts';
import { buildPosRecord, savePosBill, tenderSummary, zReport } from '../src/lib/pos.ts';
import { buildVouchers, loadBooksData } from '../src/lib/books.ts';
import { buildLedger } from '../src/lib/ledger/postings.ts';
import { loadLedgerInput } from '../src/lib/ledger/index.ts';
import { trialBalance } from '../src/lib/ledger/reports.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import type { InvoiceItem, InvoiceRecord, Payment } from '../src/types/invoice.ts';

const DAY = '2026-05-10';
const as = (role: Role | null) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role }) : null);
const fixed = (b: Uint8Array) => b.forEach((_, i) => { b[i] = i * 7; });

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => {
  as(null);
  thawDate();
});

const line = (id: string, name: string, quantity: number, rate: number): InvoiceItem => ({ id, name, type: 'Product', hsn: '6109', unit: 'PCS', quantity, rate, tax_rate: 5, discount_percent: 0, amount: quantity * rate });
const posBill = (items: InvoiceItem[]) => buildPosRecord({ items, party: {}, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), day: DAY });
const balanceOf = (code: string, day = DAY) => {
  const v = giftVouchersDb.byCode(code)!;
  return voucherState(v, getTable<Payment>('transactions'), day, getTable<InvoiceRecord>('invoices')).balance;
};
const ledger = () => buildLedger(loadLedgerInput(undefined, DAY));
const gvAccount = () => chartOf(loadUserAccounts()).find((a) => a.name === GV_LIABILITY_ACCOUNT)!;
const balanceIn = (accountId: string) => {
  const tb = trialBalance(ledger(), { start: '2026-04-01', end: '2027-03-31' });
  return tb.rows.find((r) => r.account.id === accountId)?.closing ?? 0;
};

test('codes: Luhn digit, 4 random characters from the safe alphabet, typo caught by the shape check', () => {
  assert.equal(luhnDigit('7992739871'), 3);
  const digits = voucherNumberDigits(DAY, 12);
  assert.equal(digits, `2627000012${luhnDigit('2627000012')}`);
  const check = randomCheck(fixed);
  assert.equal(check.length, 4);
  assert.ok([...check].every((c) => CHECK_ALPHABET.includes(c)));
  assert.ok([...randomCheck()].every((c) => CHECK_ALPHABET.includes(c)), 'crypto.getRandomValues source');
  const code = makeVoucherCode(DAY, 12, fixed);
  assert.match(code, /^\d{11}-[A-Z2-9]{4}$/);
  assert.equal(codeShapeIssue(code), '');
  assert.equal(codeShapeIssue(code.toLowerCase().replace('-', ' ')), '', 'case and separators do not matter');
  const typo = `${code[0]}${(Number(code[1]) + 1) % 10}${code.slice(2)}`;
  assert.match(codeShapeIssue(typo), /typing mistake/);
  assert.match(codeShapeIssue('123'), /full voucher code/);
  assert.equal(expiryFrom('2026-05-10', 12), '2027-05-09');
  assert.equal(expiryFrom('2026-01-31', 1), '2026-02-27');
});

test('sale: GV/FY series, no invoice, one receipt Dr Cash | Cr Gift vouchers outstanding; bulk issue', () => {
  const out = giftVouchersDb.sell({ count: 3, face_value: 1000, issued_on: DAY, buyer: 'Asha', method: 'Cash' });
  assert.deepEqual(out.vouchers.map((v) => v.number), ['GV/FY26-27/0001', 'GV/FY26-27/0002', 'GV/FY26-27/0003']);
  assert.equal(new Set(out.vouchers.map((v) => v.code)).size, 3);
  assert.equal(out.vouchers[0].expires_on, '2027-05-09');
  assert.equal(localDb.invoices.getAll().length, 0, 'no invoice for a voucher sale');
  const rv = loadVouchers().find((v) => v.type === 'RECEIPT')!;
  assert.equal(rv.number, out.receipt);
  const acc = gvAccount();
  assert.equal(acc.group, 'OTHER_CL');
  assert.deepEqual(rv.lines.map((l) => [l.account_id, l.dr, l.cr]), [['cash', 300000, 0], [acc.id, 0, 300000]]);
  assert.equal(balanceIn(acc.id), -300000, 'liability of ₹3,000');
  // Promotional vouchers post nothing.
  const promo = giftVouchersDb.sell({ count: 1, face_value: 200, issued_on: DAY, promo: true });
  assert.equal(promo.receipt, undefined);
  assert.equal(loadVouchers().length, 1);
  assert.equal(giftVouchersDb.nextNumber(DAY), 'GV/FY26-27/0005');
});

test('POS: partial redemption as a tender leaves a balance; the Z report shows it apart from money; ledger and cash book', () => {
  const [gv] = giftVouchersDb.sell({ count: 1, face_value: 1000, issued_on: DAY, method: 'UPI' }).vouchers;
  const rec = posBill([line('a', 'T-shirt', 1, 600)]); // 600 + 5% = 630
  assert.equal(rec.total, 630);
  const before = rec.taxable_value;
  const res = savePosBill({ record: rec, tenders: [{ method: 'Gift voucher', amount: 630, gift_voucher_id: gv.id, reference: gv.number }] });
  assert.ok(res.ok, res.errors.join('; '));
  assert.equal(res.record!.taxable_value, before, 'a voucher is consideration, not a discount');
  assert.equal(res.record!.status, 'Paid');
  const pay = getTable<Payment>('transactions')[0];
  assert.equal(pay.gift_voucher_id, gv.id);
  assert.equal(pay.method, 'Gift voucher');
  assert.equal(balanceOf(gv.code), 370);
  // Over the balance is refused before anything is written.
  const again = savePosBill({ record: posBill([line('b', 'Cap', 1, 400)]), tenders: [{ method: 'Gift voucher', amount: 420, gift_voucher_id: gv.id }] });
  assert.equal(again.ok, false);
  assert.match(again.errors.join(' '), /only ₹370\.00 left/);
  // A voucher cannot give change.
  assert.equal(tenderSummary(100, [{ method: 'Gift voucher', amount: 150, gift_voucher_id: gv.id }]).errors.length, 1);

  const z = zReport(DAY, localDb.invoices.getAll(), getTable<Payment>('transactions'));
  assert.equal(z.giftVouchers, 630);
  assert.equal(z.tenders.cash + z.tenders.upi + z.tenders.card + z.tenders.other, 0);
  assert.equal(z.received, 0);

  // Cash / bank book: the redemption moved no money.
  assert.equal(buildVouchers(loadBooksData()).filter((v) => v.type === 'Receipt').length, 0);
  // Ledger: Dr Gift vouchers outstanding | Cr Debtors; the liability is down to ₹370 and the TB balances.
  const rcpt = ledger().vouchers.find((v) => v.id === `rcpt:${pay.id}`)!;
  assert.equal(rcpt.lines.find((l) => l.dr > 0)!.account, gvAccount().id);
  assert.equal(balanceIn(gvAccount().id), -37000);
  const tb = trialBalance(ledger(), { start: '2026-04-01', end: '2027-03-31' });
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal(tb.totals.closingDr, tb.totals.closingCr);
});

test('invoice: partial redemption from the payment dialog; expired and cancelled vouchers refused', () => {
  const [gv, old] = giftVouchersDb.sell({ count: 2, face_value: 500, issued_on: DAY, method: 'Cash' }).vouchers;
  const inv = createViaStore({ client: clientMH, date: DAY, lines: [{ qty: 1, rate: 1000, tax: 18 }] });
  redeemOnInvoice({ invoiceId: inv.id, code: gv.code, amount: 300, date: DAY });
  assert.equal(balanceOf(gv.code), 200);
  assert.equal(localDb.invoices.getById(inv.id)!.amount_paid, 300);
  assert.throws(() => redeemOnInvoice({ invoiceId: inv.id, code: 'nope', amount: 10, date: DAY }), /No gift voucher/);
  // Expired: the day after expires_on.
  const st = voucherState(old, [], '2027-05-10');
  assert.match(redeemIssue(old, 100, '2027-05-10', st), /expired on 2027-05-09/);
  assert.equal(redeemIssue(old, 100, '2027-05-09', voucherState(old, [], '2027-05-09')), '');
  // No part use when the setting says so.
  assert.match(redeemIssue(old, 100, DAY, voucherState(old, [], DAY), { validity_months: 12, allow_partial: false, prefix: 'GV' }), /whole balance/);
  // Removing the receipt gives the value back (derived balance).
  const p = getTable<Payment>('transactions').find((x) => x.gift_voucher_id === gv.id)!;
  localDb.payments.remove(p.id);
  assert.equal(balanceOf(gv.code), 500);
});

test('promotional voucher: an amount discount (GST on the reduced value), noted on the voucher; cannot pay a bill', () => {
  const [promo] = giftVouchersDb.sell({ count: 1, face_value: 100, issued_on: DAY, promo: true }).vouchers;
  const rec = posBill([line('a', 'Shirt', 1, 1000)]);
  const d = applyPromoDiscount(rec, 100);
  assert.equal(d.error, '');
  assert.equal(d.record!.taxable_value, 900);
  assert.equal(d.record!.total, 945);
  assert.match(applyPromoDiscount(rec, 5000).error, /more than the bill/);
  const res = savePosBill({ record: d.record!, tenders: [{ method: 'Cash', amount: 945 }], promoVoucher: { id: promo.id, amount: 100 } });
  assert.ok(res.ok, res.errors.join('; '));
  assert.equal(balanceOf(promo.code), 0);
  assert.equal(giftVouchersDb.get(promo.id)!.promo_uses![0].number, res.record!.invoice_number);
  // Cancelling the bill gives the promo back.
  localDb.invoices.setStatus(res.record!.id, 'Cancelled');
  assert.equal(balanceOf(promo.code), 100);
  const tender = savePosBill({ record: posBill([line('b', 'Cap', 1, 100)]), tenders: [{ method: 'Gift voucher', amount: 50, gift_voucher_id: promo.id }] });
  assert.equal(tender.ok, false);
  assert.match(tender.errors.join(' '), /promotional/);
});

test('breakage: one journal for expired balances (Dr liability | Cr Unredeemed voucher income), undo restores; cancel rules', () => {
  const [a, b, c] = giftVouchersDb.sell({ count: 3, face_value: 1000, issued_on: DAY, method: 'Cash', expires_on: '2026-06-30' }).vouchers;
  const inv = createViaStore({ client: clientMH, date: DAY, lines: [{ qty: 1, rate: 400, tax: 0 }] });
  redeemOnInvoice({ invoiceId: inv.id, code: a.code, amount: 400, date: DAY });
  // Cancel refused after any redemption; allowed (owner) for an unused sold voucher, with a refund voucher.
  assert.throws(() => giftVouchersDb.cancel(a.id, DAY), /has been used/);
  as('clerk');
  assert.throws(() => giftVouchersDb.cancel(c.id, DAY));
  as(null);
  giftVouchersDb.cancel(c.id, DAY);
  const pv = loadVouchers().find((v) => v.type === 'PAYMENT')!;
  assert.equal(pv.lines.find((l) => l.cr > 0)!.account_id, 'cash');
  assert.equal(balanceIn(gvAccount().id), -(600 + 1000) * 100);

  assert.equal(giftVouchersDb.breakageDue('2026-06-30').length, 0, 'still valid on the expiry day');
  const due = giftVouchersDb.breakageDue('2026-07-01');
  assert.deepEqual(due.map((r) => [r.voucher.number, r.balance]), [[a.number, 600], [b.number, 1000]]);
  const r = giftVouchersDb.recogniseBreakage('2026-07-01', '2026-07-01');
  assert.equal(r.amount, 1600);
  assert.equal(balanceIn(gvAccount().id), 0, 'liability cleared');
  const income = chartOf(loadUserAccounts()).find((x) => x.name === 'Unredeemed voucher income')!;
  assert.equal(income.group, 'OTHER_INCOME');
  assert.equal(balanceIn(income.id), -160000);
  assert.equal(giftVouchersDb.breakageDue('2026-07-02').length, 0, 'once per voucher');
  assert.throws(() => giftVouchersDb.cancel(b.id, '2026-07-02'), /recognised as income/);
  const reg = gvRegister(giftVouchersDb.all(), getTable<Payment>('transactions'), getTable<InvoiceRecord>('invoices'), { day: '2026-07-02' });
  assert.equal(reg.totals.expired, 1600);
  assert.match(gvRegisterCsv(reg, () => ''), /GV\/FY26-27\/0001/);
  // Undo: journal deleted, balances outstanding again.
  const jid = giftVouchersDb.get(a.id)!.breakage_voucher_id!;
  assert.equal(giftVouchersDb.undoBreakage(jid), 2);
  assert.equal(balanceIn(gvAccount().id), -160000);
  assert.equal(loadVouchers().some((v) => v.id === jid), false);
  const tb = trialBalance(ledger(), { start: '2026-04-01', end: '2027-03-31' });
  assert.equal(tb.totals.closingDr, tb.totals.closingCr);
});

test('period lock and roles: a sale inside a locked period is refused; a viewer cannot sell', () => {
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-05-31' });
  assert.throws(() => giftVouchersDb.sell({ count: 1, face_value: 500, issued_on: DAY }), /lock/i);
  assert.equal(giftVouchersDb.all().length, 0, 'rolled back');
  installSettings();
  as('viewer');
  assert.throws(() => giftVouchersDb.sell({ count: 1, face_value: 500, issued_on: DAY }));
});
