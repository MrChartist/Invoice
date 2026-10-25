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
import { getTable, setTable } from '../src/lib/storage.ts';
import { A, buildLedger, loadLedgerInput, loadVouchers, saveVoucher, deleteVoucher } from '../src/lib/ledger/index.ts';
import * as BA from '../src/lib/bill-allocation.ts';
import { approveDocument, saveApprovalPolicy } from '../src/lib/approvals.ts';

beforeEach(() => { resetStorage(); installSettings(); });
afterEach(() => setActorProvider(null));

const lockUntil = (d: string) => localDb.settings.save({ ...localDb.settings.get(), lock_until: d });
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
