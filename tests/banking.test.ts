/**
 * WP-5 banking: each bank account as its own ledger (P0-8), per-account bank book, Tally per-bank
 * ledgers, cheques against several documents + bounce charges, deposit slip, payment advice, bulk
 * e-payment files, day-end cash tally.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { DEFAULT_BANK_ID, bankAccountsDb, maskAccountNo } from '../src/lib/bank-accounts.ts';
import { bankAccountIdOfLedger, bankLedgerId, bankLedgersFor, isCashOrBankLedger } from '../src/lib/bank-ledgers.ts';
import { bankAccountFor } from '../src/lib/ledger/postings-bank.ts';
import { A, chartOf } from '../src/lib/ledger/accounts.ts';
import { buildLedger, loadLedgerInput, trialBalance, saveVoucher, validateVoucher } from '../src/lib/ledger/index.ts';
import { bankAccountBalanceAt, bankAccountBook, buildVouchers, loadBooksData, accountBalanceAt } from '../src/lib/books.ts';
import { localDb } from '../src/lib/localDb.ts';
import { paymentsDb, purchasesDb } from '../src/lib/purchases.ts';
import { buildTallyModel } from '../src/lib/tally-xml.ts';
import { tallyBankResolver } from '../src/lib/tally-bank.ts';
import { allocatedTotal, chequeAllocations, loadCheques, saveCheque, transitionCheque, validateCheque, type ChequeInput } from '../src/lib/cheques.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { cashTotal, denominationRows, depositSlipView, depositableCheques, loadDepositSlips, normalizeCounts, saveDepositSlip, validateDepositSlip } from '../src/lib/deposit-slip.ts';
import { loadCashTallies, saveCashTally, tallyCash } from '../src/lib/cash-tally.ts';
import { buildPaymentAdvice, supplierPaymentRefs } from '../src/lib/payment-advice.ts';
import { buildUploadFile, suggestMode, validateUpload, validateUploadRow, type UploadRow } from '../src/lib/bank-upload.ts';
import { recordSupplierPayment, vendorPaymentsDb } from '../src/lib/billwise.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import type { Ledger } from '../src/lib/ledger/postings.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const bill = (over: Partial<PurchaseRecord> = {}): Omit<PurchaseRecord, 'id'> => ({
  kind: 'EXPENSE', vendor_name: 'Landlord', bill_number: 'R-1', date: '2026-05-10', category: 'Rent',
  lines: [{ id: 'l1', name: 'Rent', quantity: 1, rate: 1000, tax_rate: 0 }],
  taxable: 1000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 1000, amount_paid: 0, ...over,
} as Omit<PurchaseRecord, 'id'>);

/** Ledger balance (rupees, Dr positive) of `account` on all vouchers up to `date`. */
function bal(ledger: Ledger, account: string, date = '2099-12-31'): number {
  let p = 0;
  for (const v of ledger.vouchers) if (v.date <= date) for (const l of v.lines) if (l.account === account) p += l.dr - l.cr;
  return p / 100;
}
const ledgerNow = () => buildLedger(loadLedgerInput(undefined, '2026-10-25'));

