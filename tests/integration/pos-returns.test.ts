/**
 * WP-9 POS returns / exchange: the return raises a credit note (goods back to stock), refunds by
 * tender through a payment voucher, exchange credit pays the next bill, and the Z report shows it.
 */
import '../helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from '../helpers/shim.ts';
import { installSettings } from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { blankStockItem, loadPositions, stockDb } from '../../src/lib/inventory.ts';
import { clearOverrides } from '../../src/lib/period-lock.ts';
import { buildPosRecord, drawerCount, savePosBill, zReport, zReportCsv, zReportHtml } from '../../src/lib/pos.ts';
import {
  findBillByNumber, planReturn, posReturnsDb, refundVoucherLines, savePosReturn, suggestRefund, zReturns,
} from '../../src/lib/pos-returns.ts';
import { loadVouchers } from '../../src/lib/ledger/vouchers.ts';
import { readLinks } from '../../src/lib/documents.ts';
import type { InvoiceItem } from '../../src/types/invoice.ts';

const DAY = '2026-05-10';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

const line = (id: string, name: string, quantity: number, rate: number): InvoiceItem => ({
  id, name, type: 'Product', hsn: '3401', unit: 'PCS', quantity, rate, tax_rate: 18, discount_percent: 0, amount: quantity * rate,
});

function sell(items: InvoiceItem[], tenders = [{ method: 'Cash' as const, amount: 10_000 }]) {
  const rec = buildPosRecord({ items, party: {}, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), templateId: 'classic_orange', day: DAY });
  const res = savePosBill({ record: rec, tenders });
  assert.ok(res.ok, res.errors.join('; '));
  return res.record!;
}

test('return one item for a cash refund: credit note, stock back, voucher, Z report', () => {
  stockDb.saveItem(blankStockItem({ id: 'soap', name: 'Soap', hsn: '3401', opening_qty: 10, opening_rate: 20 }));
  const bill = sell([line('a', 'Soap', 2, 100)]); // 236
  assert.equal(loadPositions().find((p) => p.item.id === 'soap')?.qty, 8);

  // Find by number (exact and trailing sequence).
  const all = localDb.invoices.getAll();
  assert.equal(findBillByNumber(bill.invoice_number.toLowerCase(), all)?.id, bill.id);
  assert.equal(findBillByNumber('1', all)?.id, bill.id);
  assert.equal(findBillByNumber('nope', all), null);

  const plan = planReturn(bill, [{ itemId: 'a', quantity: 1 }], { links: readLinks(), invoices: all, payments: localDb.payments.getAll(), returns: [], day: DAY });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.amount, 118);
  assert.equal(plan.refundable, 236);
  assert.deepEqual(suggestRefund(bill, localDb.payments.getAll(), 118), [{ method: 'Cash', amount: 118 }]);

  // Refund must equal the credit.
  const bad = savePosReturn({ bill, lines: [{ itemId: 'a', quantity: 1 }], settlement: 'refund', refunds: [{ method: 'Cash', amount: 100 }] });
  assert.equal(bad.ok, false);
  assert.equal(localDb.invoices.getAll().filter((i) => i.doc_type === 'CREDIT_NOTE').length, 0, 'nothing written on a bad refund');

  const res = savePosReturn({ bill, lines: [{ itemId: 'a', quantity: 1 }], settlement: 'refund', refunds: [{ method: 'Cash', amount: 118 }] });
  assert.ok(res.ok, res.errors.join('; '));
  const cn = res.creditNote!;
  assert.equal(cn.doc_type, 'CREDIT_NOTE');
  assert.equal(cn.goods_returned, true);
  assert.equal(cn.total, 118);
  assert.equal(loadPositions().find((p) => p.item.id === 'soap')?.qty, 9, 'one soap back in stock');

  const v = loadVouchers().find((x) => x.id === res.row!.voucher_id)!;
  assert.equal(v.type, 'PAYMENT');
  assert.deepEqual(v.lines.map((l) => [l.account_id, l.dr, l.cr]), [['debtors', 11800, 0], ['cash', 0, 11800]]);

  const z = zReport(DAY, localDb.invoices.getAll(), localDb.payments.getAll(), posReturnsDb.all());
  assert.equal(z.net, 236);
  assert.equal(z.returns.count, 1);
  assert.equal(z.returns.value, 118);
  assert.equal(z.returns.refunds.cash, 118);
  assert.equal(z.netAfterReturns, 118);
  assert.equal(drawerCount(z, 500, 618).difference, 0, 'expected = float + cash − cash refunds');
  assert.match(zReportCsv(z), /Refund cash,118/);
  assert.match(zReportHtml(z), /Returns/);

  // Cannot return more than is left, nor refund twice beyond what was received.
  const again = savePosReturn({ bill, lines: [{ itemId: 'a', quantity: 2 }], settlement: 'refund', refunds: [{ method: 'Cash', amount: 236 }] });
  assert.equal(again.ok, false);
});

