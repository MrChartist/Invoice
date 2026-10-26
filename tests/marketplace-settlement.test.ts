/** R5-A4: settlement import, buckets, per-order status, posting into clearing (nets to zero), fee invoice, unpost. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, importMtr, setupWorld } from './helpers/marketplace.ts';
import { bucketTotals, classify, importSettlement, loadSettlements, parseSettlement, rebucket } from '../src/lib/marketplace/settlement-import.ts';
import { reconcileOrders, orderReconCsv } from '../src/lib/marketplace/settlement-recon.ts';
import { clearingBalance, feeTotals, postSettlement, recordFeeInvoice, settlementClearing, unpostSettlement, FEE_GST_AWAITING_ACCOUNT, TCS_RECEIVABLE_ACCOUNT } from '../src/lib/marketplace/settlement-post.ts';
import { channelById } from '../src/lib/marketplace/channels.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { chartOf, loadUserAccounts, A } from '../src/lib/ledger/accounts.ts';
import { localDb } from '../src/lib/localDb.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import type { SalesChannel } from '../src/types/marketplace-r5.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

let ch: SalesChannel;
beforeEach(() => { ch = setupWorld(); });
const amazon = () => parseSettlement([{ name: 'v2', table: fixture('amazon-settlement-v2.csv') }], 'amazon_v2');
const accountByName = (n: string) => chartOf(loadUserAccounts()).find((a) => a.name === n)!.id;
const voucherSum = (accountId: string) => loadVouchers().reduce((s, v) => s + v.lines.filter((l) => l.account_id === accountId).reduce((a, l) => a + l.dr - l.cr, 0), 0) / 100;

test('Amazon V2 long format pivots to orders and buckets; Σ lines = payout', () => {
  const p = amazon();
  assert.equal(p.settlement_id, '9001');
  assert.equal(p.deposit_date, '2026-10-16');
  assert.equal(p.payout, 2016.57);
  assert.equal(p.difference, 0);
  assert.deepEqual(p.problems, []);
  const b = bucketTotals(p.lines);
  assert.equal(b.sale, 2832);
  assert.equal(b.refund, -590);
  assert.equal(b.commission, -150);
  assert.equal(b.closing_fee, -20);
  assert.equal(b.ads, -50);
  assert.equal(b.gst_on_fees, -30.6);
  assert.equal(b.tcs, -12);
  assert.equal(b.tds_194o, -2.83);
  assert.equal(b.reimbursement, 40);
  assert.equal(new Set(p.lines.map((l) => l.order_id).filter(Boolean)).size, 3);
});

test('Flipkart workbook: Orders + Storage sheets read together sum to the typed payout', () => {
  const sheets = [{ name: 'Orders', table: fixture('flipkart-orders.csv') }, { name: 'Storage & recall', table: fixture('flipkart-storage.csv') }];
  const p = parseSettlement(sheets, 'flipkart_settlement', { payout: 1225 });
  assert.equal(p.settlement_id, 'NEFT77');
  assert.equal(p.deposit_date, '2026-10-15');
  assert.deepEqual(p.problems, [], p.problems.join(' / '));
  const b = bucketTotals(p.lines);
  assert.equal(b.sale, 1500);
  assert.equal(b.tcs, -6.36);
  assert.equal(b.tds_194o, -2.25);
  assert.equal(b.storage, -18.59);
  assert.equal(b.gst_on_fees, -37.8);
  // Without the storage sheet the lines do not reach the deposit: refused with the difference.
  const short = parseSettlement(sheets.slice(0, 1), 'flipkart_settlement', { payout: 1225 });
  assert.equal(short.difference, 18.59);
  assert.ok(short.problems.some((x) => /difference 18\.59/.test(x)));
  assert.throws(() => importSettlement(ch, short, 'fk.xlsx'), /difference/);
});

test('bucket map: unknown descriptions go to "other" until a rule is taught; rules beat the table', () => {
  assert.equal(classify('Mystery adjustment'), 'other');
  assert.equal(classify('Mystery adjustment', [{ match: 'mystery', bucket: 'claim' }]), 'claim');
  assert.equal(classify('Commission', [{ match: 'commission', bucket: 'ads' }]), 'ads');
  const p = parseSettlement([{ name: 'x', table: { headers: ['settlement-id', 'deposit-date', 'total-amount', 'order-id', 'amount-type', 'amount-description', 'amount'], rows: [['1', '2026-10-01', '10', '', '', '', ''], ['1', '', '', 'A', 'Other', 'Mystery adjustment', '10']] } }], 'amazon_v2');
  assert.deepEqual(p.unknown, ['Other / Mystery adjustment']);
  assert.equal(rebucket(p, [{ match: 'mystery', bucket: 'reimbursement' }]).lines[0].bucket, 'reimbursement');
});

test('per-order statuses: settled, refunded, short, excess fee, unsettled after the cycle', () => {
  importMtr(ch);
  const s = importSettlement(ch, amazon(), 'v2.csv');
  const docs = localDb.invoices.getAll();
  const rows = reconcileOrders(channelById(ch.id)!, docs, [s], { today: '2026-10-20' });
  const st = Object.fromEntries(rows.map((r) => [r.order_id, r.status]));
  assert.equal(st['402-111'], 'refunded');
  assert.equal(st['402-222'], 'settled');
  assert.equal(st['402-444'], 'settled');
  const r222 = rows.find((r) => r.order_id === '402-222')!;
  assert.equal(r222.net, 1032.84);
  assert.equal(r222.settled_pct, 97.25);
  // Expected fee 5 %: 402-444 paid 118 / 1180 = 10 % in fees → excess fee.
  const withFee = { ...channelById(ch.id)!, expected_fee_pct: [{ pct: 5 }] };
  assert.equal(reconcileOrders(withFee, docs, [s], { today: '2026-10-20' }).find((r) => r.order_id === '402-444')!.status, 'excess_fee');
  // Short-paid sale.
  const shortS = { ...s, lines: s.lines.map((l) => (l.order_id === '402-222' && l.bucket === 'sale' ? { ...l, amount: 1000 } : l)) };
  assert.equal(reconcileOrders(channelById(ch.id)!, docs, [shortS], { today: '2026-10-20' }).find((r) => r.order_id === '402-222')!.status, 'short');
  // No settlement line: within the cycle "pending", after cycle + 7 days "unsettled".
  assert.equal(reconcileOrders(channelById(ch.id)!, docs, [], { today: '2026-10-20' }).find((r) => r.order_id === '402-222')!.status, 'pending');
  assert.equal(reconcileOrders(channelById(ch.id)!, docs, [], { today: '2026-11-01' }).find((r) => r.order_id === '402-222')!.status, 'unsettled');
  assert.match(orderReconCsv(rows), /^Order id,/);
  assert.throws(() => importSettlement(ch, amazon(), 'again.csv'), /already imported/);
});

test('posting: receipts into clearing, one balanced journal, one contra — clearing nets to 0.00; unpost restores', () => {
  importMtr(ch);
  const s = importSettlement(ch, amazon(), 'v2.csv');
  const before = localDb.payments.getAll().length;
  const posted = postSettlement(s.id);
  assert.equal(posted.posted!.payment_ids.length, 2, 'the refunded order nets to no receipt (its credit note settles it)');
  const pays = localDb.payments.getAll().filter((p) => posted.posted!.payment_ids.includes(p.id));
  assert.ok(pays.every((p) => p.bank_account_id === ch.clearing_bank_id && p.method === 'Marketplace settlement' && p.reference === '9001'));
  assert.equal(pays.reduce((a, p) => a + p.amount, 0), 2242);
  assert.equal(voucherSum(A.debtors), 0, 'no refund left on a customer account');
  const j = loadVouchers().find((v) => v.id === posted.posted!.journal_id)!;
  assert.equal(j.type, 'JOURNAL');
  assert.equal(j.lines.reduce((a, l) => a + l.dr, 0), j.lines.reduce((a, l) => a + l.cr, 0));
  const c = loadVouchers().find((v) => v.id === posted.posted!.contra_id)!;
  assert.equal(c.type, 'CONTRA');
  assert.equal(c.lines[0].dr, 201657);
  assert.equal(settlementClearing(posted), 0);
  assert.equal(clearingBalance(ch.clearing_bank_id), 0);
  assert.equal(voucherSum(accountByName(TCS_RECEIVABLE_ACCOUNT)), 12);
  assert.equal(voucherSum(A.tdsReceivable), 2.83);
  assert.equal(voucherSum(accountByName(FEE_GST_AWAITING_ACCOUNT)), 30.6, 'GST on fees parked until the fee invoice');
  assert.equal(voucherSum(A.otherIncome), -40);
  const inv = localDb.invoices.getAll().find((d) => d.invoice_number === 'IN-1002') as InvoiceRecord;
  assert.equal(inv.status, 'Paid');
  assert.throws(() => postSettlement(s.id), /already posted/);

  unpostSettlement(s.id);
  assert.equal(localDb.payments.getAll().length, before);
  assert.equal(loadVouchers().length, 0);
  assert.equal(loadSettlements(ch.id)[0].posted, undefined);
  assert.equal((localDb.invoices.getById(inv.id) as InvoiceRecord).status, 'Sent');
});

test('fee invoice: bill with ITC, awaiting account cleared, fee expensed once', () => {
  importMtr(ch);
  const s = importSettlement(ch, amazon(), 'v2.csv');
  postSettlement(s.id);
  assert.deepEqual(feeTotals(s), { fees: 220, gst: 30.6 });
  const { bill } = recordFeeInvoice(s.id, { bill_number: 'AMZ-FEE-10', date: '2026-10-31', hsn: '9985' });
  assert.equal(bill.kind, 'EXPENSE');
  assert.equal(bill.itc_eligible, true);
  assert.equal(bill.taxable, 220);
  assert.equal(bill.cgst + bill.sgst + bill.igst, 30.6);
  assert.equal(bill.cgst, 15.3, 'the operator GSTIN is in our own state (MH)');
  assert.equal(bill.amount_paid, bill.total);
  assert.ok(purchasesDb.get(bill.id));
  assert.equal(voucherSum(accountByName(FEE_GST_AWAITING_ACCOUNT)), 0);
  assert.throws(() => unpostSettlement(s.id), /fee invoice/);
  assert.throws(() => recordFeeInvoice(s.id, { bill_number: 'X', date: '2026-10-31', hsn: '9985' }), /already/);
});

test('fee invoice already in hand at posting: GST goes straight to input credit', () => {
  importMtr(ch);
  const s = importSettlement(ch, amazon(), 'v2.csv');
  postSettlement(s.id, { feeInvoiceReceived: true });
  assert.equal(voucherSum(A.inCgst) + voucherSum(A.inSgst), 30.6);
  assert.equal(clearingBalance(ch.clearing_bank_id), 0);
  assert.throws(() => recordFeeInvoice(s.id, { bill_number: 'X', date: '2026-10-31', hsn: '9985' }), /input credit/);
});

test('period lock: a settlement in a locked period is refused, and so is posting into one', () => {
  importMtr(ch);
  const s = importSettlement(ch, amazon(), 'v2.csv');
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-10-31' });
  assert.throws(() => postSettlement(s.id));
  assert.equal(localDb.payments.getAll().length, 0, 'nothing half-posted');
  assert.equal(loadVouchers().length, 0);
  const again = parseSettlement([{ name: 'v2', table: fixture('amazon-settlement-v2.csv') }], 'amazon_v2', { settlement_id: '9002' });
  assert.throws(() => importSettlement(ch, again, 'x'), /period lock/);
});
