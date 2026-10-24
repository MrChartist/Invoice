/**
 * Phase 4.1: logo / signature images stored once, by reference.
 *
 * Templates, preview, PDF, client copy and e-invoice print all render from the
 * `sender` object of the record they are given, so "renders exactly as before"
 * is proven here as: the record a reader gets back is deep-equal to the record
 * that was saved (same data URLs, same everything else), while the stored JSON
 * holds `asset:` references and the image itself is stored once.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, loadStorage, resetStorage } from './helpers/shim.ts';
import {
  ASSET_REF,
  decodeRows,
  emptyAssets,
  encodeRows,
  hashContent,
  internImage,
  parseAssets,
  referencedAssets,
  serializeAssets,
} from '../src/lib/assets.ts';
import { DB_PREFIX, getTable, setTable } from '../src/lib/storage.ts';
import { MIGRATIONS, SCHEMA_VERSION_KEY, getSchemaVersion, runMigrations, type Migration } from '../src/lib/migrations.ts';
import { buildBackup, parseBackup, restoreBackup, wipeAppData } from '../src/lib/backup.ts';
import { measureStorage } from '../src/lib/storage-health.ts';
import { localDb } from '../src/lib/localDb.ts';
import { createViaStore, installSettings, SELLER, clientMH, reload } from './helpers/world.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => resetStorage());

const LOGO = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(4000);
const SIGN = 'data:image/png;base64,' + 'R0lGODlh'.repeat(3000);
const LOGO2 = 'data:image/jpeg;base64,' + '/9j/4AAQ'.repeat(2500);

const raw = (table: string) => JSON.parse(localStorage.getItem(DB_PREFIX + table) ?? '[]');
const assetRows = () => raw('assets') as { id: string; data: string }[];

function inv(id: string, logo = LOGO, signature = SIGN): Record<string, unknown> {
  return { id, invoice_number: `INV/FY25-26/${id}`, sender: { id: 'p1', companyName: 'Co', logo, signature }, total: 100 };
}

test('content hash is stable, length-prefixed and sensitive to every character', () => {
  assert.equal(hashContent(LOGO), hashContent(String(LOGO)));
  assert.notEqual(hashContent(LOGO), hashContent(LOGO.slice(0, -1) + 'x'));
  assert.match(hashContent('abc'), /^3-[0-9a-f]{16}$/);
});

test('saved snapshots resolve to the identical record (render input unchanged) and images are stored once', () => {
  const rows = [inv('1'), inv('2'), inv('3', LOGO2, '')];
  setTable('invoices', rows);
  const stored = raw('invoices');
  assert.ok(stored.every((r: { sender: { logo: string } }) => r.sender.logo.startsWith(ASSET_REF)), 'stored snapshot holds references');
  assert.equal(stored[2].sender.signature, '', 'an empty image stays empty');
  assert.equal(assetRows().length, 3, 'three distinct images, stored once each');
  assert.deepEqual(getTable('invoices'), rows, 'readers get back exactly what was saved');
  assert.ok(localStorage.getItem(DB_PREFIX + 'invoices')!.length < 1000, 'the table no longer carries the images');
  // Saving the resolved rows again is stable: same references, no new assets.
  const before = dumpStorage();
  setTable('invoices', getTable('invoices'));
  assert.deepEqual(dumpStorage(), before);
});

test('setTable never mutates the caller\'s rows', () => {
  const rows = [inv('1')];
  const copy = structuredClone(rows);
  setTable('invoices', rows);
  assert.deepEqual(rows, copy);
});

test('recurring templates carry their sender inside `template` and are handled the same way', () => {
  const sched = [{ id: 'r1', template: { sender: { id: 'p1', logo: LOGO, signature: SIGN }, items: [] } }];
  setTable('recurring', sched);
  assert.ok(raw('recurring')[0].template.sender.logo.startsWith(ASSET_REF));
  assert.deepEqual(getTable('recurring'), sched);
});

test('an invoice saved through the store renders from the same snapshot as before', () => {
  installSettings();
  const sender = { ...SELLER, logo: LOGO, signature: SIGN };
  const rec = createViaStore({ date: '2025-06-10', client: clientMH, lines: [{ qty: 1, rate: 1000 }], patch: { sender } });
  assert.ok(rec.sender?.logo === LOGO, 'the saved record carries the inline image');
  const back = reload(rec.id) as InvoiceRecord;
  // (JSON drops undefined fields, as it always has.)
  assert.deepEqual(back, JSON.parse(JSON.stringify(rec)), 'the record readers render from is unchanged');
  assert.ok(back.sender?.logo === LOGO && back.sender?.signature === SIGN);
  assert.ok(raw('invoices')[0].sender.logo.startsWith(ASSET_REF));
  // A second invoice reuses the stored image.
  createViaStore({ date: '2025-06-11', client: clientMH, lines: [{ qty: 1, rate: 500 }], patch: { sender } });
  assert.equal(assetRows().length, 2);
  assert.equal(localDb.invoices.getAll().filter((i) => i.sender?.logo === LOGO).length, 2);
});

test('a hash collision gets a suffixed id and never resolves to the wrong image', () => {
  const idx = emptyAssets();
  const id = hashContent(LOGO);
  idx.byId.set(id, 'data:image/png;base64,OTHER'); // pretend another image owns this id
  const ref = internImage(idx, LOGO);
  assert.equal(ref, `${ASSET_REF}${id}~1`);
  assert.deepEqual(decodeRows(encodeRows([inv('1')], idx).rows, idx), [inv('1')]);
});

test('a missing asset resolves to no image instead of a broken reference', () => {
  localStorage.setItem(DB_PREFIX + 'invoices', JSON.stringify([inv('1', `${ASSET_REF}nope`, '')]));
  assert.equal((getTable('invoices')[0] as { sender: { logo: string } }).sender.logo, '');
});

test('tolerant asset table parsing', () => {
  assert.equal(parseAssets('not json').byId.size, 0);
  assert.equal(parseAssets('{"a":1}').byId.size, 0);
  assert.equal(parseAssets('[{"id":"a","data":"x"},null,{"id":3}]').byId.size, 1);
  const idx = parseAssets(serializeAssets(parseAssets('[{"id":"a","data":"x"}]')));
  assert.equal(idx.byData.get('x'), 'a');
});

/* ── Migration v3 ─────────────────────────────────────────────── */

