/**
 * Round 21 shared registrations (R21-A): the runtime registry adds every Round 21 table (B–D's included) to the
 * first-paint maps, which carry none themselves; the tables and the settings object are backed up and in the open
 * export; dated tables are synced by their date; every writer, the sync engine and the recycle bin import the registry;
 * Round 21 adds no series.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { FU_TABLE_ACTIONS, FU_WATCHED } from '../src/lib/fuel/fu-registry.ts';
import { FU_DATED, FU_OBJECTS, FU_PACKS, FU_TABLES } from '../src/lib/fuel/fu-shared.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';
import { PACK_IDS } from '../src/lib/industry-packs.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const TABLES = Object.values(FU_TABLES) as string[];

test('R21-A registers every Round 21 table: rights, audit labels, backup, open export — at runtime only', () => {
  assert.deepEqual(FU_TABLE_ACTIONS, { fuel_settings: 'settings.manage', fuel_nozzles: 'master.edit', fuel_prices: 'master.edit', fuel_shifts: 'doc.create', fuel_tank_logs: 'doc.create', fuel_slips: 'doc.create' });
  for (const [t, a] of Object.entries(FU_TABLE_ACTIONS)) assert.equal(TABLE_ACTIONS[t], a, t);
  assert.deepEqual(Object.keys(FU_WATCHED).sort(), [...TABLES].sort());
  assert.equal(WATCHED_TABLES.fuel_nozzles?.label, 'Nozzle');
  assert.equal(FU_OBJECTS.settings, 'fuel_settings');
  for (const t of [...TABLES, FU_OBJECTS.settings]) assert.ok(TABLE_MEANING[t], `${t} in the open export`);
  for (const t of TABLES) assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
  for (const f of ['lib/access.ts', 'lib/audit-edits.ts']) assert.ok(!/fuel_nozzles|fuel_settings/.test(src(f)), `${f}: only at runtime`);
  for (const p of FU_PACKS) assert.ok(PACK_IDS.includes(p), p);
});

test('every writer, the sync engine and the recycle bin import the registry; dated tables synced by date; no series', () => {
  const lib = readdirSync(new URL('../src/lib/fuel/', import.meta.url)).filter((f) => f.endsWith('.ts'));
  for (const f of lib) {
    const s = src(`lib/fuel/${f}`);
    if (/\bsetTable\(|setJson\(/.test(s)) assert.match(s, /import '\.\/fu-registry';/, `${f} writes a Round 21 table`);
  }
  assert.match(src('lib/sync-engine.ts'), /import '\.\/fuel\/fu-registry';/);
  assert.match(src('lib/trust/recycle-bin.ts'), /import '\.\.\/fuel\/fu-registry';/);
  const sync = src('lib/sync-engine.ts');
  for (const [t, d] of Object.entries(FU_DATED)) assert.ok(sync.includes(`[\`\${DB_PREFIX}${t}\`]: '${d}'`), `${t} dated by ${d}`);
  assert.ok(!/series_counters|nextSeriesNumber/.test(lib.map((f) => src(`lib/fuel/${f}`)).join('\n')), 'Round 21 adds no series');
});
