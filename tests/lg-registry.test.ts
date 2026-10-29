/**
 * Round 19 shared registrations (R19-A): the runtime registry adds the logistics rows to the first-paint maps, which
 * carry none themselves; the tables and the settings object are backed up and in the open export; dated tables are
 * synced by their date; every writer, the sync engine and the recycle bin import the registry; JOB is written once.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { LG_TABLE_ACTIONS, LG_WATCHED } from '../src/lib/logistics/lg-registry.ts';
import { LG_DATED, LG_OBJECTS, LG_PACKS, LG_SERIES, LG_TABLES } from '../src/lib/logistics/lg-shared.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';
import { PACK_IDS } from '../src/lib/industry-packs.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const A_TABLES = [LG_TABLES.jobs, LG_TABLES.manifests]; // + R19-D manifests

test('R19-A block: logistics_settings (settings.manage), lg_jobs (doc.create) — audited, backed up, in the open export, at runtime only; rate sheets cut', () => {
  assert.deepEqual(LG_TABLE_ACTIONS, { logistics_settings: 'settings.manage', lg_jobs: 'doc.create', lg_manifests: 'doc.create' }); // R19-D: + manifests (storage cut)
  assert.equal(TABLE_ACTIONS.logistics_settings, 'settings.manage');
  assert.equal(TABLE_ACTIONS.lg_jobs, 'doc.create');
  assert.equal(TABLE_ACTIONS.lg_rate_sheets, undefined, 'cut 2: no rate sheets table');
  assert.equal(WATCHED_TABLES.lg_jobs?.label, 'Job file');
  assert.deepEqual(Object.keys(LG_WATCHED).sort(), (Object.values(LG_TABLES) as string[]).sort());
  assert.equal(LG_OBJECTS.settings, 'logistics_settings');
  for (const t of [...A_TABLES, LG_OBJECTS.settings]) assert.ok(TABLE_MEANING[t], `${t} in the open export`);
  for (const t of A_TABLES) assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
  for (const t of A_TABLES) assert.ok(src('lib/demo-data.ts').includes(`'${t}'`), `${t} demo-cleared`);
  for (const f of ['lib/access.ts', 'lib/audit-edits.ts']) assert.ok(!/lg_jobs|logistics_settings/.test(src(f)), `${f}: only at runtime`);
  for (const p of LG_PACKS) assert.ok(PACK_IDS.includes(p), p);
});

test('every writer, the sync engine and the recycle bin import the registry; jobs synced by date; restore hooks', () => {
  const lib = readdirSync(new URL('../src/lib/logistics/', import.meta.url)).filter((f) => f.endsWith('.ts'));
  for (const f of lib) {
    const s = src(`lib/logistics/${f}`);
    if (/\bsetTable\(|setJson\(/.test(s)) assert.match(s, /import '\.\/lg-registry';/, `${f} writes a Round 19 table`);
  }
  for (const f of ['lib/logistics/lg-settings.ts', 'lib/logistics/lg-save.ts']) assert.match(src(f), /import '\.\/lg-registry';/, f);
  assert.match(src('lib/sync-engine.ts'), /import '\.\/logistics\/lg-registry';/);
  assert.match(src('lib/trust/recycle-bin.ts'), /import '\.\.\/logistics\/lg-registry';/);
  const sync = src('lib/sync-engine.ts');
  assert.ok(sync.includes("[`${DB_PREFIX}lg_jobs`]: 'date'"), 'lg_jobs dated');
  assert.ok(sync.includes("[`${DB_PREFIX}lg_manifests`]: 'date'"), 'lg_manifests dated (month end)');
  assert.equal(TABLE_ACTIONS.lg_storage, undefined, 'R19-D cut 1: no storage table');
  assert.equal(LG_DATED.lg_jobs, 'date');
  const bin = src('lib/trust/recycle-bin.ts');
  for (const t of A_TABLES) assert.ok(bin.includes(`registerRestoreHook('${t}'`), `${t} restore hook`);
});

test('series: JOB written once (lg-shared)', () => {
  assert.equal(LG_SERIES.jobs, 'JOB');
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
  const all = files.map((f) => src(f)).join('\n');
  assert.equal((all.match(/'JOB'/g) ?? []).length, 1, 'JOB');
});
