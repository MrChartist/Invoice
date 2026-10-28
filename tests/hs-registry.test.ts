/**
 * Round 18 shared registrations (R18-A): the runtime registry adds the society rows to the first-paint maps, which carry
 * none themselves; the table and the settings object are backed up and in the open export; every writer, the sync
 * engine and the recycle bin import the registry. B appends `society_runs` (dated) and its block here.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { HS_TABLE_ACTIONS, HS_WATCHED } from '../src/lib/society/hs-registry.ts';
import { HS_DATED, HS_OBJECTS, HS_PACKS, HS_TABLES } from '../src/lib/society/hs-shared.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';
import { PACK_IDS } from '../src/lib/industry-packs.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('R18-A block: society_settings (settings.manage) and society_units (master.edit, audited, backed up, in the open export) at runtime only', () => {
  assert.deepEqual(HS_TABLE_ACTIONS, { society_settings: 'settings.manage', society_units: 'master.edit', society_runs: 'doc.create' });
  assert.equal(TABLE_ACTIONS.society_settings, 'settings.manage');
  assert.equal(TABLE_ACTIONS.society_units, 'master.edit');
  assert.equal(WATCHED_TABLES.society_units?.label, 'Society unit');
  assert.deepEqual(Object.keys(HS_WATCHED).sort(), (Object.values(HS_TABLES) as string[]).sort());
  assert.equal(HS_OBJECTS.settings, 'society_settings');
  for (const t of [...Object.values(HS_TABLES), HS_OBJECTS.settings] as string[]) assert.ok(TABLE_MEANING[t], `${t} in the open export`);
  for (const t of Object.values(HS_TABLES) as string[]) assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
  for (const f of ['lib/access.ts', 'lib/audit-edits.ts']) assert.ok(!/society_(units|settings)/.test(src(f)), `${f}: only at runtime`);
  for (const p of HS_PACKS) assert.ok(PACK_IDS.includes(p), p);
});

test('R18-B block: society_runs (doc.create, audited "Society run", backed up, synced by the bill date, in the open export, demo-cleared)', () => {
  assert.equal(HS_TABLES.runs, 'society_runs');
  assert.equal(TABLE_ACTIONS.society_runs, 'doc.create');
  assert.equal(WATCHED_TABLES.society_runs?.label, 'Society run');
  assert.deepEqual(HS_DATED, { society_runs: 'date' });
  assert.ok(TABLE_MEANING.society_runs && BACKUP_RECORD_TABLES.includes('society_runs'));
  assert.ok(src('lib/demo-data.ts').includes("'society_runs'"));
  assert.match(src('lib/society/hs-issue-io.ts'), /import '\.\/hs-registry';/);
});

test('every writer, the sync engine and the recycle bin import the registry; dated rows in the sync engine', () => {
  for (const f of ['lib/society/hs-settings.ts', 'lib/society/hs-units-save.ts']) assert.match(src(f), /import '\.\/hs-registry';/, f);
  assert.match(src('lib/sync-engine.ts'), /import '\.\/society\/hs-registry';/);
  assert.match(src('lib/trust/recycle-bin.ts'), /import '\.\.\/society\/hs-registry';/);
  const sync = src('lib/sync-engine.ts');
  for (const [t, d] of Object.entries(HS_DATED)) assert.ok(sync.includes(`[\`\${DB_PREFIX}${t}\`]: '${d}'`), `${t} dated`);
  // Any module outside the registry that writes a Round 18 table by name imports the registry.
  for (const f of ['lib/society/hs-units-save.ts', 'lib/society/hs-settings.ts']) assert.ok(/setTable|setJson/.test(src(f)));
});
