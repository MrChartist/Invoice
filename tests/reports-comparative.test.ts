/** PENDING 37: previous-period column on the trial balance and the balance sheet (CSV + the line map the screens use). */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_BOOKS } from '../src/lib/books.ts';
import { A, balanceSheetLedgerCsv, bsPreviousAmounts, buildLedger, ledgerBalanceSheet, previousPeriod, trialBalance, trialBalanceCsv, type LedgerInput } from '../src/lib/ledger/index.ts';

const FY2 = { start: '2026-04-01', end: '2027-03-31' };
const ledger = buildLedger({
  ...EMPTY_BOOKS, userAccounts: [], assets: [], today: '2027-03-31',
  manual: [
    // FY 25-26: capital ₹1,000 into the bank. FY 26-27: ₹300 rent paid.
    { id: 'a', type: 'RECEIPT', number: 'RV/1', date: '2025-06-01', narration: 'Capital', lines: [{ account_id: A.bank, dr: 100000, cr: 0 }, { account_id: A.capital, dr: 0, cr: 100000 }], created_at: '' },
    { id: 'b', type: 'PAYMENT', number: 'PV/1', date: '2026-07-01', narration: 'Rent', lines: [{ account_id: A.rent, dr: 30000, cr: 0 }, { account_id: A.bank, dr: 0, cr: 30000 }], created_at: '' },
  ],
} as unknown as LedgerInput);

test('trial balance CSV carries the previous period closing, ledgers only in the previous period included', () => {
  const prev = trialBalance(ledger, previousPeriod(FY2));
  const csv = trialBalanceCsv(trialBalance(ledger, FY2), prev).trim().split(/\r?\n/);
  assert.match(csv[1], /,Closing,Closing 2025-04-01 to 2026-03-31$/);
  const bank = csv.find((l) => l.includes(',Bank'))!;
  assert.match(bank, /,700\.00 Dr,1000\.00 Dr$|,700 Dr,1000 Dr$/);
  assert.equal(trialBalanceCsv(trialBalance(ledger, FY2)).split(/\r?\n/)[1].endsWith(',Closing'), true, 'one column without prev');
});

test('balance sheet: previous year-end figures by line, section and total; CSV second column', () => {
  const cur = ledgerBalanceSheet(ledger, FY2.end);
  const prev = ledgerBalanceSheet(ledger, '2026-03-31');
  const m = bsPreviousAmounts(prev);
  assert.equal(m.get('TOTAL:A'), 100000);
  assert.equal(cur.totalAssets, 70000);
  const csv = balanceSheetLedgerCsv(cur, prev).trim().split(/\r?\n/);
  assert.match(csv[1], /^Particulars,As at 2027-03-31,As at 2026-03-31$/);
  assert.ok(csv.filter((l) => l.startsWith('TOTAL,')).every((l) => /^TOTAL,700,1000$/.test(l)), csv.filter((l) => l.startsWith('TOTAL')).join(' | '));
});
