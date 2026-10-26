/**
 * WP-7 P1-20 / P2: year-end wizard ("Start new year") and the books integrity check.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { setTable } from '../src/lib/storage.ts';
import { A, saveOpenings, saveVoucher, loadVouchers, buildLedger, loadLedgerInput, saveBooksBegin } from '../src/lib/ledger/index.ts';
import { getLockUntil } from '../src/lib/period-lock.ts';
import { loadIntegrity, loadYearEnd, lockYear, postClosingStock, postProvisions, saveYearEndMark } from '../src/lib/year-end-store.ts';
import { carryForward, carryForwardCsv, fyId, yearEndJournal } from '../src/lib/year-end.ts';
import { installSettings } from './helpers/world.ts';

const FY = 2025;

beforeEach(() => {
  resetStorage();
  installSettings();
  saveBooksBegin('2025-04-01');
  saveOpenings([
    { ledger_id: A.cash, amount: 1000000 },
    { ledger_id: A.bank, amount: 9000000 },
    { ledger_id: A.capital, amount: -10000000 },
  ]);
});

const jv = (date: string, lines: Array<[string, number, number]>, type: 'JOURNAL' | 'PAYMENT' | 'RECEIPT' = 'JOURNAL') =>
  saveVoucher({ type, date, narration: '', lines: lines.map(([account_id, dr, cr]) => ({ account_id, dr, cr })) });

test('integrity: balanced books with no orphans pass; negative cash days and orphaned links are reported', () => {
  assert.equal(loadIntegrity().ok, true, JSON.stringify(loadIntegrity().issues));
  jv('2025-05-10', [[A.rent, 1500000, 0], [A.cash, 0, 1500000]], 'PAYMENT'); // 15,000 out of 10,000 cash
  jv('2025-05-12', [[A.cash, 1000000, 0], [A.bank, 0, 1000000]], 'JOURNAL');
  setTable('transactions', [{ id: 't-orphan', invoice_id: 'gone', amount: 100, date: '2025-06-01', method: 'UPI' }]);
  setTable('purchase_payments', [{ id: 'pp-orphan', purchase_id: 'no-bill', amount: 50, date: '2025-06-02', method: 'Cash' }]);
  setTable('doc_links', [{ id: 'dl1', from_id: 'x', to_id: 'y', relation: 'converted', created_at: '' }]);
  const r = loadIntegrity();
  assert.equal(r.ok, false);
  assert.equal(r.totals.diff, 0, 'the TB itself still balances');
  assert.deepEqual(r.negativeCashDays, [{ date: '2025-05-10', balance: -500000 }]);
  const msgs = r.issues.map((i) => `${i.area}:${i.ref ?? ''}`);
  assert.ok(msgs.includes('links:t-orphan'));
  assert.ok(msgs.includes('links:pp-orphan'));
  assert.ok(msgs.includes('links:dl1'));
  assert.ok(r.issues.some((i) => i.area === 'cash' && /2025-05-10/.test(i.message)));
});

test('year-end checklist: provisions and closing stock journals (reversed on 1 April), lock, marks', () => {
  jv('2025-06-01', [[A.bank, 5000000, 0], [A.sales, 0, 5000000]], 'RECEIPT');
  let st = loadYearEnd(FY).steps;
  const s = (id: string) => st.find((x) => x.id === id)!;
  assert.equal(s('provisions').status, 'todo');
  assert.equal(s('lock').status, 'todo');
  assert.equal(s('integrity').status, 'done');

  const prov = postProvisions(FY, [{ account_id: A.professional, amount: 2500000 }]);
  assert.equal(prov.date, '2026-03-31');
  assert.equal(prov.reverse_on, '2026-04-01');
  assert.deepEqual(prov.lines.map((l) => [l.account_id, l.dr, l.cr]), [[A.professional, 2500000, 0], [A.provisions, 0, 2500000]]);
  const cls = postClosingStock(FY, 1200000);
  assert.deepEqual(cls.lines.map((l) => [l.account_id, l.dr, l.cr]), [[A.stock, 1200000, 0], [A.purchases, 0, 1200000]]);
  // Re-posting replaces, never duplicates.
  postClosingStock(FY, 1300000);
  assert.equal(loadVouchers().filter((v) => v.voucher_class === 'Year-end closing stock').length, 1);

  saveYearEndMark(FY, 'opening_bills');
  saveYearEndMark(FY, 'carry_forward');
  assert.equal(lockYear(FY), '2026-03-31');
  assert.equal(getLockUntil(), '2026-03-31');
  st = loadYearEnd(FY).steps;
  assert.deepEqual(st.map((x) => [x.id, x.status]), [
    ['integrity', 'done'], ['closing_stock', 'done'], ['depreciation', 'done'], ['provisions', 'done'],
    ['opening_bills', 'done'], ['lock', 'done'], ['carry_forward', 'done'], ['auditor_pack', 'todo'],
  ]);
  assert.throws(() => postProvisions(FY, [{ account_id: A.rent, amount: 100 }]), /lock/i, 'a locked year refuses new journals');
});

test('carry forward: new year opens with balance-sheet balances; profit sits in reserves; Dr = Cr', () => {
  jv('2025-06-01', [[A.bank, 5000000, 0], [A.sales, 0, 5000000]], 'RECEIPT');
  jv('2025-07-01', [[A.rent, 2000000, 0], [A.bank, 0, 2000000]], 'PAYMENT');
  const ledger = buildLedger(loadLedgerInput());
  const c = carryForward(ledger, FY);
  assert.equal(c.profit, 3000000);
  assert.equal(c.dr, c.cr);
  const bal = (id: string) => c.rows.find((r) => r.account.id === id)?.balance ?? 0;
  assert.equal(bal(A.bank), 12000000);
  assert.equal(bal(A.reserves), -3000000, 'last year profit carried to reserves');
  assert.equal(bal(A.sales), 0, 'income does not carry forward');
  const csv = carryForwardCsv(c, FY);
  assert.match(csv, /verify with your CA/);
  assert.match(csv, /Profit for FY25-26 carried to Reserves/);
  assert.equal(fyId(FY), 'FY25-26');
});

test('yearEndJournal is pure and balanced', () => {
  const j = yearEndJournal('provision', FY, [{ account_id: A.rent, amount: 100 }, { account_id: A.salaries, amount: 250 }], false);
  assert.equal(j.reverse_on, undefined);
  assert.equal(j.lines.reduce((s, l) => s + l.dr - l.cr, 0), 0);
});
