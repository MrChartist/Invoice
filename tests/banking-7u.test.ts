/**
 * 7U banking follow-ups (roadmap 7.23): forex bank ledgers (FCY + INR balances, realised difference on
 * conversion, unrealised on revaluation), e-payment confirmation (parse, match, record all or
 * nothing), Contra for a deposit slip's cash, supplier payments in the Tally export.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientUS, createViaStore, installSettings } from './helpers/world.ts';
import { bankAccountsDb } from '../src/lib/bank-accounts.ts';
import { bankLedgerId } from '../src/lib/bank-ledgers.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { buildLedger, loadLedgerInput, trialBalance } from '../src/lib/ledger/index.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { localDb } from '../src/lib/localDb.ts';
import {
  carryingRate, deleteFxMove, fcyBalanceAt, forexSummary, fxMovements, ledgerInrBalance, liveForexData, loadFxMoves,
  moveVoucherLines, planOutflow, planRevaluation, recordFxMove, setAccountCurrency,
} from '../src/lib/forex-bank.ts';
import { loadEpayBatches, matchResponse, parseBankResponse, recordConfirmed, responseStatus, saveEpayBatch } from '../src/lib/epay-confirm.ts';
import { paymentsDb, purchasesDb } from '../src/lib/purchases.ts';
import { vendorPaymentsDb } from '../src/lib/billwise.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { saveDepositSlip } from '../src/lib/deposit-slip.ts';
import { SINGLETON_KEYS, getTable, setJson } from '../src/lib/storage.ts';
import { loadTallyBooksSource } from '../src/lib/tally-books.ts';
import { buildTallyModel } from '../src/lib/tally-xml.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

const setLock = (day: string) => setJson(SINGLETON_KEYS.settings, { lock_until: day });

beforeEach(() => {
  resetStorage();
  installSettings();
});

const ledgerNow = () => buildLedger(loadLedgerInput(undefined, '2026-10-25'));
function bal(account: string, date = '2099-12-31'): number {
  let p = 0;
  for (const v of ledgerNow().vouchers) if (v.date <= date) for (const l of v.lines) if (l.account === account) p += l.dr - l.cr;
  return p / 100;
}

/* ── Forex bank ledgers ─────────────────────────────────────── */

test('forex: pure plans — carrying rate, outflow with realised difference, revaluation', () => {
  assert.equal(carryingRate(1000, 83000), 83);
  assert.equal(carryingRate(0, 50), null);
  const p = planOutflow({ fcy: 400, inrReceived: 34000, fcyBalance: 1000, inrBalance: 83000 });
  assert.deepEqual(p, { carrying: 33200, diff: 800, errors: [] });
  // The whole balance leaves at exactly the book value (no paise drift).
  assert.equal(planOutflow({ fcy: 333.33, inrReceived: 1, fcyBalance: 333.33, inrBalance: 27777.77 }).carrying, 27777.77);
  assert.match(planOutflow({ fcy: 2000, inrReceived: 1, fcyBalance: 1000, inrBalance: 83000 }).errors[0], /Only 1000.00/);
  const r = planRevaluation({ fcyBalance: 600, inrBalance: 49800, rate: 84.5 });
  assert.deepEqual(r, { fcy: 600, book: 49800, restated: 50700, diff: 900 });
  const lines = moveVoucherLines({ kind: 'out', inr: 34000, carrying: 33200, diff: 800, counter_account: A.bank }, 'bank:eefc');
  assert.deepEqual(lines.map((l) => [l.account_id, l.dr, l.cr]), [[A.bank, 3400000, 0], ['bank:eefc', 0, 3320000], [A.fxGain, 0, 80000]]);
  const loss = moveVoucherLines({ kind: 'revalue', inr: -500, diff: -500 }, 'bank:eefc');
  assert.deepEqual(loss.map((l) => [l.account_id, l.dr, l.cr]), [['bank:eefc', 0, 50000], [A.fxGain, 50000, 0]]);
});