function seedLegacy(): void {
  localStorage.setItem(SCHEMA_VERSION_KEY, '1');
  localStorage.setItem(DB_PREFIX + 'invoices', JSON.stringify([inv('1'), inv('2'), inv('3', LOGO2, SIGN), { id: '4', sender: null }]));
  localStorage.setItem(DB_PREFIX + 'recurring', JSON.stringify([{ id: 'r1', template: { sender: { logo: LOGO } } }]));
  localStorage.setItem(DB_PREFIX + 'settings', JSON.stringify({ profiles: [{ id: 'p1', logo: LOGO }], activeProfileId: 'p1' }));
}

test('v3 moves inline images into the asset table, deduplicated, and reads are unchanged', () => {
  seedLegacy();
  const before = { invoices: getTable('invoices'), recurring: getTable('recurring') };
  const r = runMigrations(MIGRATIONS);
  assert.equal(r.status, 'migrated');
  assert.equal(getSchemaVersion(), 3);
  assert.equal(assetRows().length, 3, 'LOGO, SIGN, LOGO2 once each');
  assert.ok(raw('invoices').slice(0, 3).every((i: { sender: { logo: string } }) => i.sender.logo.startsWith(ASSET_REF)));
  assert.deepEqual(getTable('invoices'), before.invoices);
  assert.deepEqual(getTable('recurring'), before.recurring);
  assert.equal(JSON.parse(localStorage.getItem(DB_PREFIX + 'settings')!).profiles[0].logo, LOGO, 'profiles keep their own image');
  const m = measureStorage();
  assert.equal(m.embeddedImageChars, 0);
  assert.equal(m.invoicesWithImages, 0);
  assert.equal(m.invoicesSharingImages, 3);
  assert.ok((m.sharedImageChars ?? 0) > LOGO.length);
});

