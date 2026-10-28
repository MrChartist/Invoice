/**
 * A full FY 2025-26 through the same APIs the UI uses, then the double-entry ledger built from
 * storage: every voucher balances, the trial balance agrees, the Schedule III balance sheet ties
 * (P&L flowing into reserves), the cash-flow statement reconciles to the Books cash + bank book,
 * and the GST ledgers agree with the Books GST summary.
 */
import '../helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from '../helpers/shim.ts';
import { clientKA, clientMH, createViaStore, gstin, installSettings, reload } from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { computePurchaseTotals, paymentsDb, purchasesDb } from '../../src/lib/purchases.ts';
import { buildVouchers, cashBook, gstSummary, loadBooksData, profitAndLoss, saveOpening, balanceSheet } from '../../src/lib/books.ts';
import { createCreditNote } from '../../src/lib/documents.ts';
import {
  A,
  accountStatement,
  buildLedger,
  cashFlowStatement,
  closingBalances,
  ledgerBalanceSheet,
  ledgerProfitAndLoss,
  loadLedgerInput,
  saveAsset,
  saveVoucher,
  trialBalance,
  voucherDiff,
} from '../../src/lib/ledger/index.ts';
import type { PurchaseKind, PurchaseRecord } from '../../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const FY = { start: '2025-04-01', end: '2026-03-31' };
const VENDOR_MH = gstin('27AAAPL1234C1Z');
const L = (name: string, qty: number, rate: number, tax: number) => ({ id: 'l-' + name, name, quantity: qty, rate, tax_rate: tax });

function bill(over: Partial<PurchaseRecord> & { lines: PurchaseRecord['lines'] }, pos = '27'): PurchaseRecord {
  const t = computePurchaseTotals(over.lines, { placeOfSupply: pos, businessState: '27' });
  return purchasesDb.save({
    kind: 'PURCHASE' as PurchaseKind,
    vendor_name: 'Vendor',
    bill_number: 'B-1',
    date: '2025-04-05',
    category: 'Purchases',
    taxable: t.taxable,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    itc_eligible: true,
    total: t.total,
    amount_paid: 0,
    ...over,
  });
}

