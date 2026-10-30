/** AG-D1 cold-storage lots and gate passes: balances, over-release refused, the lien blocks, override audited, transfer, numbers never reused, custody only. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { getTable, setTable, KEYS } from '../src/lib/storage.ts';
import '../src/lib/trust/recycle-bin.ts';
import { addLot, bagsOut, chamberUse, deleteLot, depositorLots, editLot, loadLots, lotBalance, receiptHtml, transferBags } from '../src/lib/agri/ag-cold-lots.ts';
import { checkGatePass, depositorStatement, gatePassHtml, issueGatePass, statementHtml, undoGatePass } from '../src/lib/agri/ag-gatepass.ts';
import { giveLoan, loadLoans, loanState, repayLoan } from '../src/lib/agri/ag-loans.ts';
import { savePlan } from '../src/lib/agri/ag-cold-rent.ts';
import { saveAgriSettings } from '../src/lib/agri/ag-settings.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { Client } from '../src/types/invoice.ts';

const farmer: Client = { id: 'c-ram', name: 'Ram Singh', state_code: '09' } as Client;
const trader: Client = { id: 'c-shyam', name: 'Shyam Traders', state_code: '09' } as Client;
let planId = '';
beforeEach(() => {
  resetStorage();
  installSettings();
  setTable(KEYS.clients, [farmer, trader]);
  planId = savePlan({ name: 'Potato season', basis: 'bag_season', rate: 180, season: { from: '03-01', to: '11-30' }, part_month: 'full', charges: [], class: 'storage_agri', bill_at: 'out' }).id;
});
const lot = (over = {}) => addLot({ date_in: '2026-04-05', depositor_id: farmer.id, depositor_name: farmer.name, commodity: 'Potato', variety: 'Kufri Jyoti', bags: 240, bag_kg: 50, chamber_id: 'ch3', location: 'Floor 2, rack B', season: '2026', rent_plan_id: planId, ...over });

test('CSR numbering by FY, a deleted number stays used; edit cannot drop below what went out', () => {
  const a = lot();
  const b = lot({ bags: 10 });
  assert.deepEqual([a.number, b.number], ['CSR/FY26-27/0001', 'CSR/FY26-27/0002']);
  deleteLot(b.id);
  assert.equal(lot().number, 'CSR/FY26-27/0003');
  assert.ok(getTable('recycle_bin').length >= 1, 'deleted lot in the recycle bin');
  assert.throws(() => lot({ bags: 0 }), /bags/);
  issueGatePass(a.id, { date: '2026-06-01', bags: 100, bill: false });
  assert.throws(() => editLot(a.id, { ...a, bags: 90 }), /already gone out/);
  assert.throws(() => deleteLot(a.id), /gate passes/);
});

test('gate passes: balances, over-release refused, GPO numbers never reused after an undo, paper shows the balance', () => {
  const a = lot();
  const p1 = issueGatePass(a.id, { date: '2026-06-01', bags: 60, vehicle: 'UP80 1234', bill: false });
  assert.equal(p1.out.number, 'GPO/FY26-27/0001');
  assert.equal(lotBalance(p1.lot), 180);
  assert.equal(p1.lot.status, 'part_out');
  assert.throws(() => issueGatePass(a.id, { date: '2026-06-02', bags: 181 }), /Only 180 bags/);
  assert.throws(() => issueGatePass(a.id, { date: '2026-04-01', bags: 1 }), /before the date in/);
  const p2 = issueGatePass(a.id, { date: '2026-06-03', bags: 20, bill: false });
  assert.match(gatePassHtml(p2.lot, p2.out, 'Cold Co'), /Balance bags<\/td><td>160/);
  undoGatePass(a.id);
  assert.equal(issueGatePass(a.id, { date: '2026-06-04', bags: 180, bill: false }).out.number, 'GPO/FY26-27/0003', 'GPO 0002 stays used');
  assert.equal(loadLots()[0].status, 'closed');
  assert.match(receiptHtml(a, { company: 'Cold Co' }), /Non-negotiable receipt: not a WDRA e-NWR/);
});

test('a loan\'s lien blocks the gate pass until repaid; an owner override needs a reason and is audited', () => {
  const a = lot();
  const loan = giveLoan({ date: '2026-04-10', borrower_id: farmer.id, borrower_name: farmer.name, lot_ids: [a.id], principal: 50000, rate_pct: 12, disbursed_by: 'bank' });
  const chk = checkGatePass(a, 60, '2026-06-01', { loans: loadLoans(), lots: loadLots(), invoices: [] });
  assert.equal(chk.liens.length, 1);
  assert.throws(() => issueGatePass(a.id, { date: '2026-06-01', bags: 60 }), /has a lien/);
  const o = issueGatePass(a.id, { date: '2026-06-01', bags: 10, override_reason: 'Owner allowed seed potatoes', bill: false });
  assert.equal(o.out.loan_check, 'override');
  assert.equal(o.out.override_reason, 'Owner allowed seed potatoes');
  const log = JSON.stringify(getTable('audit_log'));
  assert.match(log, /over the lien of LAS\/FY26-27\/0001: Owner allowed seed potatoes/);
  assert.throws(() => repayLoan(loan.id, { date: '2026-06-02', amount: 60000, by: 'cash' }), /Only ₹/);
});

test('repaid in full → the pass is allowed; partial release when the rest still covers the loan at the release LTV', () => {
  const a = lot();
  const loan = giveLoan({ date: '2026-04-10', borrower_id: farmer.id, borrower_name: farmer.name, lot_ids: [a.id], principal: 50000, rate_pct: 12, disbursed_by: 'bank', bag_rate: 600 });
  saveAgriSettings({ cold: { release_ltv_pct: 70 } });
  // 240 bags × ₹600 × 70% = ₹1,00,800 cover; due ≈ ₹50,800 → up to ~119 bags may go
  assert.equal(issueGatePass(a.id, { date: '2026-06-01', bags: 100, bill: false }).out.loan_check, 'clear');
  assert.throws(() => issueGatePass(a.id, { date: '2026-06-02', bags: 40 }), /has a lien/);
  repayLoan(loan.id, { date: '2026-06-02', amount: 1, by: 'cash' });
  repayLoan(loan.id, { date: '2026-06-02', amount: loanState(loadLoans()[0], '2026-06-02').total, by: 'bank' });
  assert.equal(loadLoans()[0].status, 'closed');
  assert.equal(issueGatePass(a.id, { date: '2026-06-03', bags: 140, bill: false }).out.loan_check, 'clear');
});

test('transfer to another depositor: a child lot with the same date in; balances add up; chambers and statement', () => {
  const a = lot();
  assert.throws(() => transferBags(a.id, { date: '2026-05-01', to_depositor_id: trader.id, to_depositor_name: trader.name, bags: 50, note: ' ' }), /consent/);
  const child = transferBags(a.id, { date: '2026-05-01', to_depositor_id: trader.id, to_depositor_name: trader.name, bags: 50, note: 'Sold inside the store; both signed' });
  assert.deepEqual([child.number, child.date_in, child.bags, child.from_lot_id], ['CSR/FY26-27/0002', '2026-04-05', 50, a.id]);
  const lots = loadLots();
  assert.equal(lotBalance(lots[0]), 190);
  assert.equal(bagsOut(lots[0]), 50);
  assert.deepEqual(chamberUse(lots, [{ id: 'ch3', name: 'Chamber 3', capacity_bags: 1000 }]).map((c) => [c.bags, c.pct]), [[240, 24]]);
  assert.equal(depositorLots(lots, trader.id).balance, 50);
});

test('custody only: no stock module reads cold_lots; the stock engine sees nothing', () => {
  lot();
  const stock = readdirSync(new URL('../src/lib/', import.meta.url)).filter((f) => /^(inventory|stock-|godowns|closing-stock)/.test(f));
  for (const f of stock) assert.ok(!readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8').includes('cold_lots'), `${f} reads no lots`);
  assert.equal(localDb.invoices.getAll().length, 0);
});

test('depositor statement: lots in / out / balance, rent billed and due (issued bills only), open loans with interest; the print', () => {
  const a = lot();
  lot({ bags: 40 });
  transferBags(a.id, { date: '2026-05-01', to_depositor_id: trader.id, to_depositor_name: trader.name, bags: 20, note: 'Both agree' });
  const r = issueGatePass(a.id, { date: '2026-06-01', bags: 60 });
  assert.ok(r.bill, 'rent bill drafted');
  const issued = { ...r.bill!, id: 'issued', status: 'Sent', balance_due: 500 } as never;
  giveLoan({ date: '2026-04-10', borrower_id: farmer.id, borrower_name: farmer.name, lot_ids: [a.id], principal: 10000, rate_pct: 12, disbursed_by: 'cash' });
  const st = depositorStatement(loadLots(), [r.bill!, issued], loadLoans(), farmer.id, '2026-07-10');
  assert.deepEqual([st.lots.length, st.in, st.out, st.balance], [2, 280, 80, 200]);
  assert.equal(st.billed, Math.round(r.bill!.total * 2 * 100) / 100, 'draft + issued billed');
  assert.equal(st.due, 500, 'only the issued bill is due');
  assert.equal(st.loansDue, loanState(loadLoans()[0], '2026-07-10').total);
  assert.ok(st.loansDue > 10000, 'interest to date included');
  const other = depositorStatement(loadLots(), [r.bill!], loadLoans(), trader.id, '2026-07-10');
  assert.deepEqual([other.lots.length, other.balance, other.billed, other.loans.length], [1, 20, 0, 0]);
  const html = statementHtml(st, farmer.name, 'Cold Co', '2026-07-10');
  assert.match(html, /Depositor statement: Ram Singh/);
  assert.match(html, new RegExp(`${a.number.replace(/\//g, '\\/')} · Potato</td><td>in 240 · out 80 · balance 160 bags`));
  assert.match(html, /Rent billed \/ due/);
  assert.match(html, /Loan LAS\/FY26-27\/0001/);
  assert.match(html, /never our stock/);
});
