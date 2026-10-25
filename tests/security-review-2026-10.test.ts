/**
 * Regression tests for the SECURITY / DATA-INTEGRITY review (2026-10, H1–L5). One block per finding;
 * H1 lives in `tally-import.test.ts` / `closing-stock-yearend.test.ts` next to its neighbours.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, createViaStore, clientMH, reload } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { SINGLETON_KEYS, getTable, setJson, setTable } from '../src/lib/storage.ts';
import { A, buildLedger, loadLedgerInput, loadVouchers, saveVoucher, deleteVoucher, saveBooksBegin, saveOpenings, loadOpenings, storedBooksBegin } from '../src/lib/ledger/index.ts';
import { loadClosingStockConfig, saveClosingStockConfig } from '../src/lib/ledger/closing-stock.ts';
import { saveOpeningBillsFor } from '../src/lib/opening-bills.ts';
import { audit } from '../src/lib/audit.ts';
import { loadCheques, saveCheque, transitionCheque } from '../src/lib/cheques.ts';
import { touchesLock } from '../src/lib/sync-engine.ts';
import { recordSeries } from '../src/lib/series-counters.ts';
import { nextNoteNumber } from '../src/lib/purchase-returns.ts';
import { nextReceiptNumber as nextGrnNumber, receiptNotesDb } from '../src/lib/receipt-notes.ts';
import { nextSlipNumber } from '../src/lib/deposit-slip.ts';
import { buildPosRecord, savePosBill } from '../src/lib/pos.ts';
import { EXCHANGE_NOTE, applyExchange, openExchange, posReturnsDb, savePosReturn } from '../src/lib/pos-returns.ts';
import * as BA from '../src/lib/bill-allocation.ts';
import { approveDocument, saveApprovalPolicy } from '../src/lib/approvals.ts';

beforeEach(() => { resetStorage(); installSettings(); });
afterEach(() => setActorProvider(null));

const lockUntil = (d: string) => setJson(SINGLETON_KEYS.settings, { ...localDb.settings.get(), lock_until: d });
const receipt = (amount: number, date = '2026-06-20') => ({
  type: 'RECEIPT' as const,
  date,
  narration: 'Received',
  lines: [
    { account_id: A.bank, dr: amount * 100, cr: 0 },
    { account_id: A.debtors, dr: 0, cr: amount * 100, party: clientMH.name },
  ],
});

/* ── H2. Bill allocation on a receipt voucher is all-or-nothing ───────────── */

function twoBills() {
  const old = createViaStore({ date: '2026-04-10', lines: [{ qty: 1, rate: 1000, tax: 0 }] });
  const open = createViaStore({ date: '2026-06-10', lines: [{ qty: 1, rate: 1000, tax: 0 }] });
  lockUntil('2026-04-30');
  return { old, open };
}

test('H2: a locked bill half-way through the allocations leaves no receipt row behind (reviewer repro)', () => {
  const { old, open } = twoBills();
  const v = saveVoucher(receipt(2000));
  const allocs = [{ bill_id: open.id, ref: open.invoice_number, amount: 1000 }, { bill_id: old.id, ref: old.invoice_number, amount: 1000 }];
  assert.throws(() => BA.syncVoucherReceipts(v, clientMH.name, 2000, allocs, 'Bank Transfer'), /lock/i);
  assert.equal(getTable('transactions').length, 0, 'no untagged receipt that the ledger would post a second time');
  assert.equal(reload(open.id).amount_paid ?? 0, 0);
});

test('H2: saving a receipt voucher with allocations rolls the voucher back when an allocation is refused', () => {
  const { old, open } = twoBills();
  const allocs = [{ bill_id: open.id, ref: open.invoice_number, amount: 1000 }, { bill_id: old.id, ref: old.invoice_number, amount: 1000 }];
  assert.throws(() => BA.saveReceiptVoucher(receipt(2000), undefined, { party: clientMH.name, total: 2000, allocations: allocs, method: 'Bank Transfer' }), /lock/i);
  assert.equal(loadVouchers().length, 0, 'voucher not kept');
  assert.equal(getTable('transactions').length, 0);
  // Happy path: voucher + tagged rows, posted once.
  const saved = BA.saveReceiptVoucher(receipt(1500), undefined, { party: clientMH.name, total: 1500, allocations: [allocs[0]], method: 'Bank Transfer' });
  const rows = BA.voucherReceipts(saved.id);
  assert.deepEqual(rows.map((r) => [r.invoice_id ? 'agst' : 'onacc', r.amount]), [['agst', 1000], ['onacc', 500]]);
  assert.equal(reload(open.id).status, 'Paid');
  const ledger = buildLedger(loadLedgerInput());
  assert.equal(ledger.vouchers.filter((x) => x.kind === 'Receipt').length, 1, 'tagged rows never post again');
});

