/**
 * Round 12 shared registrations (AG-A): the runtime registry adds the agri rows to the first-paint maps (`TABLE_ACTIONS`,
 * `WATCHED_TABLES`), which carry none themselves; every table and the settings object is in the open export, the backup
 * and (dated / numbered) the sync engine; every writer, the sync engine and the recycle bin import the registry; the
 * reserved series prefixes are unused.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { AG_TABLE_ACTIONS, AG_WATCHED } from '../src/lib/agri/ag-registry.ts';
import { AG_OBJECTS, AG_RESERVED_SERIES, AG_SERIES, AG_TABLES } from '../src/lib/agri/ag-shared.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('AG-A block: rights, audit labels, registered at runtime; first-paint maps carry none', () => {
  const A = { agri_settings: 'settings.manage', farm_batches: 'doc.create', quality_cut_tables: 'master.edit', farmer_cycles: 'doc.create' };
  assert.deepEqual(Object.fromEntries(Object.entries(AG_TABLE_ACTIONS).filter(([t]) => t in A)), A); // B–D add their own blocks
  for (const [t, a] of Object.entries(A)) {
    assert.equal(TABLE_ACTIONS[t], a, `${t} registered`);
    assert.ok(TABLE_MEANING[t], `${t} in the open export`);
  }
  for (const t of Object.values(AG_TABLES)) {
    assert.ok(WATCHED_TABLES[t]?.label, `${t} audited`);
    assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
    assert.ok(!src('lib/access.ts').includes(`${t}:`) && !src('lib/audit-edits.ts').includes(`${t}:`), `${t} only at runtime`);
  }
  assert.deepEqual(Object.keys(AG_WATCHED).filter((t) => (Object.values(AG_TABLES) as string[]).includes(t)).sort(), Object.values(AG_TABLES).sort());
  assert.ok(!('agri_settings' in AG_WATCHED), 'the settings object is audited on save');
  assert.equal(AG_OBJECTS.agriSettings, 'agri_settings');
});

test('every writer, the sync engine and the recycle bin import the registry; dated / numbered rows in the sync engine', () => {
  for (const f of ['ag-settings', 'ag-batches', 'ag-farmers', 'ag-quality', 'ag-vouchers', 'ag-cycle-post']) assert.match(src(`lib/agri/${f}.ts`), /import '\.\/ag-registry';/, f);
  assert.match(src('lib/sync-engine.ts'), /import '\.\/agri\/ag-registry';/);
  assert.match(src('lib/trust/recycle-bin.ts'), /import '\.\.\/agri\/ag-registry';/);
  const sync = src('lib/sync-engine.ts');
  assert.ok(sync.includes("[`${DB_PREFIX}farm_batches`]: 'start'"));
  assert.ok(sync.includes("[`${DB_PREFIX}farmer_cycles`]: 'period_to'"));
  assert.ok(sync.includes("[`${DB_PREFIX}farmer_cycles`]: { num: 'number', date: 'period_to' }"));
});

test('series: FPV and CYB used once (ag-shared); the reserved B / C prefixes unused (help text excluded); AG-D moved CSR / GPO / LAS / SHC into AG_SERIES', () => {
  assert.deepEqual([AG_SERIES.vouchers, AG_SERIES.cycles], ['FPV', 'CYB']);
  const all = readdirSync(new URL('../src/lib/', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.ts') && !String(f).startsWith('help')).map((f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8')).join('\n');
  for (const p of ['FPV', 'CYB']) assert.equal((all.match(new RegExp(`'${p}'`, 'g')) ?? []).length, 1, p);
  for (const p of AG_RESERVED_SERIES) assert.equal((all.match(new RegExp(`'${p}'`, 'g')) ?? []).length, 1, `${p} only in the reserved list`);
});

test('AG-B block: dairy tables registered, audited, backed up, in the open export; MDS used once; writers import the registry', () => {
  const B = { milk_rate_charts: 'master.edit', milk_shifts: 'doc.create', milk_dispatches: 'doc.create', milk_cards: 'doc.create' };
  for (const [t, a] of Object.entries(B)) {
    assert.equal(TABLE_ACTIONS[t], a, `${t} registered`);
    assert.ok(WATCHED_TABLES[t]?.label && TABLE_MEANING[t] && BACKUP_RECORD_TABLES.includes(t), `${t} audited, exported, backed up`);
  }
  assert.equal(AG_SERIES.dispatches, 'MDS');
  const all = readdirSync(new URL('../src/lib/', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.ts') && !String(f).startsWith('help')).map((f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8')).join('\n');
  assert.equal((all.match(/'MDS'/g) ?? []).length, 1, 'MDS written once');
  for (const f of ['ag-rate-chart', 'ag-shifts', 'ag-milk-cycle', 'ag-dispatch', 'ag-milk-cards']) assert.match(src(`lib/agri/${f}.ts`), /import '\.\/ag-registry';/, f);
  const sync = src('lib/sync-engine.ts');
  assert.ok(sync.includes("[`${DB_PREFIX}milk_shifts`]: 'date'") && sync.includes("[`${DB_PREFIX}milk_dispatches`]: { num: 'number', date: 'date' }"));
});