test('ids: main account keeps 3510, others get bank:<id>; OD goes under short-term borrowings', () => {
  assert.equal(bankLedgerId(undefined), A.bank);
  assert.equal(bankLedgerId(DEFAULT_BANK_ID), A.bank);
  assert.equal(bankLedgerId('icici'), 'bank:icici');
  assert.equal(bankAccountIdOfLedger('bank'), DEFAULT_BANK_ID);
  assert.equal(bankAccountIdOfLedger('bank:icici'), 'icici');
  assert.equal(bankAccountIdOfLedger('cash'), null);
  const l = bankLedgersFor([
    { id: DEFAULT_BANK_ID, name: 'Main bank account' },
    { id: 'icici', name: 'ICICI CA' },
    { id: 'sbi', name: 'SBI CC', od: true },
  ]);
  assert.deepEqual(l.map((a) => [a.id, a.code, a.group]), [['bank:icici', '3510-1', 'CASH_BANK'], ['bank:sbi', '3510-2', 'LOANS_ST']]);
  assert.equal(bankLedgersFor([{ id: DEFAULT_BANK_ID, name: 'HDFC Bank CA' }])[0].name, 'HDFC Bank CA', 'renamed main renames 3510');
  assert.equal(isCashOrBankLedger({ id: 'bank:sbi', group: 'LOANS_ST' }), true);
  assert.equal(isCashOrBankLedger({ id: 'bank_od', group: 'LOANS_ST' }), false);
  assert.equal(bankAccountFor({ account: 'bank', bank_account_id: 'icici' }), 'bank:icici');
  assert.equal(bankAccountFor({ account: 'bank', bank_account_id: 'gone' }, new Set(['bank'])), 'bank', 'unknown account stays on 3510');
  assert.equal(bankAccountFor({ account: 'cash', bank_account_id: 'icici' }), 'cash');
  assert.equal(maskAccountNo('50100012345678'), '••••5678');
});

test('one bank account: chart and postings are exactly as before', () => {
  const inv = createViaStore({ date: '2026-05-01', due: '2026-05-31', lines: [{ qty: 1, rate: 10000 }], client: clientMH });
  localDb.payments.record({ invoiceId: inv.id, amount: 3000, method: 'UPI', date: '2026-05-02' });
  const ledger = ledgerNow();
  assert.ok(!ledger.accounts.some((a) => a.id.startsWith('bank:')));
  assert.equal(ledger.byId.get('bank')?.name, 'Bank account');
  assert.equal(bal(ledger, 'bank'), 3000);
});

test('several accounts: receipts, supplier payments, advances post to their own ledger; TB shows each bank', () => {
  bankAccountsDb.save({ id: DEFAULT_BANK_ID, name: 'HDFC Bank CA' });
  bankAccountsDb.save({ id: 'icici', name: 'ICICI CA' });
  const inv = createViaStore({ date: '2026-05-01', due: '2026-05-31', lines: [{ qty: 1, rate: 10000 }], client: clientMH });
  localDb.payments.record({ invoiceId: inv.id, amount: 3000, method: 'UPI', date: '2026-05-02' });
  localDb.payments.record({ invoiceId: inv.id, amount: 2000, method: 'NEFT', date: '2026-05-03', bankAccountId: 'icici' });
  localDb.payments.record({ invoiceId: inv.id, amount: 100, method: 'Cash', date: '2026-05-04', bankAccountId: 'icici' });
  const b = purchasesDb.save(bill());
  paymentsDb.record(b.id, { amount: 700, date: '2026-05-10', method: 'NEFT', bankAccountId: 'icici' });
  const ledger = ledgerNow();
  assert.equal(ledger.warnings.length, 0, ledger.warnings.join('; '));
  assert.equal(ledger.byId.get('bank')?.name, 'HDFC Bank CA');
  assert.equal(ledger.byId.get('bank:icici')?.code, '3510-1');
  assert.equal(bal(ledger, 'bank'), 3000);
  assert.equal(bal(ledger, 'bank:icici'), 1300);
  assert.equal(bal(ledger, 'cash'), 100);
  const tb = trialBalance(ledger, { start: '2026-04-01', end: '2027-03-31' });
  assert.equal(tb.totals.closingDr, tb.totals.closingCr, 'TB balances');
  assert.deepEqual(tb.rows.filter((r) => r.account.group === 'CASH_BANK').map((r) => [r.account.name, r.closing / 100]), [
    ['Cash in hand', 100], ['HDFC Bank CA', 3000], ['ICICI CA', 1300],
  ]);
});

