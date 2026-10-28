/**
 * Round 17 shared registrations (R17-A): the runtime registry adds the manpower rows to the first-paint maps, which
 * carry none themselves; the settings object is in the open export; every writer, the sync engine and the recycle bin
 * import the registry. B / C append their tables (site_musters, site_compliance) and their blocks here.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { MP_TABLE_ACTIONS, MP_WATCHED } from '../src/lib/manpower/mp-registry.ts';
import { MP_DATED, MP_OBJECTS, MP_PACKS, MP_TABLES } from '../src/lib/manpower/mp-shared.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';
import { PACK_IDS } from '../src/lib/industry-packs.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('R17-A block: the settings object (settings.manage), registered at runtime; first-paint maps carry none', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(MP_TABLE_ACTIONS).filter(([t]) => t === 'manpower_settings')), { manpower_settings: 'settings.manage' });
  assert.equal(TABLE_ACTIONS.manpower_settings, 'settings.manage');
  assert.equal(MP_OBJECTS.settings, 'manpower_settings');
  assert.ok(TABLE_MEANING.manpower_settings, 'in the open export');
  for (const f of ['lib/access.ts', 'lib/audit-edits.ts']) assert.ok(!src(f).includes('manpower_settings'), `${f}: only at runtime`);
  for (const t of Object.values(MP_TABLES) as string[]) {
    assert.ok(WATCHED_TABLES[t]?.label, `${t} audited`);
    assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
  }
  assert.deepEqual(Object.keys(MP_WATCHED).sort(), (Object.values(MP_TABLES) as string[]).sort());
  for (const p of MP_PACKS) assert.ok(PACK_IDS.includes(p), p);
});

test('every writer, the sync engine and the recycle bin import the registry; dated rows in the sync engine', () => {
  assert.match(src('lib/manpower/mp-settings.ts'), /import '\.\/mp-registry';/);
  assert.match(src('lib/sync-engine.ts'), /import '\.\/manpower\/mp-registry';/);
  assert.match(src('lib/trust/recycle-bin.ts'), /import '\.\.\/manpower\/mp-registry';/);
  const sync = src('lib/sync-engine.ts');
  for (const [t, d] of Object.entries(MP_DATED)) assert.ok(sync.includes(`[\`\${DB_PREFIX}${t}\`]: '${d}'`), `${t} dated`);
});
