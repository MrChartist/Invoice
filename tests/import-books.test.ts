/**
 * P1-21: Excel / CSV import of ledgers (group + opening, the trial-balance template path of 7.49),
 * suppliers, stock items and manual vouchers through the import wizard engine.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { guessMapping, missingRequired, templateRows, trialBalanceTemplateRows, isBooksKind } from '../src/lib/import-mapping.ts';
import { applyBooksImport, buildBooksPreview, loadBooksExisting, resolveGroup } from '../src/lib/import-books.ts';
import { buildPreview, errorRowsCsv } from '../src/lib/importers.ts';
import { chartOf, loadUserAccounts, loadUserGroups } from '../src/lib/ledger/accounts.ts';
import { loadOpenings, saveBooksBegin } from '../src/lib/ledger/openings.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { localDb } from '../src/lib/localDb.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { stockDb } from '../src/lib/inventory.ts';
import { stockGroupsDb } from '../src/lib/stock-groups.ts';
import type { BooksImportKind } from '../src/lib/import-mapping.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  saveBooksBegin('2026-04-01');
});

function preview(kind: BooksImportKind, rows: string[][]) {
  const [headers, ...data] = rows;
  const table = { headers, rows: data };
  const { mapping } = guessMapping(kind, headers, data);
  assert.deepEqual(missingRequired(kind, mapping).map((f) => f.key), [], `${kind}: required columns mapped`);
  return { table, p: buildBooksPreview({ kind, table, mapping, existing: loadBooksExisting() }) };
}

test('kinds, templates and group resolution', () => {
  assert.ok(isBooksKind('vouchers'));
  assert.ok(!isBooksKind('clients'));
  assert.equal(templateRows('stock')[0][0], 'Item name');
  assert.equal(resolveGroup('Indirect Expenses', []), 'INDIRECT_EXPENSES');
  assert.equal(resolveGroup('sundry debtors', []), 'TRADE_RECEIVABLES');
  assert.equal(resolveGroup('Cash & bank', []), 'CASH_BANK');
  assert.equal(resolveGroup('__proto__', []), undefined, 'prototype-safe lookup');
  assert.equal(resolveGroup('constructor', []), undefined);
  assert.throws(() => buildPreview({ kind: 'ledgers', table: { headers: [], rows: [] }, mapping: {}, existing: { clients: [], items: [], invoices: [] } }));
});

test('trial-balance template: ledgers, parties and openings in one opening voucher (dry run writes nothing)', async () => {
  const { p } = preview('ledgers', trialBalanceTemplateRows());
  assert.equal(p.summary.error, 0, JSON.stringify(p.rows.flatMap((r) => r.issues)));
  assert.equal(p.summary.create, 6);
  assert.equal(loadOpenings().length, 0, 'preview writes nothing');
  const report = await applyBooksImport(p, { yieldToUi: async () => {} });
  assert.equal(report.created, 6);
  assert.deepEqual(report.errors, []);
  const chart = chartOf(loadUserAccounts());
  const rent = chart.find((a) => a.name === 'HDFC Bank 0012');
  assert.equal(rent?.group, 'CASH_BANK');
  assert.ok(localDb.clients.getAll().some((c) => c.name === 'Acme Traders Pvt Ltd'));
  assert.ok(vendorsDb.all().some((v) => v.name === 'Rao Packaging Pvt Ltd'));
  const openings = loadOpenings();
  const sum = openings.reduce((s, o) => s + o.dr - o.cr, 0);
  assert.equal(sum, 0, 'the template balances: Dr = Cr');
  assert.equal(openings.find((o) => o.ledger_id === rent?.id)?.dr, 32_000_000);
  // Re-import: everything matches (update), nothing duplicated.
  const again = preview('ledgers', trialBalanceTemplateRows()).p;
  assert.equal(again.summary.create, 0);
  assert.equal(again.summary.update, 6);
});

test('ledger rows: unknown group, single Dr/Cr column, duplicate in file, user sub-group', () => {
  const { p, table } = preview('ledgers', [
    ['Ledger', 'Under', 'Opening Balance'],
    ['Rent', 'Indirect Expenses', '12,000 Dr'],
    ['Loan from Bank', 'Secured Loans', '50000 Cr'],
    ['Rent', 'Indirect Expenses', ''],
    ['Mystery', 'No Such Group', ''],
    ['=HYPERLINK("x")', 'Indirect Expenses', '-5'],
  ]);
  const rec = (i: number) => p.rows[i].record as { opening: number };
  assert.equal(rec(0).opening, 1_200_000);
  assert.equal(rec(1).opening, -5_000_000);
  assert.equal(p.rows[2].action, 'skip');
  assert.equal(p.rows[3].action, 'error');
  assert.match(p.rows[3].issues[0].message, /Unknown group/);
  // Untrusted text is imported as text; the error CSV echo is formula-guarded.
  const csv = errorRowsCsv(table, p);
  assert.ok(!/\n=HYPERLINK/.test(csv));
  assert.ok(loadUserGroups().length === 0);
});

test('suppliers: GSTIN check, PAN from GSTIN, payable opening (Cr by default), update on re-import', async () => {
  const gstin = '27AAPFU0939F1ZV';
  const { p } = preview('vendors', [
    ['Supplier Name', 'GSTIN', 'State', 'Opening Balance', 'Email'],
    ['Rao Packaging', gstin, 'MH', '15000', 'ap@rao.in'],
    ['Bad GST', '27AAAAA0000A1Z0', '', '', 'nope'],
    ['Advance Co', '', 'Delhi', '2000 Dr', ''],
  ]);
  assert.equal(p.rows[1].action, 'error');
  const report = await applyBooksImport(p, { yieldToUi: async () => {} });
  assert.equal(report.created, 2);
  const rao = vendorsDb.all().find((v) => v.name === 'Rao Packaging')!;
  assert.equal(rao.pan, 'AAPFU0939F');
  assert.equal(rao.state_code, '27');
  const op = loadOpenings().find((o) => o.ledger_id === `party:creditor:${rao.id}`);
  assert.equal(op?.cr, 1_500_000);
  const adv = vendorsDb.all().find((v) => v.name === 'Advance Co')!;
  assert.equal(loadOpenings().find((o) => o.ledger_id === `party:creditor:${adv.id}`)?.dr, 200_000);
  const again = preview('vendors', [['Supplier Name', 'Phone'], ['Rao Packaging', '9820012345']]).p;
  assert.equal(again.rows[0].action, 'update');
  await applyBooksImport(again, { yieldToUi: async () => {} });
  assert.equal(vendorsDb.all().find((v) => v.id === rao.id)?.phone, '9820012345');
  assert.equal(vendorsDb.all().find((v) => v.id === rao.id)?.gstin, gstin, 'blank cells keep stored values');
});

test('stock items: group created once, unit normalised, rate from value', async () => {
  const { p } = preview('stock', [
    ['Item Name', 'Stock Group', 'Unit', 'HSN', 'GST %', 'Opening Qty', 'Opening Value'],
    ['A4 paper', 'Stationery', 'pcs', '48025610', '12', '100', '24000'],
    ['Pen', 'Stationery', 'Nos', '9608', '18', '50', ''],
    ['Bolt', '', '', '7318', '18', '-3', ''],
  ]);
  assert.equal(p.rows[2].action, 'error');
  await applyBooksImport(p, { yieldToUi: async () => {} });
  const items = stockDb.items();
  const paper = items.find((i) => i.name === 'A4 paper')!;
  assert.equal(paper.opening_rate, 240);
  assert.equal(paper.unit, 'PCS');
  assert.equal(stockGroupsDb.all().length, 1);
  assert.equal(items.find((i) => i.name === 'Pen')?.group_id, paper.group_id);
});

test('vouchers: grouped by number, ledgers / parties resolved, manual vouchers only, duplicates and locks refused', async () => {
  await applyBooksImport(preview('ledgers', [['Ledger', 'Group'], ['Office Rent', 'Indirect Expenses'], ['HDFC', 'Bank Accounts']]).p, { yieldToUi: async () => {} });
  vendorsDb.save({ name: 'Sharma Transport' });
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-04-15' });
  const { p } = preview('vouchers', [
    ['Voucher No', 'Date', 'Voucher Type', 'Ledger', 'Debit', 'Credit', 'Narration', 'Cost Centre'],
    ['JV-1', '20-04-2026', 'Journal', 'Office Rent', '25000', '', 'April rent', 'Head office'],
    ['JV-1', '20-04-2026', 'Journal', 'Sharma Transport', '', '25000', '', ''],
    ['PV-1', '21-04-2026', 'Payment', 'Sharma Transport', '25000', '', 'paid', ''],
    ['PV-1', '21-04-2026', 'Payment', 'HDFC', '', '25000', '', ''],
    ['JV-2', '10-04-2026', 'Journal', 'Office Rent', '1', '', '', ''],
    ['JV-2', '10-04-2026', 'Journal', 'HDFC', '', '1', '', ''],
    ['S-1', '22-04-2026', 'Sales', 'Office Rent', '1', '', '', ''],
    ['JV-3', '22-04-2026', 'Journal', 'Office Rent', '10', '', '', ''],
    ['JV-3', '22-04-2026', 'Journal', 'HDFC', '', '9', '', ''],
  ]);
  const byLabel = (n: string) => p.rows.find((r) => r.label.includes(n))!;
  assert.equal(byLabel('JV-1').action, 'create');
  assert.equal(byLabel('PV-1').action, 'create');
  assert.equal(byLabel('JV-2').action, 'error', 'locked period');
  assert.equal(byLabel('S-1').action, 'error', 'sales are documents, not vouchers');
  assert.equal(byLabel('JV-3').action, 'error', 'unbalanced');
  const report = await applyBooksImport(p, { yieldToUi: async () => {} });
  assert.equal(report.created, 2);
  const vs = loadVouchers();
  assert.deepEqual(vs.map((v) => v.number).sort(), ['JV-1', 'PV-1']);
  const jv = vs.find((v) => v.number === 'JV-1')!;
  assert.equal(jv.voucher_class, 'Excel import');
  assert.equal(jv.lines.find((l) => l.cr > 0)?.party, 'Sharma Transport');
  assert.ok(jv.lines.find((l) => l.dr > 0)?.cost_centre_id, 'cost centre created and linked');
  assert.equal(localDb.invoices.getAll().length, 0, 'never invoices');
  // Re-import: the numbers exist, nothing is overwritten.
  const again = preview('vouchers', [['Voucher No', 'Date', 'Voucher Type', 'Ledger', 'Debit', 'Credit'], ['JV-1', '20-04-2026', 'Journal', 'Office Rent', '1', ''], ['JV-1', '20-04-2026', 'Journal', 'HDFC', '', '1']]).p;
  assert.equal(again.rows[0].action, 'skip');
});
