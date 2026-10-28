/** R2-C2: deferred revenue / prepaid expense schedules. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { clientUS, createViaStore, installSettings, reload } from './helpers/world.ts';
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
import { SINGLETON_KEYS, getJson, getTable, setJson, setTable } from '../src/lib/storage.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
afterEach(() => thawDate());

/** Remove the period lock directly (moving it earlier needs the owner's PIN in the app). */
const unlockBooks = () => setJson(SINGLETON_KEYS.settings, { ...getJson<Record<string, unknown>>(SINGLETON_KEYS.settings, {}), lock_until: '' });
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
  // QA5-2 F6: no release may post before the initial deferral exists (Sales would be overstated).
  assert.equal(r.locked, 3, 'init (1 Apr) and April are locked; May is held until the initial deferral posts');
  assert.equal(r.posted, 0);
  assert.equal(loadVouchers().length, 0);
  unlockBooks();
  assert.equal(postDue('2025-05-31').posted, 3, 'init + April + May once unlocked');
});

test('QA5-2 F6: a schedule whose source date is locked is refused; releases never post without the initial deferral', () => {
  const inv = annualAmc('2026-08-10');
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-08-31' });
  const [line] = invoiceSourceLines(inv);
  assert.throws(() => createDeferral({ source: line, amount_paise: 1_200_000, start: '2026-08-01', months: 12, method: 'months' }), /locked/i);
  assert.equal(loadDeferrals().length, 0);
  // A schedule written before the lock moved (or imported) still never releases ahead of its initial entry.
  unlockBooks();
  createDeferral({ source: line, amount_paise: 1_200_000, start: '2026-08-01', months: 12, method: 'months' });
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-08-31' });
  const r = postDue('2026-10-31');
  assert.equal(r.posted, 0, 'r2 / r3 are held');
  assert.equal(loadVouchers().length, 0);
  const pl = ledgerProfitAndLoss(buildLedger(loadLedgerInput()), { start: '2026-04-01', end: '2027-03-31' });
  assert.equal(pl.income.flatMap((x) => x.lines).find((l) => l.account.id === A.sales)?.amount, 1_200_000, 'Sales is the invoice value, never more');
});

test('QA5-2 F5: the deferrable amount is the line taxable value in INR', () => {
  const inc = createViaStore({ date: '2026-10-01', lines: [{ name: 'Annual AMC', qty: 1, rate: 11800, tax: 18 }], inclusive: true });
  assert.equal(invoiceSourceLines(inc)[0].amount, 10000, 'tax backed out of an inclusive price');
  const disc = createViaStore({ date: '2026-10-01', lines: [{ name: 'Annual AMC', qty: 1, rate: 10000, tax: 18, disc: 10 }, { name: 'Setup', qty: 1, rate: 1000, tax: 18 }], invoiceDiscount: { type: 'PERCENT', value: 20 } });
  assert.deepEqual(invoiceSourceLines(disc).map((l) => l.amount), [7200, 800], 'line and invoice discounts, pro-rata like the invoice calc');
  assert.equal(invoiceSourceLines(disc).reduce((s, l) => s + l.amount, 0), disc.taxable_value);
  const usd = createViaStore({ client: clientUS, date: '2026-10-01', lines: [{ name: 'SaaS year', qty: 1, rate: 1200, tax: 0 }], currency: 'USD', supply: 'EXPORT_LUT' as never, patch: { exchange_rate: 84 } as never });
  assert.equal(invoiceSourceLines(usd)[0].amount, 100800, 'converted at the document rate');
  // An unselected optional line is not on the bill: it offers nothing and the other line keeps its own index.
  const opt = { ...disc, items: [{ ...disc.items[0], optional: true, selected: false }, disc.items[1]] };
  assert.deepEqual(invoiceSourceLines(opt).map((l) => [l.line_index, l.amount]), [[1, 800]]);
  // A bill-level discount on a purchase is spread over its lines the same way.
  setTable('purchases', [{ id: 'b9', kind: 'BILL', vendor_name: 'V', bill_number: 'B-9', date: '2026-10-01', taxable: 9000, total: 10620, lines: [{ name: 'Insurance', quantity: 1, rate: 6000 }, { name: 'AMC', quantity: 1, rate: 4000 }] }]);
  assert.deepEqual(purchaseSourceLines(getTable('purchases')[0]).map((l) => l.amount), [5400, 3600]);
});

test('QA5-2 F22: deleting a schedule with a locked journal changes nothing', () => {
  const inv = annualAmc('2026-04-01');
  const [line] = invoiceSourceLines(inv);
  const d = createDeferral({ source: line, amount_paise: 1_200_000, start: '2026-04-01', months: 12, method: 'months' });
  postDue('2026-06-30');
  assert.equal(loadVouchers().length, 4);
  // Later journals first (a re-posted entry is appended), so the unlocked ones would go before the locked one.
  setTable('deferrals', loadDeferrals().map((x) => ({ ...x, voucher_ids: [...x.voucher_ids].reverse() })));
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-05-15' });
  assert.throws(() => deleteDeferral(d.id), /locked/i);
  assert.equal(loadVouchers().length, 4, 'no journal deleted');
  assert.equal(loadDeferrals().length, 1);
  assert.equal(postDue('2026-06-30').posted, 0, 'nothing posts twice');
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
