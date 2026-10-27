/** R14 PS-B3 client money: postings per kind, guards, to-fees, interest, rollback, lock, delete, statements. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientKA, clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { bankAccountsDb, isClientMoneyAccount, pickableBankAccounts } from '../src/lib/bank-accounts.ts';
import { loadVouchers, deleteVoucher } from '../src/lib/ledger/vouchers.ts';
import { chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { cmBalances, clientHeld, cmStatement, negativeBalance, totalHeld, validateCm, type CmInput } from '../src/lib/prof/ps-client-money.ts';
import { cmDb, recordClientMoney, removeClientMoney } from '../src/lib/prof/ps-cm-post.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  setActorProvider(null);
  localDb.clients.upsert(clientMH);
  localDb.clients.upsert(clientKA);
  bankAccountsDb.save({ id: 'cm', name: 'Client account — HDFC', active: true, client_money: true } as never);
});

const base = (over: Partial<CmInput> = {}): CmInput => ({ kind: 'receipt', date: '2026-10-01', client_id: 'c-mh', amount: 50000, bank_account_id: 'cm', purpose: 'expenses', ref: 'NEFT 1', narration: 'For court fees and expenses', ...over });
const nameOf = (id: string) => chartOf(loadUserAccounts()).find((a) => a.id === id)?.name;
const memo = () => createViaStore({ client: clientMH, docType: 'TAX_INVOICE', date: '2026-10-10', lines: [{ name: 'Professional fees', hsn: '998213', qty: 1, rate: 20000, tax: 0 }], status: 'Sent' }) as InvoiceRecord;

test('the client-money account is a real bank for BRS but not for receipts, cheques or supplier payments', () => {
  assert.equal(isClientMoneyAccount('cm'), true);
  assert.equal(isClientMoneyAccount('default'), false);
  assert.deepEqual(pickableBankAccounts('brs').map((a) => a.id), ['default', 'cm']);
  for (const p of ['any', 'cheque', 'epay'] as const) assert.deepEqual(pickableBankAccounts(p).map((a) => a.id), ['default'], p);
});

test('receipt → payment on behalf → to fees: journals, office receipt, balance ₹18,000 (the user story)', () => {
  const r = recordClientMoney(base());
  assert.match(r.number, /^CMV\/FY26-27\/0001$/);
  const [v] = loadVouchers();
  assert.deepEqual(v.lines.map((l) => [nameOf(l.account_id), l.dr, l.cr]), [['Client account — HDFC', 5000000, 0], ['Client money held', 0, 5000000]]);
  recordClientMoney(base({ kind: 'payment', date: '2026-10-03', amount: 12000, ref: 'e-stamp', narration: 'Stamp duty' }));
  const inv = memo();
  assert.throws(() => recordClientMoney(base({ kind: 'to_fees', date: '2026-10-12', amount: 20000, invoice_id: inv.id })), /authority/);
  const tf = recordClientMoney(base({ kind: 'to_fees', date: '2026-10-12', amount: 20000, invoice_id: inv.id, authority: { date: '2026-10-11', mode: 'email', ref: 'mail of 11 Oct' } }));
  const pay = getTable<{ id: string; bank_account_id?: string; amount: number; invoice_id: string }>('transactions');
  assert.equal(pay.length, 1, 'office receipt created once');
  assert.deepEqual([pay[0].id, pay[0].amount, pay[0].bank_account_id ?? 'default'], [tf.payment_id, 20000, 'default']);
  assert.equal((localDb.invoices.getById(inv.id) as InvoiceRecord).balance_due, 0, 'settles the invoice');
  assert.equal(clientHeld(cmDb.all(), 'c-mh'), 18000);
  assert.equal(loadVouchers().length, 3);
  const st = cmStatement(cmDb.all(), 'c-mh', '2026-10-02', '2026-10-31');
  assert.deepEqual([st.opening, st.rows.map((x) => x.balance), st.closing], [50000, [38000, 18000], 18000]);
});

test('guards: no negative balance, client named, fees deposits go to advances, invoice balance, matter balance', () => {
  assert.throws(() => recordClientMoney(base({ kind: 'payment', amount: 1 })), /below zero/);
  assert.match(validateCm(base({ client_id: '' })), /Name the client/);
  assert.throws(() => recordClientMoney(base({ purpose: 'fees' })), /advance/);
  assert.throws(() => recordClientMoney(base({ bank_account_id: 'default' })), /client money/);
  recordClientMoney(base({ matter_id: 'm1', amount: 1000 }));
  recordClientMoney(base({ matter_id: 'm2', amount: 1000 }));
  assert.throws(() => recordClientMoney(base({ kind: 'payment', matter_id: 'm1', amount: 1500 })), /below zero/, 'matter m1 has only 1000');
  const inv = memo();
  assert.throws(() => recordClientMoney(base({ kind: 'to_fees', amount: 1500, invoice_id: 'nope' })), /issued invoice/);
  assert.throws(() => recordClientMoney(base({ kind: 'to_fees', amount: 25000, invoice_id: inv.id, authority: { date: '2026-10-01', mode: 'written', ref: 'x' } })), /invoice balance/);
  assert.throws(() => recordClientMoney(base({ kind: 'to_fees', client_id: 'c-ka', amount: 10, invoice_id: inv.id, authority: { date: '2026-10-01', mode: 'written', ref: 'x' } })), /another client/);
  assert.equal(negativeBalance(cmDb.all()), null);
});

test('owner override of a missing authority is audited; a clerk cannot override', () => {
  recordClientMoney(base());
  const inv = memo();
  setActorProvider(() => ({ id: 'u1', name: 'Clerk', role: 'clerk' }) as never);
  assert.throws(() => recordClientMoney(base({ kind: 'to_fees', amount: 100, invoice_id: inv.id }), { override_reason: 'phone call' }));
  setActorProvider(null);
  const r = recordClientMoney(base({ kind: 'to_fees', amount: 100, invoice_id: inv.id }), { override_reason: 'Client confirmed on phone' });
  assert.equal(r.override_reason, 'Client confirmed on phone');
  assert.ok(getTable<{ summary: string }>('audit_log').some((a) => /owner override: Client confirmed on phone/.test(a.summary)));
});

test('transfer between clients; interest to the client or to the firm', () => {
  recordClientMoney(base());
  const t = recordClientMoney(base({ kind: 'transfer', amount: 5000, to_client_id: 'c-ka', narration: 'Common fund — by consent' }));
  assert.deepEqual(t.voucher_ids, [], 'one ledger: no journal');
  assert.deepEqual([clientHeld(cmDb.all(), 'c-mh'), clientHeld(cmDb.all(), 'c-ka')], [45000, 5000]);
  recordClientMoney(base({ kind: 'interest', amount: 100, interest_to: 'client' }));
  recordClientMoney(base({ kind: 'interest', amount: 40, client_id: '', interest_to: 'firm' }));
  assert.equal(totalHeld(cmDb.all()), 50100);
  const last = loadVouchers().at(-1)!;
  assert.equal(nameOf(last.lines[1].account_id), 'Interest received');
  assert.equal(cmBalances(cmDb.all()).length, 2);
});

test('rollback on failure; locked period refused; delete removes journal and receipt, refused when later entries need it', () => {
  recordClientMoney(base());
  const inv = memo();
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-09-30' } as never);
  assert.throws(() => recordClientMoney(base({ date: '2026-09-15' })), /lock|closed|locked/i);
  // A to-fees whose office receipt fails (invoice already paid by then) leaves nothing behind.
  const before = [getTable('client_money').length, loadVouchers().length];
  localDb.payments.record({ invoiceId: inv.id, amount: 20000, method: 'Cash', date: '2026-10-11' });
  assert.throws(() => recordClientMoney(base({ kind: 'to_fees', date: '2026-10-12', amount: 100, invoice_id: inv.id, authority: { date: '2026-10-11', mode: 'written', ref: 'x' } })));
  assert.deepEqual([getTable('client_money').length, loadVouchers().length], before);
  const p = recordClientMoney(base({ kind: 'payment', date: '2026-10-05', amount: 1000 }));
  assert.throws(() => deleteVoucher(p.voucher_ids[0]), /Client money/);
  const first = cmDb.all()[0];
  assert.throws(() => removeClientMoney(first.id), /below zero/);
  removeClientMoney(p.id);
  assert.equal(cmDb.all().length, 1);
  assert.equal(loadVouchers().length, 1);
});
