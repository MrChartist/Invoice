/** RT-D2: EMI / consumer-finance — tender split, transfer journal (customer nil, financier owes), disbursement + fee bill. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { clientRetail, createViaStore, installSettings, reload } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { loadLedger } from '../src/lib/ledger/index.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { draftsDb } from '../src/lib/purchase-drafts.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import { zReport } from '../src/lib/pos.ts';
import { todaySummary } from '../src/lib/today.ts';
import { receiptCandidates } from '../src/lib/bank-recon.ts';
import { manualCashVouchers } from '../src/lib/books.ts';
import {
  cancelDeal, dealClosed, dealOpen, feeSplit, financeCsv, financeSplit, financierSummary, loadDeals, pendingDos, recordDisbursement, recordFinance, undoDisbursement,
} from '../src/lib/retail/rt-finance.ts';
import type { Payment } from '../src/types/invoice.ts';

const DAY = '2026-07-20';
beforeEach(() => {
  resetStorage();
  installSettings();
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

/** ₹42,000 TV (incl. GST at the bill's 0% line for round numbers), ₹8,400 down in cash. */
function tvSale() {
  const inv = createViaStore({ client: clientRetail, date: DAY, lines: [{ name: 'LED TV 43"', hsn: '8528', qty: 1, rate: 42000, tax: 0 }], status: 'Sent', patch: { pos: true } as never });
  localDb.payments.record({ invoiceId: inv.id, amount: 8400, method: 'Cash', date: DAY, note: 'POS' });
  return reload(inv.id);
}
const net = (account: string, party?: string) => loadLedger().vouchers.flatMap((v) => v.lines).filter((l) => l.account === account && (party === undefined || l.party === party)).reduce((s, l) => s + l.dr - l.cr, 0) / 100;

test('tender split: the customer pays the bill less the loan', () => {
  assert.deepEqual(financeSplit(42000, 33600), { down: 8400, loan: 33600, error: '' });
  assert.match(financeSplit(42000, 50000).error, /more than the bill/);
  assert.match(financeSplit(42000, 0).error, /loan amount/);
});

test('transfer: the customer bill is settled, the financier owes the DO; no cash reader sees it', () => {
  const inv = tvSale();
  const deal = recordFinance({ invoiceId: inv.id, financier: 'Bajaj Finserv', loan: 33600, doNo: 'D-77812', scheme: '6/0', loanAccount: '1234 5678 9012' });
  assert.equal(reload(inv.id).status, 'Paid');
  assert.equal(deal.down_payment, 8400);
  assert.equal(deal.loan_account, '9012', 'masked to the last 4');
  const row = getTable<Payment>('transactions').find((p) => p.id === deal.transfer_payment_id)!;
  assert.equal(movedNoCash(row), true, 'the transfer row moved no money');
  assert.equal(net(A.debtors, clientRetail.name), 0, 'customer nil in the books');
  assert.equal(net(A.debtors, 'Bajaj Finserv'), 33600, 'financier owes the DO');
  const pays = getTable<Payment>('transactions');
  const invs = localDb.invoices.getAll();
  const z = zReport(DAY, invs, pays);
  assert.deepEqual([z.tenders.cash, z.tenders.other], [8400, 0], 'Z report: the finance part is not a tender of the drawer');
  assert.equal(z.credit, 0);
  assert.equal(todaySummary({ invoices: invs, payments: pays, purchases: [] }, DAY).bank, 0);
  assert.equal(receiptCandidates(invs, pays).length, 0, 'not a bank receipt to reconcile');
  assert.equal(manualCashVouchers(loadVouchers(), pays).length, 0, 'the transfer journal is not a cash-book entry');
  assert.throws(() => recordFinance({ invoiceId: inv.id, financier: 'HDFC', loan: 1, doNo: 'X' }), /unpaid/);
});

test('disbursement + fee bill closes the DO; a partial disbursement keeps it open; undo', () => {
  const inv = tvSale();
  const deal = recordFinance({ invoiceId: inv.id, financier: 'Bajaj Finserv', loan: 33600, doNo: 'D-77812' });
  const part = recordDisbursement(deal.id, { date: '2026-07-22', amount: 20000, method: 'Bank transfer' });
  assert.equal(dealOpen(part), 13600);
  assert.equal(dealClosed(part), false);
  assert.equal(pendingDos(loadDeals(), '2026-07-30').length, 1, 'open after 7 days');
  const done = recordDisbursement(deal.id, { date: '2026-07-25', amount: 12844, fee: 756, method: 'Bank transfer' });
  assert.ok(dealClosed(done));
  assert.equal(net(A.debtors, 'Bajaj Finserv'), 0, 'financier settled');
  assert.equal(net(A.bank), 32844, 'net money reached the bank');
  assert.equal(net(A.creditors, 'Bajaj Finserv'), 756, 'fee withheld sits against the financier until its bill is approved');
  const draft = draftsDb.all().find((d) => d.vendor_name === 'Bajaj Finserv')!;
  assert.deepEqual([draft.total, draft.taxable, draft.cgst + draft.sgst, draft.lines[0].hsn, draft.lines[0].tax_rate, draft.itc_eligible], [756, 640.68, 115.32, '997119', 18, true]);
  assert.deepEqual(feeSplit(756), { sac: '997119', rate: 18, taxable: 640.68, gst: 115.32 });
  assert.equal(manualCashVouchers(loadVouchers(), getTable<Payment>('transactions')).reduce((s, v) => s + v.credit, 0), 32844, 'cash book: the bank receipts only');
  assert.throws(() => recordDisbursement(deal.id, { date: '2026-07-26', amount: 1 }), /Only ₹0.00/);
  const s = financierSummary(loadDeals());
  assert.deepEqual([s[0].loan, s[0].received, s[0].fees, s[0].open], [33600, 32844, 756, 0]);
  assert.match(financeCsv(loadDeals(), '2026-07-30'), /D-77812/);
  const back = undoDisbursement(deal.id, done.disbursements[1].id);
  assert.equal(dealOpen(back), 13600);
  assert.equal(draftsDb.all().length, 0, 'the fee draft goes with it');
  assert.throws(() => cancelDeal(deal.id), /disbursements first/);
  undoDisbursement(deal.id, back.disbursements[0].id);
  cancelDeal(deal.id);
  assert.equal(reload(inv.id).balance_due, 33600, 'cancelled: the customer owes again');
  assert.equal(net(A.debtors, 'Bajaj Finserv'), 0);
});
