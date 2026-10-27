/** MF-D4 AA / EPCG: EO balances by quantity and value, validity and EO dates, at-risk memo, EPCG multiple, BOE duty foregone. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import { anf4fSheet, authorisationsDb, defaultDates, dutyForegone, eoStatus, exportsAgainst, importsAgainst, withExportAa, type ExportAuthorisation } from '../src/lib/mfg/mf-authorisations.ts';
import { incentivesDb } from '../src/lib/trade/export-incentives.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ industry_packs: ['shopfloor'] } as never);
});

const aa = (over: Partial<ExportAuthorisation> = {}): ExportAuthorisation => ({
  id: 'aa1', kind: 'aa', number: '0310001234', date: '2026-01-15', items_import: [{ item_id: 'pp', qty: 12000, cif_value: 1200000 }], items_export: [{ item_id: 'caps', qty: 10000, fob_value: 2000000 }],
  norm: 'sion', ...defaultDates('aa', '2026-01-15'), duty_saved: 300000, status: 'open', ...over,
});
const items: Record<string, string> = { 'pp granules': 'pp', 'caps 28 mm': 'caps' };
const idOf = (n: string) => items[n.trim().toLowerCase()];

test('default dates: AA import validity 12 months, EO 18 months; EPCG 6 years', () => {
  assert.deepEqual(defaultDates('aa', '2026-01-15'), { import_valid_to: '2027-01-14', eo_due: '2027-07-14' });
  assert.equal(defaultDates('epcg', '2026-01-15').eo_due, '2032-01-14');
});

test('EO balance by quantity and value (lower share), at-risk memo, bell, imports in base units; RoDTEP 4RE', () => {
  const ex = { id: 'e1', invoice_number: 'EXP/1', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-03-01', currency: 'USD', exchange_rate: 80, items: [{ id: 'l', name: 'Caps 28 mm', quantity: 4000, rate: 6, tax_rate: 0 }], mf: withExportAa(undefined, aa()) } as unknown as InvoiceRecord;
  const other = { ...ex, id: 'e2', mf: undefined } as InvoiceRecord;
  const exports = exportsAgainst([ex, other], 'aa1', idOf);
  assert.deepEqual(exports.map((e) => [e.qty, e.value]), [[4000, 1920000]]);
  const bill = { id: 'b1', kind: 'PURCHASE', vendor_name: 'Sabic', bill_number: 'BOE/1', date: '2026-02-01', lines: [{ id: 'l', name: 'PP granules', quantity: 5, rate: 100000, unit: 'MT', unit_factor: 1000 }], taxable: 500000, total: 500000, mf: { authorisation_id: 'aa1' } };
  const imports = importsAgainst([bill, { ...bill, id: 'b2', status: 'void' }, { ...bill, id: 'b3', mf: undefined }], 'aa1', idOf);
  assert.deepEqual(imports.map((i) => [i.qty, i.value]), [[5000, 500000]]);
  const s = eoStatus(aa(), exports, imports, '2027-05-01');
  assert.deepEqual([s.qtyDone, s.valueDone, s.fulfilled, s.atRisk, s.bell], [4000, 1920000, 0.4, 180000, '90']);
  assert.equal(s.importAllowed, 4800);
  assert.equal(eoStatus(aa(), exports, imports, '2027-07-01').bell, '30');
  assert.equal(eoStatus(aa({ eo_extended_to: '2028-01-14' }), exports, imports, '2027-07-01').bell, '');
  assert.equal(eoStatus(aa({ status: 'redeemed' }), exports, imports, '2027-07-01').atRisk, 0);
  assert.equal(anf4fSheet(aa(), exports, imports).length, 4);
  assert.deepEqual(ex.mf, { kind: 'export_aa', export_aa: { authorisation_id: 'aa1', aa_no: '0310001234' } });
  assert.deepEqual(withExportAa(ex.mf as never, null), undefined, 'untag');
  const r = incentivesDb.save({ invoice_id: 'e1', kind: 'rodtep', date: '2026-03-05', claimed: 5000, appendix: '4RE' });
  assert.equal(r.appendix, '4RE');
  assert.equal(incentivesDb.save({ invoice_id: 'e1', kind: 'drawback', date: '2026-03-05', claimed: 5000 }).appendix, undefined);
});

test('EPCG: EO = multiple × duty saved, block-wise progress', () => {
  const e = aa({ kind: 'epcg', number: 'EP1', items_export: [], duty_saved: 100000, ...defaultDates('epcg', '2026-01-15') });
  const exports = [{ doc_id: 'x', number: 'X', date: '2029-06-01', item_id: 'caps', item: 'Caps', qty: 1, value: 350000 }];
  const s = eoStatus(e, exports, [], '2030-02-01');
  assert.deepEqual([s.valueRequired, s.fulfilled, s.atRisk], [600000, 0.5833, 41670]);
  assert.deepEqual(s.blocks.map((b) => [b.year, b.required, b.met]), [[4, 300000, true], [6, 600000, false]]);
  assert.equal(eoStatus({ ...e, eo_multiple: 8 }, exports, [], '2030-02-01').valueRequired, 800000);
});

test('BOE duty foregone is a memo; the register store validates, refuses duplicates and tagged deletes', () => {
  assert.deepEqual(dutyForegone({ totals: { av: 100, bcd: 10, sws: 1, other: 0, igst: 20.02, cess: 0, duty: 11, total: 31.02 } }), { bcd: 10, sws: 1, other: 0, igst: 20.02, cess: 0, total: 31.02 });
  const row = authorisationsDb.save({ ...aa(), id: undefined } as never);
  assert.throws(() => authorisationsDb.save({ ...aa(), id: undefined } as never), /already/);
  assert.throws(() => authorisationsDb.save({ ...aa(), id: undefined, number: 'Z', eo_due: '2025-01-01' } as never), /before/);
  assert.throws(() => authorisationsDb.remove(row.id, 1), /tagged/);
  authorisationsDb.remove(row.id, 0);
  assert.equal(getTable('export_authorisations').length, 0);
  assert.equal(getTable('vouchers').length, 0, 'nothing posted');
});
