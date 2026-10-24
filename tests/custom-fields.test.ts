/**
 * Roadmap 6.23: custom fields on documents, items and parties.
 * Definitions storage + validation, value cleaning (local-day dates), the invoice snapshot rule
 * (labels as saved; renaming / deleting a field never changes history), catalogue → line and
 * client → document flows, printing hooks, the sales register and backup round-trip.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import {
  CUSTOM_FIELDS_TABLE,
  cleanValue,
  cleanValueMap,
  customFieldsDb,
  finalizeValues,
  formatCustomValue,
  mergePartyValues,
  printableValues,
  readValues,
  registerCells,
  registerColumns,
  setSnapshotValue,
  snapshotFromMap,
} from '../src/lib/custom-fields.ts';
import { DB_PREFIX, resetStorageBackend } from '../src/lib/storage.ts';
import { buildBackup, parseBackup, restoreBackup } from '../src/lib/backup.ts';
import { localDb } from '../src/lib/localDb.ts';
import { salesRegister } from '../src/lib/accounting-export.ts';
import { useInvoiceStore, RECORD_KEYS } from '../src/store/useInvoiceStore.ts';
import { clientToParty, normalizeRecord } from '../src/store/invoice-defaults.ts';
import { createViaStore, installSettings, clientMH, clientKA, reload } from './helpers/world.ts';
import { formatDate } from '../src/lib/utils.ts';

beforeEach(() => {
  resetStorageBackend();
  resetStorage();
  installSettings();
});

const st = () => useInvoiceStore.getState();

/* ── Values ──────────────────────────────────────────────────────── */

test('cleanValue normalises per type; dates must be real local days', () => {
  assert.equal(cleanValue('text', '  Truck 7  '), 'Truck 7');
  assert.equal(cleanValue('text', 'x'.repeat(500)).length, 200);
  assert.equal(cleanValue('number', '₹ 1,250.50'), '1250.50');
  assert.equal(cleanValue('number', '12abc'), '');
  assert.equal(cleanValue('number', '-3'), '-3');
  assert.equal(cleanValue('date', '2027-01-31'), '2027-01-31');
  assert.equal(cleanValue('date', '2026-02-30'), '', 'not a calendar day');
  assert.equal(cleanValue('date', '31/01/2027'), '');
  assert.equal(cleanValue('date', ''), '');
});

test('date values print through the template formatter as the same local day', () => {
  assert.equal(formatCustomValue({ type: 'date', value: '2026-04-01' }, formatDate), formatDate('2026-04-01'));
  assert.match(formatCustomValue({ type: 'date', value: '2026-04-01' }, formatDate), /1 Apr 2026/);
  assert.equal(formatCustomValue({ type: 'text', value: 'A1' }, formatDate), 'A1');
});

/* ── Definitions ─────────────────────────────────────────────────── */

test('definitions are stored in their own mrchartist_inv_ table and validated', () => {
  const f = customFieldsDb.save({ label: ' Vehicle no. ', type: 'text', applies_to: 'document', print: true });
  assert.equal(f.label, 'Vehicle no.');
  assert.ok(localStorage.getItem(DB_PREFIX + CUSTOM_FIELDS_TABLE));
  assert.throws(() => customFieldsDb.save({ label: 'vehicle NO.', type: 'text', applies_to: 'document', print: false }), /already/);
  // Same label for another scope is fine.
  customFieldsDb.save({ label: 'Vehicle no.', type: 'text', applies_to: 'party', print: false });
  assert.throws(() => customFieldsDb.save({ label: '  ', type: 'text', applies_to: 'item', print: false }), /label/);
  const b = customFieldsDb.save({ label: 'Batch', type: 'text', applies_to: 'item', print: true });
  customFieldsDb.move(b.id, -1);
  assert.equal(customFieldsDb.all()[1].id, b.id);
  customFieldsDb.remove(f.id);
  assert.equal(customFieldsDb.all().length, 2);
});

test('master values: cleaned on save, unknown fields kept, empty map → undefined', () => {
  const qty = customFieldsDb.save({ label: 'Pack size', type: 'number', applies_to: 'item', print: false });
  assert.deepEqual(cleanValueMap({ [qty.id]: '1,000', old: 'kept' }, customFieldsDb.all()), { [qty.id]: '1000', old: 'kept' });
  assert.equal(cleanValueMap({ [qty.id]: 'abc' }, customFieldsDb.all()), undefined);
});

/* ── Snapshot rule ───────────────────────────────────────────────── */

function saveWithVehicle(value: string) {
  const def = customFieldsDb.all().find((d) => d.applies_to === 'document')!;
  st().newDraft();
  st().setSender(localDb.settings.activeProfile()!);
  st().setClient(clientMH);
  st().updateItem(st().items[0].id, 'name', 'Freight');
  st().updateItem(st().items[0].id, 'rate', 1000);
  st().patch({ custom_values: setSnapshotValue(st().custom_values, def, value) });
  const r = st().saveInvoice();
  assert.ok(r.ok, r.errors.join('; '));
  return r.record!;
}

