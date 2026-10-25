/**
 * Review findings 2026-10 (books / GST): M2 (Sec 25(4) transfer pair), M3 (e-payment confirmation),
 * L2 (rcm_documents in sync), L3 (refund trail), L4 (ISD renumbering), L5 (closing-stock journals),
 * L6 (deposit slip all-or-nothing), L7 (TRACES import normalising).
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, gstin, SELLER } from './helpers/world.ts';
import { setActorProvider, type Role } from '../src/lib/access.ts';
import { branchesDb, UNASSIGNED, type Branch } from '../src/lib/branch.ts';
import { localDb } from '../src/lib/localDb.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { godownsDb, transfersDb } from '../src/lib/godowns.ts';
import { raiseTransferPair } from '../src/lib/branch-transfer.ts';
import { APPROVAL_POLICY_KEY } from '../src/lib/approval-gate.ts';
import { getTable, setJson, setTable, SINGLETON_KEYS, DB_PREFIX } from '../src/lib/storage.ts';
import { loadEpayBatches, matchResponse, parseBankResponse, recordConfirmed, saveEpayBatch } from '../src/lib/epay-confirm.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { vendorPaymentsDb } from '../src/lib/billwise.ts';
import { docNumberKey, touchesLock } from '../src/lib/sync-engine.ts';
import { advanceRefund, loadRefunds, saveRefund } from '../src/lib/gst-cash-refunds.ts';
import { loadIsdDocs, saveIsdDoc } from '../src/lib/isd.ts';
import { A, loadStockValuer, saveBooksBegin, saveUserAccount, saveVoucher } from '../src/lib/ledger/index.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { CLOSING_STOCK_CLASS, inventoryValuer, saveClosingStockConfig, stockJournalPostings } from '../src/lib/ledger/closing-stock.ts';
import { branchStockValuer } from '../src/lib/ledger/branch-stock.ts';
import { collectEvents, computeStock, type StockInputs, type StockItem } from '../src/lib/inventory.ts';
import { loadCheques, saveCheque } from '../src/lib/cheques.ts';
import { loadDepositSlips, saveDepositSlip } from '../src/lib/deposit-slip.ts';
import { normalizeImports } from '../src/lib/traces-justification.ts';
import type { Godown, StockTransfer } from '../src/types/stock.ts';

const as = (role: Role | null) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role }) : null);
beforeEach(() => {
  as(null);
  resetStorage();
  installSettings();
});
afterEach(() => as(null));

/* ── M2 ─────────────────────────────────────────────────────────── */

function transferWorld() {
  const gMh = godownsDb.save({ name: 'Bhiwandi' });
  const gKa = godownsDb.save({ name: 'Hosur' });
  const mh: Branch = branchesDb.save({ name: 'Mumbai HO', profile_id: SELLER.id, gstin: SELLER.companyGstin, godown_id: gMh.id });
  const ka: Branch = branchesDb.save({ name: 'Bengaluru', gstin: gstin('29AABCU9603R1Z'), godown_id: gKa.id });
  const t = transfersDb.save({ date: '2026-08-01', from_godown: gMh.id, to_godown: gKa.id, lines: [{ id: 'tl1', item_id: 'it1', qty: 10 }] });
  return { mh, ka, t };
}

test('M2: a clerk whose invoice approvals would hold is refused, and nothing is saved', () => {
  const { t } = transferWorld();
  setJson(APPROVAL_POLICY_KEY, { enabled: true, mode: 'all', threshold: 0 });
  as('clerk');
  assert.throws(() => raiseTransferPair(t, { tl1: 100 }), /owner/);
  as(null);
  assert.equal(localDb.invoices.getAll().filter((i) => i.branch_transfer_id === t.id).length, 0, 'no draft invoice left behind');
  assert.equal(purchasesDb.all().length, 0);
});

test('M2: if the bill cannot be saved the invoice is rolled back', () => {
  const { t } = transferWorld();
  const real = purchasesDb.save;
  purchasesDb.save = () => {
    throw new Error('refused');
  };
  try {
    assert.throws(() => raiseTransferPair(t, { tl1: 100 }), /refused/);
  } finally {
    purchasesDb.save = real;
  }
  assert.equal(localDb.invoices.getAll().length, 0);
});