/* ── M3. Deleting / editing a receipt voucher carries its bill-wise rows ──── */

test('M3: deleteVoucher removes the voucher’s bill-wise receipt rows (any screen)', () => {
  const inv = createViaStore({ date: '2026-06-10', lines: [{ qty: 1, rate: 1000, tax: 0 }] });
  const v = BA.saveReceiptVoucher(receipt(1000), undefined, { party: clientMH.name, total: 1000, allocations: [{ bill_id: inv.id, ref: inv.invoice_number, amount: 1000 }], method: 'Bank Transfer' });
  assert.equal(reload(inv.id).status, 'Paid');
  deleteVoucher(v.id);
  assert.equal(BA.voucherReceipts(v.id).length, 0);
  assert.notEqual(reload(inv.id).status, 'Paid');
});

test('M3: saveVoucher refuses an edit that would leave its bill-wise rows out of step; harmless edits pass', () => {
  const inv = createViaStore({ date: '2026-06-10', lines: [{ qty: 1, rate: 1000, tax: 0 }] });
  const v = BA.saveReceiptVoucher(receipt(1000), undefined, { party: clientMH.name, total: 1000, allocations: [{ bill_id: inv.id, ref: inv.invoice_number, amount: 1000 }], method: 'Bank Transfer' });
  assert.throws(() => saveVoucher({ ...receipt(1200), id: v.id }), /bill-wise/i);
  assert.throws(() => saveVoucher({ ...receipt(1000, '2026-06-25'), id: v.id }), /bill-wise/i);
  const n = saveVoucher({ ...receipt(1000), id: v.id, narration: 'Received by NEFT', number: 'RV-9' });
  assert.equal(n.narration, 'Received by NEFT');
  assert.ok(BA.voucherReceipts(v.id).every((r) => r.reference === 'RV-9'), 'receipt rows follow the new number');
  // Re-doing the allocations through the editor path works (rows replaced, voucher re-dated).
  BA.saveReceiptVoucher({ ...receipt(1000, '2026-06-25'), id: v.id }, undefined, { party: clientMH.name, total: 1000, allocations: [{ bill_id: inv.id, ref: inv.invoice_number, amount: 1000 }], method: 'Bank Transfer' });
  assert.ok(BA.voucherReceipts(v.id).every((r) => r.date === '2026-06-25'));
});

/* ── H3. Maker-checker cannot be bypassed after issue / approval ──────────── */

const as = (role: 'owner' | 'clerk', name: string = role) => setActorProvider(() => ({ id: name, name, role }));
function gated() {
  as('owner', 'Rohit');
  saveApprovalPolicy({ enabled: true, mode: 'above', threshold: 10000 });
  as('clerk', 'Asha');
}

test('H3: a clerk cannot raise an issued document above the approval limit (reviewer repro)', () => {
  gated();
  const small = createViaStore({ date: '2026-06-10', lines: [{ qty: 1, rate: 5000, tax: 0 }] });
  assert.equal(small.status, 'Sent');
  const raised = { ...reload(small.id), items: reload(small.id).items.map((i) => ({ ...i, rate: 50000, amount: 50000 })), subtotal: 50000, taxable_value: 50000, total: 50000, balance_due: 50000 };
  assert.throws(() => localDb.invoices.save(raised), /approval/i);
  assert.equal(reload(small.id).total, 5000);
  // A value change that stays under the limit, or a non-money edit, is fine.
  localDb.invoices.save({ ...reload(small.id), notes: 'thanks' });
  as('owner');
  assert.equal(localDb.invoices.save(raised).total, 50000, 'the owner may');
});

