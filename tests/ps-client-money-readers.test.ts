/**
 * R14 PS-B3 readers: the firm's own cash views (Today, payment modes, collection lag, cash-forecast opening) leave
 * client-money accounts out through the one predicate `isClientMoneyAccount`; the BRS still offers them. Client-money
 * vouchers are not `transactions` rows, so `movedNoCash` and its readers are unchanged. The static guard keeps the
 * listed readers on the predicate.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { bankAccountsDb, pickableBankAccounts } from '../src/lib/bank-accounts.ts';
import { todaySummary } from '../src/lib/today.ts';
import { paymentModes } from '../src/lib/sales-reports.ts';
import { collectionLags, openingCash } from '../src/lib/cash-forecast.ts';
import { loadBooksData } from '../src/lib/books.ts';
import { recordClientMoney } from '../src/lib/prof/ps-cm-post.ts';
import type { Payment } from '../src/types/invoice.ts';

const DAY = '2026-10-12';
beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
  bankAccountsDb.save({ id: 'cm', name: 'Client account', active: true, client_money: true } as never);
  bankAccountsDb.save({ id: 'b2', name: 'Office ICICI', active: true });
});

function world() {
  const inv = createViaStore({ client: clientMH, docType: 'TAX_INVOICE', date: '2026-10-01', due: '2026-10-05', lines: [{ name: 'Fees', qty: 1, rate: 10000, tax: 0 }], status: 'Sent' });
  localDb.payments.record({ invoiceId: inv.id, amount: 4000, method: 'Bank Transfer', date: DAY, bankAccountId: 'b2' });
  // A stray receipt booked into the client account (imported / legacy data): clients' money, not the firm's.
  const rows = getTable<Payment>('transactions');
  setTable('transactions', [...rows, { ...rows[0], id: 'stray', amount: 3000, bank_account_id: 'cm', receipt_number: 'X' }]);
  return inv;
}

test('Today, payment modes and collection lag leave a client-money account out', () => {
  const inv = world();
  const payments = getTable<Payment>('transactions');
  const t = todaySummary({ invoices: [inv], payments, purchases: [] }, DAY);
  assert.equal(t.bank, 4000);
  const pm = paymentModes(payments, [inv], { start: '2026-10-01', end: '2026-10-31' } as never);
  assert.equal(pm.total, 4000);
  const lag = [...collectionLags([inv], payments).values()][0];
  assert.equal(lag.receipts, 1);
});

test('cash-forecast opening leaves client money out; the BRS still offers the account', () => {
  recordClientMoney({ kind: 'receipt', date: '2026-10-01', client_id: 'c-mh', amount: 50000, bank_account_id: 'cm', purpose: 'expenses', ref: '', narration: '' });
  assert.equal(openingCash(loadBooksData(), DAY), 0);
  assert.ok(pickableBankAccounts('brs').some((a) => a.id === 'cm'));
});

test('static guard: the firm cash readers call isClientMoneyAccount', () => {
  for (const f of ['src/lib/today.ts', 'src/lib/sales-reports.ts', 'src/lib/cash-forecast.ts']) {
    assert.match(readFileSync(f, 'utf8'), /isClientMoneyAccount\(/, f);
  }
  assert.doesNotMatch(readFileSync('src/lib/no-cash.ts', 'utf8'), /client_money/, 'no new no-cash marker');
});