test('a saved invoice keeps the label it was saved with; renaming or deleting the field never changes it', () => {
  assert.ok((RECORD_KEYS as readonly string[]).includes('custom_values'));
  const def = customFieldsDb.save({ label: 'Vehicle no.', type: 'text', applies_to: 'document', print: true });
  const saved = saveWithVehicle('MH12AB1234');
  assert.deepEqual(reload(saved.id).custom_values, [{ id: def.id, label: 'Vehicle no.', type: 'text', value: 'MH12AB1234', print: true }]);

  customFieldsDb.save({ ...def, label: 'Truck no.', print: false });
  // Reopen and re-save the old invoice: still the old label and print flag.
  assert.ok(st().loadInvoice(saved.id));
  st().setNotes('edited later');
  assert.ok(st().saveInvoice().ok);
  const again = reload(saved.id);
  assert.equal(again.custom_values?.[0].label, 'Vehicle no.');
  assert.equal(again.custom_values?.[0].print, true);
  assert.deepEqual(printableValues(again.custom_values).map((v) => v.label), ['Vehicle no.']);

  // A new invoice takes today's definition.
  const fresh = saveWithVehicle('KA01X9');
  assert.equal(reload(fresh.id).custom_values?.[0].label, 'Truck no.');
  assert.equal(printableValues(reload(fresh.id).custom_values).length, 0, 'now internal');

  // Deleting the field: history still prints.
  customFieldsDb.remove(def.id);
  assert.deepEqual(printableValues(reload(saved.id).custom_values).map((v) => v.value), ['MH12AB1234']);
});

test('before its first save a document follows the current definition', () => {
  const def = customFieldsDb.save({ label: 'Site', type: 'text', applies_to: 'document', print: false });
  const typed = setSnapshotValue(undefined, def, 'Pune');
  customFieldsDb.save({ ...def, label: 'Project site', print: true });
  assert.deepEqual(finalizeValues(typed, customFieldsDb.all(), true), [{ id: def.id, label: 'Project site', type: 'text', value: 'Pune', print: true }]);
  assert.deepEqual(finalizeValues(typed, customFieldsDb.all(), false), [{ id: def.id, label: 'Site', type: 'text', value: 'Pune', print: false }]);
  assert.equal(finalizeValues(setSnapshotValue(typed, def, '   '), [], true), undefined, 'cleared value drops the entry');
});

test('half-typed values are kept while editing and cleaned on save', () => {
  const def = customFieldsDb.save({ label: 'Weight (kg)', type: 'number', applies_to: 'document', print: true });
  let list = setSnapshotValue(undefined, def, '12.');
  assert.equal(list[0].value, '12.');
  list = setSnapshotValue(list, def, '1,200.5');
  assert.deepEqual(finalizeValues(list, customFieldsDb.all(), true)?.[0].value, '1200.5');
});

test('normalizeRecord keeps the snapshot and leaves legacy rows without it', () => {
  const v = [{ id: 'f', label: 'PO date', type: 'date' as const, value: '2026-05-01', print: true }];
  assert.deepEqual(normalizeRecord({ id: 'a', custom_values: v }).custom_values, v);
  assert.equal(normalizeRecord({ id: 'b' }).custom_values, undefined);
  assert.deepEqual(readValues([{ id: 'x', value: '' }, { label: 'no id', value: '1' }, 'junk']), []);
});

/* ── Flows from master data ─────────────────────────────────────── */

test('item custom fields flow from the catalogue onto the line with their label', () => {
  const batch = customFieldsDb.save({ label: 'Batch', type: 'text', applies_to: 'item', print: true });
  const expiry = customFieldsDb.save({ label: 'Expiry', type: 'date', applies_to: 'item', print: true });
  customFieldsDb.save({ label: 'Shelf', type: 'text', applies_to: 'item', print: false });
  const inv = createViaStore({ date: '2026-05-10', lines: [{ qty: 1, rate: 100 }] });
  st().loadInvoice(inv.id);
  const lineId = st().items[0].id;
  st().applyCatalogItem(lineId, { name: 'Syrup 100ml', rate: 80, custom_fields: { [batch.id]: 'B-42', [expiry.id]: '2027-01-31' } });
  const line = st().items[0];
  assert.deepEqual(line.custom_values?.map((v) => [v.label, v.value]), [['Batch', 'B-42'], ['Expiry', '2027-01-31']]);
  assert.ok(st().saveInvoice().ok);
  assert.equal(reload(inv.id).items[0].custom_values?.length, 2);
  // Picking a plain item replaces the values.
  st().applyCatalogItem(lineId, { name: 'Plain', rate: 10 });
  assert.equal(st().items[0].custom_values, undefined);
  assert.deepEqual(snapshotFromMap({ [batch.id]: '' }, customFieldsDb.all(), 'item'), []);
});

