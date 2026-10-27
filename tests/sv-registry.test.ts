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
  for (const [t, a] of Object.entries(A)) assert.equal(SV_TABLE_ACTIONS[t], a, t); // each package pins its own block
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

test('SV-C block: rights, audit labels, backup / sync / open export, MEM used once, restore hooks', () => {
  const C = { member_plans: 'master.edit', memberships: 'doc.create', checkins: 'doc.create', class_schedules: 'master.edit', class_attendance: 'doc.create' };
  const sync = src('lib/sync-engine.ts');
  for (const [t, a] of Object.entries(C)) {
    assert.equal(SV_TABLE_ACTIONS[t], a, t);
    assert.equal(TABLE_ACTIONS[t], a, `${t} registered`);
    assert.ok(SV_WATCHED[t]?.label && TABLE_MEANING[t] && BACKUP_RECORD_TABLES.includes(t), `${t} audited, exported, backed up`);
  }
  for (const [t, f] of [['memberships', 'start'], ['checkins', 'date'], ['class_attendance', 'date']]) assert.ok(sync.includes(`[\`\${DB_PREFIX}${t}\`]: '${f}'`), `${t} dated`);
  assert.ok(sync.includes("[`${DB_PREFIX}memberships`]: { num: 'number', date: 'start' }"));
  assert.equal(SV_SERIES.memberships, 'MEM');
  assert.ok(!(SV_RESERVED_SERIES as readonly string[]).includes('MEM'));
  const lib = readdirSync(new URL('../src/lib/', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.ts') && !String(f).startsWith('help')).map((f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8')).join('\n');
  assert.equal((lib.match(/'MEM'/g) ?? []).length, 1);
  for (const f of ['sv-members', 'sv-memberships', 'sv-checkin', 'sv-classes', 'sv-attendance', 'sv-coaching-refund']) assert.match(src(`lib/services/${f}.ts`), /import '\.\/sv-registry';/, f);
  for (const t of ['checkins', 'class_attendance', 'memberships']) assert.ok(src('lib/trust/recycle-bin.ts').includes(`'${t}'`), `${t} restore hook`);
});