test('H3: an approved document raised and re-issued by the clerk needs approval again', () => {
  gated();
  const big = createViaStore({ date: '2026-06-10', lines: [{ qty: 1, rate: 25000, tax: 0 }] });
  assert.equal(big.approval?.state, 'pending');
  as('owner');
  approveDocument(big.id);
  assert.equal(reload(big.id).approval?.approved_value, 25000);
  as('clerk', 'Asha');
  // Back to draft, raise, issue again.
  localDb.invoices.setStatus(big.id, 'Draft');
  const draft = reload(big.id);
  const raised = { ...draft, items: draft.items.map((i) => ({ ...i, rate: 90000, amount: 90000 })), subtotal: 90000, taxable_value: 90000, total: 90000, balance_due: 90000, status: 'Sent' as const };
  const saved = localDb.invoices.save(raised);
  assert.equal(saved.status, 'Draft');
  assert.equal(saved.approval?.state, 'pending');
  // Re-issuing the approved value unchanged needs nothing.
  as('owner');
  approveDocument(big.id);
  as('clerk', 'Asha');
  localDb.invoices.setStatus(big.id, 'Draft');
  assert.equal(localDb.invoices.save({ ...reload(big.id), status: 'Sent' }).status, 'Sent');
});

test('H3: setStatus cannot issue a pending or above-limit draft; payments refuse a pending document', () => {
  gated();
  const big = createViaStore({ date: '2026-06-10', lines: [{ qty: 1, rate: 25000, tax: 0 }] });
  assert.equal(big.approval?.state, 'pending');
  assert.throws(() => localDb.invoices.setStatus(big.id, 'Sent'), /approval/i);
  assert.throws(() => localDb.invoices.setStatus(big.id, 'Paid'), /approval/i);
  assert.equal(reload(big.id).status, 'Draft');
  assert.throws(() => localDb.payments.record({ invoiceId: big.id, amount: 100, method: 'Cash' }), /approval/i);
  assert.equal(localDb.payments.listFor(big.id).length, 0);
  // A plain draft above the limit, issued through setStatus, is held like a save would hold it.
  const plain = createViaStore({ date: '2026-06-11', lines: [{ qty: 1, rate: 30000, tax: 0 }], asDraft: true });
  assert.equal(plain.approval, undefined);
  localDb.invoices.setStatus(plain.id, 'Sent');
  assert.equal(reload(plain.id).status, 'Draft');
  assert.equal(reload(plain.id).approval?.state, 'pending');
});

/* ── L5. Only the owner's decision writes the approvals log ───────────────── */

test('L5: a clerk cannot write the approvals decision log directly', () => {
  as('clerk', 'Asha');
  assert.throws(() => setTable('approvals', [{ id: 'x', doc_id: 'd', decision: 'approved' }]), /not allowed|access|permission/i);
  assert.equal(getTable('approvals').length, 0);
});

/* ── M1. Closing-stock settings: role, period lock, audit ─────────────────── */

test('M1: closing-stock settings need books.edit, respect the lock and are audited', () => {
  as('clerk', 'Asha');
  saveClosingStockConfig({ mode: 'manual', opening: 100000, entries: [{ date: '2026-03-31', value: 200000 }] });
  setActorProvider(() => ({ id: 'v', name: 'Vik', role: 'viewer' }));
  assert.throws(() => saveClosingStockConfig({ mode: 'none' }), /not allowed|access|permission/i);
  setActorProvider(null);
  assert.ok(audit.all().some((r) => r.entity_id === 'closing_stock' && /Closing stock changed/.test(r.summary)));
  lockUntil('2026-03-31');
  assert.throws(() => saveClosingStockConfig({ mode: 'manual', opening: 100000, entries: [{ date: '2026-03-31', value: 250000 }] }), /lock/i, 'figure on a locked day');
  assert.throws(() => saveClosingStockConfig({ mode: 'manual', opening: 100000, entries: [] }), /lock/i, 'removing a locked figure');
  assert.throws(() => saveClosingStockConfig({ mode: 'manual', opening: 150000, entries: [{ date: '2026-03-31', value: 200000 }] }), /lock/i, 'opening while a period is locked');
  assert.throws(() => saveClosingStockConfig({ mode: 'none', opening: 100000, entries: [{ date: '2026-03-31', value: 200000 }] }), /lock/i, 'mode while a period is locked');
  const ok = saveClosingStockConfig({ mode: 'manual', opening: 100000, entries: [{ date: '2026-03-31', value: 200000 }, { date: '2026-09-30', value: 300000 }] });
  assert.equal(ok.entries?.length, 2, 'an open day is fine');
  assert.deepEqual(loadClosingStockConfig().entries?.map((e) => e.date), ['2026-03-31', '2026-09-30']);
});

/* ── M2. Openings follow the lock of the opening day ──────────────────────── */