test('v3 is idempotent: running it again changes nothing', () => {
  seedLegacy();
  runMigrations(MIGRATIONS);
  const after = dumpStorage();
  MIGRATIONS.find((m) => m.version === 3)!.up();
  assert.deepEqual(dumpStorage(), after);
});

test('v3 leaves an unresolvable reference and unreadable tables exactly as they were', () => {
  localStorage.setItem(SCHEMA_VERSION_KEY, '1');
  localStorage.setItem(DB_PREFIX + 'invoices', JSON.stringify([inv('1', `${ASSET_REF}gone`, SIGN)]));
  localStorage.setItem(DB_PREFIX + 'recurring', '{broken');
  runMigrations(MIGRATIONS);
  assert.equal(raw('invoices')[0].sender.logo, `${ASSET_REF}gone`);
  assert.ok(raw('invoices')[0].sender.signature.startsWith(ASSET_REF));
  assert.equal(localStorage.getItem(DB_PREFIX + 'recurring'), '{broken');
});

test('v3 rolls back to the inline images if a later migration in the same run fails', () => {
  seedLegacy();
  const before = dumpStorage();
  const boom: Migration = { version: 4, name: 'boom', up: () => { throw new Error('nope'); } };
  const r = runMigrations([...MIGRATIONS, boom]);
  assert.equal(r.status, 'failed');
  assert.equal(getSchemaVersion(), 3, 'v3 itself committed');
  // Reads are the same whichever shape is on disk.
  loadStorage({});
  assert.deepEqual(getTable('invoices'), JSON.parse(before[DB_PREFIX + 'invoices']));
});

test('a failing v3 puts every key back as it was', () => {
  seedLegacy();
  localStorage.setItem(SCHEMA_VERSION_KEY, '2'); // only v3 runs
  const before = dumpStorage();
  const v3 = MIGRATIONS.find((m) => m.version === 3)!;
  const r = runMigrations([MIGRATIONS[0], MIGRATIONS[1], { ...v3, up: () => { v3.up(); throw new Error('disk on fire'); } }]);
  assert.equal(r.status, 'failed');
  assert.deepEqual(dumpStorage(), before);
});

/* ── Backups ──────────────────────────────────────────────────── */

test('backup round trip: the file is self-contained and restores to identical reads', () => {
  setTable('invoices', [inv('1'), inv('2', LOGO2, SIGN)]);
  const reads = getTable('invoices');
  const file = buildBackup();
  assert.ok(file.data[DB_PREFIX + 'assets'], 'the asset table rides along');
  const text = JSON.stringify(file);
  wipeAppData();
  assert.deepEqual(getTable('invoices'), []);
  restoreBackup(parseBackup(text).data);
  assert.deepEqual(getTable('invoices'), reads);
});

test('an old backup with inline images restores, then the v3 migration moves them to references', () => {
  const old = {
    app: 'mrchartist-invoice',
    version: 1,
    exportedAt: '2025-01-01T00:00:00.000Z',
    data: {
      [SCHEMA_VERSION_KEY]: '1',
      [DB_PREFIX + 'invoices']: JSON.stringify([inv('1'), inv('2')]),
      [DB_PREFIX + 'settings']: JSON.stringify({ profiles: [], activeProfileId: '' }),
    },
  };
  restoreBackup(parseBackup(JSON.stringify(old)).data);
  assert.deepEqual(getTable('invoices'), [inv('1'), inv('2')], 'renders before the migration runs');
  runMigrations(); // what the reload after a restore does
  assert.ok(raw('invoices')[0].sender.logo.startsWith(ASSET_REF));
  assert.equal(assetRows().length, 2);
  assert.deepEqual(getTable('invoices'), [inv('1'), inv('2')], 'and the same after it');
});

test('a backup whose references do not resolve inside the file is refused', () => {
  setTable('invoices', [inv('1')]);
  const file = buildBackup();
  delete file.data[DB_PREFIX + 'assets'];
  assert.throws(() => parseBackup(JSON.stringify(file)), /missing 2 logo\/signature images/);
  const ids = referencedAssets(raw('invoices'));
  assert.equal(ids.size, 2);
});