test('forex: EEFC account — receipts in USD, conversion (realised) and revaluation (unrealised) tie the ledger', () => {
  bankAccountsDb.save({ id: 'eefc', name: 'HDFC EEFC USD', opening: 83000, opening_as_of: '2026-04-01' });
  assert.throws(() => setAccountCurrency('default', 'USD'), /main bank account stays in rupees/);
  setAccountCurrency('eefc', 'usd', 1000);
  const acc = bankAccountsDb.all().find((a) => a.id === 'eefc')!;
  assert.equal(acc.currency, 'USD');
  assert.equal(acc.fcy_opening, 1000);

  // A USD invoice paid into the EEFC account at a realised rate.
  const inv = createViaStore({ client: clientUS, date: '2026-05-01', currency: 'USD', supply: 'EXPORT_LUT' as never, lines: [{ qty: 1, rate: 500, tax: 0 }], patch: { exchange_rate: 84 } });
  localDb.payments.record({ invoiceId: inv.id, amount: 500, method: 'Bank transfer', date: '2026-05-10', realisedRate: 84.2, bankAccountId: 'eefc' });
  const data = liveForexData();
  assert.equal(fcyBalanceAt(acc, data, '2026-05-31'), 1500);
  const inr = ledgerInrBalance('eefc', '2026-05-31');
  assert.equal(inr, 83000 + 42100, 'opening + receipt at the realised rate');

  // Convert USD 600 into the main account at 84.5: carrying = 600 × (125100 / 1500) = 50040.
  const out = recordFxMove({ bank_account_id: 'eefc', date: '2026-06-01', kind: 'out', fcy: 600, rate: 84.5, counter_account: A.bank });
  assert.equal(out.carrying, 50040);
  assert.equal(out.inr, 50700);
  assert.equal(out.diff, 660);
  assert.equal(fcyBalanceAt(acc, liveForexData(), '2026-06-30'), 900);
  assert.equal(ledgerInrBalance('eefc', '2026-06-30'), 125100 - 50040);
  assert.equal(bal(A.fxGain), -660 + -(42100 - 42000), 'realised gain on conversion + on the receipt (credit)');

  // Period-end revaluation of USD 900 at 85: restated 76500 vs book 75060 → unrealised gain 1440.
  const rv = recordFxMove({ bank_account_id: 'eefc', date: '2026-06-30', kind: 'revalue', rate: 85 });
  assert.equal(rv.diff, 1440);
  assert.equal(ledgerInrBalance('eefc', '2026-06-30'), 76500);
  assert.match(loadVouchers().find((v) => v.id === rv.voucher_id)!.narration, /unrealised exchange gain .*verify with your CA/);
  assert.throws(() => recordFxMove({ bank_account_id: 'eefc', date: '2026-06-30', kind: 'revalue', rate: 85 }), /Nothing to revalue/);

  const tb = trialBalance(ledgerNow(), { start: '2026-04-01', end: '2027-03-31' });
  assert.equal(tb.totals.closingDr, tb.totals.closingCr, 'trial balance still balances');
  assert.ok(tb.totals.closingDr > 0);

  const sum = forexSummary(acc, { from: '2026-04-01', to: '2026-06-30' });
  assert.equal(sum.fcy, 900);
  assert.equal(sum.realised, 660);
  assert.equal(sum.unrealised, 1440);
  assert.equal(sum.rate, 85);
  assert.deepEqual(fxMovements(acc, liveForexData()).map((r) => r.kind), ['opening', 'receipt', 'out', 'revalue']);

  deleteFxMove(rv.id);
  assert.equal(loadFxMoves().length, 1);
  assert.equal(ledgerInrBalance('eefc', '2026-06-30'), 75060);
});

test('forex: a locked period refuses the entry and leaves nothing behind', () => {
  bankAccountsDb.save({ id: 'eefc', name: 'EEFC', opening: 8300, opening_as_of: '2026-04-01' });
  setAccountCurrency('eefc', 'USD', 100);
  setLock('2026-06-30');
  assert.throws(() => recordFxMove({ bank_account_id: 'eefc', date: '2026-06-15', kind: 'revalue', rate: 90 }));
  assert.equal(loadFxMoves().length, 0);
  assert.equal(loadVouchers().length, 0);
});

/* ── e-Payment confirmation ─────────────────────────────────── */

