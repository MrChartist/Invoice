/**
 * Round 15 shared registrations (R15-B): the runtime registry adds the travel rows to the first-paint maps
 * (`TABLE_ACTIONS`, `WATCHED_TABLES`), which carry none themselves; every table and the settings object is in the open
 * export, the backup and (dated) the sync engine; every writer, the sync engine and the recycle bin import the registry.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { TV_TABLE_ACTIONS, TV_WATCHED } from '../src/lib/travel/tv-registry.ts';
import { TV_DATED, TV_OBJECTS, TV_PACKS, TV_TABLES } from '../src/lib/travel/tv-shared.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';
import { DEMO_EXTRA_TABLES } from '../src/lib/demo-data.ts';
import { PACK_IDS } from '../src/lib/industry-packs.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('R15-B block: rights, audit labels, registered at runtime; first-paint maps carry none', () => {
  const B = { travel_settings: 'settings.manage', travel_bookings: 'doc.create' };
  assert.deepEqual(Object.fromEntries(Object.entries(TV_TABLE_ACTIONS).filter(([t]) => t in B)), B); // C / D add their blocks
  for (const [t, a] of Object.entries(B)) {
    assert.equal(TABLE_ACTIONS[t], a, `${t} registered`);
    assert.ok(TABLE_MEANING[t], `${t} in the open export`);
    assert.ok(!src('lib/access.ts').includes(`${t}:`) && !src('lib/audit-edits.ts').includes(`${t}:`), `${t} only at runtime`);
  }
  for (const t of Object.values(TV_TABLES)) {
    assert.ok(WATCHED_TABLES[t]?.label, `${t} audited`);
    assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
    assert.ok((DEMO_EXTRA_TABLES as readonly string[]).includes(t), `${t} sample rows removable`);
  }
  assert.deepEqual(Object.keys(TV_WATCHED).sort(), Object.values(TV_TABLES).sort());
  assert.equal(TV_OBJECTS.settings, 'travel_settings');
  for (const p of TV_PACKS) assert.ok(PACK_IDS.includes(p), p);
});

test('R15-C block: supplier statements (books.edit, audited, dated by period end, open export)', () => {
  assert.equal(TV_TABLE_ACTIONS.supplier_statements, 'books.edit');
  assert.equal(TABLE_ACTIONS.supplier_statements, 'books.edit');
  assert.equal(TV_TABLES.statements, 'supplier_statements');
  assert.equal(TV_DATED.supplier_statements, 'period_end');
  assert.ok(TABLE_MEANING.supplier_statements);
  assert.ok(!src('lib/access.ts').includes('supplier_statements:'));
});

test('every writer, the sync engine and the recycle bin import the registry; dated rows in the sync engine', () => {
  for (const f of ['tv-settings', 'tv-bookings', 'tv-bill', 'tv-air', 'tv-statements', 'tv-statement-bill', 'tv-cancel']) assert.match(src(`lib/travel/${f}.ts`), /import '\.\/tv-registry';/, f);
  assert.match(src('lib/sync-engine.ts'), /import '\.\/travel\/tv-registry';/);
  assert.match(src('lib/trust/recycle-bin.ts'), /import '\.\.\/travel\/tv-registry';/);
  const sync = src('lib/sync-engine.ts');
  for (const [t, d] of Object.entries(TV_DATED)) assert.ok(sync.includes(`[\`\${DB_PREFIX}${t}\`]: '${d}'`), `${t} dated`);
});
