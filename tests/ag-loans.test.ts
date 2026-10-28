/** AG-D3 loans against stored produce: interest by days, interest-first repayments, lien, partial release at LTV, vouchers balance, closing at zero. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setTable, KEYS } from '../src/lib/storage.ts';
import '../src/lib/trust/recycle-bin.ts';
import { addLot, loadLots } from '../src/lib/agri/ag-cold-lots.ts';
import { deleteLoan, giveLoan, interestStatement, loanStatementHtml, liensOn, loadLoans, loanState, ltvWarning, overdueLoans, releaseCovered, repayLoan, splitRepayment, undoRepayment, LOAN_LEDGER, INTEREST_LEDGER } from '../src/lib/agri/ag-loans.ts';
import { savePlan } from '../src/lib/agri/ag-cold-rent.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import type { AgriLoan } from '../src/types/agri-r12d.ts';

const farmer = { id: 'c-ram', name: 'Ram Singh', state_code: '09' };
beforeEach(() => {
  resetStorage();
  installSettings();
  setTable(KEYS.clients, [farmer]);
});
const L = (o: Partial<AgriLoan> = {}): AgriLoan => ({ id: 'l', number: 'LAS/FY26-27/0001', date: '2026-04-01', borrower_id: 'c', borrower_name: 'R', lot_ids: ['lot'], principal: 120000, rate_pct: 12, basis: 'simple', disbursed_by: 'bank', payment_voucher_id: 'v', repayments: [], status: 'open', ...o });

test('simple interest by days on a 365-day year; monthly compounding adds unpaid interest at month starts', () => {
  assert.equal(loanState(L(), '2026-05-01').interest, 1183.56, '120000 × 12% × 30 / 365');
  assert.equal(loanState(L(), '2027-04-01').interest, 14400);
  const c = loanState(L({ basis: 'monthly_compound' }), '2026-06-01');
  assert.ok(c.interest > loanState(L(), '2026-06-01').interest, 'compounding earns more');
  assert.equal(loanState(L({ basis: 'monthly_compound' }), '2026-05-01').interest, 1183.56, 'no compounding inside the first month');
});

test('repayment splits interest first; the statement rows; loan-to-value warning; overdue', () => {
  const split = splitRepayment(L(), '2026-05-01', 5000);
  assert.deepEqual(split, { interest_part: 1183.56, principal_part: 3816.44 });
  assert.throws(() => splitRepayment(L(), '2026-05-01', 200000), /Only ₹121183.56/);
  const after = L({ repayments: [{ id: 'r', date: '2026-05-01', amount: 5000, ...split, receipt_id: 'x' }] });
  assert.equal(loanState(after, '2026-05-01').principal, 116183.56);
  const rows = interestStatement(after, '2026-05-31');
  assert.deepEqual(rows.map((r) => [r.date, r.days, r.interest, r.paid, r.principal]), [['2026-04-01', 0, 0, 0, 120000], ['2026-05-01', 30, 1183.56, 5000, 116183.56], ['2026-05-31', 30, 1145.92, 0, 116183.56]]);
  assert.match(ltvWarning(120000, 240, 600, 70)!, /above 70% of the stored value \(₹100800\.00/);
  assert.equal(ltvWarning(90000, 240, 600, 70), undefined);
  assert.equal(overdueLoans([L({ due_date: '2026-11-15' })], '2026-11-16').length, 1);
  assert.equal(overdueLoans([L({ due_date: '2026-11-15' })], '2026-11-15').length, 0);
});

test('give, repay to zero (closes), vouchers balance; undo and delete through the data layer', () => {
  const plan = savePlan({ name: 'P', basis: 'bag_season', rate: 180, part_month: 'full', charges: [], class: 'storage_agri', bill_at: 'out' });
  const lot = addLot({ date_in: '2026-03-10', depositor_id: farmer.id, depositor_name: farmer.name, commodity: 'Potato', bags: 240, chamber_id: 'c', season: '2026', rent_plan_id: plan.id });
  assert.throws(() => giveLoan({ date: '2026-04-01', borrower_id: farmer.id, borrower_name: farmer.name, lot_ids: [], principal: 1, rate_pct: 12, disbursed_by: 'bank' }), /lot/);
  const loan = giveLoan({ date: '2026-04-01', borrower_id: farmer.id, borrower_name: farmer.name, lot_ids: [lot.id], principal: 120000, rate_pct: 12, disbursed_by: 'cash', bag_rate: 700 });
  assert.equal(loan.number, 'LAS/FY26-27/0001');
  assert.equal(liensOn(lot.id, loadLoans(), '2026-05-01').length, 1);
  assert.equal(releaseCovered(loan, loadLots(), lot.id, 10, '2026-05-01', 80), true, '230 × 700 × 80% covers');
  assert.equal(releaseCovered(loan, loadLots(), lot.id, 10, '2026-05-01', undefined), false, 'no setting, no partial release');
  repayLoan(loan.id, { date: '2026-05-01', amount: 5000, by: 'cash' });
  const due = loanState(loadLoans()[0], '2026-06-01').total;
  const closed = repayLoan(loan.id, { date: '2026-06-01', amount: due, by: 'bank' });
  assert.equal(closed.status, 'closed');
  assert.equal(liensOn(lot.id, loadLoans(), '2026-06-02').length, 0, 'lien lifted');
  const vs = loadVouchers();
  assert.equal(vs.length, 3);
  for (const v of vs) assert.equal(v.lines.reduce((s, l) => s + l.dr - l.cr, 0), 0, `${v.number} balances`);
  const names = new Map(chartOf(loadUserAccounts()).map((a) => [a.id, a.name]));
  assert.deepEqual(vs[2].lines.map((l) => names.get(l.account_id)).slice(1), [LOAN_LEDGER, INTEREST_LEDGER]);
  assert.throws(() => repayLoan(loan.id, { date: '2026-05-15', amount: 1, by: 'cash' }), /date order/);
  undoRepayment(loan.id);
  assert.equal(loadLoans()[0].status, 'open');
  assert.throws(() => deleteLoan(loan.id), /Undo the repayments/);
  undoRepayment(loan.id);
  deleteLoan(loan.id);
  assert.equal(loadLoans().length, 0);
  assert.equal(loadVouchers().length, 0);
  assert.equal(giveLoan({ date: '2026-04-02', borrower_id: farmer.id, borrower_name: farmer.name, lot_ids: [lot.id], principal: 1000, rate_pct: 12, disbursed_by: 'bank' }).number, 'LAS/FY26-27/0002', 'number never reused');
});

test('interest statement print: one row per step and what is due now', () => {
  const l = L({ repayments: [{ id: 'p1', date: '2026-05-01', amount: 21183.56, interest_part: 1183.56, principal_part: 20000, receipt_id: 'r', receipt_no: 'RCT/1' }] });
  const html = loanStatementHtml(l, '2026-06-01', 'Cold Co');
  assert.match(html, /Interest statement LAS\/FY26-27\/0001/);
  assert.match(html, /2026-04-01 · Disbursed LAS\/FY26-27\/0001/);
  assert.match(html, /2026-05-01 · Repaid RCT\/1<\/td><td>30 days · interest ₹1183.56 · paid ₹21183.56 · principal ₹100000.00/);
  const s = loanState(l, '2026-06-01');
  assert.match(html, new RegExp(`Due now</td><td>₹${s.total.toFixed(2)}`));
  assert.equal(interestStatement(l, '2026-06-01').length, 3);
});
