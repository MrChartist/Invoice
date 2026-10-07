/**
 * Purchases -> ITC -> GSTR-3B set-off -> books, plus inventory after sales,
 * purchases and returns. All expected numbers are derived by hand below.
 */
import '../helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, freezeDate, thawDate } from '../helpers/shim.ts';
import {
  SELLER_GSTIN,
  clientKA,
  createViaStore,
  gstin,
  installSettings,
  reload,
} from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { computePurchaseTotals, itcTotals, paymentsDb, purchasesDb, balanceOf } from '../../src/lib/purchases.ts';
import {
  balanceSheet,
  gstSummary,
  loadBooksData,
  profitAndLoss,
  saveOpening,
} from '../../src/lib/books.ts';
import { buildGstReport } from '../../src/lib/gst-reports.ts';
import { computeStock, loadPositions, stockDb, blankStockItem, summarize } from '../../src/lib/inventory.ts';
import { createCreditNote } from '../../src/lib/documents.ts';
import { getTable } from '../../src/lib/storage.ts';
import type { PurchaseKind, PurchaseRecord } from '../../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const VENDOR_MH = gstin('27AAAPL1234C1Z');
const VENDOR_KA = gstin('29AAAPL1234C1Z');

function bill(
  over: Partial<PurchaseRecord> & { lines: PurchaseRecord['lines'] },
  ctx: { pos: string; gst?: boolean } = { pos: '27' },
): PurchaseRecord {
  const t = computePurchaseTotals(over.lines, { placeOfSupply: ctx.pos, businessState: '27', gstApplies: ctx.gst ?? true });
  return purchasesDb.save({
    kind: 'PURCHASE' as PurchaseKind,
    vendor_name: 'Vendor',
    bill_number: 'B-1',
    date: '2026-04-05',
    category: 'Purchases',
    taxable: t.taxable,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    itc_eligible: true,
    total: t.total,
    amount_paid: 0,
    ...over,
  });
}

const L = (name: string, qty: number, rate: number, tax: number) => ({ id: 'l-' + name, name, quantity: qty, rate, tax_rate: tax });

/**
 * April 2026.
 *   Sales:  S1 intra 10,000 @18 (CGST 900 + SGST 900) paid in full 11,800 on 12 Apr (bank)
 *           S2 inter 5,000 @18 (IGST 900), unpaid                                  5,900
 *   Purchases:
 *     P1 intra 50,000 @18 -> CGST 4,500 + SGST 4,500, ITC ok, total 59,000, 30,000 paid (bank, 15 Apr)
 *     P2 inter 10,000 @18 -> IGST 1,800, ITC ok, total 11,800, unpaid
 *     P3 intra  2,000 @18 -> 180 + 180, ITC BLOCKED, total 2,360, unpaid
 *     P4 expense rent 20,000, no GST, paid in cash on 20 Apr
 *   Openings: bank 1,00,000 and cash 50,000 on 1 Apr.
 */
function scenario() {
  const s1 = createViaStore({ date: '2026-04-08', lines: [{ qty: 10, rate: 1000, tax: 18 }] });
  const s2 = createViaStore({ date: '2026-04-09', client: clientKA, lines: [{ qty: 5, rate: 1000, tax: 18 }] });
  localDb.payments.record({ invoiceId: s1.id, amount: 11800, method: 'Bank transfer', date: '2026-04-12' });

  const p1 = bill({ vendor_name: 'Paper Co', vendor_gstin: VENDOR_MH, bill_number: 'PC-1', lines: [L('Paper ream', 500, 100, 18)] });
  const p2 = bill({ vendor_name: 'Bengaluru Metals', vendor_gstin: VENDOR_KA, bill_number: 'BM-1', date: '2026-04-06', lines: [L('Steel', 100, 100, 18)] }, { pos: '29' });
  const p3 = bill({ vendor_name: 'Gift Shop', bill_number: 'GS-1', date: '2026-04-07', itc_eligible: false, lines: [L('Gifts', 20, 100, 18)] });
  const p4 = bill({ kind: 'EXPENSE', vendor_name: 'Landlord', bill_number: 'RENT-4', date: '2026-04-01', category: 'Rent', lines: [L('Rent', 1, 20000, 0)] }, { pos: '27', gst: false });
  paymentsDb.record(p1.id, { amount: 30000, date: '2026-04-15', method: 'Bank transfer' });
  paymentsDb.record(p4.id, { amount: 20000, date: '2026-04-20', method: 'Cash' });
  saveOpening('bank', 100000, '2026-04-01');
  saveOpening('cash', 50000, '2026-04-01');
  return { s1, s2, p1: purchasesDb.get(p1.id)!, p2, p3, p4: purchasesDb.get(p4.id)! };
}