function year() {
  saveOpening('bank', 200000, '2025-04-01');
  saveOpening('cash', 10000, '2025-04-01');
  // Capital and a loan by journal / receipt vouchers.
  saveVoucher({ type: 'RECEIPT', date: '2025-04-02', narration: 'Capital introduced', lines: [{ account_id: A.bank, dr: 50000000, cr: 0 }, { account_id: A.capital, dr: 0, cr: 50000000 }] });
  saveVoucher({ type: 'RECEIPT', date: '2025-05-01', narration: 'Term loan', lines: [{ account_id: A.bank, dr: 30000000, cr: 0 }, { account_id: A.securedLoans, dr: 0, cr: 30000000 }] });

  // Sales: intra with freight, inter with TDS, a credit note, a USD export.
  const s1 = createViaStore({ date: '2025-04-10', client: clientMH, lines: [{ qty: 10, rate: 10000, tax: 18 }], shipping: 500 });
  const s2 = createViaStore({ date: '2025-06-15', client: clientKA, lines: [{ qty: 1, rate: 200000, tax: 18 }], tds: { rate: 10, section: '194J' } });
  const cnDraft = createCreditNote(reload(s1.id), { reason: 'Damaged', lines: [{ itemId: reload(s1.id).items[0].id, quantity: 2 }] });
  localDb.invoices.save({ ...reload(cnDraft.id), status: 'Sent', issue_date: '2025-05-01' });
  const s3 = createViaStore({ date: '2025-08-01', lines: [{ qty: 10, rate: 100, tax: 0 }], currency: 'USD', supply: 'EXPORT_LUT', patch: { exchange_rate: 85.5 } });

  // Receipts (incl. one net of TDS: 2,36,000 − 20,000 = 2,16,000).
  localDb.payments.record({ invoiceId: s1.id, amount: 50000, method: 'Bank transfer', date: '2025-04-30' });
  localDb.payments.record({ invoiceId: s1.id, amount: 5000, method: 'Cash', date: '2025-05-05' });
  localDb.payments.record({ invoiceId: s2.id, amount: 216000, method: 'UPI', date: '2025-07-15' });
  localDb.payments.record({ invoiceId: s3.id, amount: 1000, method: 'Bank transfer', date: '2025-09-01' });

  // Purchases: normal, RCM (legal fees), import of goods, blocked ITC, an expense.
  const p1 = bill({ vendor_name: 'Paper Co', vendor_gstin: VENDOR_MH, bill_number: 'PC-1', lines: [L('Paper', 500, 100, 18)] });
  const p2 = bill({ vendor_name: 'Advocate', bill_number: 'ADV-1', date: '2025-06-01', category: 'Professional fees', kind: 'EXPENSE', reverse_charge: true, lines: [L('Legal fees', 1, 20000, 18)] });
  bill({ vendor_name: 'Shenzhen Ltd', bill_number: 'IMP-1', date: '2025-07-01', import_type: 'GOODS', boe_number: '1234567', lines: [L('Parts', 100, 300, 18)] }, '96');
  bill({ vendor_name: 'Gift Shop', bill_number: 'GS-1', date: '2025-09-01', itc_eligible: false, lines: [L('Gifts', 10, 500, 18)] });
  const p5 = bill({ vendor_name: 'Landlord', bill_number: 'RENT-1', date: '2025-04-01', kind: 'EXPENSE', category: 'Rent', lines: [L('Rent', 1, 120000, 0)] });
  paymentsDb.record(p1.id, { amount: 59000, date: '2025-05-10', method: 'Bank transfer' });
  paymentsDb.record(p2.id, { amount: 20000, date: '2025-06-10', method: 'Bank transfer' });
  paymentsDb.record(p5.id, { amount: 120000, date: '2025-04-05', method: 'Cash' });

  // GST deposited in cash and an RCM liability set off; interest; drawings; customs IGST paid.
  saveVoucher({ type: 'PAYMENT', date: '2025-07-20', narration: 'RCM GST paid (PMT-06)', lines: [{ account_id: A.rcmPayable, dr: 360000, cr: 0 }, { account_id: A.bank, dr: 0, cr: 360000 }] });
  saveVoucher({ type: 'PAYMENT', date: '2025-07-01', narration: 'Customs IGST on BoE 1234567', lines: [{ account_id: A.importIgst, dr: 540000, cr: 0 }, { account_id: A.bank, dr: 0, cr: 540000 }] });
  saveVoucher({ type: 'PAYMENT', date: '2026-03-31', narration: 'Loan interest', lines: [{ account_id: A.interestExp, dr: 2400000, cr: 0 }, { account_id: A.bank, dr: 0, cr: 2400000 }] });
  saveVoucher({ type: 'PAYMENT', date: '2025-12-31', narration: 'Drawings', lines: [{ account_id: A.drawings, dr: 1000000, cr: 0 }, { account_id: A.cash, dr: 0, cr: 1000000 }] });
  saveVoucher({ type: 'CONTRA', date: '2025-10-01', narration: 'Cash deposited', lines: [{ account_id: A.bank, dr: 500000, cr: 0 }, { account_id: A.cash, dr: 0, cr: 500000 }] });
  saveVoucher({ type: 'JOURNAL', date: '2026-03-31', narration: 'Closing stock', lines: [{ account_id: A.stock, dr: 1500000, cr: 0 }, { account_id: A.otherIncome, dr: 0, cr: 1500000 }] });

  // Fixed assets: laptop bought from the bank (full rate) and furniture late in the year (half rate).
  saveAsset({ name: 'Laptop', block: 'COMPUTER', account_id: A.faComputers, cost: 90000, acquired_on: '2025-05-01', put_to_use: '2025-05-01', paid_from: A.bank });
  saveAsset({ name: 'Desk', block: 'FURNITURE', account_id: A.faFurniture, cost: 40000, acquired_on: '2025-11-01', put_to_use: '2025-11-01', paid_from: A.bank });
}

