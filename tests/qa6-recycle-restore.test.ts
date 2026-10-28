/**
 * QA round 6, package QA6-1:
 *  - F1: a recycle-bin restore (and the Undo toast, same path) asks the module that owns the row first — a gift-voucher
 *    receipt is re-checked against the voucher, module journals (settlement, RA deduction, breakage, Rule 42, deposit…)
 *    come back only while their module still counts them as posted, and an RA deduction receipt and its journal come
 *    back as a pair or not at all.
 *  - F11: a gift-voucher receipt cannot be removed once the voucher's unredeemed balance was recognised (breakage).
 *  - F17: restoring someone else's delete needs the owner's `data.erase`; an issued document needs the same right as
 *    deleting it.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { createViaStore, installSettings } from './helpers/world.ts';
import { fixture, importMtr, setupWorld } from './helpers/marketplace.ts';
import { setupWorks } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { setActorProvider, type Role } from '../src/lib/access.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { BIN_TABLE, RestoreError, planRestore, restoreEntries, restoreEntry } from '../src/lib/trust/recycle-bin.ts';
import { giftVouchersDb, redeemOnInvoice, voucherState } from '../src/lib/retail/gift-vouchers.ts';
import { importSettlement, parseSettlement } from '../src/lib/marketplace/settlement-import.ts';
import { clearingBalance, postSettlement, unpostSettlement } from '../src/lib/marketplace/settlement-post.ts';
import { channelById } from '../src/lib/marketplace/channels.ts';
import { deleteVoucher, loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { saveBoqTerms } from '../src/lib/works/boq.ts';
import { saveRaBill } from '../src/lib/works/measurements.ts';
import { recordDeductionRow, removeDeductionRow } from '../src/lib/works/ra-receivable.ts';
import { loadLedger } from '../src/lib/ledger/index.ts';
import { trialBalance } from '../src/lib/ledger/reports.ts';
import type { BinEntry } from '../src/types/trade-r4.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

const DAY = '2026-05-10';
const as = (role: Role | null, name = 'U') => setActorProvider(role ? () => ({ id: name, name, role }) : null);
const bin = () => getTable<BinEntry>(BIN_TABLE);
const gvState = (id: string) => voucherState(giftVouchersDb.get(id)!, getTable<Payment>('transactions'), DAY, getTable<InvoiceRecord>('invoices'));
const closing = (name: string) => trialBalance(loadLedger(), { start: '2026-04-01', end: '2027-03-31' }).rows.filter((r) => r.account.name === name).reduce((s, r) => s + r.closing, 0);

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

/* ── F1 A: gift voucher spent since the delete ───────────────────── */

test('F1: restoring a bill with its gift-voucher receipt is refused once the voucher was spent again (bin and Undo path)', () => {
  const [gv] = giftVouchersDb.sell({ count: 1, face_value: 1000, issued_on: DAY, method: 'Cash' }).vouchers;
  const a = createViaStore({ date: DAY, lines: [{ qty: 1, rate: 1000, tax: 0 }], status: 'Sent' });
  redeemOnInvoice({ invoiceId: a.id, code: gv.code, amount: 1000, date: DAY });
  localDb.invoices.remove(a.id);
  assert.equal(gvState(gv.id).balance, 1000, 'the delete gave the value back');
  const b = createViaStore({ date: DAY, lines: [{ qty: 1, rate: 1000, tax: 0 }], status: 'Sent' });
  redeemOnInvoice({ invoiceId: b.id, code: gv.code, amount: 1000, date: DAY });
  const entry = bin().find((e) => e.table === 'invoices' && e.row_id === a.id)!;
  const before = bin().length;
  assert.throws(() => restoreEntry(entry.id, { withChildren: true }), (e) => e instanceof RestoreError && /gift voucher/i.test(e.message));
  assert.throws(() => restoreEntries([entry.id], { withChildren: true }), (e) => e instanceof RestoreError, 'the Undo toast path refuses too');
  assert.equal(gvState(gv.id).redeemed, 1000, 'one bill paid by the voucher');
  assert.ok(!localDb.invoices.getById(a.id), 'nothing came back');
  assert.equal(bin().length, before, 'the bin is unchanged');
  // The bill alone may come back (unpaid): the receipt stays in the bin.
  restoreEntry(entry.id);
  assert.ok(localDb.invoices.getById(a.id));
  assert.equal(gvState(gv.id).redeemed, 1000);
});