test('M2: openings, opening bills and the books-beginning date respect the period lock', () => {
  saveBooksBegin('2026-04-01');
  saveOpenings([{ ledger_id: A.bank, amount: 100_00 }]);
  lockUntil('2026-03-31');
  assert.throws(() => saveOpenings([{ ledger_id: A.bank, amount: 200_00 }]), /lock/i);
  assert.equal(loadOpenings()[0].dr, 100_00);
  assert.throws(() => saveOpeningBillsFor({ id: clientMH.id!, name: clientMH.name, side: 'receivable' }, [{ ref_no: 'OLD/1', date: '2026-02-01', amount: 100, dr_cr: 'Dr' }]), /lock/i);
  assert.throws(() => saveBooksBegin('2026-10-01'), /lock/i, 'moving the opening out of a locked day');
  assert.equal(storedBooksBegin(), '2026-04-01');
  lockUntil('2025-12-31');
  assert.throws(() => { saveBooksBegin('2025-10-01'); }, /lock/i, 'moving it into a locked day');
  saveBooksBegin('2026-10-01');
  saveOpenings([{ ledger_id: A.bank, amount: 300_00 }]);
  assert.equal(loadOpenings()[0].dr, 300_00);
});

/* ── M4. Bouncing a cheque with several allocations is all-or-nothing ─────── */

test('M4: a bounce refused on the second allocation reverses neither payment (reviewer repro)', () => {
  const open = createViaStore({ date: '2026-10-05', lines: [{ qty: 1, rate: 1000, tax: 0 }] });
  const old = createViaStore({ date: '2026-09-05', lines: [{ qty: 1, rate: 1000, tax: 0 }] });
  const c = saveCheque({
    direction: 'received', number: '000777', bank: 'HDFC Bank', cheque_date: '2026-10-10', amount: 2000, party_name: clientMH.name,
    allocations: [{ invoice_id: open.id, amount: 1000 }, { invoice_id: old.id, amount: 1000 }],
  } as never);
  transitionCheque(c.id, 'cleared', { date: '2026-10-12', today: '2026-10-25' });
  assert.equal(getTable('transactions').length, 2);
  lockUntil('2026-09-30');
  assert.throws(() => transitionCheque(c.id, 'bounced', { date: '2026-10-20', today: '2026-10-25' }), /lock/i);
  assert.equal(getTable('transactions').length, 2, 'the open invoice’s payment is not reversed alone');
  assert.equal(reload(open.id).status, 'Paid');
  assert.equal(loadCheques()[0].status, 'cleared');
});

/* ── M5. Folder sync knows the dates of every ledger-affecting table ──────── */

test('M5: a synced change inside the locked period is caught for the newer ledger tables', () => {
  const P = 'mrchartist_inv_';
  const lock = '2026-03-31';
  const rows: [string, Record<string, string>][] = [
    ['purchase_returns', { date: '2026-03-10' }],
    ['receipt_notes', { date: '2026-03-10' }],
    ['vendor_payments', { date: '2026-03-10' }],
    ['tds_challans', { date: '2026-03-10' }],
    ['gst_setoffs', { date: '2026-03-10' }],
    ['gst_challans', { generated_on: '2026-03-10' }],
    ['payroll_runs', { date: '2026-03-10' }],
    ['payroll_payments', { date: '2026-03-10' }],
    ['deposit_slips', { date: '2026-03-10' }],
    ['pos_returns', { day: '2026-03-10' }],
    ['cheques', { cheque_date: '2026-03-01', cleared_on: '2026-03-10' }],
  ];
  for (const [table, row] of rows) {
    assert.equal(touchesLock(lock, P + table, undefined, row), true, table);
    const moved = Object.fromEntries(Object.entries(row).map(([k]) => [k, '2026-05-01']));
    assert.equal(touchesLock(lock, P + table, undefined, moved), false, `${table} open`);
  }
  assert.equal(touchesLock(lock, `${P}books_begin`, undefined, { id: 'books_begin', date: '2026-04-01' }), true, 'opening day 31 Mar');
  assert.equal(touchesLock(lock, `${P}books_begin`, undefined, { id: 'books_begin', date: '2026-04-02' }), false);
  saveBooksBegin('2026-04-01');
  assert.equal(touchesLock(lock, `${P}ledger_openings`, undefined, { id: 'o', ledger_id: 'bank', dr: 1, cr: 0 }), true, 'openings post on 31 Mar');
  assert.equal(touchesLock(lock, `${P}opening_bills`, undefined, { id: 'b', date: '2025-01-01' }), true);
  assert.equal(touchesLock('2026-03-30', `${P}ledger_openings`, undefined, { id: 'o', ledger_id: 'bank', dr: 1, cr: 0 }), false);
});

