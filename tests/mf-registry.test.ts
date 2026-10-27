/**
 * Round 13 shared registrations (MF-A): the runtime registry adds the manufacturing rows to the first-paint maps
 * (`TABLE_ACTIONS`, `WATCHED_TABLES`), which carry none themselves; every table and the settings object is in the open
 * export, the backup and (dated / numbered) the sync engine; every writer, the sync engine and the recycle bin import the
 * registry; JCD is written once and the reserved prefixes FAI / PES / CUT / KPB are unused.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { MF_TABLE_ACTIONS, MF_WATCHED } from '../src/lib/mfg/mf-registry.ts';
import { MF_OBJECTS, MF_RESERVED_SERIES, MF_SERIES, MF_TABLES } from '../src/lib/mfg/mf-shared.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';
import { DEMO_EXTRA_TABLES } from '../src/lib/demo-data.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('MF-A block: rights, audit labels, registered at runtime; first-paint maps carry none', () => {
  const A = { mfg_settings: 'settings.manage', work_centres: 'master.edit', routings: 'master.edit', job_cards: 'doc.create' };
  assert.deepEqual(Object.fromEntries(Object.entries(MF_TABLE_ACTIONS).filter(([t]) => t in A)), A); // B–D add their own blocks
  for (const [t, a] of Object.entries(A)) {
    assert.equal(TABLE_ACTIONS[t], a, `${t} registered`);
    assert.ok(TABLE_MEANING[t], `${t} in the open export`);
  }
  for (const t of Object.values(MF_TABLES)) {
    assert.ok(WATCHED_TABLES[t]?.label, `${t} audited`);
    assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
    assert.ok((DEMO_EXTRA_TABLES as readonly string[]).includes(t), `${t} sample rows removable`);
    assert.ok(!src('lib/access.ts').includes(`${t}:`) && !src('lib/audit-edits.ts').includes(`${t}:`), `${t} only at runtime`);
  }
  assert.deepEqual(Object.keys(MF_WATCHED).sort(), Object.values(MF_TABLES).sort());
  assert.equal(MF_OBJECTS.mfgSettings, 'mfg_settings');
});

test('every writer, the sync engine and the recycle bin import the registry; dated / numbered rows in the sync engine', () => {
  for (const f of ['mf-settings', 'mf-centres', 'mf-routings', 'mf-jobcards', 'mf-costcards', 'mf-authorisations', 'mf-incentives']) assert.match(src(`lib/mfg/${f}.ts`), /import '\.\/mf-registry';/, f);
  assert.match(src('lib/sync-engine.ts'), /import '\.\/mfg\/mf-registry';/);
  assert.match(src('lib/trust/recycle-bin.ts'), /import '\.\.\/mfg\/mf-registry';/);
  const sync = src('lib/sync-engine.ts');
  assert.ok(sync.includes("[`${DB_PREFIX}job_cards`]: 'date'"));
  assert.ok(sync.includes("[`${DB_PREFIX}job_cards`]: { num: 'number', date: 'date' }"));
  assert.match(src('lib/trust/recycle-bin.ts'), /registerRestoreHook\('job_cards'/);
  assert.match(src('lib/trust/recycle-bin.ts'), /registerRestoreHook\('routings'/);
});

test('series: JCD written once (mf-shared); the reserved B–D prefixes unused elsewhere', () => {
  assert.equal(MF_SERIES.jobCards, 'JCD');
  for (const p of MF_RESERVED_SERIES) assert.ok(['FAI', 'PES', 'CUT', 'KPB'].includes(p), p); // each package moves its prefix into MF_SERIES
  for (const p of ['CUT', 'KPB']) assert.ok((Object.values(MF_SERIES) as string[]).includes(p), `${p} moved (MF-C)`);
  const all = readdirSync(new URL('../src/lib/', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.ts') && !String(f).startsWith('help')).map((f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8')).join('\n');
  assert.equal((all.match(/'JCD'/g) ?? []).length, 1, 'JCD');
  for (const p of [...MF_RESERVED_SERIES, 'CUT', 'KPB']) assert.equal((all.match(new RegExp(`'${p}'`, 'g')) ?? []).length, 1, `${p} only in the reserved list`);
});
