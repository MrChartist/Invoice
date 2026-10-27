/**
 * Round 10 shared registrations (SV-A): the runtime registry adds the service rows to the first-paint maps
 * (`TABLE_ACTIONS`, `WATCHED_TABLES`), which carry none themselves; every table and the settings object is in the open
 * export, the backup and (dated / numbered) the sync engine; every writer, the sync engine and the recycle bin import
 * the registry; the reserved series prefixes are unused.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { SV_TABLE_ACTIONS, SV_WATCHED } from '../src/lib/services/sv-registry.ts';
import { SV_OBJECTS, SV_RESERVED_SERIES, SV_SERIES, SV_TABLES } from '../src/lib/services/sv-shared.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('SV-A block: rights, audit labels, registered at runtime; first-paint maps carry none', () => {
  const A = { appointments: 'doc.create', service_staff: 'master.edit', commission_plans: 'master.edit', staff_payouts: 'books.edit', payer_claims: 'doc.create', service_settings: 'settings.manage' };
  assert.deepEqual(Object.fromEntries(Object.entries(SV_TABLE_ACTIONS).filter(([t]) => t in A)), A); // B–D add their own blocks
  for (const [t, a] of Object.entries(A)) {
    assert.equal(TABLE_ACTIONS[t], a, `${t} registered`);
    assert.ok(TABLE_MEANING[t], `${t} in the open export`);
  }
  for (const t of Object.values(SV_TABLES)) {
    assert.ok(WATCHED_TABLES[t]?.label, `${t} audited`);
    assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
  }
  assert.deepEqual(Object.keys(SV_WATCHED).sort(), Object.values(SV_TABLES).sort());
  assert.ok(!('service_settings' in SV_WATCHED), 'the settings object is audited on save');
  assert.equal(SV_OBJECTS.serviceSettings, 'service_settings');
  for (const t of Object.values(SV_TABLES)) assert.ok(!src('lib/access.ts').includes(`${t}:`) && !src('lib/audit-edits.ts').includes(`${t}:`), `${t} only at runtime`);
});

test('every writer, the sync engine and the recycle bin import the registry; dated / numbered rows in the sync engine', () => {
  for (const f of ['sv-settings', 'sv-appointments', 'sv-staff', 'sv-payouts', 'sv-claims']) assert.match(src(`lib/services/${f}.ts`), /import '\.\/sv-registry';/, f);
  assert.match(src('lib/sync-engine.ts'), /import '\.\/services\/sv-registry';/);
  assert.match(src('lib/trust/recycle-bin.ts'), /import '\.\.\/services\/sv-registry';/);
  const sync = src('lib/sync-engine.ts');
  for (const t of ['appointments', 'staff_payouts', 'payer_claims']) assert.ok(sync.includes(`[\`\${DB_PREFIX}${t}\`]: 'date'`), `${t} dated`);
  assert.ok(sync.includes("[`${DB_PREFIX}payer_claims`]: { num: 'number', date: 'date' }"));
});

test('series: CLM used once (sv-shared); OPD / IPD / LAB / MEM reserved and unused (help text excluded)', () => {
  assert.equal(SV_SERIES.claims, 'CLM');
  const all = readdirSync(new URL('../src/lib/', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.ts') && !String(f).startsWith('help')).map((f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8')).join('\n');
  assert.equal((all.match(/'CLM'/g) ?? []).length, 1);
  for (const p of SV_RESERVED_SERIES) assert.equal((all.match(new RegExp(`'${p}'`, 'g')) ?? []).length, 1, `${p} only in the reserved list`);
});

test('SV-D block: vehicles / appliances and labour operations (masters), workshop settings (owner); writers import the registry', () => {
  const D = { service_assets: 'master.edit', labour_ops: 'master.edit', workshop_settings: 'settings.manage' };
  for (const [t, a] of Object.entries(D)) {
    assert.equal(SV_TABLE_ACTIONS[t], a, t);
    assert.equal(TABLE_ACTIONS[t], a, `${t} registered`);
    assert.ok(TABLE_MEANING[t], `${t} in the open export`);
  }
  assert.deepEqual([SV_WATCHED.service_assets?.label, SV_WATCHED.labour_ops?.label], ['Vehicle / appliance', 'Labour operation']);
  assert.equal(SV_OBJECTS.workshopSettings, 'workshop_settings');
  for (const f of ['sv-assets', 'sv-jobs-workshop', 'sv-estimates', 'sv-parts-issue', 'sv-labour', 'sv-motor-claims']) assert.match(src(`lib/services/${f}.ts`), /import '\.\/sv-registry';/, f);
});