test('full year: balanced vouchers, trial balance, Schedule III tie-out and AS 3 reconciliation', () => {
  year();
  const books = loadBooksData();
  const ledger = buildLedger(loadLedgerInput(books, '2026-03-31'));
  assert.deepEqual(ledger.warnings, []);
  for (const v of ledger.vouchers) assert.equal(voucherDiff(v), 0, `${v.kind} ${v.number} does not balance`);
  assert.ok(ledger.vouchers.some((v) => v.kind === 'Depreciation'));

  const tb = trialBalance(ledger, FY);
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal(tb.totals.closingDr, tb.totals.closingCr);

  // RCM: 20,000 × 18% = 3,600 credited to RCM payable, and paid → nil. Supplier owed only 20,000 (paid).
  const close = closingBalances(ledger, FY.end);
  assert.equal(close.get(A.rcmPayable), 0);
  assert.equal(close.get(A.importIgst), 0);
  assert.equal(accountStatement(ledger, A.creditors, FY, 'Advocate')!.closing, 0);
  // Customs IGST: 30,000 × 18% = 5,400 claimed as input IGST.
  assert.ok((close.get(A.inIgst) ?? 0) >= 540000);
  // TDS: 10% of 2,00,000 = 20,000 receivable, customer cleared.
  assert.equal(close.get(A.tdsReceivable), 2000000);
  assert.equal(accountStatement(ledger, A.debtors, FY, clientKA.name)!.closing, 0);

  // Depreciation: laptop 90,000 × 40% = 36,000; desk used 151 days → 40,000 × 5% = 2,000.
  const pl = ledgerProfitAndLoss(ledger, FY);
  const dep = pl.expenses.find((s) => s.group === 'DEPRECIATION')!.total;
  assert.equal(dep, 3800000);

  // Balance sheet ties, with this year's profit inside reserves.
  const bs = ledgerBalanceSheet(ledger, FY.end);
  assert.equal(bs.difference, 0);
  assert.equal(bs.totalAssets, bs.totalEquityAndLiabilities);
  assert.equal(bs.profitForYear, pl.netProfit);
  assert.equal(bs.fixedAssets.net, 13000000 - 3800000);

  // Cash flow reconciles to the Books cash + bank books.
  const cf = cashFlowStatement(ledger, FY);
  assert.equal(cf.difference, 0);
  const bv = buildVouchers(books);
  const bookCash = cashBook(bv, books.openings, 'cash', FY);
  const bookBank = cashBook(bv, books.openings, 'bank', FY);
  const ledgerCash = accountStatement(ledger, A.cash, FY)!;
  const ledgerBank = accountStatement(ledger, A.bank, FY)!;
  // Books' cash/bank books carry manual vouchers' cash / bank lines (QA6-1 F5) but not assets; strip those out to compare.
  const manualMove = (acc: string) =>
    ledger.vouchers.filter((v) => v.kind === 'Fixed Asset').reduce((s, v) => s + v.lines.filter((l) => l.account === acc).reduce((x, l) => x + l.dr - l.cr, 0), 0);
  assert.equal((ledgerCash.closing - manualMove(A.cash)) / 100, bookCash.closing);
  assert.equal((ledgerBank.closing - manualMove(A.bank)) / 100, bookBank.closing);
  assert.equal(cf.closingCash, ledgerCash.closing + ledgerBank.closing);
  assert.equal(cf.closingCash - cf.openingCash, cf.netChange);

  // GST ledgers agree with the Books GST summary (output side, after the credit note).
  const g = gstSummary(books, FY);
  assert.equal(-(close.get(A.outCgst) ?? 0) / 100, g.outputCgst);
  assert.equal(-(close.get(A.outSgst) ?? 0) / 100, g.outputSgst);
  assert.equal(-(close.get(A.outIgst) ?? 0) / 100, g.outputIgst);

  // Indicative Books balance sheet: same cash, bank and (TDS aside) receivables.
  const ind = balanceSheet(books, FY.end);
  assert.equal((ledgerBank.closing - manualMove(A.bank)) / 100, ind.assets.bank);
  assert.equal((ledgerCash.closing - manualMove(A.cash)) / 100, ind.assets.cash);
});

test('ledger P&L = Books P&L once manual entries and depreciation are set aside', () => {
  year();
  const books = loadBooksData();
  const ledger = buildLedger(loadLedgerInput(books, '2026-03-31'));
  const pl = ledgerProfitAndLoss(ledger, FY);
  const bp = profitAndLoss(books, FY, 'accrual');
  // Only manual vouchers (interest 24,000; closing stock 15,000) and depreciation (38,000) are ledger-only.
  assert.equal(pl.netProfit / 100, Math.round((bp.netProfit - 24000 + 15000 - 38000) * 100) / 100);
  const docsOnly = ledgerProfitAndLoss(buildLedger({ ...loadLedgerInput(books, '2026-03-31'), manual: [], assets: [] }), FY);
  assert.equal(docsOnly.revenue / 100, bp.income);
  assert.equal(docsOnly.directCosts / 100, bp.directCosts);
  assert.equal(docsOnly.indirectExpenses / 100, bp.indirectExpenses);
  assert.equal(docsOnly.netProfit / 100, bp.netProfit);
});
