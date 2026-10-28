/**
 * QA round 6 F5 (QA6-1): money that moves only through a manual voucher — gift-voucher sales, donations, security
 * deposits, marketplace payouts — reaches the simple cash / bank book (Books → Cash & bank, the cash tally, Today,
 * the dashboard tile, Reconcile's book balance) and the BRS candidates, without counting a receipt row twice.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { createViaStore, installSettings } from './helpers/world.ts';
import { fixture, importMtr, setupWorld } from './helpers/marketplace.ts';
import { accountBalanceAt, buildVouchers, loadBooksData } from '../src/lib/books.ts';
import { suggestMatches, voucherCandidates } from '../src/lib/bank-recon.ts';
import { computeTiles } from '../src/lib/dashboard-tiles.ts';
import { openingCash } from '../src/lib/cash-forecast.ts';
import { giftVouchersDb, redeemOnInvoice } from '../src/lib/retail/gift-vouchers.ts';
import { saveDonation } from '../src/lib/nonprofit/donations.ts';
import { recordDeposit } from '../src/lib/property/deposits.ts';
import { saveVoucher } from '../src/lib/ledger/vouchers.ts';
import { saveReceiptVoucher } from '../src/lib/bill-allocation.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { importSettlement, parseSettlement } from '../src/lib/marketplace/settlement-import.ts';
import { postSettlement } from '../src/lib/marketplace/settlement-post.ts';
import { channelById } from '../src/lib/marketplace/channels.ts';
import { loadLedger } from '../src/lib/ledger/index.ts';
import { trialBalance } from '../src/lib/ledger/reports.ts';

const DAY = '2026-07-21';
beforeEach(() => {
  resetStorage();
  installSettings();
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

const balances = (day = DAY) => {
  const books = loadBooksData();
  const vs = buildVouchers(books);
  return { cash: accountBalanceAt(vs, books.openings, 'cash', day), bank: accountBalanceAt(vs, books.openings, 'bank', day) };
};
const ledgerClosing = (id: string) => trialBalance(loadLedger(), { start: '2026-04-01', end: '2027-03-31' }).rows.filter((r) => r.account.id === id).reduce((s, r) => s + r.closing, 0) / 100;

test('F5: a gift voucher sold for cash, a cash donation and a deposit received by bank are in the cash / bank book; the redemption is not', () => {
  const [gv] = giftVouchersDb.sell({ count: 1, face_value: 500, issued_on: '2026-07-20', method: 'Cash' }).vouchers;
  const a = createViaStore({ date: DAY, lines: [{ qty: 1, rate: 500, tax: 0 }], status: 'Sent' });
  redeemOnInvoice({ invoiceId: a.id, code: gv.code, amount: 500, date: DAY });
  saveDonation({ date: DAY, donor_id: 'c1', amount: 2000, mode: 'cash', type: 'others', section: 'none' } as never, 'Donor');
  recordDeposit({ direction: 'received', party_id: '', party_name: 'Tenant', amount: 3000, date: '2026-07-01', mode: 'bank' });
  const b = balances();
  assert.equal(b.cash, 2500, 'cash = voucher sale + donation');
  assert.equal(b.bank, 3000, 'bank = deposit');
  assert.equal(b.cash, ledgerClosing(A.cash), 'same cash as the ledger');
  assert.equal(b.bank, ledgerClosing(A.bank), 'same bank as the ledger');
  // Every reader on the same stream: dashboard tile, cash forecast opening.
  const books = loadBooksData();
  assert.deepEqual(computeTiles({ books, links: [], branches: [] } as never, DAY).cashBank, { cash: 2500, bank: 3000 });
  assert.equal(openingCash(books, DAY), 5500);
});

test('F5: optional, memorandum and future post-dated vouchers stay out; a reversing journal reverses; a contra moves cash to bank', () => {
  const v = (over: object) => saveVoucher({ type: 'PAYMENT', date: '2026-07-10', narration: 'x', lines: [{ account_id: A.rent, dr: 10000, cr: 0 }, { account_id: A.cash, dr: 0, cr: 10000 }], ...over } as never);
  v({ variant: 'OPTIONAL' });
  v({ variant: 'MEMO' });
  v({ post_dated: true, date: '2026-08-10' });
  assert.deepEqual(balances('2026-12-31'), { cash: 0, bank: 0 });
  v({});
  assert.equal(balances().cash, -100);
  saveVoucher({ type: 'CONTRA', date: '2026-07-11', narration: 'deposit', lines: [{ account_id: A.bank, dr: 5000, cr: 0 }, { account_id: A.cash, dr: 0, cr: 5000 }] });
  assert.deepEqual(balances(), { cash: -150, bank: 50 });
  saveVoucher({ type: 'JOURNAL', date: '2026-07-12', reverse_on: '2026-07-15', narration: 'accrual', lines: [{ account_id: A.cash, dr: 700, cr: 0 }, { account_id: A.otherIncome, dr: 0, cr: 700 }] });
  assert.equal(balances('2026-07-13').cash, -143);
  assert.equal(balances('2026-07-16').cash, -150, 'the reversal takes it out again');
});

test('F5: a bill-wise receipt voucher is counted once (its receipt rows carry it)', () => {
  const inv = createViaStore({ date: DAY, lines: [{ qty: 1, rate: 1000, tax: 0 }], status: 'Sent' });
  const party = inv.client.name;
  saveReceiptVoucher(
    { type: 'RECEIPT', date: DAY, narration: 'bill-wise', lines: [{ account_id: A.bank, dr: 100000, cr: 0 }, { account_id: A.debtors, dr: 0, cr: 100000, party }] },
    undefined,
    { party, total: 1000, allocations: [{ bill_id: inv.id, ref: inv.invoice_number, amount: 1000 }], method: 'Bank transfer' } as never,
  );
  assert.equal(balances().bank, 1000);
});

test('F5: a marketplace payout reaches the bank book and the BRS offers it for the statement line', () => {
  const ch = setupWorld();
  importMtr(ch);
  const p = parseSettlement([{ name: 'v2', table: fixture('amazon-settlement-v2.csv') }], 'amazon_v2');
  const s = postSettlement(importSettlement(channelById(ch.id)!, p, 'v2.csv').id);
  const books = loadBooksData();
  const vs = buildVouchers(books);
  const { receipts } = voucherCandidates(vs);
  const payout = receipts.find((c) => Math.abs(c.amount - s.payout) < 0.005 && c.date === s.deposit_date && !c.bank_account_id);
  assert.ok(payout, `a ₹${s.payout} payout candidate into the main bank (${receipts.map((c) => `${c.amount}@${c.bank_account_id ?? 'main'}`).join(', ')})`);
  assert.ok(!receipts.some((c) => c.bank_account_id === channelById(ch.id)!.clearing_bank_id), 'the clearing account is not a BRS account');
  const line = { id: 'l1', date: s.deposit_date, narration: 'NEFT AMAZON SELLER SERVICES', ref: '', debit: 0, credit: s.payout };
  const sug = suggestMatches([line], receipts);
  assert.equal(sug[0]?.candidateIds[0], payout!.id);
  // The main bank's book balance includes the payout.
  const bank = accountBalanceAt(vs, books.openings, 'bank', s.deposit_date);
  assert.ok(Math.abs(bank - s.payout) < 0.005, `bank ${bank} = payout ${s.payout} (receipts sit in the clearing account until paid out)`);
});
