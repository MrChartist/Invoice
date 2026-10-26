/**
 * R6-C3 (P1-21): importing suppliers, ledgers (an opening trial balance) and bill-wise opening bills through the CSV /
 * XLSX wizard — dry-run difference, group mapping, supplier de-duplication, all-or-nothing, the locked opening day,
 * and a Vyapar party export that holds customers and suppliers. Every run is recorded in `import_runs`.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings, gstin } from './helpers/world.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import { clearOverrides, isPeriodLockedError } from '../src/lib/period-lock.ts';
import { guessMapping, isOpeningsKind, KIND_LABELS, missingRequired, presetById, templateRows, type ImportKind } from '../src/lib/import-mapping.ts';
import { parseTable } from '../src/lib/csv.ts';
import { applyOpeningsImport, buildOpeningsPreview, differenceNote, drCrOf, ImportOpeningsError, loadImportRuns, loadOpeningsContext, mapGroup, recordImportRun, signedAmount } from '../src/lib/import-openings.ts';
import { loadOpenings, openingDifference, partyLedgerId } from '../src/lib/ledger/index.ts';
import { loadOpeningBills } from '../src/lib/opening-bills.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { wizardReducer, initialWizardState } from '../src/components/import/wizard-state.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-06-30T10:00:00');
});
afterEach(() => thawDate());

const G1 = gstin('27AAPFU0939F1Z');
const G2 = gstin('29AABCT1332L1Z');

function preview(kind: 'vendors' | 'ledgers' | 'opening_bills', csv: string, presetId?: string) {
  const t = parseTable(csv);
  const table = { headers: t.headers, rows: t.rows };
  const { mapping } = guessMapping(kind, table.headers, table.rows, presetId);
  assert.deepEqual(missingRequired(kind, mapping).map((f) => f.key), [], `required columns mapped for ${kind}`);
  return buildOpeningsPreview({ kind, table, mapping, ctx: loadOpeningsContext() });
}

test('pure helpers: Dr / Cr cells, signed amounts, group mapping to the nearest Schedule III primary', () => {
  assert.equal(drCrOf('1,200 Dr'), 'Dr');
  assert.equal(drCrOf('Credit'), 'Cr');
  assert.equal(drCrOf('1200'), '');
  assert.equal(signedAmount('1,200 Cr', '', 'Dr'), -120_000);
  assert.equal(signedAmount('500', 'Dr', 'Cr'), 50_000);
  assert.equal(signedAmount('-75', '', 'Dr'), -7_500);
  assert.equal(signedAmount('', '', 'Dr'), null);
  assert.ok(Number.isNaN(signedAmount('abc', '', 'Dr')));
  assert.deepEqual(mapGroup('Sundry Creditors', []), { group: 'TRADE_PAYABLES', primary: 'TRADE_PAYABLES', exact: true });
  assert.deepEqual(mapGroup('Bank Accounts', []), { group: 'CASH_BANK', primary: 'CASH_BANK', exact: true });
  assert.deepEqual(mapGroup('Capital Account', []).primary, 'CAPITAL');
  assert.deepEqual(mapGroup('Duties & Taxes', []).primary, 'DUTIES_TAXES');
  assert.deepEqual(mapGroup('Office Rent Exp', []), { group: 'INDIRECT_EXPENSES', primary: 'INDIRECT_EXPENSES', exact: false }, 'keyword → nearest primary, flagged');
  assert.deepEqual(mapGroup('Misc', [], 'Cr'), { group: 'OTHER_CL', primary: 'OTHER_CL', exact: false });
  assert.deepEqual(mapGroup('Misc', [], 'Dr').primary, 'OTHER_CA');
  assert.deepEqual(mapGroup('Plant Loans', [{ id: 'ug1', name: 'Plant Loans', parent: 'LOANS_LT' }]), { group: 'ug1', primary: 'LOANS_LT', exact: true }, 'a user sub-group wins');
});

test('kinds, presets and templates: the three new kinds are wired into the wizard', () => {
  for (const k of ['vendors', 'ledgers', 'opening_bills'] as ImportKind[]) {
    assert.ok(isOpeningsKind(k) && KIND_LABELS[k]);
    assert.ok(templateRows(k)[0].length > 3);
  }
  assert.equal(isOpeningsKind('clients'), false);
  assert.ok(presetById('trial_balance')?.headers.ledgers);
  for (const id of ['vyapar', 'busy', 'marg', 'quickbooks', 'xero', 'refrens', 'clearone']) assert.ok(presetById(id)?.headers.vendors, `${id} has supplier headers`);
  const s = wizardReducer(initialWizardState('ledgers', { clients: [], items: [], invoices: [] }), { type: 'loaded', fileName: 'tb.csv', table: { headers: ['Name', 'Group', 'Debit', 'Credit'], rows: [['Cash', 'Cash-in-Hand', '100', '']] }, delimiter: ',' });
  assert.deepEqual([s.mapping.name, s.mapping.group, s.mapping.debit, s.mapping.credit], [0, 1, 2, 3]);
});

test('a trial balance with a Dr / Cr mismatch shows the difference before saving; it posts to 1090 after', () => {
  const p = preview('ledgers', [
    'Name,Group,Debit,Credit',
    'Capital Account,Capital Account,,250000',
    'HDFC Bank,Bank Accounts,180000,',
    'Furniture,Fixed Assets,60000,',
    'Shree Packaging,Sundry Creditors,,15000',
    'Asha Traders,Sundry Debtors,20000,',
    'Office Rent Exp,Expenses group X,4000,',
    'Difference in opening balances,Primary,,',
  ].join('\n'), 'trial_balance');
  assert.equal(p.difference, -1_000_00, '264,000 Dr vs 265,000 Cr');
  assert.match(differenceNote(p), /Difference in opening balances: ₹1,000.00 Cr — posts to "Opening balance difference" \(1090\)/);
  const rent = p.rows.find((r) => r.label === 'Office Rent Exp')!;
  assert.ok(rent.issues.some((i) => /not a known group — mapped to Other \(indirect\) expenses/.test(i.message)));
  assert.equal(p.rows.find((r) => r.label.startsWith('Difference'))!.action, 'skip');
  assert.ok(p.rows.find((r) => r.label === 'Shree Packaging')!.issues.some((i) => /New supplier/.test(i.message)));

  const report = applyOpeningsImport(p, { fileName: 'tb.csv' });
  assert.deepEqual([report.created, report.updated, report.skipped], [5, 1, 1], 'Capital Account is the default ledger (updated)');
  const openings = loadOpenings();
  assert.equal(openingDifference(openings), -1_000_00);
  const v = vendorsDb.all().find((x) => x.name === 'Shree Packaging')!;
  const c = localDb.clients.getAll().find((x) => x.name === 'Asha Traders')!;
  assert.equal(openings.find((o) => o.ledger_id === partyLedgerId('creditor', v.id))!.cr, 15_000_00);
  assert.equal(openings.find((o) => o.ledger_id === partyLedgerId('debtor', c.id))!.dr, 20_000_00);
  const hdfc = getTable<{ id: string; name: string; group: string; code: string }>('accounts').find((a) => a.name === 'HDFC Bank')!;
  assert.equal(hdfc.group, 'CASH_BANK');
  assert.match(hdfc.code, /^IM-\d+$/);
  const [run] = loadImportRuns();
  assert.deepEqual([run.kind, run.file_name, run.created, run.updated, run.opening_difference], ['ledgers', 'tb.csv', 5, 1, -1_000_00]);
});

test('an existing ledger is matched by name (opening set, group kept), not duplicated', () => {
  const p = preview('ledgers', 'Ledger Name,Under,Opening Balance\nCash in hand,Cash-in-Hand,"5,000 Dr"\nCapital Account,Capital Account,5000 Cr');
  assert.deepEqual(p.rows.map((r) => r.action), ['update', 'update']);
  assert.equal(p.difference, 0);
  applyOpeningsImport(p);
  assert.equal(getTable('accounts').length, 0, 'no new account');
  assert.equal(loadOpenings().length, 2);
});

test('suppliers: de-duplicated by GSTIN (existing master and within the file); opening balance by Dr / Cr', () => {
  vendorsDb.save({ name: 'Metro Steel Traders', gstin: G1 });
  const p = preview('vendors', [
    'Supplier Name,GSTIN,Phone,Opening Balance,Dr/Cr',
    `Metro Steel,${G1},9820012345,"12,000",Cr`,
    `Shree Packaging,${G2},,4500,`,
    `Shree Packaging Pvt,${G2},,,`,
  ].join('\n'));
  assert.deepEqual(p.rows.map((r) => [r.action, r.matchId ? 'match' : '']), [['update', 'match'], ['create', ''], ['skip', '']]);
  assert.ok(p.rows[0].issues.some((i) => /its name is kept/.test(i.message)));
  applyOpeningsImport(p);
  const all = vendorsDb.all();
  assert.equal(all.length, 2, 'matched, not duplicated');
  const metro = all.find((v) => v.gstin === G1)!;
  assert.deepEqual([metro.name, metro.phone], ['Metro Steel Traders', '9820012345']);
  const op = loadOpenings();
  assert.equal(op.find((o) => o.ledger_id === partyLedgerId('creditor', metro.id))!.cr, 12_000_00);
  const shree = all.find((v) => v.gstin === G2)!;
  assert.equal(op.find((o) => o.ledger_id === partyLedgerId('creditor', shree.id))!.cr, 4_500_00, 'a supplier balance defaults to Cr');
});

test('a Vyapar party export splits into clients and suppliers', () => {
  const p = preview('vendors', [
    'Party Name,Phone No.,Email Id,GSTIN,Party Type,Receivable Balance,Payable Balance',
    'Asha Traders,9000000001,asha@x.in,,Customer,2500,0',
    'Shree Packaging,9000000002,,,Supplier,0,7000',
    'Gopal Stores,9000000003,,,,1200,0',
  ].join('\n'), 'vyapar');
  applyOpeningsImport(p);
  assert.deepEqual(vendorsDb.all().map((v) => v.name), ['Shree Packaging']);
  assert.deepEqual(localDb.clients.getAll().map((c) => c.name).sort(), ['Asha Traders', 'Gopal Stores']);
  const asha = localDb.clients.getAll().find((c) => c.name === 'Asha Traders')!;
  const op = loadOpenings();
  assert.equal(op.find((o) => o.ledger_id === partyLedgerId('debtor', asha.id))!.dr, 2_500_00);
  assert.equal(op.find((o) => o.ledger_id === partyLedgerId('creditor', vendorsDb.all()[0].id))!.cr, 7_000_00);
});

test('all or nothing: a bad row refuses the whole import; a failure half-way rolls every table back', () => {
  const bad = preview('ledgers', 'Name,Group,Debit,Credit\nCash,Cash-in-Hand,100,\n,Bank Accounts,50,\nFurniture,Fixed Assets,abc,');
  assert.equal(bad.summary.error, 2);
  assert.throws(() => applyOpeningsImport(bad), (e: unknown) => e instanceof ImportOpeningsError && /Fix or skip the 2 rows/.test(e.message));
  assert.equal(loadOpenings().length, 0);
  // A write refused half-way (a duplicate account code planted after the dry run) leaves nothing behind.
  const ok = preview('ledgers', 'Name,Group,Debit,Credit\nHDFC Bank,Bank Accounts,100,\nFurniture,Fixed Assets,,100');
  setTable('accounts', [{ id: 'x', code: 'X1', name: 'Furniture', group: 'FIXED_ASSETS' }]);
  assert.throws(() => applyOpeningsImport(ok), /already exists/);
  assert.deepEqual(getTable<{ name: string }>('accounts').map((a) => a.name), ['Furniture']);
  assert.equal(loadOpenings().length, 0);
  assert.equal(loadImportRuns().length, 0);
});

test('the locked opening day is refused in the dry run and by the write', () => {
  // A preview built before the lock (an open wizard) is still refused by the write.
  const q = preview('opening_bills', 'Party,Side,Bill No,Bill Date,Amount\nAsha Traders,Receivable,OLD/7,2026-02-01,"10,000"');
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-03-31' } as never);
  const p = preview('opening_bills', 'Party,Side,Bill No,Bill Date,Amount\nAsha Traders,Receivable,OLD/7,2026-02-01,"10,000"');
  assert.equal(p.locked, true);
  assert.match(p.rows[0].issues.map((i) => i.message).join(' '), /opening day \(31 Mar 2026\) is in a locked period/);
  assert.equal(p.rows[0].action, 'error');
  assert.throws(() => applyOpeningsImport(q), (e: unknown) => isPeriodLockedError(e));
  assert.equal(loadOpeningBills().length, 0);
  assert.equal(localDb.clients.getAll().length, 0, 'the new client made for the bill is rolled back too');
});

test('opening bills: side from the column, Dr / Cr or the party master; merged into the party list by reference', () => {
  vendorsDb.save({ name: 'Shree Packaging' });
  localDb.clients.upsert({ name: 'Asha Traders' });
  const p = preview('opening_bills', [
    'Party Name,Bill No,Bill Date,Due Date,Pending Amount,Dr/Cr',
    'Asha Traders,OLD/7,01-02-2026,03-03-2026,"10,000",Dr',
    'Shree Packaging,SP/101,2026-02-10,,6000,',
    'Shree Packaging,SP/101,2026-02-10,,6000,',
    'Nobody,X/1,2026-02-10,,100,',
  ].join('\n'));
  assert.deepEqual(p.rows.map((r) => r.action), ['create', 'create', 'skip', 'error']);
  const report = applyOpeningsImport({ ...p, rows: p.rows.map((r) => (r.action === 'error' ? { ...r, action: 'skip' as const } : r)) });
  assert.equal(report.created, 2);
  const bills = loadOpeningBills();
  assert.deepEqual(bills.map((b) => [b.party_name, b.side, b.ref_no, b.date, b.due_date ?? '', b.amount, b.dr_cr]).sort(), [
    ['Asha Traders', 'receivable', 'OLD/7', '2026-02-01', '2026-03-03', 10_000, 'Dr'],
    ['Shree Packaging', 'payable', 'SP/101', '2026-02-10', '', 6_000, 'Cr'],
  ]);
  // A second file updates the same reference instead of adding a duplicate.
  const again = preview('opening_bills', 'Party Name,Bill No,Bill Date,Pending Amount,Side\nShree Packaging,SP/101,2026-02-10,5500,Payable');
  assert.equal(again.rows[0].action, 'update');
  applyOpeningsImport(again);
  assert.deepEqual(loadOpeningBills().filter((b) => b.side === 'payable').map((b) => b.amount), [5_500]);
});

test('every import run is recorded (the setup checklist reads import_runs)', () => {
  recordImportRun({ kind: 'clients', file_name: 'parties.csv', created: 3, updated: 0, skipped: 1, errors: 0 });
  const [r] = loadImportRuns();
  assert.deepEqual([r.kind, r.created, r.at.slice(0, 10)], ['clients', 3, '2026-06-30']);
});
