/**
 * Multi-account bank reconciliation: bank accounts master, receipts / supplier payments tagged to
 * an account, per-account book balance, statements and bank-line actions carrying the account.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { DEFAULT_BANK_ID, accountIdOf, bankAccountsDb } from '../src/lib/bank-accounts.ts';
import { accountBalanceAt, bankAccountBalanceAt, buildVouchers, loadBooksData } from '../src/lib/books.ts';
import { localDb } from '../src/lib/localDb.ts';
import { paymentsDb, purchasesDb } from '../src/lib/purchases.ts';
import { bankDb, makeStatement, normalizeStatements, payoutCandidates, receiptCandidates } from '../src/lib/bank-recon.ts';
import { recordReceiptFromLine } from '../src/components/bank/actions.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const bill = (): Omit<PurchaseRecord, 'id'> => ({
  kind: 'EXPENSE', vendor_name: 'Landlord', bill_number: '', date: '2026-05-10', category: 'Rent',
  lines: [{ id: 'l1', name: 'Rent', quantity: 1, rate: 1000, tax_rate: 0 }],
  taxable: 1000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 1000, amount_paid: 0,
} as Omit<PurchaseRecord, 'id'>);

test('master: the main account always exists; names unique; delete only when unused', () => {
  assert.deepEqual(bankAccountsDb.all().map((a) => a.id), [DEFAULT_BANK_ID]);
  assert.equal(bankAccountsDb.multiple(), false);
  bankAccountsDb.save({ id: 'icici', name: 'ICICI current', number: '••4521' });
  assert.equal(bankAccountsDb.multiple(), true);
  assert.throws(() => bankAccountsDb.save({ id: 'x', name: 'icici current' }), /already exists/);
  bankAccountsDb.save({ id: DEFAULT_BANK_ID, name: 'HDFC savings' });
  assert.deepEqual(bankAccountsDb.all().map((a) => a.name), ['HDFC savings', 'ICICI current'], 'main account renamed, still first');
  assert.throws(() => bankAccountsDb.remove(DEFAULT_BANK_ID, false), /cannot be deleted/);
  assert.throws(() => bankAccountsDb.remove('icici', true), /inactive/);
  bankAccountsDb.save({ ...bankAccountsDb.all()[1], active: false });
  assert.equal(bankAccountsDb.multiple(), false, 'inactive accounts do not count');
  bankAccountsDb.remove('icici', false);
  assert.equal(bankAccountsDb.all().length, 1);
});

test('receipts and supplier payments carry their account (never for cash)', () => {
  const inv = createViaStore({ date: '2026-05-01', due: '2026-05-31', lines: [{ qty: 1, rate: 10000 }], client: clientMH });
  const p1 = localDb.payments.record({ invoiceId: inv.id, amount: 1000, method: 'UPI', date: '2026-05-02', bankAccountId: 'icici' });
  const p2 = localDb.payments.record({ invoiceId: inv.id, amount: 500, method: 'Cash', date: '2026-05-03', bankAccountId: 'icici' });
  assert.equal(p1.bank_account_id, 'icici');
  assert.equal(p2.bank_account_id, undefined);
  const b = purchasesDb.save(bill());
  const pp = paymentsDb.record(b.id, { amount: 400, date: '2026-05-10', method: 'NEFT', bankAccountId: 'icici' });
  assert.equal(pp.bank_account_id, 'icici');
  const rc = receiptCandidates(localDb.invoices.getAll() as never, localDb.payments.getAll() as never);
  assert.deepEqual(rc.map((c) => accountIdOf(c)), ['icici'], 'cash is not a bank candidate');
  const po = payoutCandidates(purchasesDb.all(), [], paymentsDb.all());
  assert.equal(po[0].bank_account_id, 'icici');
});

test('per-account book balance: own opening + tagged movements; main falls back to the Books opening', () => {
  const inv = createViaStore({ date: '2026-05-01', due: '2026-05-31', lines: [{ qty: 1, rate: 10000 }], client: clientMH });
  localDb.payments.record({ invoiceId: inv.id, amount: 3000, method: 'UPI', date: '2026-05-02' });
  localDb.payments.record({ invoiceId: inv.id, amount: 2000, method: 'NEFT', date: '2026-05-03', bankAccountId: 'icici' });
  const b = purchasesDb.save(bill());
  paymentsDb.record(b.id, { amount: 700, date: '2026-05-10', method: 'NEFT', bankAccountId: 'icici' });
  const data = loadBooksData();
  data.openings = [{ id: 'o1', account: 'bank', amount: 10000, as_of: '2026-04-01' }];
  const v = buildVouchers(data);
  assert.equal(v.find((x) => x.type === 'Payment')?.bank_account_id, 'icici');

  const main = bankAccountsDb.all()[0];
  const icici = bankAccountsDb.save({ id: 'icici', name: 'ICICI', opening: 500, opening_as_of: '2026-04-01' });
  assert.deepEqual(bankAccountBalanceAt(v, data.openings, main, '2026-05-31'), { balance: 13000, openingMissing: false });
  assert.deepEqual(bankAccountBalanceAt(v, data.openings, icici, '2026-05-31'), { balance: 1800, openingMissing: false });
  assert.equal(accountBalanceAt(v, data.openings, 'bank', '2026-05-31'), 14300, 'the Books bank total is unchanged');
  const noOpening = bankAccountsDb.save({ id: 'sbi', name: 'SBI' });
  assert.equal(bankAccountBalanceAt(v, data.openings, noOpening, '2026-05-31').openingMissing, true);
});

test('statements keep their account; a receipt made from a statement line goes into that account', () => {
  const st = makeStatement({ bankLabel: 'ICICI', openingBalance: undefined }, [
    { date: '2026-05-04', narration: 'NEFT ACME BUYERS', ref: '', debit: 0, credit: 1180, balance: 0 } as never,
  ], 'icici.csv', new Date(2026, 4, 5), 'icici');
  assert.equal(st.bank_account_id, 'icici');
  assert.equal(normalizeStatements([st])[0].bank_account_id, 'icici');
  assert.equal(makeStatement({ bankLabel: 'Main', openingBalance: undefined }, [], 'm.csv', new Date(), DEFAULT_BANK_ID).bank_account_id, undefined);
  bankDb.saveAll([st]);
  const inv = createViaStore({ date: '2026-05-01', due: '2026-05-31', lines: [{ qty: 1, rate: 1000 }], client: clientMH });
  const pay = recordReceiptFromLine(st.lines[0], inv.id);
  assert.equal(pay.bank_account_id, 'icici');
});

test('advance receipts and refunds land in the account they name', async () => {
  const { saveAdvance, refundAdvance } = await import('../src/lib/advances.ts');
  const a = saveAdvance({
    date: '2026-05-10', client: { name: 'Acme Buyers' }, place_of_supply: '27', supply: 'services', tax_rate: 18, amount: 11800,
    method: 'Bank transfer', bankAccountId: 'icici',
  }, { today: '2026-06-30' });
  assert.equal(a.bank_account_id, 'icici');
  refundAdvance(a.id, { amount: 1180, date: '2026-05-20', method: 'NEFT', bankAccountId: 'icici' }, { today: '2026-06-30' });
  const cash = saveAdvance({
    date: '2026-05-11', client: { name: 'Walk-in' }, place_of_supply: '27', supply: 'services', tax_rate: 18, amount: 500,
    method: 'Cash', bankAccountId: 'icici',
  }, { today: '2026-06-30' });
  assert.equal(cash.bank_account_id, undefined, 'never for cash');
  const data = loadBooksData();
  const v = buildVouchers(data);
  const icici = bankAccountsDb.save({ id: 'icici', name: 'ICICI', opening: 0, opening_as_of: '2026-04-01' });
  assert.equal(bankAccountBalanceAt(v, data.openings, icici, '2026-05-31').balance, 10620, 'received 11,800 − refunded 1,180');
});
