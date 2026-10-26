/**
 * R4-C6 open-format export: invoices flatten into parent + lines CSVs with a stable column order, every backed-up
 * table has a schema entry (guard), device-local / sync / vault / bin / payroll keys are left out, images become
 * files, the CSV formula guard holds, and a 2,000-invoice set stays fast.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';
import { DB_PREFIX, DEVICE_LOCAL_KEYS, SYNC_META_KEYS, getTable, listKeys, setTable } from '../src/lib/storage.ts';
import { AssetSink, buildReadme, buildSchema, csvOf, exportFileName, exportableKeys, flattenObject, flattenTable } from '../src/lib/trust/open-export.ts';
import { PAYROLL_TABLES, TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';

beforeEach(() => resetStorage());

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const inv = (id: string, over: Record<string, unknown> = {}) => ({
  id, invoice_number: `INV/FY26-27/${id}`, issue_date: '2026-05-01', total: 118, paid: false,
  client: { name: 'Acme', gstin: '27AAPFU0939F1ZV', addresses: [{ line: 'x' }] },
  sender: { companyName: 'Me', logo: PNG },
  items: [{ id: `${id}-1`, name: 'Pen', quantity: 1, rate: 100 }, { id: `${id}-2`, name: '=SUM(A1)', quantity: 2, rate: 9 }],
  ...over,
});

test('invoices → invoices.csv (one level flattened) + invoice_items.csv keyed by invoice_id; stable column order', () => {
  const sink = new AssetSink();
  const [head, lines] = flattenTable('invoices', [inv('1'), inv('2', { notes: 'n' })], sink);
  assert.deepEqual(head.columns, ['id', 'invoice_number', 'issue_date', 'total', 'paid', 'client.name', 'client.gstin', 'client.addresses', 'sender.companyName', 'sender.logo', 'notes']);
  assert.deepEqual(head.rows[0], ['1', 'INV/FY26-27/1', '2026-05-01', 118, false, 'Acme', '27AAPFU0939F1ZV', '[{"line":"x"}]', 'Me', 'assets/image-1.png', '']);
  assert.deepEqual([head.types.total, head.types.issue_date, head.types.paid, head.types['client.addresses']], ['number', 'date', 'bool', 'json']);
  assert.equal(lines.name, 'invoice_items');
  assert.deepEqual(lines.columns, ['invoice_id', 'line_no', 'id', 'name', 'quantity', 'rate']);
  assert.deepEqual(lines.rows.map((r) => r.slice(0, 2)), [['1', 1], ['1', 2], ['2', 1], ['2', 2]]);
  assert.equal(sink.files.length, 1, 'the same logo is written once');
  assert.equal(sink.files[0].path, 'assets/image-1.png');
  assert.ok(!csvOf(head).includes('data:image'), 'no data URIs in cells');
  assert.match(csvOf(lines), /'=SUM\(A1\)/, 'formula guard');
});

test('every backed-up table has a schema entry (a new table without one is reported here, not silently dropped)', () => {
  const missing = BACKUP_RECORD_TABLES.filter((t) => !TABLE_MEANING[t]);
  assert.deepEqual(missing, []);
  const schema = buildSchema(flattenTable('invoices', [inv('1')], new AssetSink()), 'Acme', 'now');
  assert.equal(schema.tables.invoices.columns.id.meaning, 'Row id (unique in its table).');
  assert.equal(schema.tables.invoices.columns['client.gstin'].meaning, 'GSTIN.');
  assert.equal(schema.tables.invoices.columns.paid.meaning, 'unknown');
  assert.equal(schema.tables.invoice_items.columns.invoice_id.type, 'string');
});

test('left out: device-local, sync, vault, attachments, drafts and prefs; the bin and payroll only when chosen / allowed', () => {
  const keys = [
    ...DEVICE_LOCAL_KEYS, ...SYNC_META_KEYS, `${DB_PREFIX}att_abc`, `${DB_PREFIX}__vault__`, `${DB_PREFIX}draft`, `${DB_PREFIX}notif_state`, `${DB_PREFIX}assets`,
    `${DB_PREFIX}invoices`, `${DB_PREFIX}settings`, `${DB_PREFIX}recycle_bin`, `${DB_PREFIX}employees`, `${DB_PREFIX}audit_archive_0001`, 'theme',
  ];
  assert.deepEqual(exportableKeys(keys, { includeBin: false, includeAttachments: false, payroll: false }), ['audit_archive_0001', 'invoices', 'settings']);
  assert.deepEqual(exportableKeys(keys, { includeBin: true, includeAttachments: true, payroll: true }), ['audit_archive_0001', 'employees', 'invoices', 'recycle_bin', 'settings']);
  assert.ok(PAYROLL_TABLES.has('payroll_runs'));
});

test('object keys become path / value rows with images as files; README and file name', () => {
  const sink = new AssetSink();
  const t = flattenObject('settings', { activeProfileId: 'p1', profiles: [{ id: 'p1', logo: PNG }], lock: { until: '2026-03-31' } }, sink);
  assert.deepEqual(t.rows, [['activeProfileId', 'p1'], ['profiles', '[{"id":"p1","logo":"assets/image-1.png"}]'], ['lock.until', '2026-03-31']]);
  const readme = buildReadme([t], 'Acme & Co', 'now', { includeBin: false, includeAttachments: false, payroll: false, workbook: true, attachments: 0, images: 1 });
  assert.match(readme, /settings\.csv/);
  assert.match(readme, /only lossless way back/);
  assert.match(readme, /Payroll tables/);
  assert.equal(exportFileName('Acme & Co. Pvt Ltd', '2026-10-26'), 'Acme-Co-Pvt-Ltd-data-export-2026-10-26.zip');
});

test('2,000 invoices flatten quickly (soft budget)', () => {
  setTable('invoices', Array.from({ length: 2000 }, (_, i) => inv(String(i))));
  const t0 = Date.now();
  const names = exportableKeys(listKeys(DB_PREFIX), { includeBin: false, includeAttachments: false, payroll: true });
  const sink = new AssetSink();
  const tables = names.flatMap((n) => flattenTable(n, getTable(n), sink));
  const text = tables.map(csvOf).join('');
  assert.ok(text.length > 100000);
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
});