test('openings: ledger per bank = BRS book balance = per-account bank book', () => {
  const inv = createViaStore({ date: '2026-05-01', due: '2026-05-31', lines: [{ qty: 1, rate: 10000 }], client: clientMH });
  localDb.payments.record({ invoiceId: inv.id, amount: 3000, method: 'UPI', date: '2026-05-02' });
  localDb.payments.record({ invoiceId: inv.id, amount: 2000, method: 'NEFT', date: '2026-05-03', bankAccountId: 'icici' });
  const b = purchasesDb.save(bill());
  paymentsDb.record(b.id, { amount: 700, date: '2026-05-10', method: 'NEFT', bankAccountId: 'icici' });
  const icici = bankAccountsDb.save({ id: 'icici', name: 'ICICI', opening: 500, opening_as_of: '2026-04-01' });
  const main = bankAccountsDb.all()[0];
  const books = loadBooksData();
  books.openings = [{ id: 'o1', account: 'bank', amount: 10000, as_of: '2026-04-01' }];
  const ledger = buildLedger(loadLedgerInput(books, '2026-10-25'));
  const v = buildVouchers(books);
  assert.equal(bal(ledger, 'bank'), bankAccountBalanceAt(v, books.openings, main, '2026-05-31').balance);
  assert.equal(bal(ledger, 'bank'), 13000);
  assert.equal(bal(ledger, 'bank:icici'), 1800);
  const period = { start: '2026-04-01', end: '2026-05-31' };
  assert.equal(bankAccountBook(v, books.openings, icici, period).closing, 1800);
  assert.equal(bankAccountBook(v, books.openings, main, period).closing, 13000);
  assert.equal(bankAccountBook(v, books.openings, icici, period).opening, 500);
  assert.equal(accountBalanceAt(v, books.openings, 'bank', '2026-05-31'), 14300, 'the combined Books bank book is unchanged');
  const tb = trialBalance(ledger, { start: '2026-04-01', end: '2027-03-31' });
  assert.equal(tb.totals.closingDr, tb.totals.closingCr);
});

test('contra between two banks and an OD account is a valid voucher and moves both ledgers', () => {
  bankAccountsDb.save({ id: 'icici', name: 'ICICI CA' });
  bankAccountsDb.save({ id: 'sbi', name: 'SBI CC', od: true });
  const chart = chartOf();
  assert.ok(chart.some((a) => a.id === 'bank:sbi' && a.group === 'LOANS_ST'));
  const lines = [{ account_id: 'bank:icici', dr: 50000, cr: 0 }, { account_id: 'bank', dr: 0, cr: 50000 }];
  assert.deepEqual(validateVoucher({ type: 'CONTRA', date: '2026-06-01', narration: '', lines }, chart), []);
  saveVoucher({ type: 'CONTRA', date: '2026-06-01', narration: 'Transfer', lines });
  saveVoucher({ type: 'CONTRA', date: '2026-06-02', narration: 'Into CC', lines: [{ account_id: 'bank:sbi', dr: 20000, cr: 0 }, { account_id: 'bank:icici', dr: 0, cr: 20000 }] });
  const ledger = ledgerNow();
  assert.equal(bal(ledger, 'bank:icici'), 300);
  assert.equal(bal(ledger, 'bank'), -500);
  assert.equal(bal(ledger, 'bank:sbi'), 200);
});

test('Tally: one ledger per bank, OD under Bank OD A/c, the main account keeps the configured ledger', () => {
  bankAccountsDb.save({ id: 'icici', name: 'ICICI CA' });
  bankAccountsDb.save({ id: 'sbi', name: 'SBI CC', od: true });
  const r = tallyBankResolver('Bank Account', 'Cash');
  assert.deepEqual(r({ method: 'NEFT' }), { ledger: 'Bank Account', parent: 'Bank Accounts' });
  assert.deepEqual(r({ method: 'Cash', bank_account_id: 'icici' }), { ledger: 'Cash', parent: 'Cash-in-Hand' });
  assert.deepEqual(r({ method: 'NEFT', bank_account_id: 'sbi' }), { ledger: 'SBI CC', parent: 'Bank OD A/c' });
  const inv = createViaStore({ date: '2026-05-01', due: '2026-05-31', lines: [{ qty: 1, rate: 10000 }], client: clientMH });
  localDb.payments.record({ invoiceId: inv.id, amount: 3000, method: 'UPI', date: '2026-05-02' });
  localDb.payments.record({ invoiceId: inv.id, amount: 2000, method: 'NEFT', date: '2026-05-03', bankAccountId: 'icici' });
  const model = buildTallyModel({ invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll(), purchases: [], vendors: [] } as never, { companyName: 'X' });
  const receipts = model.vouchers.filter((v) => v.type === 'Receipt');
  assert.deepEqual(receipts.map((v) => v.entries[0].ledger).sort(), ['Bank Account', 'ICICI CA']);
  assert.ok(model.ledgers.some((l) => l.name === 'ICICI CA' && l.parent === 'Bank Accounts'));
});