test('party fields come from the picked client, are replaced by another pick, and never stick to the client copy', () => {
  const code = customFieldsDb.save({ label: 'Customer code', type: 'text', applies_to: 'party', print: true });
  st().newDraft();
  st().setClient(clientToParty({ ...clientMH, custom_fields: { [code.id]: 'C-001' } }));
  assert.deepEqual(st().custom_values, [{ id: code.id, label: 'Customer code', type: 'text', value: 'C-001', print: true, scope: 'party' }]);
  assert.equal('custom_fields' in st().client, false);
  st().setClient({ name: 'typed' }); // typing does not touch them
  assert.equal(st().custom_values?.length, 1);
  st().setClient(clientToParty(clientKA)); // another client without a code
  assert.equal(st().custom_values, undefined);
  // Merge keeps what the document already has.
  const merged = mergePartyValues([{ id: code.id, label: 'Customer code', type: 'text', value: 'edited', print: true, scope: 'party' }], { [code.id]: 'C-001' }, customFieldsDb.all());
  assert.equal(merged[0].value, 'edited');
});

test('saving an invoice never wipes the client master’s custom values', () => {
  const code = customFieldsDb.save({ label: 'Customer code', type: 'text', applies_to: 'party', print: false });
  localDb.clients.upsert({ ...clientMH, custom_fields: { [code.id]: 'C-9' } });
  createViaStore({ date: '2026-05-10', client: { ...clientMH }, lines: [{ qty: 1, rate: 100 }] });
  const c = localDb.clients.getAll().find((x) => x.name === clientMH.name)!;
  assert.deepEqual(c.custom_fields, { [code.id]: 'C-9' });
});

/* ── Printing ───────────────────────────────────────────────────── */

test('printable values: only flagged ones with a label, document fields before party fields', () => {
  const list = [
    { id: 'p', label: 'Customer code', type: 'text' as const, value: 'C1', print: true, scope: 'party' as const },
    { id: 'd', label: 'Vehicle', type: 'text' as const, value: 'MH12', print: true },
    { id: 'i', label: 'Internal', type: 'text' as const, value: 'x', print: false },
  ];
  assert.deepEqual(printableValues(list).map((v) => v.id), ['d', 'p']);
  assert.deepEqual(printableValues(undefined), []);
});

test('templates print the block through the engine with the accent variable, never a hard-coded colour', () => {
  const src = (p: string) => readFileSync(new URL(`../src/components/templates/${p}`, import.meta.url), 'utf8');
  assert.match(src('TemplateEngine.tsx'), /<CustomFieldsBlock invoice=\{invoice\} \/>/);
  assert.match(src('parts/GstBody.tsx'), /printableValues\(invoice\.custom_values\)/);
  assert.match(src('parts/ReceiptBody.tsx'), /<CustomFieldsBlock invoice=\{invoice\} compact \/>/);
  for (const p of ['parts/PaperItemsTable.tsx', 'parts/GstBody.tsx', 'parts/ReceiptBody.tsx']) assert.match(src(p), /<ItemCustomLine values=/);
  const block = src('parts/CustomFieldsBlock.tsx');
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i);
  const css = src('invoice-paper.module.css');
  const extra = css.slice(css.indexOf('.extra {'), css.indexOf('.extraCompact'));
  assert.match(extra, /var\(--tpl-accent\)/);
  assert.doesNotMatch(extra, /#[0-9a-f]{3,6}\b/i);
});

/* ── Exports and backups ─────────────────────────────────────────── */

test('the sales register gains one column per custom field label used', () => {
  const docs = [
    { custom_values: [{ id: 'a', label: 'Vehicle', type: 'text' as const, value: 'MH12', print: true }] },
    { custom_values: [{ id: 'b', label: 'Project', type: 'text' as const, value: 'Alpha', print: false }] },
    {},
  ];
  assert.deepEqual(registerColumns(docs), ['Vehicle', 'Project']);
  assert.deepEqual(registerCells(docs[1], ['Vehicle', 'Project']), ['', 'Alpha']);
  const def = customFieldsDb.save({ label: 'Vehicle no.', type: 'text', applies_to: 'document', print: true });
  saveWithVehicle('MH12AB1234');
  void def;
  const reg = salesRegister(localDb.invoices.getAll());
  assert.equal(reg.headers.at(-1), 'Vehicle no.');
  assert.equal(reg.rows[0].at(-1), 'MH12AB1234');
  // No custom fields used → the register keeps its usual columns.
  assert.equal(salesRegister([]).headers.at(-1), 'Due Date');
});

test('definitions and values survive a backup round-trip; a damaged definition table is refused', () => {
  const def = customFieldsDb.save({ label: 'Vehicle no.', type: 'text', applies_to: 'document', print: true });
  const saved = saveWithVehicle('MH12AB1234');
  const file = buildBackup();
  const { data } = parseBackup(JSON.stringify(file));
  resetStorage();
  restoreBackup(data);
  assert.deepEqual(customFieldsDb.all().map((d) => d.id), [def.id]);
  assert.equal(reload(saved.id).custom_values?.[0].value, 'MH12AB1234');
  const bad = { ...file, data: { ...file.data, [DB_PREFIX + CUSTOM_FIELDS_TABLE]: JSON.stringify([{ label: 'no id' }]) } };
  assert.throws(() => parseBackup(JSON.stringify(bad)), /custom_fields/);
});