test('purchase totals: intra splits CGST/SGST, inter is IGST, blocked ITC is flagged', () => {
  const { p1, p2, p3, p4 } = scenario();
  assert.deepEqual([p1.taxable, p1.cgst, p1.sgst, p1.igst, p1.total], [50000, 4500, 4500, 0, 59000]);
  assert.deepEqual([p2.taxable, p2.cgst, p2.sgst, p2.igst, p2.total], [10000, 0, 0, 1800, 11800]);
  assert.deepEqual([p3.taxable, p3.cgst, p3.sgst, p3.total], [2000, 180, 180, 2360]);
  assert.deepEqual([p4.total, p4.amount_paid, balanceOf(p4)], [20000, 20000, 0]);
  assert.equal(balanceOf(p1), 29000);
  const itc = itcTotals(purchasesDb.all());
  assert.deepEqual([itc.cgst, itc.sgst, itc.igst, itc.total, itc.ineligible], [4500, 4500, 1800, 10800, 360]);
});

test('GSTR-3B: output liability, ITC by head, ineligible ITC and the legal set-off order', () => {
  scenario();
  const rep = buildGstReport(localDb.invoices.getAll(), purchasesDb.all(), {
    period: { kind: 'month', fyStart: 2026, month: 4 },
    gstin: SELLER_GSTIN,
  });
  const b = rep.gstr3b;
  // Output: CGST 900, SGST 900 (S1) and IGST 900 (S2)
  assert.deepEqual(b.outward.taxable, { taxable: 15000, igst: 900, cgst: 900, sgst: 900, cess: 0 });
  // ITC: P1 (4,500 + 4,500) and P2 (IGST 1,800); P3 is blocked (4D)
  assert.deepEqual(b.itc.availableOther, { igst: 1800, cgst: 4500, sgst: 4500, cess: 0 });
  assert.deepEqual(b.itc.ineligible, { igst: 0, cgst: 180, sgst: 180, cess: 0 });
  assert.deepEqual(b.itc.net, { igst: 1800, cgst: 4500, sgst: 4500, cess: 0 });
  // Set-off: IGST credit 1,800 -> IGST 900, then CGST 900 (SGST untouched); SGST credit pays SGST 900.
  assert.deepEqual(b.payment.itcUsed.igst, { igst: 900, cgst: 900, sgst: 0 });
  assert.deepEqual(b.payment.itcUsed.cgst, { cgst: 0, igst: 0 });
  assert.deepEqual(b.payment.itcUsed.sgst, { sgst: 900, igst: 0 });
  assert.deepEqual(b.payment.cash, { igst: 0, cgst: 0, sgst: 0 });
  assert.deepEqual(b.payment.itcCarry, { igst: 0, cgst: 4500, sgst: 3600 });
  assert.equal(b.purchasesConsidered, 4);
});

test('books agree with the GST position and the balance sheet balances (plug == openings)', () => {
  scenario();
  const data = loadBooksData();
  const apr = { start: '2026-04-01', end: '2026-04-30' };

  const g = gstSummary(data, apr);
  assert.deepEqual([g.outputCgst, g.outputSgst, g.outputIgst, g.outputTotal], [900, 900, 900, 2700]);
  assert.deepEqual([g.itc, g.blockedGst, g.netPayable], [10800, 360, -8100]); // refundable / carried

  // Accrual P&L: income 15,000; costs = taxable + BLOCKED GST (ITC-able GST is not a cost)
  //   direct  : 50,000 + 10,000 + (2,000 + 360) = 62,360
  //   indirect: rent 20,000
  const pl = profitAndLoss(data, apr, 'accrual');
  assert.equal(pl.income, 15000);
  assert.equal(pl.directCosts, 62360);
  assert.equal(pl.indirectExpenses, 20000);
  assert.equal(pl.grossProfit, -47360);
  assert.equal(pl.netProfit, -67360);

  // Cash basis: income only as received, costs only as paid (apportioned to the cost part of the bill)
  //   income 11,800 x 10,000/11,800 = 10,000
  //   P1 paid 30,000 of 59,000: 30,000 x 50,000/59,000 = 25,423.73 ; rent 20,000
  const cash = profitAndLoss(data, apr, 'cash');
  assert.equal(cash.income, 10000);
  assert.equal(cash.directCosts, 25423.73);
  assert.equal(cash.indirectExpenses, 20000);
  assert.equal(cash.netProfit, -35423.73);

  const bs = balanceSheet(data, '2026-04-30');
  assert.equal(bs.assets.cash, 30000); // 50,000 - 20,000 rent
  assert.equal(bs.assets.bank, 81800); // 1,00,000 + 11,800 - 30,000
  assert.equal(bs.assets.receivables, 5900); // S2
  assert.equal(bs.assets.itcReceivable, 8100); // ITC 10,800 - output 2,700
  assert.equal(bs.liabilities.payables, 43160); // (59,000 + 11,800 + 2,360 + 20,000) - 50,000 paid
  assert.equal(bs.liabilities.gstPayable, 0);
  assert.equal(bs.equity.retainedEarnings, -67360);
  assert.equal(bs.equity.total, 82640); // 125,800 assets - 43,160 liabilities
  assert.equal(bs.equity.capitalAndOther, 150000, 'the balancing figure is exactly the two opening balances');
});

