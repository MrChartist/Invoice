/**
 * P1-21 (7Q): Excel / CSV import of stock items and manual vouchers through the import wizard engine
 * (ledgers, suppliers and the trial balance are R6-C3's `import-openings.ts`, tested in its own file).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { guessMapping, missingRequired, templateRows, isBooksKind } from '../src/lib/import-mapping.ts';
import { applyBooksImport, buildBooksPreview, loadBooksExisting } from '../src/lib/import-books.ts';
import { saveUserAccount } from '../src/lib/ledger/accounts.ts';
import { saveBooksBegin } from '../src/lib/ledger/openings.ts';
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

test('kinds and templates', () => {
  assert.ok(isBooksKind('vouchers'));
  assert.ok(isBooksKind('stock'));
  assert.ok(!isBooksKind('clients'));
  assert.ok(!isBooksKind('ledgers'), 'ledgers are the R6-C3 openings kind');
  assert.equal(templateRows('stock')[0][0], 'Item name');
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
  saveUserAccount({ code: '5901', name: 'Office Rent', group: 'INDIRECT_EXPENSES' });
  saveUserAccount({ code: '1291', name: 'HDFC', group: 'CASH_BANK' });
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