/* ── L1. Debit notes, GRNs and pay-in slips never hand a deleted number out again ── */

test('L1: deleting the latest DN / GRN / RJO / PIS does not free its number', () => {
  recordSeries('DN/FY26-27/0005');
  recordSeries('GRN/FY26-27/0003');
  recordSeries('RJO/FY26-27/0002');
  recordSeries('PIS/FY26-27/0009');
  assert.equal(nextNoteNumber([], '2026-06-01'), 'DN/FY26-27/0006', 'a deleted DN/0005 is not reused');
  assert.equal(nextNoteNumber(['DN/FY26-27/0007'], '2026-06-01'), 'DN/FY26-27/0008');
  assert.equal(nextGrnNumber([], 'GRN', '2026-06-01'), 'GRN/FY26-27/0004');
  assert.equal(nextGrnNumber([], 'REJECTION_OUT', '2026-06-01'), 'RJO/FY26-27/0003');
  assert.equal(nextSlipNumber([], '2026-06-01'), 'PIS/FY26-27/0010');
  assert.equal(nextNoteNumber([], '2027-04-01'), 'DN/FY27-28/0001', 'each FY starts again');
});

test('L1: saving a GRN records its number as issued', () => {
  const note = receiptNotesDb.save({ kind: 'GRN', date: '2026-06-01', vendor_name: 'V', lines: [{ id: 'l1', name: 'Bolt', quantity: 5, rate: 1 }] } as never, []);
  assert.equal(note.number, 'GRN/FY26-27/0001');
  receiptNotesDb.remove(note.id, []);
  assert.equal(receiptNotesDb.nextNumber('GRN', '2026-06-02'), 'GRN/FY26-27/0002');
});

/* ── L4. Using an exchange credit is all-or-nothing; the voucher names the returning customer ── */

test('L4: a failed exchange voucher leaves no exchange payment behind; the voucher debits the returned bill’s party', () => {
  const DAY = '2026-05-10';
  const posLine = (id: string, name: string, rate: number) => ({ id, name, type: 'Product' as const, hsn: '3401', unit: 'PCS', quantity: 1, rate, tax_rate: 18, discount_percent: 0, amount: rate });
  const bill = (party: { name?: string }, items: ReturnType<typeof posLine>[], tenders: { method: 'Cash'; amount: number }[], exchangeReturnId?: string) => {
    const record = buildPosRecord({ items, party, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), templateId: 'classic_orange', day: DAY });
    return savePosBill({ record, tenders, ...(exchangeReturnId ? { exchangeReturnId } : {}) });
  };
  const first = bill({ name: 'Asha' }, [posLine('a', 'Shirt', 500)], [{ method: 'Cash', amount: 590 }]);
  assert.ok(first.ok, first.errors.join('; '));
  const ret = savePosReturn({ bill: first.record!, lines: [{ itemId: 'a', quantity: 1 }], settlement: 'exchange' });
  assert.ok(ret.ok, ret.errors.join('; '));

  const ls = globalThis.localStorage;
  const realSet = ls.setItem.bind(ls);
  ls.setItem = (k: string, v: string) => {
    if (k.endsWith('_vouchers')) throw new DOMException('full', 'QuotaExceededError');
    realSet(k, v);
  };
  let second;
  try {
    second = bill({}, [posLine('b', 'Shirt XL', 600)], [{ method: 'Cash', amount: 118 }], ret.row!.id);
  } finally {
    ls.setItem = realSet;
  }
  assert.equal(second.ok, false);
  assert.equal(localDb.payments.getAll().filter((p) => (p.note ?? '').startsWith(EXCHANGE_NOTE)).length, 0, 'no exchange payment without its voucher');
  assert.ok(openExchange(ret.row!.id), 'the credit is still open for a retry');

  const x = applyExchange(ret.row!.id, localDb.invoices.getById(second.record!.id)!);
  assert.equal(x.used, 590);
  const v = loadVouchers().find((o) => o.id === posReturnsDb.all()[0].voucher_id)!;
  assert.equal(v.lines.find((l) => l.account_id === 'debtors')?.party, 'Asha', 'the customer who returned the goods');
});
