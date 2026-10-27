/** RT-D3: buy-back (URD voucher, no GST / ITC), exchange receipt moves no cash, full-value sale, margin scheme split. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings, reload } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { godownsDb, nonSaleableGodowns, usedGoodsGodowns } from '../src/lib/godowns.ts';
import { loadTracking, serialsInStock } from '../src/lib/stock-tracking.ts';
import { readPurchase, readPurchaseLines } from '../src/lib/purchase-normalize.ts';
import { loadLedger } from '../src/lib/ledger/index.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import { zReport } from '../src/lib/pos.ts';
import { todaySummary } from '../src/lib/today.ts';
import { receiptCandidates } from '../src/lib/bank-recon.ts';
import { buildVouchers, loadBooksData } from '../src/lib/books.ts';
import { calcInputFromRecord, calculateInvoice } from '../src/lib/invoice-calc.ts';
import { applyExchange, buyBackOf, buyBackRows, deleteBuyBack, marginIssue, marginLines, recordBuyBack, undoExchange } from '../src/lib/retail/rt-buyback.ts';
import { nextUrdNumber } from '../src/lib/retail/rt-urd.ts';
import { cashPaymentIssue, cashReceiptIssue, sameDayCash } from '../src/lib/retail/rt-cash-guard.ts';
import type { Client, InvoiceItem, Payment } from '../src/types/invoice.ts';

const DAY = '2026-07-20';
const OLD = '356938035643809';
const walkIn: Client = { id: 'c-ravi', name: 'Ravi Kumar', email: '', address: '', city: 'Mumbai', zip: '', state_code: '27', phone: '9800000009' } as Client;
beforeEach(() => {
  resetStorage();
  installSettings();
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

const buy = () => recordBuyBack({ date: DAY, customer: 'Ravi Kumar', phone: '9800000009', model: 'iPhone 12 64GB', serial: OLD, value: 18000, hsn: '8517', taxRate: 18, goods: { condition: 'Good', id_type: 'Aadhaar', id_last4: '4321' } });
const net = (account: string, party?: string) => loadLedger().vouchers.flatMap((v) => v.lines).filter((l) => l.account === account && (party === undefined || l.party === party)).reduce((s, l) => s + l.dr - l.cr, 0) / 100;

test('buy-back: URD voucher, no GST / ITC / RCM, into the saleable "used" godown as a second-hand serial', () => {
  const p = buy();
  assert.match(p.bill_number, /^URD\/FY26-27\/0001$/);
  assert.deepEqual([p.total, p.cgst + p.sgst + p.igst, p.itc_eligible, !!p.reverse_charge], [18000, 0, false, false]);
  assert.equal(p.used_goods?.id_last4, '4321');
  const c = readPurchase(p)!;
  assert.deepEqual([c.cgst + c.sgst + c.igst, c.itcEligible, c.taxable], [0, false, 18000], 'purchases contract: no GST, no ITC');
  assert.deepEqual(readPurchaseLines(p).map((l) => [l.quantity, l.serials]), [[1, [OLD]]]);
  const used = godownsDb.list().find((g) => g.kind === 'used')!;
  assert.ok(usedGoodsGodowns(godownsDb.list()).has(used.id) && !nonSaleableGodowns(godownsDb.list()).has(used.id), 'saleable');
  const t = [...loadTracking().values()].find((x) => x.item.second_hand)!;
  assert.deepEqual(serialsInStock(t, used.id), [OLD]);
  assert.equal(t.item.serial_kind, 'imei');
  assert.throws(() => buy(), /already in stock/);
  assert.equal(net(A.creditors, 'Ravi Kumar'), -18000, 'owed to the customer until settled');
});

test('exchange: the receipt moves no cash; the sale carries the full value with GST; parties net off', () => {
  const p = buy();
  const sale = createViaStore({ client: walkIn, date: DAY, lines: [{ name: 'iPhone 15 128GB', hsn: '8517', qty: 1, rate: 67711.86, tax: 18 }], status: 'Sent', patch: { pos: true } as never });
  assert.equal(sale.total, 79900, 'GST on the full ₹79,900');
  const x = applyExchange(sale.id, p.id);
  assert.equal(x.amount, 18000);
  assert.equal(movedNoCash(x), true);
  assert.equal(reload(sale.id).balance_due, 61900);
  localDb.payments.record({ invoiceId: sale.id, amount: 61900, method: 'UPI', date: DAY });
  const pays = getTable<Payment>('transactions');
  const invs = localDb.invoices.getAll();
  assert.equal(zReport(DAY, invs, pays).tenders.cash, 0);
  assert.equal(zReport(DAY, invs, pays).tenders.upi, 61900, 'Z report: only the UPI');
  const today = todaySummary({ invoices: invs, payments: pays, purchases: [] }, DAY);
  assert.deepEqual([today.cash, today.upi], [0, 61900]);
  assert.equal(receiptCandidates(invs, pays).length, 1, 'bank reco: the UPI only');
  assert.equal(buildVouchers(loadBooksData()).filter((v) => v.account === 'cash').length, 0, 'cash book unchanged by the exchange');
  assert.equal(net(A.creditors, 'Ravi Kumar'), 0, 'creditor cleared by the exchange');
  assert.equal(net(A.debtors, 'Ravi Kumar'), 0);
  assert.equal(purchasesDb.get(p.id)?.amount_paid, 18000, 'voucher shown settled');
  assert.throws(() => deleteBuyBack(p.id), /undo that exchange/);
  undoExchange(x.id);
  assert.equal(purchasesDb.get(p.id)?.amount_paid, 0);
  const other = createViaStore({ client: clientMH, date: DAY, lines: [{ qty: 1, rate: 1000 }], status: 'Sent' });
  assert.throws(() => applyExchange(other.id, p.id), /put that name on the bill/);
});

test('margin scheme: split into cost (no GST) + margin (GST inside); negative margin → no GST; refused for a registered buyer', () => {
  const p = buy();
  const line: InvoiceItem = { id: 'l', name: 'iPhone 12 64GB (used)', type: 'Product', hsn: '8517', unit: 'NOS', quantity: 1, rate: 22000, tax_rate: 18, discount_percent: 0, amount: 22000, serials: [OLD] };
  const bb = buyBackOf(OLD, purchasesDb.all())!;
  assert.deepEqual([bb.purchase.id, bb.value], [p.id, 18000]);
  const inc = marginLines(line, { id: p.id, value: bb.value }, true, () => 'm');
  assert.deepEqual(inc.map((l) => [l.rate, l.tax_rate, l.margin?.part]), [[18000, 0, 'cost'], [4000, 18, 'margin']]);
  assert.deepEqual(inc[0].serials, [OLD], 'the serial stays on the cost line (one unit out of stock)');
  const rec = { ...reload(createViaStore({ client: walkIn, date: DAY, lines: [{ qty: 1, rate: 1 }], inclusive: true }).id), items: inc };
  const t = calculateInvoice(calcInputFromRecord(rec));
  assert.equal(t.total, 22000, 'the customer pays ₹22,000');
  assert.equal(t.tax_amount, 610.17, 'GST only on the ₹4,000 margin (18/118)');
  const exc = marginLines({ ...line, rate: 18644.07 }, { id: p.id, value: 18000 }, false, () => 'm');
  assert.deepEqual(exc.map((l) => [l.rate, l.tax_rate]), [[18000, 0], [3389.83, 18]], 'tax-exclusive bill: margin line ex-GST');
  const neg = marginLines({ ...line, rate: 15000 }, { id: p.id, value: 18000 }, true, () => 'm');
  assert.deepEqual(neg.map((l) => [l.rate, l.tax_rate]), [[15000, 0]], 'negative margin ignored: no GST');
  assert.match(marginIssue({ client: clientMH }), /no ITC/);
  assert.equal(marginIssue({ client: walkIn }), '');
  assert.throws(() => marginLines({ ...line, quantity: 2 }, { id: p.id, value: 1 }, true, () => 'm'), /one used device/);
  createViaStore({ client: walkIn, date: DAY, lines: [{ qty: 1, rate: 1 }] });
  const sale = localDb.invoices.save({ ...rec, id: '', invoice_number: '', items: inc.map((l) => ({ ...l })) });
  const row = buyBackRows(purchasesDb.all(), localDb.invoices.getAll()).find((r) => r.purchase.id === p.id)!;
  assert.deepEqual([row.sale?.id, row.price, row.margin], [sale.id, 22000, 4000]);
});

test('URD number reserved after a delete', () => {
  const p = buy();
  deleteBuyBack(p.id);
  assert.equal(nextUrdNumber(DAY), 'URD/FY26-27/0002');
});

test('cash guard: Sec 269ST on receipts (same-day aggregation), Sec 40A(3) on cash paid', () => {
  assert.equal(cashReceiptIssue('warn', 199999, 0, DAY), null);
  assert.deepEqual(cashReceiptIssue('block', 200000, 0, DAY)?.block, true);
  assert.equal(cashReceiptIssue('warn', 150000, 60000, DAY)?.block, false);
  assert.equal(cashReceiptIssue('off', 900000, 0, DAY), null);
  const a = createViaStore({ client: walkIn, date: DAY, lines: [{ qty: 1, rate: 150000, tax: 0 }], status: 'Sent' });
  localDb.payments.record({ invoiceId: a.id, amount: 150000, method: 'Cash', date: DAY });
  assert.equal(sameDayCash(walkIn, DAY, localDb.invoices.getAll(), getTable<Payment>('transactions')), 150000);
  assert.equal(sameDayCash(walkIn, DAY, localDb.invoices.getAll(), getTable<Payment>('transactions'), a.id), 0);
  assert.equal(cashPaymentIssue(10000, DAY), '');
  assert.match(cashPaymentIssue(18000, DAY), /40A\(3\)/);
});
