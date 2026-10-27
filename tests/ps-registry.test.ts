/**
 * Round 14 shared registrations (PS-A): the runtime registry adds the professional rows to the first-paint maps
 * (`TABLE_ACTIONS`, `WATCHED_TABLES`), which carry none themselves; every table and the settings object is in the open
 * export, the backup and (dated / numbered) the sync engine; every writer, the sync engine and the recycle bin import the
 * registry; ENG is written once, CMV is reserved for PS-B and unused.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { PS_TABLE_ACTIONS, PS_WATCHED } from '../src/lib/prof/ps-registry.ts';
import { PS_DATED, PS_NUMBERED, PS_OBJECTS, PS_PACKS, PS_RESERVED_SERIES, PS_SERIES, PS_TABLES } from '../src/lib/prof/ps-shared.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';
import { DEMO_EXTRA_TABLES } from '../src/lib/demo-data.ts';
import { PACK_IDS } from '../src/lib/industry-packs.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('PS-A block: rights, audit labels, registered at runtime; first-paint maps carry none', () => {
  const A = { prof_settings: 'settings.manage', engagements: 'doc.create', conflict_checks: 'master.edit' };
  assert.deepEqual(Object.fromEntries(Object.entries(PS_TABLE_ACTIONS).filter(([t]) => t in A)), A); // B–D add their own blocks
  for (const [t, a] of Object.entries(A)) {
    assert.equal(TABLE_ACTIONS[t], a, `${t} registered`);
    assert.ok(TABLE_MEANING[t], `${t} in the open export`);
    assert.ok(!src('lib/access.ts').includes(`${t}:`) && !src('lib/audit-edits.ts').includes(`${t}:`), `${t} only at runtime`);
  }
  for (const t of Object.values(PS_TABLES)) {
    assert.ok(WATCHED_TABLES[t]?.label, `${t} audited`);
    assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
    assert.ok((DEMO_EXTRA_TABLES as readonly string[]).includes(t), `${t} sample rows removable`);
  }
  assert.deepEqual(Object.keys(PS_WATCHED).sort(), Object.values(PS_TABLES).sort());
  assert.equal(PS_OBJECTS.profSettings, 'prof_settings');
  for (const p of PS_PACKS) assert.ok(PACK_IDS.includes(p), p);
});

test('every writer, the sync engine and the recycle bin import the registry; dated / numbered rows in the sync engine', () => {
  for (const f of ['ps-settings', 'ps-engagements', 'ps-conflicts', 'ps-letters', 'ps-prebill']) assert.match(src(`lib/prof/${f}.ts`), /import '\.\/ps-registry';/, f);
  assert.match(src('lib/sync-engine.ts'), /import '\.\/prof\/ps-registry';/);
  assert.match(src('lib/trust/recycle-bin.ts'), /import '\.\.\/prof\/ps-registry';/);
  const sync = src('lib/sync-engine.ts');
  for (const [t, d] of Object.entries(PS_DATED)) assert.ok(sync.includes(`[\`\${DB_PREFIX}${t}\`]: '${d}'`), `${t} dated`);
  for (const t of Object.keys(PS_NUMBERED)) assert.ok(sync.includes(`[\`\${DB_PREFIX}${t}\`]: { num: 'number', date: '${PS_DATED[t]}' }`), `${t} numbered`);
  assert.match(src('lib/trust/recycle-bin.ts'), /registerRestoreHook\('engagements'/);
});

test('series: ENG and CMV written once (ps-shared)', () => {
  assert.equal(PS_SERIES.engagements, 'ENG');
  assert.equal(PS_SERIES.clientMoney, 'CMV'); // PS-B moved it out of the reserved list
  assert.deepEqual([...PS_RESERVED_SERIES], []);
  const all = readdirSync(new URL('../src/lib/', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.ts') && !String(f).startsWith('help')).map((f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8')).join('\n');
  assert.equal((all.match(/'ENG'/g) ?? []).length, 1, 'ENG');
  assert.equal((all.match(/'CMV'/g) ?? []).length, 1, 'CMV');
});

test('PS-B block: client_money rights, audit label, writer imports the registry, dated and numbered', () => {
  assert.equal(PS_TABLE_ACTIONS.client_money, 'books.edit');
  assert.equal(TABLE_ACTIONS.client_money, 'books.edit');
  assert.equal(WATCHED_TABLES.client_money?.label, 'Client-money voucher');
  assert.ok(TABLE_MEANING.client_money);
  assert.match(src('lib/prof/ps-cm-post.ts'), /import '\.\/ps-registry';/);
  assert.deepEqual([PS_DATED.client_money, PS_NUMBERED.client_money], ['date', 'CMV']);
});