const bill = (over: Partial<PurchaseRecord> = {}): Omit<PurchaseRecord, 'id'> => ({
  kind: 'EXPENSE', vendor_name: 'Landlord', bill_number: 'R-1', date: '2026-05-10', category: 'Rent',
  lines: [{ id: 'l1', name: 'Rent', quantity: 1, rate: 1000, tax_rate: 0 }],
  taxable: 1000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 1000, amount_paid: 0, ...over,
} as Omit<PurchaseRecord, 'id'>);

test('e-payment response: status words, header detection, statement rows read as paid', () => {
  assert.equal(responseStatus('Success'), 'paid');
  assert.equal(responseStatus('PROCESSED'), 'paid');
  assert.equal(responseStatus('Rejected - invalid IFSC'), 'failed');
  assert.equal(responseStatus('Pending'), 'pending');
  const rows = parseBankResponse('Bulk payment status report\nCustomer Ref,Beneficiary Account,Amount,Status,UTR No,Value Date,Reason\nBills due,000123459876,"1,500.00",Success,HDFCN2026061000001,10/06/2026,\nRent June,99887766,1000,Failed,,10/06/2026,Account closed\n');
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].reference, rows[0].amount, rows[0].status, rows[0].utr, rows[0].date, rows[0].account], ['Bills due', 1500, 'paid', 'HDFCN2026061000001', '2026-06-10', '9876']);
  assert.equal(rows[1].status, 'failed');
  assert.equal(rows[1].reason, 'Account closed');
  const st = parseBankResponse('Date,Narration,Withdrawal,Deposit\n11-06-2026,NEFT-ACME-EPB REF 7,2500.00,\n');
  assert.deepEqual([st[0].amount, st[0].status, st[0].date], [2500, 'paid', '2026-06-11']);
  assert.throws(() => parseBankResponse('a,b\n1,2\n'), /No amount/);
});

test('e-payment batch: match by reference, account, unique amount; record paid rows all or nothing', () => {
  const acme = vendorsDb.save({ name: 'Acme Supplies', bank_account_no: '000123459876', bank_ifsc: 'HDFC0000123' } as never);
  const bolt = vendorsDb.save({ name: 'Bolt Traders' } as never);
  const cog = vendorsDb.save({ name: 'Cog Works' } as never);
  const b1 = purchasesDb.save(bill({ vendor_id: acme.id, vendor_name: acme.name, bill_number: 'A-1', total: 1000, taxable: 1000, date: '2026-05-01' }));
  const b2 = purchasesDb.save(bill({ vendor_id: acme.id, vendor_name: acme.name, bill_number: 'A-2', total: 800, taxable: 800, date: '2026-05-20' }));
  purchasesDb.save(bill({ vendor_id: bolt.id, vendor_name: bolt.name, bill_number: 'B-1', total: 2500, taxable: 2500 }));
  bankAccountsDb.save({ id: 'icici', name: 'ICICI CA' });
  const batch = saveEpayBatch({
    date: '2026-06-10', bank_account_id: 'icici', preset: 'generic',
    rows: [
      { vendorId: acme.id, vendorName: acme.name, amount: 1500, mode: 'NEFT', reference: 'Bills due', accountNo: '000123459876' },
      { vendorId: bolt.id, vendorName: bolt.name, amount: 2500, mode: 'NEFT', reference: 'B-1', accountNo: '55554444' },
      { vendorId: cog.id, vendorName: cog.name, amount: 700, mode: 'IMPS', reference: 'Advance', accountNo: '11112222' },
    ],
  });
  assert.equal(batch.number, 'EPB/FY26-27/0001');
  assert.equal(batch.rows[0].account_last4, '9876');

  const resp = parseBankResponse('Ref,Amount,Status,UTR,Date,Beneficiary Account\nBills due,1500,Success,UTR1,10/06/2026,000123459876\nxx,2500,Success,UTR2,11/06/2026,55554444\nyy,700,Failed,,10/06/2026,\nzz,99,Success,UTR9,10/06/2026,\n');
  const m = matchResponse(batch, resp);
  assert.deepEqual(m.matches.map((x) => [x.how, x.status]), [['reference', 'paid'], ['account', 'paid'], ['amount', 'failed']]);
  assert.deepEqual(m.unmatched, [4]);
  assert.deepEqual(m.open, []);

  // A locked day for one row: nothing at all is recorded.
  setLock('2026-06-10');
  assert.throws(() => recordConfirmed(batch.id, m.matches));
  assert.equal(paymentsDb.all().length, 0);
  assert.equal(loadEpayBatches()[0].rows.every((r) => r.status === 'sent'), true);
  setLock('');

  const res = recordConfirmed(batch.id, m.matches);
  assert.deepEqual(res, { paid: 2, failed: 1, total: 4000 });
  // Acme: 1500 → oldest bill A-1 in full (1000), A-2 500.
  assert.equal(purchasesDb.get(b1.id)!.amount_paid, 1000);
  assert.equal(purchasesDb.get(b2.id)!.amount_paid, 500);
  const pp = paymentsDb.all();
  assert.equal(pp.length, 3);
  assert.ok(pp.every((p) => p.bank_account_id === 'icici' && p.method === 'Bank transfer'));
  assert.equal(pp.find((p) => p.purchase_id === b1.id)!.reference, 'UTR1');
  assert.equal(pp.find((p) => p.reference === 'UTR2')!.date, '2026-06-11', 'the bank date');
  const rows = loadEpayBatches()[0].rows;
  assert.deepEqual(rows.map((r) => r.status), ['paid', 'paid', 'failed']);
  assert.equal(vendorPaymentsDb.all().length, 0);
  // Re-recording the same confirmation does nothing (rows are no longer open).
  assert.throws(() => recordConfirmed(batch.id, []), /Nothing confirmed/);
  // Supplier payments reach the Tally export (WP-7 confirmed): one Payment voucher per bill payment.
  const tally = buildTallyModel({ invoices: [], payments: [], clients: [], items: [], purchases: getTable('purchases'), vendors: getTable('vendors'), books: loadTallyBooksSource('2026-10-25') } as never, { companyName: 'Demo Co' });
  const pays = tally.vouchers.filter((v) => v.type === 'Payment');
  assert.equal(pays.length, 3);
  assert.ok(pays.some((v) => v.number === 'A-1/P1' && v.entries[1].ledger === 'ICICI CA'));
});