test('M2: a live bill counts as "already raised" even after its invoice is cancelled', () => {
  const { t } = transferWorld();
  const { invoice } = raiseTransferPair(t, { tl1: 100 });
  setTable('invoices', getTable<Record<string, unknown>>('invoices').map((i) => (i.id === invoice.id ? { ...i, status: 'Cancelled' } : i)));
  assert.throws(() => raiseTransferPair(t, { tl1: 100 }), /already raised/);
  assert.equal(purchasesDb.all().filter((b) => b.branch_transfer_id === t.id).length, 1);
});

test('M2: a stock transfer with a live pair cannot be edited or deleted', () => {
  const { t } = transferWorld();
  raiseTransferPair(t, { tl1: 100 });
  assert.throws(() => transfersDb.save({ ...t, lines: [{ id: 'tl1', item_id: 'it1', qty: 12 }] }), /Sec 25\(4\)/);
  assert.throws(() => transfersDb.remove(t.id), /Sec 25\(4\)/);
  assert.ok(transfersDb.get(t.id));
});

/* ── M3 ─────────────────────────────────────────────────────────── */

test('M3: credit / negative rows of a bank file are not payments', () => {
  const rows = parseBankResponse('Ref,Amount,Dr/Cr,Status\nA,1500,DR,Success\nB,1500,CR,Success\n');
  assert.deepEqual(rows.map((r) => r.reference), ['A']);
  assert.equal(parseBankResponse('Ref,Amount\nX,-700\nY,(800)\nZ,900 Cr\nW,1000\n').map((r) => r.reference).join(), 'W');
  assert.equal(parseBankResponse('Narration,Amount,Type\nrefund,500,Credit\npaid,600,Debit\n').length, 1);
});

test('M3: an amount-only match is recorded only once the user confirms it', () => {
  const v = vendorsDb.save({ name: 'Vendor A' } as never);
  const batch = saveEpayBatch({ date: '2026-06-10', preset: 'generic', rows: [{ vendorId: v.id, vendorName: v.name, amount: 700, mode: 'NEFT', reference: 'Advance A' }] });
  const m = matchResponse(batch, parseBankResponse('Reference,Amount,Status\nsomething else,700,Paid\n'));
  assert.equal(m.matches[0].how, 'amount');
  assert.throws(() => recordConfirmed(batch.id, m.matches), /Nothing confirmed/);
  assert.equal(vendorPaymentsDb.all().length, 0);
  assert.equal(loadEpayBatches()[0].rows[0].status, 'sent');
  const res = recordConfirmed(batch.id, m.matches, [batch.rows[0].id]);
  assert.equal(res.paid, 1);
  assert.equal(vendorPaymentsDb.all().length, 1);
});

/* ── L2 ─────────────────────────────────────────────────────────── */

test('L2: RCM documents are period-locked in sync and their two series never collide', () => {
  const key = `${DB_PREFIX}rcm_documents`;
  assert.equal(touchesLock('2026-06-30', key, null, { id: 'r', kind: 'SELF_INVOICE', date: '2026-06-01', number: 'RCM/FY26-27/0001' }), true);
  assert.equal(touchesLock('2026-06-30', key, null, { id: 'r', kind: 'SELF_INVOICE', date: '2026-07-01' }), false);
  const a = docNumberKey(key, { kind: 'SELF_INVOICE', number: 'X/0001' });
  const b = docNumberKey(key, { kind: 'PAYMENT_VOUCHER', number: 'X/0001' });
  assert.ok(a && b && a !== b, 'scoped by kind');
  assert.equal(docNumberKey(key, { kind: 'SELF_INVOICE', number: 'x/0001' }), a, 'same series, same number → same key');
});

/* ── L3 ─────────────────────────────────────────────────────────── */

