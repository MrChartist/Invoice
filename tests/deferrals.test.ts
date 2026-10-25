/** R2-C2: deferred revenue / prepaid expense schedules. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { createViaStore, installSettings, reload } from './helpers/world.ts';
import {
  ADVANCE_INCOME_NAME,
  PREPAID_NAME,
  cancelledSources,
  createDeferral,
  deferralRegister,
  deleteDeferral,
  invoiceSourceLines,
  loadDeferrals,
  monthsBetween,
  postDue,
  purchaseSourceLines,
  scheduleRows,
  serviceEnd,
  stopDeferral,
} from '../src/lib/deferrals.ts';
import { A, buildLedger, chartOf, closingBalances, ledgerProfitAndLoss, loadLedgerInput, loadUserAccounts, loadVouchers, trialBalance } from '../src/lib/ledger/index.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
afterEach(() => thawDate());

const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);

test('schedule by months: equal shares on calendar month ends, rounding on the last', () => {
  const rows = scheduleRows(1_000_000, '2025-04-01', 3, 'months');
  assert.deepEqual(rows.map((r) => r.date), ['2025-04-30', '2025-05-31', '2025-06-30']);
  assert.deepEqual(rows.map((r) => r.amount), [333_333, 333_333, 333_334]);
  assert.equal(serviceEnd('2025-04-15', 12), '2026-04-14');
  assert.equal(monthsBetween('2025-04-01', '2026-03-31'), 12);
  assert.equal(monthsBetween('2025-01-01', '2025-01-31'), 1);
});

test('schedule by days: proportional to days in each month, last share on the service end', () => {
  const rows = scheduleRows(3_650_000, '2025-04-15', 12, 'days'); // ₹36,500 over 365 days
  assert.equal(rows[0].date, '2025-04-30');
  assert.equal(rows[0].amount, 160_000, '16 days × ₹100');
  assert.equal(rows.at(-1)?.date, '2026-04-14');
  assert.equal(rows.at(-1)?.amount, 140_000, '14 days');
  assert.equal(sum(rows), 3_650_000);
  assert.equal(rows.length, 13);
});

test('leap year: February 2028 carries 29 days', () => {
  const rows = scheduleRows(3_660_000, '2027-04-01', 12, 'days'); // 366 days to 31 Mar 2028
  const feb = rows.find((r) => r.date === '2028-02-29');
  assert.ok(feb, 'released on 29 Feb');
  assert.equal(feb!.amount, 290_000);
  assert.equal(sum(rows), 3_660_000);
});

function annualAmc(date = '2025-04-01'): InvoiceRecord {
  return createViaStore({ date, lines: [{ name: 'Annual AMC', qty: 1, rate: 12000, tax: 18 }] });
}

test('posting: initial deferral on the invoice date, releases as months end, idempotent; GST untouched', () => {
  const inv = annualAmc();
  const [line] = invoiceSourceLines(inv);
  assert.equal(line.amount, 12000);
  const d = createDeferral({ source: line, amount_paise: 1_200_000, start: '2025-04-01', months: 12, method: 'months' });
  assert.ok(chartOf(loadUserAccounts()).some((a) => a.name === ADVANCE_INCOME_NAME), 'holding account created on first use');
  const r1 = postDue('2025-06-15');
  assert.equal(r1.posted, 3, 'init + April + May');
  assert.equal(postDue('2025-06-15').posted, 0, 'idempotent');
  const ledger = buildLedger(loadLedgerInput());
  const pl = ledgerProfitAndLoss(ledger, { start: '2025-04-01', end: '2025-05-31' });
  const sales = pl.income.flatMap((s) => s.lines).find((l) => l.account.id === A.sales)?.amount ?? 0;
  assert.equal(sales, 200_000, 'two months of revenue in the P&L');
  const bal = closingBalances(ledger, '2025-05-31');
  assert.equal(bal.get(d.holding_account_id), -1_000_000, '₹10,000 still received in advance');
  assert.equal(bal.get(A.outCgst), -108_000, 'output GST stays on the invoice date');
  // Whole FY: all released
  postDue('2026-03-31');
  const full = ledgerProfitAndLoss(buildLedger(loadLedgerInput()), { start: '2025-04-01', end: '2026-03-31' });
  assert.equal(full.income.flatMap((s) => s.lines).find((l) => l.account.id === A.sales)?.amount, 1_200_000);
  assert.equal(loadDeferrals()[0].status, 'completed');
});

test('FY split and register ties to the trial balance', () => {
  const inv = annualAmc('2025-10-01');
  const [line] = invoiceSourceLines(inv);
  const d = createDeferral({ source: line, amount_paise: 1_200_000, start: '2025-10-01', months: 12, method: 'months' });
  postDue('2026-09-30');
  const fy1 = deferralRegister({ start: '2025-04-01', end: '2026-03-31' });
  assert.deepEqual(fy1.totals, { opening: 0, deferred: 1_200_000, released: 600_000, closing: 600_000 });
  const fy2 = deferralRegister({ start: '2026-04-01', end: '2027-03-31' });
  assert.deepEqual(fy2.totals, { opening: 600_000, deferred: 0, released: 600_000, closing: 0 });
  const tb = trialBalance(buildLedger(loadLedgerInput()), { start: '2025-04-01', end: '2026-03-31' });
  const hold = tb.rows.find((r) => r.account.id === d.holding_account_id);
  assert.equal(-(hold?.closing ?? 0), fy1.totals.closing, 'register closing = ledger balance');
});

test('period lock: a locked release is skipped, then posted once unlocked', () => {
  const inv = annualAmc();
  const [line] = invoiceSourceLines(inv);
  createDeferral({ source: line, amount_paise: 1_200_000, start: '2025-04-01', months: 12, method: 'months' });
  const s = localDb.settings.get();
  localDb.settings.save({ ...s, lock_until: '2025-04-30' });
  const r = postDue('2025-05-31');
  assert.equal(r.locked, 2, 'init (1 Apr) and April are locked');
  assert.equal(r.posted, 1, 'May posts');
  assert.equal(loadVouchers().length, 1);
});

test('stop / reversal on cancel: unreleased amount comes back, holding account clears', () => {
  freezeDate('2025-07-10T10:00:00');
  const inv = annualAmc();
  const [line] = invoiceSourceLines(inv);
  const d = createDeferral({ source: line, amount_paise: 1_200_000, start: '2025-04-01', months: 12, method: 'months' });
  postDue('2025-07-10');
  localDb.invoices.setStatus(inv.id, 'Cancelled');
  const flagged = cancelledSources(loadDeferrals(), localDb.invoices.getAll(), []);
  assert.deepEqual(flagged.map((x) => x.id), [d.id]);
  const r = stopDeferral(d.id, '2025-07-10');
  assert.equal(r.posted, 1);
  const ledger = buildLedger(loadLedgerInput());
  const bal = closingBalances(ledger, '2026-03-31');
  assert.equal(bal.get(d.holding_account_id) ?? 0, 0, 'nothing left in advance');
  const pl = ledgerProfitAndLoss(ledger, { start: '2025-04-01', end: '2026-03-31' });
  assert.equal(pl.income.flatMap((s) => s.lines).find((l) => l.account.id === A.sales)?.amount ?? 0, 0, 'a cancelled invoice leaves no revenue');
  assert.equal(postDue('2026-03-31').posted, 0, 'no more releases after the stop');
  assert.equal(cancelledSources(loadDeferrals(), [reload(inv.id)], []).length, 0);
  deleteDeferral(d.id);
  assert.equal(loadVouchers().length, 0, 'delete removes its journals');
});

test('prepaid expense from a bill line (read through readPurchase), and source validation', () => {
  setTable('purchases', [{ id: 'b1', kind: 'EXPENSE', category: 'Rent', vendor_name: 'Landlord', bill_number: 'R-1', date: '2025-04-01', taxable: 60000, total: 60000, lines: [] }]);
  const [line] = purchaseSourceLines(getTable('purchases')[0]);
  assert.equal(line.amount, 60000);
  const d = createDeferral({ source: line, amount_paise: 6_000_000, start: '2025-04-01', months: 6, method: 'months' }, getTable('purchases')[0]);
  assert.equal(d.kind, 'expense');
  assert.equal(d.account_id, A.rent);
  assert.ok(chartOf(loadUserAccounts()).some((a) => a.name === PREPAID_NAME));
  assert.throws(() => createDeferral({ source: line, amount_paise: 100, start: '2025-04-01', months: 6, method: 'months' }), /already has a schedule/);
  postDue('2025-04-30');
  const bal = closingBalances(buildLedger(loadLedgerInput()), '2025-04-30');
  assert.equal(bal.get(d.holding_account_id), 5_000_000, '5 months prepaid');
});
