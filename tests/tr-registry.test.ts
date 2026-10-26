/**
 * Round 8 shared registrations: every R8 table is backed up, synced (dated / numbered ones in DATED / NUMBERED), in the
 * open-export schema, and — through the lazy `tr-registry.ts` — in TABLE_ACTIONS and WATCHED_TABLES. The lazy writers
 * (sync engine, recycle bin) and every R8 module import the registry; first-paint modules do not.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TR_OBJECTS, TR_SERIES, TR_TABLES } from '../src/lib/trade/tr-shared.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { TR_TABLE_ACTIONS, TR_WATCHED } from '../src/lib/trade/tr-registry.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('every R8 table: backup, open-export schema, rights and audit label', () => {
  for (const t of Object.values(TR_TABLES)) {
    assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
    assert.ok(TABLE_MEANING[t], `${t} in the open-export schema`);
    assert.equal(TABLE_ACTIONS[t], TR_TABLE_ACTIONS[t], `${t} rights registered`);
    assert.equal(WATCHED_TABLES[t], TR_WATCHED[t], `${t} audited`);
  }
  for (const o of Object.values(TR_OBJECTS)) {
    assert.ok(TABLE_MEANING[o], `${o} described`);
    assert.ok(TR_TABLE_ACTIONS[o], `${o} rights`);
  }
  assert.ok(!(TR_OBJECTS.bankStatementSettings in TR_WATCHED), 'bank-statement terms are viewing terms, not audited');
});

test('dated / numbered tables in the sync engine; the series prefixes are new', () => {
  const sync = src('lib/sync-engine.ts');
  for (const t of ['trade_claims', 'price_drops', 'interest_runs', 'packaging_moves', 'brokerage_postings', 'arrivals', 'sale_pattis', 'indents']) assert.ok(sync.includes(`\`\${DB_PREFIX}${t}\`]: `), `${t} dated`);
  for (const t of ['trade_claims', 'price_drops', 'arrivals', 'sale_pattis', 'indents']) assert.ok(new RegExp(`\\$\\{DB_PREFIX\\}${t}\`\\]: \\{ num: 'number'`).test(sync), `${t} numbered`);
  assert.deepEqual(Object.values(TR_SERIES).sort(), ['ARR', 'IND', 'PAT', 'PDR', 'TCL']);
  const all = readdirSync(new URL('../src/lib/', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.ts')).map((f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8')).join('\n');
  for (const p of Object.values(TR_SERIES)) assert.equal((all.match(new RegExp(`'${p}'`, 'g')) ?? []).length, 1, `${p} used only in tr-shared.ts`);
});

test('the lazy writers and the R8 modules import the registry; first-paint maps carry no R8 row', () => {
  for (const f of ['lib/sync-engine.ts', 'lib/trust/recycle-bin.ts', 'lib/trade/tr-arrivals.ts', 'lib/trade/tr-patti.ts', 'lib/trade/tr-indents.ts', 'lib/trade/tr-stock-statement.ts', 'lib/trade/tr-party-rates.ts', 'lib/trade/tr-claims.ts', 'lib/trade/tr-price-drop.ts', 'lib/trade/tr-interest.ts', 'lib/trade/tr-packaging.ts']) assert.ok(/import '\.{1,2}\/(trade\/)?tr-registry'/.test(src(f)), f);
  for (const t of Object.values(TR_TABLES)) {
    assert.ok(!src('lib/access.ts').includes(`  ${t}:`), `${t} not in access.ts (first paint)`);
    assert.ok(!src('lib/audit-edits.ts').includes(`  ${t}:`), `${t} not in audit-edits.ts (first paint)`);
  }
});
