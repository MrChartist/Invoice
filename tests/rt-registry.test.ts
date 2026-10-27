/**
 * Round 9 shared registrations: every R9 table is backed up, synced (dated / numbered ones in DATED / NUMBERED), in the
 * open-export schema, and — through the lazy `rt-registry.ts` — in TABLE_ACTIONS and WATCHED_TABLES. The lazy writers
 * (sync engine, recycle bin) and every R9 writer module import the registry; first-paint maps carry no R9 row.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { RT_DATED, RT_NUMBERED, RT_OBJECTS, RT_SERIES, RT_TABLES } from '../src/lib/retail/rt-shared.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { RT_TABLE_ACTIONS, RT_WATCHED } from '../src/lib/retail/rt-registry.ts';
import { DEMO_EXTRA_TABLES } from '../src/lib/demo-data.ts';
import { RIDER_CASH_LEDGER } from '../src/lib/retail/rt-shared.ts';
import { RIDER_CASH_LEDGER as NO_CASH_RIDER } from '../src/lib/no-cash.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('the storage table of the PRD (§6): 12 tables, one object, four series', () => {
  assert.deepEqual(Object.values(RT_TABLES).sort(), ['alteration_jobs', 'delivery_riders', 'doctors', 'finance_deals', 'imei_checks', 'jewel_tags', 'karigar_moves', 'metal_rates', 'rider_settlements', 'rx_refills', 'service_jobs', 'short_book']);
  assert.deepEqual(Object.values(RT_OBJECTS), ['retail_settings']);
  assert.deepEqual(Object.values(RT_SERIES).sort(), ['ALT', 'KAR', 'SVC', 'URD']);
  assert.equal(RIDER_CASH_LEDGER, NO_CASH_RIDER, 'one ledger name for COD cash with riders');
  assert.deepEqual(RT_TABLE_ACTIONS, {
    delivery_riders: 'master.edit', rider_settlements: 'payment.record', short_book: 'doc.create', retail_settings: 'settings.manage',
    doctors: 'master.edit', rx_refills: 'doc.create', alteration_jobs: 'doc.create', imei_checks: 'doc.create', finance_deals: 'doc.create',
    service_jobs: 'doc.create', metal_rates: 'master.edit', jewel_tags: 'master.edit', karigar_moves: 'books.edit',
  });
});

test('every R9 table: backup, open-export schema, rights, audit label, demo table', () => {
  for (const t of Object.values(RT_TABLES)) {
    assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
    assert.ok(TABLE_MEANING[t], `${t} in the open-export schema`);
    assert.equal(TABLE_ACTIONS[t], RT_TABLE_ACTIONS[t], `${t} rights registered`);
    assert.equal(WATCHED_TABLES[t], RT_WATCHED[t], `${t} audited`);
    assert.ok((DEMO_EXTRA_TABLES as readonly string[]).includes(t), `${t} can hold Demo rows`);
  }
  for (const o of Object.values(RT_OBJECTS)) {
    assert.ok(TABLE_MEANING[o], `${o} described`);
    assert.equal(TABLE_ACTIONS[o], 'settings.manage');
  }
});

test('dated / numbered tables in the sync engine; the series prefixes are used only in rt-shared.ts', () => {
  const sync = src('lib/sync-engine.ts');
  for (const [t, f] of Object.entries(RT_DATED)) assert.ok(sync.includes(`[\`\${DB_PREFIX}${t}\`]: '${f}'`), `${t} dated by ${f}`);
  for (const t of Object.keys(RT_NUMBERED)) assert.ok(new RegExp(`\\$\\{DB_PREFIX\\}${t}\`\\]: \\{ num: 'number'`).test(sync), `${t} numbered`);
  const all = readdirSync(new URL('../src/lib/', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.ts')).map((f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8')).join('\n');
  for (const p of Object.values(RT_SERIES)) assert.equal((all.match(new RegExp(`'${p}'`, 'g')) ?? []).length, 1, `${p} used only in rt-shared.ts`);
});

test('the lazy writers and the RT-A writers import the registry; first-paint maps carry no R9 row', () => {
  for (const f of ['lib/sync-engine.ts', 'lib/trust/recycle-bin.ts', 'lib/retail/rt-delivery.ts', 'lib/retail/rt-short-book.ts', 'lib/retail/rt-pharmacy-rx.ts', 'lib/retail/rt-refills.ts', 'lib/retail/rt-alterations.ts', 'lib/retail/rt-imei.ts', 'lib/retail/rt-finance.ts', 'lib/retail/rt-buyback.ts', 'lib/retail/rt-service-jobs.ts']) assert.ok(/import '\.{1,2}\/(retail\/)?rt-registry'/.test(src(f)), f);
  for (const t of [...Object.values(RT_TABLES), ...Object.values(RT_OBJECTS)]) {
    assert.ok(!src('lib/access.ts').includes(`  ${t}:`), `${t} not in access.ts (first paint)`);
    assert.ok(!src('lib/audit-edits.ts').includes(`  ${t}:`), `${t} not in audit-edits.ts (first paint)`);
  }
});