test('L3: refund trail transitions are checked; leaving PAID removes the receipt voucher', () => {
  const claim = saveRefund({ category: 'EXCESS_CASH', period_from: '2026-04-01', period_to: '2026-06-30', relevant_date: '2026-06-30', filed_on: '2026-07-02', arn: 'AA2707260000123', claimed: { igst: 2000, cgst: 0, sgst: 0, cess: 0 } });
  advanceRefund(claim.id, { status: 'SANCTIONED', date: '2026-08-01', sanctioned: { igst: 2000 } });
  const paid = advanceRefund(claim.id, { status: 'PAID', date: '2026-08-20', bankLedgerId: A.bank });
  assert.ok(loadVouchers().some((v) => v.id === paid.voucher_id));
  const back = advanceRefund(claim.id, { status: 'SANCTIONED', date: '2026-08-25', sanctioned: { igst: 2000 } });
  assert.equal(back.voucher_id, undefined);
  assert.equal(back.paid_on, undefined);
  assert.ok(!loadVouchers().some((v) => v.id === paid.voucher_id), 'the receipt is gone');

  const other = saveRefund({ category: 'EXCESS_CASH', period_from: '2026-04-01', period_to: '2026-06-30', relevant_date: '2026-06-30', filed_on: '2026-07-03', arn: 'AA2707260000999', claimed: { igst: 100, cgst: 0, sgst: 0, cess: 0 } });
  advanceRefund(other.id, { status: 'REJECTED', date: '2026-08-01' });
  assert.throws(() => advanceRefund(other.id, { status: 'PAID', date: '2026-08-05', bankLedgerId: A.bank }), /rejected/);
  assert.throws(() => advanceRefund(claim.id, { status: 'FILED', date: '2026-08-26' }), /cannot be marked/);
  assert.equal(loadRefunds().find((r) => r.id === other.id)?.status, 'REJECTED');
});

/* ── L4 ─────────────────────────────────────────────────────────── */

test('L4: an ISD distribution moved into another FY takes that FY’s number', () => {
  const ISD = gstin('27AABCU9603R2Z');
  const UNIT = gstin('29AABCU9603R1Z');
  const d = saveIsdDoc({ kind: 'DISTRIBUTION', number: '', date: '2026-03-20', isd_gstin: ISD, party_gstin: UNIT, party_name: 'Unit', igst: 100, cgst: 0, sgst: 0, cess: 0, eligible: true });
  assert.match(d.number, /FY25-26/);
  const e = saveIsdDoc({ id: d.id, kind: 'DISTRIBUTION', number: '', date: '2026-04-05', isd_gstin: ISD, party_gstin: UNIT, party_name: 'Unit', igst: 100, cgst: 0, sgst: 0, cess: 0, eligible: true });
  assert.match(e.number, /FY26-27/);
  const f = saveIsdDoc({ id: d.id, kind: 'DISTRIBUTION', number: '', date: '2026-04-09', isd_gstin: ISD, party_gstin: UNIT, party_name: 'Unit', igst: 120, cgst: 0, sgst: 0, cess: 0, eligible: true });
  assert.equal(f.number, e.number, 'same FY keeps the number');
  assert.equal(loadIsdDocs().length, 1);
});

/* ── L5 ─────────────────────────────────────────────────────────── */