/* ── Cheques ───────────────────────────────────────────────── */

const received = (over: Partial<ChequeInput> = {}): ChequeInput => ({
  direction: 'received', number: '004512', bank: 'HDFC Bank', cheque_date: '2026-05-20', amount: 9000, party_name: 'Acme', ...over,
});

test('cheque against several invoices: validation, one payment each into the cheque\'s account, bounce reverses all + charges', () => {
  bankAccountsDb.save({ id: 'icici', name: 'ICICI CA' });
  const i1 = createViaStore({ date: '2026-05-01', due: '2026-05-31', lines: [{ qty: 1, rate: 5000 }], client: clientMH });
  const i2 = createViaStore({ date: '2026-05-02', due: '2026-05-31', lines: [{ qty: 1, rate: 3000 }], client: clientMH });
  assert.match(validateCheque(received({ allocations: [{ invoice_id: i1.id, amount: 6000 }, { invoice_id: i2.id, amount: 3500 }] }))[0], /more than the cheque/);
  assert.match(validateCheque(received({ allocations: [{ invoice_id: i1.id, amount: 100 }, { invoice_id: i1.id, amount: 100 }] }))[0], /twice/);
  const c = saveCheque(received({ allocations: [{ invoice_id: i1.id, amount: 5000 }, { invoice_id: i2.id, amount: 3000 }], bank_account_id: 'icici' }));
  assert.equal(allocatedTotal(c.allocations), 8000);
  assert.equal(chequeAllocations(c).length, 2);
  transitionCheque(c.id, 'deposited', { date: '2026-05-21', today: '2026-06-30' });
  const r = transitionCheque(c.id, 'cleared', { date: '2026-05-22', today: '2026-06-30' });
  assert.equal(r.cheque.payment_ids?.length, 2);
  assert.match(r.note ?? '', /2 invoices settled.*1,000\.00 is not allocated/);
  const pays = localDb.payments.getAll();
  assert.deepEqual(pays.map((p) => [p.amount, p.bank_account_id, p.method]).sort(), [[3000, 'icici', 'Cheque'], [5000, 'icici', 'Cheque']]);
  assert.throws(() => saveCheque({ ...received({ allocations: [{ invoice_id: i1.id, amount: 4000 }] }), id: c.id }), /payment was recorded/);
  assert.equal(bal(ledgerNow(), 'bank:icici'), 8000);

  const b = transitionCheque(c.id, 'bounced', { date: '2026-05-25', today: '2026-06-30', reason: 'Funds insufficient', charges: 590 });
  assert.equal(localDb.payments.getAll().length, 0);
  assert.equal(b.cheque.payment_ids, undefined);
  assert.equal(b.cheque.bounce_charges, 590);
  const vouchers = loadVouchers();
  assert.equal(vouchers.length, 1);
  assert.deepEqual(vouchers[0].lines.map((l) => [l.account_id, l.dr, l.cr]), [[A.bankCharges, 59000, 0], ['bank:icici', 0, 59000]]);
  const ledger = ledgerNow();
  assert.equal(bal(ledger, 'bank:icici'), -590);
  assert.equal(bal(ledger, A.bankCharges), 590);
});

