/** R5-C4: funds (cost-centre kind `fund`), fund statement, FCRA warnings, admin cap by date, FC-4, Sec 11 tracker. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupR5c } from './helpers/r5c.ts';
import { localDb } from '../src/lib/localDb.ts';
import { bankAccountsDb } from '../src/lib/bank-accounts.ts';
import { setTable } from '../src/lib/storage.ts';
import { bankLedgerId } from '../src/lib/bank-ledgers.ts';
import { loadLedger } from '../src/lib/ledger/index.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { saveVoucher } from '../src/lib/ledger/vouchers.ts';
import { COST_CENTRE_KINDS, loadCostCentres } from '../src/lib/cost-centres.ts';
import { ensureAccount } from '../src/lib/institutions/r5c.ts';
import { saveDonation } from '../src/lib/nonprofit/donations.ts';
import { ensureGeneralFund, loadFunds, saveFund, transferBetweenFunds } from '../src/lib/nonprofit/funds.ts';
import { fundStatement } from '../src/lib/nonprofit/fund-statement.ts';
import { donationFcraIssues, ledgerFcraIssues } from '../src/lib/nonprofit/fcra-checks.ts';
import { buildFc4 } from '../src/lib/nonprofit/fc4.ts';
import { applicationFor } from '../src/lib/nonprofit/application.ts';

beforeEach(() => setupR5c());

const FY = { start: '2025-04-01', end: '2026-03-31' };
const P = (r: number) => Math.round(r * 100);
const donor = () => localDb.clients.upsert({ name: 'Donor', email: '', address: '', city: '', zip: '', donor: { id_code: 'pan', id_no: 'ABCPD1234F' } });
const give = (amount: number, o: Record<string, unknown>) => saveDonation({ date: '2025-06-01', donor_id: donor(), amount, mode: 'electronic', type: 'others', section: '80G', ...o } as never, 'Donor');
const spend = (account: string, amount: number, fund: string | undefined, bank: string, date = '2025-07-01') =>
  saveVoucher({ type: 'PAYMENT', date, narration: 'spend', lines: [{ account_id: account, dr: P(amount), cr: 0, ...(fund ? { cost_centre_id: fund } : {}) }, { account_id: bank, dr: 0, cr: P(amount) }] });

test('fund kind, default General fund once, the fund details survive a save', () => {
  assert.ok(COST_CENTRE_KINDS.includes('fund'));
  const g = ensureGeneralFund();
  ensureGeneralFund();
  assert.equal(loadFunds().filter((f) => f.name === 'General fund').length, 1);
  assert.equal(g.fund.nature, 'unrestricted');
  const csr = saveFund({ name: 'CSR school', fund: { nature: 'restricted', purpose: 'School building', budget: 500000 } });
  assert.deepEqual(loadCostCentres().find((c) => c.id === csr.id)?.fund, { nature: 'restricted', purpose: 'School building', budget: 500000 });
  setTable('bank_accounts', [{ id: 'x', name: 'FC', fcra: 'designated' }, { id: 'y', name: 'Y', fcra: 'bogus' }]);
  assert.equal(bankAccountsDb.all().find((b) => b.id === 'x')?.fcra, 'designated');
  assert.equal(bankAccountsDb.all().find((b) => b.id === 'y')?.fcra, undefined, 'normalise keeps only the two FCRA kinds');
});

test('fund statement: receipts, utilisation, inter-fund transfers, closing; corpus kept out of income', () => {
  const g = ensureGeneralFund();
  const csr = saveFund({ name: 'CSR school', fund: { nature: 'restricted' } });
  const prog = ensureAccount('Programme expenses', 'INDIRECT_EXPENSES', 6600);
  give(1000, { fund_id: csr.id, date: '2025-03-01' }); // opening
  give(50000, { fund_id: csr.id });
  give(20000, { fund_id: g.id, type: 'corpus' });
  spend(prog, 30000, csr.id, A.bank);
  transferBetweenFunds(g.id, csr.id, 5000, '2025-08-01', 'top up');
  const s = fundStatement(loadLedger(), loadFunds().find((f) => f.id === csr.id)!, FY);
  assert.equal(s.opening, 1000);
  assert.equal(s.receiptsTotal, 50000);
  assert.equal(s.utilisationTotal, 30000);
  assert.equal(s.transfersIn, 5000);
  assert.equal(s.closing, 26000);
  const gs = fundStatement(loadLedger(), loadFunds().find((f) => f.id === g.id)!, FY);
  assert.equal(gs.receipts[0].account.name, 'Donations — corpus fund');
  assert.equal(gs.transfersOut, 5000);
  assert.equal(gs.closing, 15000);
  const app = applicationFor(loadLedger(), 2025);
  assert.equal(app.income, 50000, 'the corpus donation is not income');
});

test('FCRA warnings: FC into a local account, local into the designated account, transfers out of FCRA', () => {
  bankAccountsDb.save({ id: 'fc', name: 'FCRA SBI NDMB', active: true, fcra: 'designated' });
  bankAccountsDb.save({ id: 'fu', name: 'FCRA utilisation', active: true, fcra: 'utilisation' });
  const fc = saveFund({ name: 'Foreign grant', fund: { nature: 'fcra' } });
  const local = saveFund({ name: 'Local', fund: { nature: 'unrestricted' } });
  const ok = give(100000, { fund_id: fc.id, bank_account_id: 'fc' });
  const bad1 = give(500, { fund_id: fc.id });
  const bad2 = give(700, { fund_id: local.id, bank_account_id: 'fc' });
  const kinds = donationFcraIssues([ok, bad1, bad2], loadFunds(), bankAccountsDb.all());
  assert.deepEqual(kinds.map((k) => k.kind), ['fcIntoLocal', 'localIntoFcra']);
  const prog = ensureAccount('Programme expenses', 'INDIRECT_EXPENSES', 6600);
  saveVoucher({ type: 'CONTRA', date: '2025-07-01', narration: 'to utilisation', lines: [{ account_id: bankLedgerId('fu'), dr: P(40000), cr: 0 }, { account_id: bankLedgerId('fc'), dr: 0, cr: P(40000) }] });
  spend(prog, 10000, fc.id, bankLedgerId('fu'));
  saveVoucher({ type: 'PAYMENT', date: '2025-07-05', narration: 'to another NGO', lines: [{ account_id: A.creditors, dr: P(8000), cr: 0, party: 'Other NGO' }, { account_id: bankLedgerId('fu'), dr: 0, cr: P(8000) }] });
  const issues = ledgerFcraIssues(loadLedger(), loadFunds(), bankAccountsDb.all(), FY);
  assert.deepEqual(issues.map((i) => i.kind), ['transfer']);
  assert.equal(issues[0].kind === 'transfer' && issues[0].amount, 8000);
});

test('FCRA admin cap by date (50% before 29 Sep 2020, 20% after) and FC-4 totals tie to the ledger', () => {
  bankAccountsDb.save({ id: 'fc', name: 'FCRA SBI NDMB', active: true, fcra: 'designated' });
  const fc = saveFund({ name: 'Foreign grant', fund: { nature: 'fcra', purpose: 'Health camps' } });
  const admin = ensureAccount('Office salaries', 'INDIRECT_EXPENSES', 6700);
  const prog = ensureAccount('Programme expenses', 'INDIRECT_EXPENSES', 6600);
  for (const [fy, d] of [[2019, '2019-06-01'], [2025, '2025-06-01']] as const) {
    give(10000, { fund_id: fc.id, bank_account_id: 'fc', date: d });
    spend(admin, 3000, fc.id, bankLedgerId('fc'), d);
    spend(prog, 2000, fc.id, bankLedgerId('fc'), d);
    const issues = ledgerFcraIssues(loadLedger(), loadFunds(), bankAccountsDb.all(), { start: `${fy}-04-01`, end: `${fy + 1}-03-31` }, [admin]);
    assert.deepEqual(issues.map((i) => i.kind), fy === 2019 ? [] : ['adminCap'], String(fy));
  }
  const f = buildFc4(loadLedger(), loadFunds(), bankAccountsDb.all(), 2025);
  assert.deepEqual([f.bankOpening, f.bankReceipts, f.bankPayments, f.bankClosing], [5000, 10000, 5000, 10000]);
  assert.equal(f.income, 10000);
  assert.equal(f.expenditure, 5000);
  assert.deepEqual(f.purposes, [{ purpose: 'Health camps', amount: 5000 }]);
  assert.equal(f.dueBy, '2026-12-31');
});

test('Sec 11 application: % applied incl. accumulation against the date-keyed 85%', () => {
  const prog = ensureAccount('Programme expenses', 'INDIRECT_EXPENSES', 6600);
  give(100000, {});
  spend(prog, 80000, undefined, A.bank);
  const a = applicationFor(loadLedger(), 2025);
  assert.deepEqual([a.income, a.applied, a.pct, a.threshold, a.shortfall], [100000, 80000, 80, 85, 5000]);
  const b = applicationFor(loadLedger(), 2025, 5000);
  assert.equal(b.shortfall, 0);
});
