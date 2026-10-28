/**
 * WP-1 openings: ledger opening balances (Dr / Cr on the books-beginning date), the difference in
 * opening balances (reported, never forced), TB / BS with openings, bill-wise opening outstandings
 * in receivables ageing and statements, receipts against opening bills, interest, roles, backup.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, loadStorage, resetStorage } from './helpers/shim.ts';
import { setActorProvider, type Role } from '../src/lib/access.ts';
import { EMPTY_BOOKS } from '../src/lib/books.ts';
import { buildBackup, parseBackup, validateBackupData } from '../src/lib/backup.ts';
import { runMigrations, SCHEMA_VERSION_KEY } from '../src/lib/migrations.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import {
  A,
  accountStatement,
  buildLedger,
  dayBefore,
  defaultBooksBegin,
  ensureBooksBegin,
  interestOnBalances,
  ledgerBalanceSheet,
  ledgerInterest,
  ledgerInterestReport,
  loadBooksBegin,
  loadLedgerInput,
  loadOpenings,
  normalizeOpenings,
  openingBalance,
  openingDifference,
  openingDifferenceText,
  openingVoucherDifference,
  partyLedgerId,
  saveBooksBegin,
  saveOpenings,
  saveUserAccount,
  trialBalance,
  type LedgerInput,
} from '../src/lib/ledger/index.ts';
import {
  billsTotal,
  loadOpeningBills,
  loadReceivableOpeningBills,
  normalizeOpeningBills,
  openingBillsFor,
  receivableOpeningBills,
  saveOpeningBillsFor,
  validateOpeningBills,
  type OpeningBill,
} from '../src/lib/opening-bills.ts';
import { buildLedger as partyStatement, buildReceivables } from '../src/lib/receivables.ts';

const as = (role: Role | null) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role }) : null);
beforeEach(() => resetStorage());
afterEach(() => as(null));

const BEGIN = '2026-04-01';
const FY = { start: '2026-04-01', end: '2027-03-31' };
const asha = { id: 'c1', name: 'Asha', company: 'Asha Traders', email: '', address: '', city: '', zip: '' };

function input(over: Partial<LedgerInput> & Record<string, unknown> = {}): LedgerInput {
  return { ...EMPTY_BOOKS, userAccounts: [], manual: [], assets: [], today: '2026-10-25', booksBegin: BEGIN, clients: [asha], ...over } as LedgerInput;
}

const op = (ledger_id: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id: `o-${ledger_id}`,
  ledger_id,
  dr: amount > 0 ? amount : 0,
  cr: amount < 0 ? -amount : 0,
  ...extra,
});

test('opening voucher: dated the day before books begin, balanced via Opening balance difference', () => {
  const ledger = buildLedger(
    input({
      ledgerOpenings: [op(A.capital, -50_000_00), op(A.bank, 30_000_00), op(A.faComputers, 15_000_00), op(partyLedgerId('debtor', 'c1'), 10_000_00)],
    }),
  );
  const v = ledger.vouchers.find((x) => x.id === `obal:${BEGIN}`);
  assert.ok(v);
  assert.equal(v!.date, '2026-03-31');
  assert.equal(v!.kind, 'Opening');
  // Dr 30,000 + 15,000 + 10,000 = 55,000; Cr 50,000 → difference 5,000 Dr → Cr Opening balance difference 5,000.
  const diffLine = v!.lines.find((l) => l.account === A.openingDiff)!;
  assert.equal(diffLine.cr, 5_000_00);
  assert.equal(openingVoucherDifference(v), 5_000_00);
  assert.equal(v!.lines.find((l) => l.account === A.debtors)!.party, 'Asha Traders', 'party line uses the client name the invoices use');
  assert.equal(ledger.warnings.length, 0);
  assert.equal(dayBefore('2026-03-01'), '2026-02-28');
});

test('trial balance with openings: opening column holds them, debits = credits, difference shows on 1090', () => {
  const ledger = buildLedger(input({ ledgerOpenings: [op(A.capital, -50_000_00), op(A.bank, 45_000_00)] }));
  const tb = trialBalance(ledger, FY);
  const row = (id: string) => tb.rows.find((r) => r.account.id === id)!;
  assert.equal(row(A.bank).opening, 45_000_00);
  assert.equal(row(A.capital).opening, -50_000_00);
  assert.equal(row(A.openingDiff).opening, 5_000_00, 'difference in opening balances: ₹5,000 Dr');
  assert.equal(tb.totals.openingDr, tb.totals.openingCr);
  assert.equal(openingDifference(loadOpenings()), 0);
  assert.equal(openingDifferenceText(5_000_00), 'Difference in opening balances: ₹5,000.00 Dr');
  assert.equal(openingDifferenceText(0), '');
});

test('balance sheet ties with openings; P&L openings before 1 April fold into reserves', () => {
  const ledger = buildLedger(
    input({
      ledgerOpenings: [op(A.capital, -1_00_000_00), op(A.bank, 80_000_00), op(A.stock, 30_000_00), op(A.sales, -20_000_00), op(A.rent, 10_000_00)],
    }),
  );
  const bs = ledgerBalanceSheet(ledger, '2026-04-30');
  assert.equal(bs.difference, 0);
  assert.equal(bs.profitBroughtForward, 10_000_00, 'last year’s sales − rent carried as surplus');
  assert.equal(bs.profitForYear, 0);
  // Mid-year books: P&L openings stay in this FY.
  const mid = buildLedger(input({ booksBegin: '2026-10-01', ledgerOpenings: [op(A.capital, -10_000_00), op(A.sales, -10_000_00), op(A.bank, 20_000_00)] }));
  assert.equal(ledgerBalanceSheet(mid, '2026-10-31').profitForYear, 10_000_00);
});

test('unknown account / vanished party openings are left out with a warning, not silently', () => {
  const ledger = buildLedger(input({ ledgerOpenings: [op('nope', 100), op(partyLedgerId('debtor', 'gone'), 200), op(A.bank, 300)] }));
  assert.equal(ledger.warnings.length, 2);
  const v = ledger.vouchers.find((x) => x.kind === 'Opening')!;
  assert.deepEqual(v.lines.map((l) => l.account).sort(), [A.bank, A.openingDiff].sort());
});

test('a party with opening bills but no typed opening: the bill total is its opening', () => {
  const bills: OpeningBill[] = [
    { id: 'b1', party_id: 'c1', party_name: 'Asha', side: 'receivable', ref_no: 'INV-90', date: '2026-02-10', due_date: '2026-03-12', amount: 7_000, dr_cr: 'Dr' },
    { id: 'b2', party_id: 'c1', party_name: 'Asha', side: 'receivable', ref_no: 'CN-3', date: '2026-03-01', amount: 1_000, dr_cr: 'Cr' },
    { id: 'b3', party_id: 'v1', party_name: 'Steel Co', side: 'payable', ref_no: 'S/11', date: '2026-03-20', amount: 4_000, dr_cr: 'Cr' },
  ];
  const ledger = buildLedger(input({ openingBills: bills, vendors: [{ id: 'v1', name: 'Steel Co' }] }));
  const v = ledger.vouchers.find((x) => x.kind === 'Opening')!;
  const deb = v.lines.find((l) => l.account === A.debtors)!;
  const cred = v.lines.find((l) => l.account === A.creditors)!;
  assert.equal(deb.dr, 6_000_00);
  assert.equal(cred.cr, 4_000_00);
  assert.equal(cred.party, 'Steel Co');
  assert.equal(openingVoucherDifference(v), 2_000_00);
});

test('Books cash opening on the same date still wins for cash (no double count)', () => {
  const ledger = buildLedger(input({ ledgerOpenings: [op(A.cash, 5_000_00), op(A.capital, -5_000_00)], openings: [{ id: 'bo', account: 'cash', amount: 8_000, as_of: BEGIN }] as never }));
  const st = accountStatement(ledger, A.cash, FY)!;
  assert.equal(st.opening, 5_000_00, 'master opening dated 31 Mar');
  assert.equal(st.closing, 8_000_00, 'the Books opening on 1 Apr tops cash up to what was typed there, not 5,000 + 8,000');
});

test('storage: saveOpenings upserts one row per ledger, 0 removes, pins books-begin, audits', () => {
  saveOpenings([{ ledger_id: A.capital, amount: -10_000_00 }, { ledger_id: A.bank, amount: 10_000_00 }]);
  assert.equal(loadOpenings().length, 2);
  assert.equal(openingBalance(A.capital, undefined, loadOpenings()), -10_000_00);
  assert.equal(openingBalance(A.capital, '2025-01-01', loadOpenings(), BEGIN), 0, 'before the books began there is no balance');
  saveOpenings([{ ledger_id: A.bank, amount: 0 }]);
  assert.deepEqual(loadOpenings().map((o) => o.ledger_id), [A.capital]);
  assert.ok(getTable('books_begin').length === 1, 'books-begin date pinned on first save');
  assert.ok(getTable<{ summary: string }>('audit_log').some((e) => /Opening balances changed/.test(e.summary)));
  saveBooksBegin('2025-04-01');
  assert.equal(loadBooksBegin('2026-10-25'), '2025-04-01');
  assert.throws(() => saveBooksBegin('2025-02-30'), /books beginning/);
  assert.equal(ensureBooksBegin('2030-01-01'), '2025-04-01', 'never moves once stored');
  assert.equal(defaultBooksBegin('2026-03-31'), '2025-04-01');
  assert.equal(defaultBooksBegin('2026-04-01'), '2026-04-01');
});

test('normalizers are idempotent and tolerant', () => {
  const rows = [op('a', 100), op('a', 300), { id: 'x', ledger_id: 'b', dr: 1.5, cr: 0 }, op('z', 0), { id: 'n', ledger_id: 'c', dr: 500, cr: 200 }];
  const once = normalizeOpenings(rows);
  assert.deepEqual(once.map((o) => [o.ledger_id, o.dr, o.cr]), [['a', 300, 0], ['c', 300, 0]]);
  assert.deepEqual(normalizeOpenings(once), once);
  const bills = normalizeOpeningBills([
    { id: 'b1', party_id: 'c1', party_name: 'Asha', side: 'receivable', ref_no: 'R1', date: '2026-01-01', amount: '100.456', dr_cr: 'Dr' },
    { id: 'b1', party_name: 'Dup', side: 'receivable', date: '2026-01-01', amount: 1 },
    { id: 'b2', party_name: 'Bad date', side: 'payable', date: '2026-02-30', amount: 1 },
    { id: 'b3', party_name: 'Default side', side: 'payable', date: '2026-02-03', amount: 5 },
  ]);
  assert.deepEqual(bills.map((b) => [b.id, b.amount, b.dr_cr]), [['b1', 100.46, 'Dr'], ['b3', 5, 'Cr']]);
  assert.deepEqual(normalizeOpeningBills(bills), bills);
});

test('saveOpeningBillsFor validates, replaces the party’s bills, and openingBillsFor reads them (WIP-C API)', () => {
  assert.deepEqual(validateOpeningBills([{ ref_no: 'A', date: '2026-01-05', amount: 0, dr_cr: 'Dr' }, { ref_no: 'a', date: 'x', amount: 5, dr_cr: 'Dr' }]), [
    'Bill 1: enter an amount above zero.',
    'Bill 2: reference a is used twice.',
    'Bill 2: choose the bill date.',
  ]);
  saveOpeningBillsFor({ id: 'v1', name: 'Steel Co', side: 'payable' }, [{ ref_no: 'S/1', date: '2026-03-01', credit_days: 30, amount: 500, dr_cr: 'Cr' }]);
  saveOpeningBillsFor({ id: 'c1', name: 'Asha', side: 'receivable' }, [{ ref_no: 'R1', date: '2026-03-10', amount: 100, dr_cr: 'Dr' }]);
  saveOpeningBillsFor({ id: 'c1', name: 'Asha', side: 'receivable' }, [{ ref_no: 'R2', date: '2026-03-11', amount: 250, dr_cr: 'Dr' }]);
  assert.deepEqual(openingBillsFor('c1').map((b) => b.ref_no), ['R2']);
  const pay = openingBillsFor('v1', 'payable');
  assert.equal(pay[0].due_date, '2026-03-31', 'credit days → due date');
  assert.equal(billsTotal(loadOpeningBills()), -250);
});

test('receivables: opening bills age like invoices, settle by receipts, never count as billed; On Account residual', () => {
  const now = new Date(2026, 5, 30); // 30 Jun 2026
  const openings = new Map([[partyLedgerId('debtor', 'c1'), 12_000_00]]);
  const bills: OpeningBill[] = [{ id: 'ob1', party_id: 'c1', party_name: 'Asha', side: 'receivable', ref_no: 'OLD/7', date: '2026-02-01', due_date: '2026-03-03', amount: 10_000, dr_cr: 'Dr' }];
  const ob = receivableOpeningBills(bills, openings, [asha], BEGIN);
  assert.equal(ob.length, 2);
  assert.deepEqual(ob[1], { id: 'onacc:c1', party_id: 'c1', party_name: 'Asha', ref_no: 'On Account', date: '2026-03-31', due_date: '2026-03-31', amount: 2_000, dr_cr: 'Dr', on_account: true });
  const payments = [{ id: 'p1', invoice_id: 'ob1', amount: 4_000, method: 'UPI', date: '2026-05-10', client_id: 'c1', client_name: 'Asha Traders' }];
  const rep = buildReceivables({ invoices: [], payments, clients: [asha], openingBills: ob }, { now });
  const party = rep.parties[0];
  assert.equal(party.key, 'c1');
  assert.equal(party.net, 8_000, '12,000 opening − 4,000 received');
  const old = party.bills.find((b) => b.number === 'OLD/7')!;
  assert.equal(old.opening, true);
  assert.equal(old.outstanding, 6_000);
  assert.equal(old.bucket, '90+ days', 'due 3 Mar → 119 days overdue on 30 Jun');
  assert.equal(rep.totals.buckets['90+ days'], 8_000);
  // Statement: opening entries first, running balance, payment against the bill.
  const st = partyStatement(party, '2026-04-01', '2026-06-30');
  assert.equal(st.opening, 12_000);
  assert.equal(st.closing, 8_000);
  assert.equal(st.entries[0].particulars, 'Receipt – UPI (against OLD/7)');
  // Other currencies ignore INR opening bills.
  assert.equal(buildReceivables({ invoices: [], payments: [], openingBills: ob }, { currency: 'USD', now }).parties.length, 0);
  // A Cr opening is an opening credit (advance).
  const cr = buildReceivables({ invoices: [], payments: [], openingBills: [{ ...ob[0], id: 'x', dr_cr: 'Cr' }] }, { now });
  assert.equal(cr.parties[0].net, -10_000);
  assert.equal(cr.parties[0].bills.length, 0);
});

test('ledger: a receipt against an opening bill clears the right party (client_name), receivables agree', () => {
  const bills: OpeningBill[] = [{ id: 'ob1', party_id: 'c1', party_name: 'Asha', side: 'receivable', ref_no: 'OLD/7', date: '2026-02-01', amount: 10_000, dr_cr: 'Dr' }];
  const transactions = [{ id: 'p1', invoice_id: 'ob1', amount: 4_000, method: 'Cash', date: '2026-05-10', client_id: 'c1', client_name: 'Asha Traders' }];
  const ledger = buildLedger(input({ openingBills: bills, transactions: transactions as never }));
  const st = accountStatement(ledger, A.debtors, FY, 'Asha Traders')!;
  assert.equal(st.opening, 10_000_00);
  assert.equal(st.closing, 6_000_00);
  assert.ok(!ledger.vouchers.some((v) => v.party === 'Unknown customer'));
});

test('loadLedgerInput / loadReceivableOpeningBills read the stored masters end to end', () => {
  setTable('clients', [asha]);
  saveOpeningBillsFor({ id: 'c1', name: 'Asha', side: 'receivable' }, [{ ref_no: 'R1', date: '2026-03-10', amount: 10_000, dr_cr: 'Dr' }]);
  const inp = loadLedgerInput(EMPTY_BOOKS, '2026-10-25');
  const tb = trialBalance(buildLedger(inp), FY);
  assert.equal(tb.rows.find((r) => r.account.id === A.debtors)!.opening, 10_000_00);
  assert.equal(tb.rows.find((r) => r.account.id === A.openingDiff)!.opening, -10_000_00);
  assert.equal(tb.totals.openingDr, tb.totals.openingCr);
  const ob = loadReceivableOpeningBills([asha], '2026-10-25');
  assert.equal(ob.length, 1, 'no typed opening → no On Account line');
});

test('interest on a ledger: simple interest on daily balances, by side', () => {
  const p = { start: '2026-04-01', end: '2026-04-30' };
  // ₹1,00,000 Dr all month at 12% / 365: 100000 × 12% × 30 / 365 = 986.30
  const r = interestOnBalances(1_00_000_00, [], p, { rate: 12, on: 'dr' });
  assert.equal(r.onDebit, 98630);
  assert.equal(interestOnBalances(1_00_000_00, [], p, { rate: 12, on: 'cr' }).onDebit, 0);
  // Balance halves from 16 Apr: 15 days on 1,00,000 + 15 days on 50,000 = 493.15 + 246.58
  const h = interestOnBalances(1_00_000_00, [{ date: '2026-04-16', balance: 50_000_00 }], p, { rate: 12, on: 'both' });
  assert.equal(h.slices.length, 2);
  assert.equal(h.onDebit, 49315 + 24658);
  const acc = saveUserAccount({ code: '3601', name: 'Loan to Ravi', group: 'LOANS_ADV_ST', interest: { rate: 12, on: 'dr' } });
  assert.deepEqual(acc.interest, { rate: 12, on: 'dr' });
  const ledger = buildLedger(input({ userAccounts: [acc], ledgerOpenings: [op(acc.id, 1_00_000_00), op(A.bank, -1_00_000_00)] }));
  assert.equal(ledgerInterest(ledger, acc.id, p, acc.interest!).onDebit, 98630);
});

test('PENDING 35: ledger-wise interest report lists loans given (own parameters) and taken (loan master rate)', () => {
  const p = { start: '2026-04-01', end: '2026-04-30' };
  const given = saveUserAccount({ code: '3601', name: 'Loan to Ravi', group: 'LOANS_ADV_ST', interest: { rate: 12, on: 'dr' } });
  const taken = saveUserAccount({ code: '2101', name: 'HDFC term loan', group: 'LOANS_LT' });
  const ledger = buildLedger(input({ userAccounts: [given, taken], ledgerOpenings: [op(given.id, 1_00_000_00), op(taken.id, -73_000_00), op(A.bank, -27_000_00)] }));
  const rows = ledgerInterestReport(ledger, p, new Map([[taken.id, { rate: 10, on: 'cr' as const }]]));
  assert.deepEqual(rows.map((r) => [r.account.name, r.source, r.onDebit, r.onCredit]), [
    ['HDFC term loan', 'loan', 0, 60000], // 73,000 × 10% × 30 / 365 = 600.00
    ['Loan to Ravi', 'ledger', 98630, 0],
  ]);
  assert.equal(rows[1].closing, 1_00_000_00);
  assert.equal(ledgerInterestReport(ledger, p).length, 1, 'without the loan master only ledgers with parameters');
});

test('roles: openings need books.edit (viewer refused, clerk allowed)', () => {
  as('viewer');
  assert.throws(() => saveOpenings([{ ledger_id: A.bank, amount: 100 }]), /cannot/);
  assert.throws(() => saveOpeningBillsFor({ id: 'c1', name: 'Asha', side: 'receivable' }, []), /cannot/);
  for (const t of ['ledger_openings', 'opening_bills', 'books_begin']) assert.throws(() => setTable(t, []), /cannot/, t);
  as('clerk');
  saveOpenings([{ ledger_id: A.bank, amount: 100 }]);
  assert.equal(loadOpenings().length, 1);
});

test('backup round-trip keeps groups, openings, books-begin and opening bills; damaged rows are refused', () => {
  setTable('groups', [{ id: 'g1', name: 'Mumbai', parent: 'TRADE_RECEIVABLES' }]);
  saveOpenings([{ ledger_id: A.bank, amount: 100_00 }]);
  saveOpeningBillsFor({ id: 'c1', name: 'Asha', side: 'receivable' }, [{ ref_no: 'R1', date: '2026-03-10', amount: 100, dr_cr: 'Dr' }]);
  const text = JSON.stringify(buildBackup());
  const { data } = parseBackup(text);
  resetStorage();
  loadStorage(data);
  assert.equal(getTable('groups').length, 1);
  assert.equal(loadOpenings()[0].dr, 100_00);
  assert.equal(loadOpeningBills()[0].ref_no, 'R1');
  assert.equal(getTable('books_begin').length, 1);
  assert.throws(() => validateBackupData({ mrchartist_inv_opening_bills: JSON.stringify([{ ref_no: 'no id' }]) }), /opening_bills/);
  assert.throws(() => validateBackupData({ mrchartist_inv_groups: '{}' }), /groups/);
});

test('migrations: nothing to map (stored shapes are additive) — a run over masters data is a no-op', () => {
  setTable('clients', [asha]);
  setTable('groups', [{ id: 'g1', name: 'Mumbai', parent: 'TRADE_RECEIVABLES' }]);
  setTable('accounts', [{ id: 'a1', code: '9', name: 'Loan', group: 'LOANS_ADV_ST', under: 'nope' }]);
  const before = dumpStorage();
  const first = runMigrations();
  assert.ok(first.status === 'migrated' || first.status === 'fresh' || first.status === 'current');
  const after = dumpStorage();
  for (const k of ['mrchartist_inv_groups', 'mrchartist_inv_accounts', 'mrchartist_inv_clients']) assert.equal(after[k], before[k], `${k} untouched`);
  assert.equal(runMigrations().status, 'current', 'second run is idempotent');
  assert.ok(after[SCHEMA_VERSION_KEY]);
});

test('P0-11: a manual receipt allocated bill-wise settles the opening bill once (receivables + ledger agree); delete removes it', async () => {
  const { syncVoucherReceipts, removeVoucherReceipts, openRefsFor, validateAllocations, voucherReceipts } = await import('../src/lib/bill-allocation.ts');
  const { saveVoucher, loadVouchers } = await import('../src/lib/ledger/index.ts');
  setTable('clients', [asha]);
  saveOpeningBillsFor({ id: 'c1', name: 'Asha', side: 'receivable' }, [{ ref_no: 'OLD/1', date: '2026-02-01', due_date: '2026-03-01', amount: 10_000, dr_cr: 'Dr' }]);
  const refs = openRefsFor('Asha Traders', undefined, new Date(2026, 5, 30));
  assert.deepEqual(refs.map((r) => [r.ref, r.outstanding, r.opening]), [['OLD/1', 10_000, true]]);
  assert.deepEqual(validateAllocations([{ bill_id: refs[0].id, ref: 'OLD/1', amount: 12_000 }], 12_000, refs), ['OLD/1: only 10000.00 is due.']);
  const v = saveVoucher({
    type: 'RECEIPT',
    date: '2026-05-10',
    narration: 'Received',
    lines: [
      { account_id: A.bank, dr: 12_000_00, cr: 0 },
      { account_id: A.debtors, dr: 0, cr: 12_000_00, party: 'Asha Traders' },
    ],
  });
  syncVoucherReceipts(v, 'Asha Traders', 12_000, [{ bill_id: refs[0].id, ref: 'OLD/1', amount: 10_000 }], 'Bank Transfer');
  const rows = voucherReceipts(v.id);
  assert.deepEqual(rows.map((r) => [r.invoice_id ? 'agst' : 'onacc', r.amount, r.client_id]), [['agst', 10_000, 'c1'], ['onacc', 2_000, 'c1']]);
  // Receivables: bill cleared, 2,000 on account (net −2,000).
  const transactions = getTable('transactions');
  const rep = buildReceivables({ invoices: [], payments: transactions as never, clients: [asha], openingBills: loadReceivableOpeningBills([asha], '2026-10-25') }, { now: new Date(2026, 5, 30) });
  assert.equal(rep.parties[0].bills.length, 0);
  assert.equal(rep.parties[0].net, -2_000);
  // Ledger: the voucher posts once; its receipt rows do not post again.
  const ledger = buildLedger(loadLedgerInput({ ...EMPTY_BOOKS, transactions: transactions as never }, '2026-10-25'));
  const st = accountStatement(ledger, A.debtors, FY, 'Asha Traders')!;
  assert.equal(st.opening, 10_000_00);
  assert.equal(st.closing, -2_000_00, 'ledger party balance = receivables net');
  assert.equal(ledger.vouchers.filter((x) => x.kind === 'Receipt').length, 1);
  removeVoucherReceipts(v.id);
  assert.equal(voucherReceipts(v.id).length, 0);
  assert.equal(loadVouchers().length, 1);
});

test('R6-C2: the customer TDS on a bill cleared by a voucher allocation reaches the register and TDS receivable', async () => {
  const { syncVoucherReceipts, openRefsFor, voucherReceipts, stampVoucherTds } = await import('../src/lib/bill-allocation.ts');
  const { saveVoucher } = await import('../src/lib/ledger/index.ts');
  const { tdsInvoiceLines } = await import('../src/lib/tds-register.ts');
  setTable('clients', [asha]);
  const inv = {
    id: 'i1', doc_type: 'TAX_INVOICE', status: 'Sent', invoice_number: 'INV/FY26-27/0001', issue_date: '2026-05-01', due_date: '2026-05-31', currency: 'INR',
    client: { id: 'c1', name: 'Asha', company: 'Asha Traders' }, items: [{ id: 'l', name: 'Audit fee', quantity: 1, rate: 100_000, tax_rate: 18, amount: 100_000 }],
    subtotal: 100_000, taxable_value: 100_000, cgst_amount: 9_000, sgst_amount: 9_000, igst_amount: 0, tax_amount: 18_000, total: 118_000,
    tds_amount: 10_000, tds_section: '194J', amount_paid: 0, balance_due: 108_000, gst_mode: 'CGST_SGST',
  };
  setTable('invoices', [inv]);
  const refs = openRefsFor('Asha Traders', undefined, new Date(2026, 5, 30));
  assert.deepEqual(refs.map((r) => [r.ref, r.outstanding, r.tds]), [['INV/FY26-27/0001', 108_000, 10_000]], 'the allocation screen shows the TDS');
  const v = saveVoucher({
    type: 'RECEIPT', date: '2026-06-10', narration: 'Received net of TDS',
    lines: [{ account_id: A.bank, dr: 108_000_00, cr: 0 }, { account_id: A.debtors, dr: 0, cr: 108_000_00, party: 'Asha Traders' }],
  });
  syncVoucherReceipts(v, 'Asha Traders', 108_000, [{ bill_id: 'i1', ref: inv.invoice_number, amount: 108_000 }], 'Bank Transfer');
  const [row] = voucherReceipts(v.id);
  assert.equal(row.tds_amount, 10_000, 'the row that clears the cash part carries the TDS');
  // Register: the bill is settled (cash + TDS = total).
  const lines = tdsInvoiceLines({ invoices: getTable('invoices') as never, payments: getTable('transactions') as never, clients: [asha] as never });
  assert.deepEqual(lines.map((l) => [l.tds, l.settled]), [[10_000, true]]);
  // Ledger: Dr TDS receivable, Cr the debtor — the party balance is nil, as for an invoice receipt.
  const ledger = buildLedger(loadLedgerInput({ ...EMPTY_BOOKS, invoices: getTable('invoices') as never, transactions: getTable('transactions') as never }, '2026-10-25'));
  assert.equal(accountStatement(ledger, A.tdsReceivable, FY)!.closing, 10_000_00);
  assert.equal(accountStatement(ledger, A.debtors, FY, 'Asha Traders')!.closing, 0);
  // A partial allocation that does not reach total − TDS stamps nothing.
  const partial = stampVoucherTds([{ id: 'x', invoice_id: 'i1', amount: 50_000, method: 'Bank', date: '2026-06-10' }], new Set(['x']), () => inv as never);
  assert.equal(partial[0].tds_amount, undefined);
});