test('issued cheque against several bills records one supplier payment per bill; cancel reverses them', () => {
  const b1 = purchasesDb.save(bill({ bill_number: 'B1' }));
  const b2 = purchasesDb.save(bill({ bill_number: 'B2', total: 500, taxable: 500, lines: [{ id: 'l', name: 'x', quantity: 1, rate: 500, tax_rate: 0 }] }));
  const c = saveCheque({ direction: 'issued', number: '000101', bank: 'HDFC', cheque_date: '2026-05-20', amount: 1500, party_name: 'Landlord', allocations: [{ purchase_id: b1.id, amount: 1000 }, { purchase_id: b2.id, amount: 500 }] });
  const r = transitionCheque(c.id, 'cleared', { date: '2026-05-21', today: '2026-06-30' });
  assert.equal(r.cheque.purchase_payment_ids?.length, 2);
  assert.equal(purchasesDb.get(b1.id)?.amount_paid, 1000);
  assert.equal(purchasesDb.get(b2.id)?.amount_paid, 500);
  assert.equal(loadCheques()[0].status, 'cleared');
});

/* ── Deposit slip ──────────────────────────────────────────── */

test('deposit slip: depositable cheques, denominations, totals, save marks cheques deposited into the account', () => {
  bankAccountsDb.save({ id: 'icici', name: 'ICICI CA', account_no: '000405012345', ifsc: 'ICIC0000004' });
  const a = saveCheque(received({ number: '100001', amount: 1200 }));
  saveCheque(received({ number: '100002', amount: 800, cheque_date: '2026-07-01' })); // post-dated
  const today = '2026-06-01';
  const ok = depositableCheques(loadCheques(), today);
  assert.deepEqual(ok.map((c) => c.number), ['100001']);
  const counts = normalizeCounts({ '500': 3, '100': '2', '7': 9, '10': -1 });
  assert.deepEqual(counts, { '500': 3, '100': 2 });
  assert.equal(cashTotal(counts), 1700);
  assert.equal(denominationRows(counts).find((r) => r.value === 500)?.amount, 1500);
  assert.match(validateDepositSlip({ date: today, cheques: [], cash: {} }, today)[0], /at least one/);
  const slip = saveDepositSlip({ date: today, bank_account_id: 'icici', cheque_ids: [a.id], cash: counts, depositor: 'Ravi' }, today);
  assert.equal(slip.number, 'PIS/FY26-27/0001');
  assert.equal(slip.total, 2900);
  const dep = loadCheques().find((c) => c.id === a.id)!;
  assert.equal(dep.status, 'deposited');
  assert.equal(dep.bank_account_id, 'icici');
  assert.equal(dep.deposit_slip_id, slip.id);
  assert.equal(loadDepositSlips().length, 1);
  const view = depositSlipView(slip, [dep], bankAccountsDb.all().find((x) => x.id === 'icici'));
  assert.equal(view.accountNo, '000405012345', 'the slip itself carries the full number');
  assert.equal(view.chequeTotal, 1200);
  assert.match(view.words, /Two Thousand Nine Hundred/i);
  assert.equal(saveDepositSlip({ date: today, cheque_ids: [], cash: { '50': 1 } }, today).number, 'PIS/FY26-27/0002');
});

test('cash tally: counted vs books, one count per day', () => {
  assert.deepEqual(tallyCash({ '500': 2 }, 1000), { counted: 1000, difference: 0, status: 'tallied' });
  assert.equal(tallyCash({ '100': 1 }, 150).status, 'short');
  saveCashTally({ date: '2026-06-01', counts: { '200': 1 }, expected: 150 });
  const t = saveCashTally({ date: '2026-06-01', counts: { '100': 1, '50': 1 }, expected: 150, note: 'recount' });
  const all = loadCashTallies();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, t.id);
  assert.equal(all[0].difference, 0);
});

/* ── Payment advice & e-payments ───────────────────────────── */