test('UPI refund books to bank; a walk-in bill on account is not refundable beyond receipts', () => {
  const bill = sell([line('a', 'Comb', 1, 100)], [{ method: 'UPI', amount: 118 }] as never);
  const res = savePosReturn({ bill, lines: [{ itemId: 'a', quantity: 1 }], settlement: 'refund', refunds: [{ method: 'UPI', amount: 118 }] });
  assert.ok(res.ok, res.errors.join('; '));
  assert.deepEqual(loadVouchers()[0].lines.map((l) => l.account_id), ['debtors', 'bank']);
  assert.equal(zReturns(DAY, posReturnsDb.all(), localDb.invoices.getAll()).refunds.upi, 118);
  assert.deepEqual(refundVoucherLines('X', [{ method: 'Cash', amount: 0 }]), []);
});

test('exchange: credit pays the next bill, rest in cash; Z report keeps exchange out of tenders', () => {
  const bill = sell([line('a', 'Shirt', 1, 500)]); // 590
  const ret = savePosReturn({ bill, lines: [{ itemId: 'a', quantity: 1 }], settlement: 'exchange' });
  assert.ok(ret.ok, ret.errors.join('; '));
  assert.equal(ret.row!.voucher_id, undefined, 'no voucher until the credit is used');

  const rec = buildPosRecord({ items: [line('b', 'Shirt XL', 1, 600)], party: {}, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), templateId: 'classic_orange', day: DAY }); // 708
  // Walk-in must pay the 118 difference.
  const short = savePosBill({ record: rec, tenders: [], exchangeReturnId: ret.row!.id });
  assert.equal(short.ok, false);
  const res = savePosBill({ record: rec, tenders: [{ method: 'Cash', amount: 118 }], exchangeReturnId: ret.row!.id });
  assert.ok(res.ok, res.errors.join('; '));
  assert.equal(res.record!.status, 'Paid');
  const row = posReturnsDb.all()[0];
  assert.equal(row.exchange_bill_id, res.record!.id);
  assert.equal(row.exchange_used, 590);
  assert.ok(row.voucher_id);
  // Reusing the same credit is refused.
  const twice = savePosBill({ record: { ...rec, id: '' }, tenders: [{ method: 'Cash', amount: 708 }], exchangeReturnId: row.id });
  assert.equal(twice.ok, false);

  const z = zReport(DAY, localDb.invoices.getAll(), localDb.payments.getAll(), posReturnsDb.all());
  assert.equal(z.exchangeIn, 590);
  assert.equal(z.tenders.cash, 590 + 118, 'first bill + the difference');
  assert.equal(z.returns.exchanged, 590);
  assert.equal(z.returns.refunds.cash, 0);
});

test('exchange credit above the new bill: the rest is refunded in cash', () => {
  const bill = sell([line('a', 'Jacket', 1, 1000)]); // 1180
  const ret = savePosReturn({ bill, lines: [{ itemId: 'a', quantity: 1 }], settlement: 'exchange' });
  const rec = buildPosRecord({ items: [line('b', 'Cap', 1, 100)], party: {}, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), templateId: 'classic_orange', day: DAY }); // 118
  const res = savePosBill({ record: rec, tenders: [], exchangeReturnId: ret.row!.id });
  assert.ok(res.ok, res.errors.join('; '));
  const row = posReturnsDb.all()[0];
  assert.equal(row.exchange_used, 118);
  assert.deepEqual(row.refunds, [{ method: 'Cash', amount: 1062 }]);
  const z = zReport(DAY, localDb.invoices.getAll(), localDb.payments.getAll(), posReturnsDb.all());
  assert.equal(z.returns.refunds.cash, 1062);
  assert.equal(drawerCount(z, 0, 118).difference, 0, '1180 taken − 1062 handed back');
});
