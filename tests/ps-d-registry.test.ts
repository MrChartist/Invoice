/**
 * PS-D registrations: rights and audit labels added at runtime (first-paint maps carry none), backup / open export /
 * sync rows, every writer, the sync engine and the recycle bin import the registry; restore rules; rule rows carry
 * `verified`; D's rule chunk stays out of the shell.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { PS_TABLE_ACTIONS, PS_WATCHED } from '../src/lib/prof/ps-registry.ts';
import { PS_DATED } from '../src/lib/prof/ps-shared.ts';
import * as rules from '../src/lib/prof-rules.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('PS-D block: rights, audit labels, registered at runtime, backed up, in the open export', () => {
  const D = { partners: 'settings.manage', partner_runs: 'books.edit', udin_register: 'doc.create' };
  assert.deepEqual(Object.fromEntries(Object.entries(PS_TABLE_ACTIONS).filter(([t]) => t in D)), D);
  for (const t of Object.keys(D)) assert.ok(PS_WATCHED[t]?.label, t);
  for (const [t, a] of Object.entries(D)) {
    assert.equal(TABLE_ACTIONS[t], a, `${t} registered`);
    assert.ok(WATCHED_TABLES[t]?.label, `${t} audited`);
    assert.ok(TABLE_MEANING[t], `${t} in the open export`);
    assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
    assert.ok(!src('lib/access.ts').includes(`${t}:`) && !src('lib/audit-edits.ts').includes(`${t}:`), `${t} only at runtime`);
  }
  const sync = src('lib/sync-engine.ts');
  for (const [t, f] of Object.entries(PS_DATED).filter(([t]) => t in D)) assert.ok(sync.includes(`[\`\${DB_PREFIX}${t}\`]: '${f}'`), `${t} dated`);
});

test('writers, the sync engine and the recycle bin import the registry; restore rules exist', () => {
  for (const f of ['ps-partners', 'ps-194t', 'ps-partner-post', 'ps-udin']) assert.match(src(`lib/prof/${f}.ts`), /import '\.\/ps-registry';/, f);
  const bin = src('lib/trust/recycle-bin.ts');
  for (const t of ['partner_runs', 'udin_register', 'partners']) assert.match(bin, new RegExp(`registerRestoreHook\\('${t}'`));
  assert.match(bin, /'Partners appropriation', 'Partner credit'/);
});

test('every Round 14 rule row is dated and says whether it is verified; the rule chunk stays out of the shell', () => {
  for (const [name, rows] of Object.entries(rules)) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/, name);
      assert.equal(typeof r.verified, 'boolean', name);
      assert.ok(r.source, name);
    }
  }
  for (const f of ['lib/tax-rules.ts', 'lib/shop-mode.ts', 'App.tsx', 'main.tsx', 'lib/tds-rules.ts']) assert.ok(!src(f).includes('prof-rules'), f);
});