test('e-payment: a paid row with no open bill goes on account', () => {
  const v = vendorsDb.save({ name: 'New Vendor' } as never);
  const batch = saveEpayBatch({ date: '2026-06-10', preset: 'generic', rows: [{ vendorId: v.id, vendorName: v.name, amount: 300, mode: 'NEFT', reference: 'Advance A' }] });
  const m = matchResponse(batch, parseBankResponse('Reference,Amount,Status\nAdvance A,300,Paid\n'));
  recordConfirmed(batch.id, m.matches);
  assert.equal(vendorPaymentsDb.all()[0].amount, 300);
  assert.equal(vendorPaymentsDb.all()[0].kind, 'ON_ACCOUNT');
});

/* ── Deposit slip cash → Contra ─────────────────────────────── */

test('deposit slip: cash posts a Contra Dr bank | Cr cash on the slip date; optional; refused with the period', () => {
  bankAccountsDb.save({ id: 'icici', name: 'ICICI CA' });
  const slip = saveDepositSlip({ date: '2026-06-01', bank_account_id: 'icici', cheque_ids: [], cash: { '500': 4 } }, '2026-06-01');
  assert.ok(slip.cash_voucher_id);
  const v = loadVouchers().find((x) => x.id === slip.cash_voucher_id)!;
  assert.equal(v.type, 'CONTRA');
  assert.equal(v.date, '2026-06-01');
  assert.match(v.narration, /PIS\/FY26-27\/0001/);
  assert.equal(bal(bankLedgerId('icici')), 2000);
  assert.equal(bal(A.cash), -2000);
  const none = saveDepositSlip({ date: '2026-06-02', cheque_ids: [], cash: { '100': 1 }, post_cash_contra: false }, '2026-06-02');
  assert.equal(none.cash_voucher_id, undefined);
  setLock('2026-06-30');
  assert.throws(() => saveDepositSlip({ date: '2026-06-03', cheque_ids: [], cash: { '100': 1 } }, '2026-06-03'));
  assert.equal(loadVouchers().length, 1);
});