test('REGRESSION: a payment on a cancelled bill still reduces the bank and shows as a vendor advance, not a plug', () => {
  const p = bill({ vendor_name: 'V', bill_number: 'X', date: '2026-04-05', lines: [L('Thing', 1, 1000, 0)] }, { pos: '27', gst: false });
  paymentsDb.record(p.id, { amount: 1000, date: '2026-04-06', method: 'Bank transfer' });
  purchasesDb.save({ ...purchasesDb.get(p.id)!, status: 'cancelled' } as never);
  saveOpening('bank', 5000, '2026-04-01');
  const bs = balanceSheet(loadBooksData(), '2026-04-30');
  assert.equal(bs.assets.bank, 4000);
  assert.equal(bs.assets.vendorAdvances, 1000);
  assert.equal(bs.equity.capitalAndOther, 5000);
});

test('REGRESSION: a receipt on a cancelled invoice is a customer advance, not a plug', () => {
  const inv = createViaStore({ date: '2026-04-08', lines: [{ qty: 1, rate: 1000, tax: 0 }] });
  localDb.payments.record({ invoiceId: inv.id, amount: 1000, method: 'UPI', date: '2026-04-09' });
  localDb.invoices.setStatus(inv.id, 'Cancelled');
  const bs = balanceSheet(loadBooksData(), '2026-04-30');
  assert.equal(bs.assets.bank, 1000);
  assert.equal(bs.liabilities.customerAdvances, 1000);
  assert.equal(bs.equity.capitalAndOther, 0);
});

/* ───────────────────────── inventory ───────────────────────── */

test('inventory: opening + purchase + sale + sales return, weighted average and FIFO', () => {
  const item = blankStockItem({ id: 'w', name: 'Widget', hsn: '847130', opening_qty: 10, opening_rate: 50, reorder_level: 20 });
  stockDb.saveItem(item);
  // purchase of 100 @ 60 (ex GST) on 5 Apr
  bill({ vendor_name: 'WidgetCo', bill_number: 'W-1', date: '2026-04-05', lines: [{ id: 'wl', name: 'Widget', hsn: '847130', quantity: 100, rate: 60, tax_rate: 18 }] });
  // a draft/cancelled bill and an EXPENSE for the same name must NOT add stock
  purchasesDb.save({ ...bill({ vendor_name: 'Ghost', bill_number: 'G-1', date: '2026-04-05', lines: [{ id: 'gl', name: 'Widget', hsn: '847130', quantity: 999, rate: 1, tax_rate: 0 }] }), status: 'cancelled' } as never);
  bill({ kind: 'EXPENSE', vendor_name: 'Fees', bill_number: 'E-1', date: '2026-04-05', lines: [{ id: 'el', name: 'Widget', hsn: '847130', quantity: 777, rate: 1, tax_rate: 0 }] }, { pos: '27', gst: false });
  // sale of 30 @ 100 on 10 Apr
  const sale = createViaStore({ date: '2026-04-10', lines: [{ name: 'Widget', hsn: '847130', qty: 30, rate: 100, tax: 18 }] });
  // credit note (sales return) of 5 on 20 Apr
  freezeDate('2026-04-20T10:00:00');
  const live = reload(sale.id);
  createCreditNote(live, { lines: [{ itemId: live.items[0].id, quantity: 5 }], reason: 'Sales return' });
  thawDate();

  const inputs = {
    items: stockDb.items(),
    moves: stockDb.moves(),
    invoices: getTable('invoices') as never[],
    purchases: getTable('purchases') as never[],
  };
  // Weighted average:
  //   opening 10 @ 50 = 500 ; + 100 @ 60 = 6,000 -> 110 units, 6,500 (avg 59.0909)
  //   sale 30 at 59.0909 = 1,772.73 -> 80 units, 4,727.27
  //   return 5 at the last issue cost 59.0909 = 295.45 -> 85 units, 5,022.73
  const [wa] = computeStock({ ...inputs, method: 'WEIGHTED_AVG' });
  assert.equal(wa.qty, 85);
  assert.equal(wa.value, 5022.73);
  assert.equal(wa.soldQty, 25); // 30 sold - 5 returned
  assert.equal(wa.revenue, 2500); // 25 x 100
  assert.equal(wa.cogs, 1477.27); // 1,772.73 - 295.45
  assert.equal(wa.purchasedQty, 100);

  // FIFO: sale takes 10 @ 50 + 20 @ 60 = 1,700 (unit 56.67); 80 @ 60 = 4,800 remain; return 5 @ 56.67 = 283.33
  const [ff] = computeStock({ ...inputs, method: 'FIFO' });
  assert.equal(ff.qty, 85);
  assert.equal(ff.value, 5083.33);
  assert.equal(ff.cogs, 1416.67); // 1,700 - 283.33

  // as-of date: before the sale only the purchase has landed
  const [early] = computeStock({ ...inputs, asOf: '2026-04-09' });
  assert.equal(early.qty, 110);
  assert.equal(early.value, 6500);

  // reorder level 20, stock 85 => healthy; live loader agrees with the pure engine
  assert.equal(loadPositions()[0].qty, 85);
  assert.equal(summarize(computeStock(inputs)).stockValue, 5022.73);
});