test('L5: only the year-end wizard class is netted; user Inventories ledgers count; branch-tagged journals net off that branch', () => {
  const mk = (extra: Record<string, unknown>) => ({
    id: String(Math.random()), type: 'JOURNAL' as const, number: 'J', date: '2026-03-31', narration: '', created_at: '',
    lines: [{ account_id: 'stock', dr: 500, cr: 0 }, { account_id: 'purchases', dr: 0, cr: 500 }], ...extra,
  });
  assert.equal(stockJournalPostings([mk({ narration: 'Closing stock adjustment' })], '2026-10-01').length, 0, 'a narration alone is not the wizard journal');
  assert.equal(stockJournalPostings([mk({ voucher_class: CLOSING_STOCK_CLASS })], '2026-10-01').length, 1);
  const fg = mk({ voucher_class: CLOSING_STOCK_CLASS, lines: [{ account_id: 'fg', dr: 700, cr: 0 }, { account_id: 'purchases', dr: 0, cr: 700 }] });
  assert.deepEqual(stockJournalPostings([fg], '2026-10-01', new Set(['stock', 'fg'])).map((p) => p.delta), [700]);

  // Storage: a wizard-class journal on a user Inventories ledger is netted off the valuation.
  saveBooksBegin('2025-04-01');
  saveClosingStockConfig({ mode: 'manual', entries: [{ date: '2026-03-31', value: 1000000 }] });
  const fgAcc = saveUserAccount({ code: 'FG1', name: 'Finished goods', group: 'INVENTORIES' });
  saveVoucher({ type: 'JOURNAL', date: '2026-03-31', narration: 'Closing stock', voucher_class: CLOSING_STOCK_CLASS, lines: [{ account_id: fgAcc.id, dr: 1000000, cr: 0 }, { account_id: A.purchases, dr: 0, cr: 1000000 }] });
  assert.equal(loadStockValuer()?.value('2026-03-31'), 0, 'counted once');

  // Branch: Mumbai holds 10 × ₹100; a closing-stock journal tagged to Mumbai already carries ₹400 of it.
  const item = (id: string, extra: Partial<StockItem> = {}): StockItem => ({ id, name: id, unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, ...extra });
  const godowns: Godown[] = [{ id: 'main', name: 'Main' }, { id: 'pune', name: 'Pune' }];
  const transfers: StockTransfer[] = [{ id: 't1', transfer_number: 'STR/1', date: '2026-05-01', from_godown: 'main', to_godown: 'pune', lines: [{ id: 'l', item_id: 'a', qty: 4 }] }];
  const inputs: StockInputs = { items: [item('a', { opening_qty: 14, opening_rate: 100 })], moves: [], invoices: [], transfers };
  const positions = computeStock(inputs);
  const events = collectEvents({ ...inputs, includeTransfers: true });
  const branches: Branch[] = [{ id: 'mum', name: 'Mumbai', godown_id: 'main' }, { id: 'pun', name: 'Pune', godown_id: 'pune' }];
  const journals = [{ id: 'j', number: 'J/1', date: '2026-05-31', delta: 40000, branch_id: 'mum' }];
  const gross = inventoryValuer(positions);
  const company = { ...gross, value: (d: string) => gross.value(d) - (d >= '2026-05-31' ? 40000 : 0) };
  const ctx = { positions, events, branches, godowns, company, journals };
  const mum = branchStockValuer('mum', ctx)!;
  const pun = branchStockValuer('pun', ctx)!;
  const none = branchStockValuer(UNASSIGNED, ctx)!;
  assert.equal(mum.value('2026-06-01'), 100000 - 40000, 'Mumbai net of its own journal');
  assert.equal(pun.value('2026-06-01'), 40000);
  assert.equal(none.value('2026-06-01'), 0);
  assert.equal(mum.value('2026-06-01') + pun.value('2026-06-01') + none.value('2026-06-01'), company.value('2026-06-01'));
});

/* ── L6 ─────────────────────────────────────────────────────────── */

test('L6: a deposit slip is all or nothing (an expired cheque leaves no deposit, Contra or slip behind)', () => {
  const ok = saveCheque({ direction: 'received', number: '100001', bank: 'HDFC Bank', cheque_date: '2026-10-20', amount: 1200, party_name: 'Acme' });
  const stale = saveCheque({ direction: 'received', number: '100002', bank: 'HDFC Bank', cheque_date: '2026-06-01', amount: 800, party_name: 'Bolt' });
  const vouchersBefore = loadVouchers().length;
  const counters = JSON.stringify(getTable('series_counters'));
  assert.throws(() => saveDepositSlip({ date: '2026-10-24', cheque_ids: [ok.id, stale.id], cash: { '500': 2 } }, '2026-10-24'), /expired/);
  for (const c of loadCheques()) {
    assert.equal(c.status, 'received', c.number);
    assert.equal(c.deposit_slip_id, undefined, c.number);
  }
  assert.equal(loadVouchers().length, vouchersBefore, 'no Contra left');
  assert.equal(loadDepositSlips().length, 0);
  assert.equal(JSON.stringify(getTable('series_counters')), counters);
  void SINGLETON_KEYS;
});

/* ── L7 ─────────────────────────────────────────────────────────── */

test('L7: normalizeImports survives rows with wrong field types', () => {
  const rows = normalizeImports([
    { id: 'a', imported_on: 42, file_name: { x: 1 }, meta: 'bad', findings: [{ kind: 'SHORT_DEDUCTION', pan: 5, name: null, base: 'x', tds: '12.345', demand: 1 }], skipped: 'n' },
    { id: 'b', imported_on: '2026-05-01', file_name: 'f.txt', meta: { tan: 'MUMA12345B', fy: 2026, quarter: 1, form: '26Q' }, findings: [] },
    { id: 'c', findings: [] },
  ]);
  assert.equal(rows.length, 3);
  const a = rows.find((r) => r.id === 'a')!;
  assert.equal(typeof a.imported_on, 'string');
  assert.equal(a.file_name, '');
  assert.deepEqual(a.meta, { tan: '', fy: null, quarter: null, form: '' });
  assert.equal(a.findings[0].base, 0);
  assert.equal(a.findings[0].tds, 12.35);
  assert.equal(typeof a.findings[0].name, 'string');
  assert.equal(rows[0].id, 'b', 'newest first');
});