test('F1: a gift-voucher receipt whose voucher still has the balance comes back with its bill', () => {
  const [gv] = giftVouchersDb.sell({ count: 1, face_value: 1000, issued_on: DAY, method: 'Cash' }).vouchers;
  const a = createViaStore({ date: DAY, lines: [{ qty: 1, rate: 600, tax: 0 }], status: 'Sent' });
  redeemOnInvoice({ invoiceId: a.id, code: gv.code, amount: 600, date: DAY });
  localDb.invoices.remove(a.id);
  const entry = bin().find((e) => e.table === 'invoices')!;
  restoreEntry(entry.id, { withChildren: true });
  assert.equal(gvState(gv.id).redeemed, 600);
  assert.equal(gvState(gv.id).balance, 400);
});

/* ── F1 B: marketplace settlement ────────────────────────────────── */

function postedSettlement() {
  const ch = setupWorld();
  importMtr(ch);
  const p = parseSettlement([{ name: 'v2', table: fixture('amazon-settlement-v2.csv') }], 'amazon_v2');
  const s = importSettlement(channelById(ch.id)!, p, 'v2.csv');
  const posted = postSettlement(s.id);
  return { ch: channelById(ch.id)!, s: posted };
}

test('F1: a settlement journal / contra / receipt unposted with its settlement is refused alone; a re-post leaves clearing at 0', () => {
  const { ch, s } = postedSettlement();
  unpostSettlement(s.id);
  const mine = bin().filter((e) => (e.table === 'vouchers' && (e.row as { voucher_class?: string }).voucher_class === 'Marketplace settlement') || (e.table === 'transactions' && (e.row as { method?: string }).method === 'Marketplace settlement'));
  assert.ok(mine.length >= 3);
  for (const e of mine) {
    assert.throws(() => restoreEntry(e.id), (err) => err instanceof RestoreError && err.refusal === 'module' && /settlement/i.test(err.message), `${e.table} refused`);
    assert.equal(planRestore(e, (t) => getTable(t), bin()).refusal, 'module', 'the panel shows the refusal before the click');
  }
  postSettlement(s.id);
  assert.equal(clearingBalance(ch.clearing_bank_id), 0);
});

test('F1: a settlement journal deleted on its own while the settlement is still posted can come back (it repairs the posting)', () => {
  const { ch, s } = postedSettlement();
  deleteVoucher(s.posted!.journal_id!);
  assert.notEqual(clearingBalance(ch.clearing_bank_id), 0);
  const e = bin().find((x) => x.table === 'vouchers' && x.row_id === s.posted!.journal_id)!;
  restoreEntry(e.id);
  assert.equal(clearingBalance(ch.clearing_bank_id), 0);
});

/* ── F1 C: RA deduction receipt + journal ────────────────────────── */

function raWithDeduction() {
  const boq = setupWorks();
  freezeDate('2026-07-25T10:00:00');
  saveBoqTerms(boq.id, { deductions: [{ kind: 'gst_tds' }], dlp_months: 12 } as never);
  const ra = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] }).invoice;
  const g = recordDeductionRow(ra.id, 'gst_tds', { date: '2026-07-20' });
  return { ra, g };
}

test('F1: an RA deduction receipt and its journal come back as a pair (either one restores both); clearing stays at 0', () => {
  for (const pick of ['transactions', 'vouchers'] as const) {
    resetStorage();
    installSettings();
    const { g } = raWithDeduction();
    removeDeductionRow(g.id);
    const e = bin().find((x) => x.table === pick)!;
    const done = restoreEntry(e.id);
    assert.deepEqual(done.map((x) => x.table).sort(), ['transactions', 'vouchers'], `restoring the ${pick} row brings both`);
    assert.equal(closing('RA deductions clearing'), 0, 'clearing nets to zero');
    assert.ok(getTable<Payment>('transactions').some((p) => p.id === g.id && p.ra_journal_id && loadVouchers().some((v) => v.id === p.ra_journal_id)));
    assert.equal(bin().length, 0);
  }
});

test('F1: an RA deduction receipt whose journal is gone for good is refused', () => {
  const { g } = raWithDeduction();
  removeDeductionRow(g.id);
  const journal = bin().find((x) => x.table === 'vouchers')!;
  setTable(BIN_TABLE, bin().filter((x) => x.id !== journal.id)); // the journal was deleted for good
  const e = bin().find((x) => x.table === 'transactions')!;
  assert.throws(() => restoreEntry(e.id), (err) => err instanceof RestoreError && err.refusal === 'module');
  assert.ok(!getTable<Payment>('transactions').some((p) => p.id === g.id));
});