test('payment advice: bills settled, TDS on bill and on payment, on-account rest; account masked', () => {
  const v = vendorsDb.save({ name: 'Consultant LLP', bank_account_no: '50100012345678', bank_ifsc: 'HDFC0001234', bank_name: 'HDFC Bank' });
  const b1 = purchasesDb.save(bill({ vendor_id: v.id, vendor_name: v.name, bill_number: 'C-1', total: 10000, taxable: 10000, tds_section: '194J', tds_amount: 1000, tds_on: 'BILL', lines: [{ id: 'l', name: 'Fees', quantity: 1, rate: 10000, tax_rate: 0 }] }));
  const b2 = purchasesDb.save(bill({ vendor_id: v.id, vendor_name: v.name, bill_number: 'C-2', date: '2026-05-12' }));
  const res = recordSupplierPayment({ vendorId: v.id, vendorName: v.name, date: '2026-05-20', amount: 10500, method: 'NEFT', reference: 'UTR1', allocations: [{ purchaseId: b1.id, amount: 9000 }, { purchaseId: b2.id, amount: 1000 }], remainderKind: 'ADVANCE' });
  const input = { purchases: purchasesDb.all(), payments: paymentsDb.all(), vendorPayments: vendorPaymentsDb.all(), vendors: vendorsDb.all(), bankAccounts: bankAccountsDb.all() };
  const refs = supplierPaymentRefs(input);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].key, `g:${res.groupId}`);
  assert.equal(refs[0].amount, 10500);
  const adv = buildPaymentAdvice(refs[0].key, input)!;
  assert.equal(adv.vendor, 'Consultant LLP');
  assert.equal(adv.vendorBank, 'HDFC Bank · ••••5678 · HDFC0001234');
  assert.deepEqual(adv.lines.map((l) => [l.billNo, l.paid, l.tdsOnBill, l.balance]), [['C-1', 9000, 1000, 0], ['C-2', 1000, 0, 0]]);
  assert.equal(adv.onAccount, 500);
  assert.equal(adv.onAccountLabel, 'Advance');
  assert.equal(adv.totalPaid, 10500);
  assert.equal(adv.totalTds, 1000);
  assert.equal(adv.paidFrom, 'Main bank account');
  assert.equal(buildPaymentAdvice('g:none', input), null);
});

test('bulk e-payment file: validation and presets', () => {
  const row: UploadRow = { beneficiary: 'Consultant LLP', accountNo: '5010 0012 345678', ifsc: 'hdfc0001234', amount: 10500, mode: 'NEFT', reference: 'C-1, C-2' };
  assert.deepEqual(validateUploadRow(row), []);
  assert.match(validateUploadRow({ ...row, ifsc: 'HDFC1234' }).join(), /IFSC/);
  assert.match(validateUploadRow({ ...row, mode: 'RTGS' }).join(), /RTGS needs/);
  assert.equal(suggestMode(250000), 'RTGS');
  assert.equal(suggestMode(10000), 'NEFT');
  assert.match(validateUpload({ preset: 'hdfc', date: '2026-05-20', debitAccountNo: '', rows: [row] })[0], /account to debit/);
  const g = buildUploadFile({ preset: 'generic', date: '2026-05-20', debitAccountNo: '', rows: [row] });
  const lines = g.text.trim().split('\r\n');
  assert.equal(lines[0].split(',')[0], 'Payment Type');
  assert.equal(lines[1], 'NEFT,,Consultant LLP,50100012345678,HDFC0001234,10500.00,20/05/2026,C-1 C-2,,');
  assert.equal(g.total, 10500);
  const h = buildUploadFile({ preset: 'hdfc', date: '2026-05-20', debitAccountNo: '000405012345', rows: [row, { ...row, mode: 'RTGS', amount: 300000 }] });
  const hl = h.text.trim().split('\r\n');
  assert.equal(hl.length, 2, 'HDFC layout has no header row');
  assert.ok(hl[1].startsWith('R,V0002,50100012345678,300000.00,Consultant LLP'));
  for (const preset of ['icici', 'sbi'] as const) {
    const f = buildUploadFile({ preset, date: '2026-05-20', debitAccountNo: '000405012345', rows: [row] });
    assert.ok(f.text.includes('000405012345') && f.text.includes('HDFC0001234'), preset);
  }
  assert.throws(() => buildUploadFile({ preset: 'generic', date: '2026-05-20', debitAccountNo: '', rows: [] }), /at least one/);
});
