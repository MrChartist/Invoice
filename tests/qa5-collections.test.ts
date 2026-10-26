/**
 * QA round 5, package QA5-1 (docs/prd/qa-round-5.md): collections, write-off and composition money paths.
 *  F1  pending settlement notes reserve the due; approval re-checks it
 *  F2  write-off uses the true amount due (credit notes and FCNs applied)
 *  F3  CMP-08 / GSTR-4 leave out no-GST financial notes
 *  F11 same-FY recovery when the bill's month is locked
 *  F12 a clerk cannot remove a write-off row
 *  F13 Sales by customer leaves FCNs out, as the P&L does
 *  F18 the clerk cap converts a foreign-currency amount to rupees
 *  F20 one receipt keeps one promise, not every overlapping one
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, createViaStore, reload, SELLER, clientUS } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { createFinancialNote, dueOn, recordReceiptAndSettle } from '../src/lib/settlement.ts';
import { approveDocument } from '../src/lib/approvals.ts';
import { buildReceivables } from '../src/lib/receivables.ts';
import { buildCmp08 } from '../src/lib/composition-returns.ts';
import { estimateEcoTcs } from '../src/lib/gstr4-annual.ts';
import { bulkWriteOff, loadRecoveries, recordRecovery, recoverable, writeOffBill, writeOffBlock } from '../src/lib/write-off.ts';
import { createCreditNote } from '../src/lib/documents.ts';
import { salesByCustomer, salesDocs } from '../src/lib/sales-reports.ts';
import { profitAndLoss, type BooksData } from '../src/lib/books.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { promiseCounts, promiseNotices, promiseProgress, promiseAllocation, openPromises, type CollectionNote, type PartyReceipt } from '../src/lib/collections.ts';

beforeEach(() => { resetStorage(); installSettings(); });
afterEach(() => setActorProvider(null));

const asClerk = () => setActorProvider(() => ({ id: 'c', name: 'Clerk', role: 'clerk' }));
const receivables = () =>
  buildReceivables({ invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll(), links: getTable('doc_links') } as never, { now: new Date('2026-10-26') });

test('F1: pending settlement notes reserve the due — a second note beyond it is refused', () => {
  const inv = createViaStore({ date: '2026-10-05', lines: [{ qty: 1, rate: 50000, tax: 18 }], status: 'Sent' });
  asClerk();
  const first = createFinancialNote(inv.id, { amount: 5000, reason: 'settlement_discount', date: '2026-10-20' });
  assert.equal(first.pending, true);
  assert.throws(() => createFinancialNote(inv.id, { amount: 58000, reason: 'settlement_discount', date: '2026-10-20' }), /54000\.00 is still due .*waiting for approval/);
  // Within what is left it is still accepted (and waits too).
  assert.equal(createFinancialNote(inv.id, { amount: 54000, reason: 'settlement_discount', date: '2026-10-20' }).pending, true);
});

test('F1: approving a settlement note after the bill was paid in full is refused; a still-owed note issues', () => {
  const inv = createViaStore({ date: '2026-10-05', lines: [{ qty: 1, rate: 50000, tax: 18 }], status: 'Sent' });
  asClerk();
  const a = createFinancialNote(inv.id, { amount: 5000, reason: 'settlement_discount', date: '2026-10-20' });
  setActorProvider(null);
  localDb.payments.record({ invoiceId: inv.id, amount: inv.total, method: 'UPI', date: '2026-10-21' });
  assert.equal(reload(inv.id).status, 'Paid');
  assert.throws(() => approveDocument(a.note.id), /already settled/);
  assert.equal(reload(a.note.id).status, 'Draft', 'the note stays a pending draft');
  const rcv = receivables() as unknown as { totals: { creditNotes: number; net: number } };
  assert.equal(rcv.totals.creditNotes, 0, 'no credit is created for the party');
  assert.equal(rcv.totals.net, 0);

  // A note the bill still owes issues and settles the bill.
  const inv2 = createViaStore({ date: '2026-10-05', lines: [{ qty: 1, rate: 10000, tax: 18 }], status: 'Sent' });
  localDb.payments.record({ invoiceId: inv2.id, amount: 11000, method: 'UPI', date: '2026-10-21' });
  asClerk();
  const b = createFinancialNote(inv2.id, { amount: 800, reason: 'short_payment', date: '2026-10-21' });
  assert.equal(b.pending, true);
  setActorProvider(null);
  approveDocument(b.note.id);
  assert.equal(reload(b.note.id).status, 'Sent');
  assert.equal(reload(inv2.id).status, 'Paid');
  assert.equal(dueOn(inv2.id), 0);
});

test('F1: approval refuses a note larger than what is left after a part payment', () => {
  const inv = createViaStore({ date: '2026-10-05', lines: [{ qty: 1, rate: 10000, tax: 18 }], status: 'Sent' });
  asClerk();
  const n = createFinancialNote(inv.id, { amount: 1000, reason: 'short_payment', date: '2026-10-21' });
  setActorProvider(null);
  localDb.payments.record({ invoiceId: inv.id, amount: 11500, method: 'UPI', date: '2026-10-22' });
  assert.throws(() => approveDocument(n.note.id), /Only 300\.00 is still due/);
});

test('F18: the clerk cap compares rupees with rupees on a foreign-currency bill', () => {
  const inv = createViaStore({ client: clientUS, date: '2026-10-05', currency: 'USD', supply: 'EXPORT_LUT' as never, lines: [{ qty: 1, rate: 1000, tax: 0 }], patch: { exchange_rate: 84 }, status: 'Sent' });
  asClerk();
  // $50 = ₹4,200, far above the ₹100 cap.
  assert.equal(createFinancialNote(inv.id, { amount: 50, reason: 'short_payment', date: '2026-10-20' }).pending, true);
  // $1 = ₹84 is within the cap (₹100, and 2% of ₹84,000).
  assert.equal(createFinancialNote(inv.id, { amount: 1, reason: 'short_payment', date: '2026-10-20' }).pending, false);
});

test('F2: a write-off after a credit note writes off only the net due', () => {
  const inv = createViaStore({ date: '2026-10-05', lines: [{ name: 'Widget', qty: 10, rate: 1000, tax: 18 }], status: 'Sent' });
  const cn = createCreditNote(inv, { lines: [{ itemId: inv.items[0].id, quantity: 2 }], reason: 'Damaged', goodsReturned: true });
  assert.equal(dueOn(inv.id), 9440);
  const r = writeOffBill(inv.id, { date: '2026-10-25', reason: 'Customer closed' });
  assert.equal(r.total, round(inv.total - cn.total));
  assert.equal(reload(inv.id).status, 'Paid');
  const rcv = receivables() as unknown as { totals: { net: number } };
  assert.equal(rcv.totals.net, 0, 'the party ends at nil, not in credit');
});

test('F2: a write-off after a receipt and a kasar FCN writes off the due; fully credited bills are skipped', () => {
  const inv = createViaStore({ date: '2026-10-05', lines: [{ qty: 1, rate: 10000, tax: 18 }], status: 'Sent' });
  recordReceiptAndSettle({ invoiceId: inv.id, amount: 5000, method: 'UPI', date: '2026-10-10' });
  createFinancialNote(inv.id, { amount: 100, reason: 'short_payment', date: '2026-10-11' });
  assert.equal(dueOn(inv.id), 6700);
  const r = bulkWriteOff([inv.id], { date: '2026-10-25', reason: 'gone' });
  assert.equal(r.total, 6700);
  assert.equal(dueOn(inv.id), 0);

  // A bill whose due is fully covered by credits (status not yet re-derived) is nothing to write off.
  const credited = { ...reload(inv.id), status: 'Sent' as const };
  assert.equal(writeOffBlock(credited, new Map([[inv.id, 11800]])), 'nothing');
});

test('F3: CMP-08 keeps the turnover when a no-GST kasar FCN settles a bill of supply', () => {
  for (const kind of ['manufacturer', 'trader'] as const) {
    resetStorage();
    installSettings({ profiles: [{ ...SELLER, gst_scheme: 'composition', composition_category: kind } as never] });
    const inv = createViaStore({
      date: '2026-10-05', lines: [{ qty: 1, rate: 100000, tax: 18 }], gstMode: 'NONE', docType: 'BILL_OF_SUPPLY' as never, status: 'Sent',
      patch: { sender: { ...SELLER, gst_scheme: 'composition', composition_category: kind } as never },
    });
    const period = { kind: 'quarter', fyStart: 2026, quarter: 3 } as never;
    const before = buildCmp08(localDb.invoices.getAll(), [], period, {});
    recordReceiptAndSettle({ invoiceId: inv.id, amount: inv.total - 10000, method: 'Cash', date: '2026-10-20', settle: { reason: 'short_payment', amount: 10000 } });
    const after = buildCmp08(localDb.invoices.getAll(), [], period, {});
    assert.equal(after.outward.value, 100000, `${kind}: turnover`);
    assert.equal(after.outward.exempt, 0, `${kind}: no negative exempt value`);
    assert.deepEqual(after.payable, before.payable, `${kind}: tax unchanged`);
    assert.equal(after.counts.documents, before.counts.documents, `${kind}: the FCN is not a document of the return`);
  }
});

test('F3: the GSTR-4 e-commerce TCS estimate leaves a no-GST FCN out', () => {
  const sender = { ...SELLER, gst_scheme: 'composition', composition_category: 'trader' } as never;
  installSettings({ profiles: [sender] });
  const eco = { eco_gstin: '27AACCF0683K1ZM', eco_section: 'TCS_52' };
  const inv = createViaStore({
    date: '2026-10-05', lines: [{ qty: 1, rate: 10000, tax: 0 }], gstMode: 'NONE', docType: 'BILL_OF_SUPPLY' as never, status: 'Sent',
    patch: { sender, ...eco } as never,
  });
  const period = { kind: 'quarter', fyStart: 2026, quarter: 3 } as never;
  const before = estimateEcoTcs(localDb.invoices.getAll(), period);
  // A financial note copies the bill's fields; give it the operator too, as an older note might carry.
  const r = createFinancialNote(inv.id, { amount: 500, reason: 'short_payment', date: '2026-10-20' });
  localDb.invoices.save({ ...reload(r.note.id), ...eco } as never);
  assert.equal(before.length, 1);
  assert.deepEqual(estimateEcoTcs(localDb.invoices.getAll(), period), before);
});

test('F11: a same-FY recovery is recorded when the bill and its write-off are in a locked month', () => {
  const inv = createViaStore({ date: '2026-05-05', lines: [{ qty: 1, rate: 10000, tax: 18 }], status: 'Sent' });
  writeOffBill(inv.id, { date: '2026-05-25', reason: 'gone' });
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-06-30' } as never);
  const paymentsBefore = JSON.stringify(localDb.payments.getAll());
  const rec = recordRecovery({ invoiceId: inv.id, amount: 3000, date: '2026-10-20', method: 'UPI' });
  assert.equal(rec.mode, 'locked_period');
  assert.equal(JSON.stringify(localDb.payments.getAll()), paymentsBefore, 'the locked May rows are untouched');
  const v = loadVouchers().find((x) => x.id === rec.voucher_id)!;
  assert.equal(v.date, '2026-10-20', 'dated the day the money came in');
  assert.equal(loadRecoveries().length, 1);
  assert.equal(recoverable(inv.id), 8800);
  // The recovery date itself must still be open.
  assert.throws(() => recordRecovery({ invoiceId: inv.id, amount: 100, date: '2026-06-15', method: 'UPI' }), /locked/i);
});

test('F11: with the lock lifted, the same-FY path still reduces the write-off row', () => {
  const inv = createViaStore({ date: '2026-05-05', lines: [{ qty: 1, rate: 10000, tax: 18 }], status: 'Sent' });
  writeOffBill(inv.id, { date: '2026-05-25', reason: 'gone' });
  const rec = recordRecovery({ invoiceId: inv.id, amount: 3000, date: '2026-10-20', method: 'UPI' });
  assert.equal(rec.mode, 'same_fy');
});

test('F12: a clerk cannot remove a write-off row through the payment layer', () => {
  const inv = createViaStore({ date: '2026-10-01', lines: [{ qty: 1, rate: 10000, tax: 0 }], gstMode: 'NONE', status: 'Sent' });
  localDb.payments.record({ invoiceId: inv.id, amount: 1000, method: 'UPI', date: '2026-10-02' });
  writeOffBill(inv.id, { date: '2026-10-25', reason: 'gone' });
  const wo = localDb.payments.getAll().find((p) => p.write_off)!;
  const money = localDb.payments.getAll().find((p) => !p.write_off)!;
  asClerk();
  assert.throws(() => localDb.payments.remove(wo.id), /cannot/);
  assert.equal(reload(inv.id).status, 'Paid');
  // An ordinary receipt is still the clerk's to remove.
  localDb.payments.remove(money.id);
  assert.equal(localDb.payments.getAll().length, 1);
  setActorProvider(null);
  localDb.payments.remove(wo.id);
  assert.equal(reload(inv.id).status, 'Sent');
});

test('F13: Sales by customer keeps the billed value when a kasar FCN settles the bill, like the P&L', () => {
  const inv = createViaStore({ date: '2026-10-05', lines: [{ qty: 1, rate: 10000, tax: 18 }], status: 'Sent' });
  recordReceiptAndSettle({ invoiceId: inv.id, amount: inv.total - 500, method: 'UPI', date: '2026-10-10', settle: { reason: 'short_payment', amount: 500 } });
  const period = { start: '2026-10-01', end: '2026-10-31' } as never;
  const rep = salesByCustomer(salesDocs(localDb.invoices.getAll()).docs, period);
  assert.deepEqual(rep.rows.map((r) => [r.taxable, r.total, r.creditNotes]), [[10000, 11800, 0]]);
  const data = { invoices: localDb.invoices.getAll(), transactions: localDb.payments.getAll(), purchases: [], vendors: [], purchasePayments: [] } as unknown as BooksData;
  const pnl = profitAndLoss(data, period, 'accrual');
  assert.equal(pnl.income, 10000);
  assert.equal(rep.rows.reduce((s, r) => s + r.income, 0), pnl.income);
});

test('F20: one receipt keeps one of two overlapping promises', () => {
  const note = (id: string, date: string, by: string): CollectionNote => ({
    id, party_key: 'p', kind: 'call', outcome: '', date, created_at: `${date}T10:00:00.000Z`, promise: { amount: 5000, date: by },
  });
  const a = note('a', '2026-10-20', '2026-11-01');
  const b = note('b', '2026-10-22', '2026-11-05');
  const receipts: PartyReceipt[] = [{ party_key: 'p', date: '2026-10-31', amount: 5000 }];
  const alloc = promiseAllocation([a, b], receipts);
  assert.equal(alloc.get('a'), 5000);
  assert.equal(alloc.get('b'), 0);
  assert.equal(promiseProgress(a, receipts, '2026-11-02', alloc)?.state, 'kept');
  assert.equal(promiseProgress(b, receipts, '2026-11-02', alloc)?.state, 'open');
  assert.deepEqual(promiseCounts('p', [a, b], receipts, '2026-11-06'), { kept: 1, broken: 1 });
  assert.deepEqual([...openPromises([a, b], receipts, '2026-11-02').keys()], ['p'], 'the reminder hold stays for B');
  assert.deepEqual(promiseNotices([a, b], receipts, '2026-11-05').due.map((n) => n.id), ['b']);
  // Two receipts keep both.
  const two = [...receipts, { party_key: 'p', date: '2026-11-04', amount: 5000 }];
  assert.deepEqual(promiseCounts('p', [a, b], two, '2026-11-06'), { kept: 2, broken: 0 });
});

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