/* ── F1: other module journals ───────────────────────────────────── */

test('F1: a breakage journal undone from Gift vouchers, a Rule 42 journal undone, a gift-voucher sale voucher are refused alone', async () => {
  const [gv] = giftVouchersDb.sell({ count: 1, face_value: 800, issued_on: DAY, expires_on: '2026-06-30', method: 'UPI' }).vouchers;
  const r = giftVouchersDb.recogniseBreakage('2026-07-15', '2026-07-15');
  const journalId = loadVouchers().find((v) => v.number === r.journal)!.id;
  giftVouchersDb.undoBreakage(journalId);
  const brk = bin().find((x) => x.row_id === journalId)!;
  assert.throws(() => restoreEntry(brk.id), (err) => err instanceof RestoreError && err.refusal === 'module' && /breakage/i.test(err.message));
  assert.ok(!giftVouchersDb.get(gv.id)!.breakage_voucher_id);

  const { postReversal, unpostReversal } = await import('../src/lib/institutions/common-credit.ts');
  const { A } = await import('../src/lib/ledger/accounts.ts');
  void A;
  const run = postReversal({ month: '2026-05', kind: 'monthly', heads: { igst: 100, cgst: 0, sgst: 0, cess: 0 } as never, figures: {}, date: DAY });
  unpostReversal(run.id);
  const cc = bin().find((x) => x.row_id === run.journal_id)!;
  assert.throws(() => restoreEntry(cc.id), (err) => err instanceof RestoreError && err.refusal === 'module' && /Rule 42/i.test(err.message));

  // A sale voucher deleted on its own while the voucher still names it is a stray delete: it may come back.
  const sale = giftVouchersDb.get(gv.id)!.sale_voucher_id!;
  deleteVoucher(sale);
  const se = bin().find((x) => x.row_id === sale)!;
  restoreEntry(se.id);
  assert.ok(loadVouchers().some((v) => v.id === sale));
});

/* ── F11 ─────────────────────────────────────────────────────────── */

test('F11: a gift-voucher receipt cannot be removed after breakage was recognised (nor its bill deleted); undo the breakage first', () => {
  const [gv] = giftVouchersDb.sell({ count: 1, face_value: 1000, issued_on: DAY, expires_on: '2026-06-30', method: 'Cash' }).vouchers;
  const a = createViaStore({ date: DAY, lines: [{ qty: 1, rate: 400, tax: 0 }], status: 'Sent' });
  const { payment } = redeemOnInvoice({ invoiceId: a.id, code: gv.code, amount: 400, date: DAY });
  const r = giftVouchersDb.recogniseBreakage('2026-07-15', '2026-07-15');
  assert.throws(() => localDb.payments.remove(payment.id), /breakage/i);
  assert.throws(() => localDb.invoices.remove(a.id), /breakage/i);
  assert.ok(getTable<Payment>('transactions').some((p) => p.id === payment.id), 'the receipt is still there');
  giftVouchersDb.undoBreakage(loadVouchers().find((v) => v.number === r.journal)!.id);
  localDb.payments.remove(payment.id);
  assert.ok(!getTable<Payment>('transactions').some((p) => p.id === payment.id));
});

/* ── F17 ─────────────────────────────────────────────────────────── */

test('F17: a clerk cannot restore an issued invoice the owner deleted; a clerk restores their own deleted draft', () => {
  const inv = createViaStore({ date: DAY, lines: [{ qty: 1, rate: 500, tax: 0 }], status: 'Sent' });
  localDb.invoices.remove(inv.id);
  const e = bin().find((x) => x.table === 'invoices')!;
  as('clerk', 'Clerk');
  assert.throws(() => restoreEntry(e.id), /Clerk/);
  assert.throws(() => restoreEntries([e.id]), /Clerk/);
  assert.ok(!localDb.invoices.getById(inv.id));
  // Their own draft: fine.
  const draft = createViaStore({ date: DAY, lines: [{ qty: 1, rate: 100, tax: 0 }], asDraft: true });
  localDb.invoices.remove(draft.id);
  const mine = bin().find((x) => x.row_id === draft.id)!;
  assert.equal(mine.deleted_by, 'Clerk');
  restoreEntry(mine.id);
  assert.ok(localDb.invoices.getById(draft.id));
  as(null);
  restoreEntry(e.id);
  assert.ok(localDb.invoices.getById(inv.id), 'the owner can');
});
