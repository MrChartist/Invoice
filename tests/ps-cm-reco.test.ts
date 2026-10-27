/** R14 PS-B3 three-way reconciliation: agreement, and each kind of difference. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { bankAccountsDb } from '../src/lib/bank-accounts.ts';
import { loadVouchers, saveVoucher } from '../src/lib/ledger/vouchers.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { balancesByClient, threeWay } from '../src/lib/prof/ps-cm-reco.ts';
import { cmDb, recordClientMoney } from '../src/lib/prof/ps-cm-post.ts';
import type { CmInput } from '../src/lib/prof/ps-client-money.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
  bankAccountsDb.save({ id: 'cm', name: 'Client account', active: true, client_money: true } as never);
});

const base = (over: Partial<CmInput> = {}): CmInput => ({ kind: 'receipt', date: '2026-10-01', client_id: 'c-mh', amount: 50000, bank_account_id: 'cm', purpose: 'expenses', ref: '', narration: '', ...over });
const reco = (statement: number | null, date = '2026-10-31', opening?: number) => threeWay({
  date, statement, rows: cmDb.all(), vouchers: loadVouchers(),
  bankLedgers: new Map([['bank:cm', { opening, as_of: '2026-04-01' }]]),
  paymentIds: new Set(getTable<{ id: string }>('transactions').map((p) => p.id)),
});

test('bank, ledger and client balances agree', () => {
  recordClientMoney(base());
  recordClientMoney(base({ kind: 'payment', date: '2026-10-03', amount: 12000 }));
  const r = reco(38000);
  assert.deepEqual([r.statement, r.ledger, r.clients, r.diffs, r.agreed], [38000, 38000, 38000, [], true]);
  assert.deepEqual(balancesByClient(cmDb.all(), '2026-10-31').map((b) => [b.client, b.balance]), [['c-mh', 38000]]);
  assert.equal(reco(null, '2026-10-02').ledger, 50000, 'as on a date');
});

test('differences: uncleared, unallocated journal, firm interest, opening, missing office receipt', () => {
  recordClientMoney(base());
  const r1 = reco(49000);
  assert.deepEqual(r1.diffs.map((d) => [d.kind, d.amount]), [['uncleared', -1000]]);
  assert.equal(r1.agreed, false);
  saveVoucher({ type: 'PAYMENT', date: '2026-10-20', narration: 'Bank charges', lines: [{ account_id: A.bankCharges, dr: 11800, cr: 0 }, { account_id: 'bank:cm', dr: 0, cr: 11800 }] });
  recordClientMoney(base({ kind: 'interest', client_id: '', amount: 75, interest_to: 'firm', date: '2026-10-30' }));
  const r2 = reco(null, '2026-10-31', 500);
  assert.deepEqual(r2.diffs.map((d) => d.kind).sort(), ['firm_interest', 'unallocated', 'unallocated']);
  assert.equal(r2.ledger, 50000 - 118 + 75 + 500);
  assert.equal(r2.clients, 50000);
  const inv = createViaStore({ client: clientMH, docType: 'TAX_INVOICE', date: '2026-10-10', lines: [{ name: 'Fees', qty: 1, rate: 1000, tax: 0 }], status: 'Sent' });
  const tf = recordClientMoney(base({ kind: 'to_fees', date: '2026-10-12', amount: 1000, invoice_id: inv.id, authority: { date: '2026-10-11', mode: 'written', ref: 'letter' } }));
  localDb.payments.remove(tf.payment_id!);
  assert.ok(reco(null).diffs.some((d) => d.kind === 'receipt_missing' && d.ref === tf.number));
});
