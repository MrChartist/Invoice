/**
 * Round 11 shared registrations (CN-A): the runtime registry adds the construction rows to the first-paint maps
 * (`TABLE_ACTIONS`, `WATCHED_TABLES`), which carry none themselves; the settings object is described in the open-export
 * schema; the reserved series prefixes are unused elsewhere; the `RaDeductionKind` union carries the six CN-B kinds.
 * CN-A writes no table, so the lazy all-table writers (sync engine, recycle bin) import the registry with the first
 * package that adds a table (CN-B / C / D) — see docs/features/construction-r11.md (first-paint budget).
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { CN_OBJECTS, CN_TABLE_ACTIONS, CN_WATCHED } from '../src/lib/construction/cn-registry.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { DEDUCTION_LABELS } from '../src/lib/works/deductions.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('CN-A block: the construction settings object (owner only), described in the open export', () => {
  assert.deepEqual(CN_OBJECTS, { constructionSettings: 'construction_settings' });
  assert.equal(CN_TABLE_ACTIONS.construction_settings, 'settings.manage');
  assert.ok(!('construction_settings' in CN_WATCHED), 'the settings object is audited on save');
  assert.equal(TABLE_ACTIONS.construction_settings, 'settings.manage', 'registered at runtime');
  assert.ok(TABLE_MEANING.construction_settings);
});

test('first-paint maps carry no Round 11 row; writers import the registry', () => {
  assert.ok(!src('lib/access.ts').includes('construction_settings'));
  assert.ok(!src('lib/audit-edits.ts').includes('construction_settings'));
  assert.match(src('lib/construction/cn-settings.ts'), /from '\.\/cn-registry'/);
  assert.ok(!/realty_|sub_work/.test(src('lib/access.ts') + src('lib/audit-edits.ts')), 'Round 11 tables only at runtime');
});

test('CN-C block: builder tables, rights and audit labels, registered at runtime; every writer and the all-table writers import the registry', () => {
  const C = { realty_projects: 'master.edit', realty_units: 'master.edit', realty_bookings: 'doc.create', payment_plans: 'master.edit', stage_certificates: 'doc.create', rera_withdrawals: 'books.edit' };
  for (const [t, a] of Object.entries(C)) {
    assert.equal(CN_TABLE_ACTIONS[t], a, t);
    assert.equal(TABLE_ACTIONS[t], a, `${t} registered`);
    assert.ok(WATCHED_TABLES[t]?.label, `${t} audited`);
    assert.ok(TABLE_MEANING[t], `${t} in the open export`);
  }
  for (const f of ['cn-realty-projects', 'cn-units', 'cn-plans', 'cn-bookings', 'cn-demands', 'cn-rera', 'cn-cancellations']) assert.match(src(`lib/construction/${f}.ts`), /import '\.\/cn-registry';/, f);
  assert.match(src('lib/sync-engine.ts'), /import '\.\/construction\/cn-registry';/);
  assert.match(src('lib/trust/recycle-bin.ts'), /import '\.\.\/construction\/cn-registry';/);
});

test('the six CN-B deduction kinds are in the union (labelled); reserved series prefixes are unused', () => {
  for (const k of ['secured_advance', 'material_recovery', 'water_power', 'hire_charges', 'advance_interest', 'withheld']) assert.ok(k in DEDUCTION_LABELS, k);
  const all = readdirSync(new URL('../src/lib/', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.ts')).map((f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8')).join('\n');
  for (const p of ['SWO', 'SCB', 'MUS', 'PLG']) assert.equal((all.match(new RegExp(`'${p}'`, 'g')) ?? []).length, 0, `${p} free for its package`);
  // CN-C uses its two: bookings BKG/FY… and demands DMD/FY…, once each.
  for (const [p, f] of [['BKG', 'cn-bookings'], ['DMD', 'cn-demands']]) {
    assert.equal((all.match(new RegExp(`'${p}'`, 'g')) ?? []).length, 1, p);
    assert.match(src(`lib/construction/${f}.ts`), new RegExp(`= '${p}';`));
  }
});

test('CN-B block: four tables with rights, audit labels, backup / sync / open-export rows; the all-table writers import the registry', () => {
  const B = { works_contracts: 'master.edit', secured_advances: 'doc.create', price_variations: 'doc.create', bank_guarantees: 'books.edit' };
  for (const [t, a] of Object.entries(B)) {
    assert.equal(CN_TABLE_ACTIONS[t], a, t);
    assert.equal(TABLE_ACTIONS[t], a, `${t} registered at runtime`);
    assert.ok(CN_WATCHED[t]?.label && WATCHED_TABLES[t], `${t} audited`);
    assert.ok(TABLE_MEANING[t], `${t} in the open export`);
    assert.ok(!src('lib/access.ts').includes(t) && !src('lib/audit-edits.ts').includes(t), `${t} not in a first-paint map`);
    assert.equal((src('lib/backup.ts').match(new RegExp(`'${t}'`, 'g')) ?? []).length, 2, `${t} backed up (record + id tables)`);
  }
  assert.match(src('lib/sync-engine.ts'), /import '\.\/construction\/cn-registry';/);
  assert.match(src('lib/trust/recycle-bin.ts'), /import '\.\.\/construction\/cn-registry';/);
  assert.match(src('lib/sync-engine.ts'), /price_variations`\]: \{ num: 'number', date: 'date' \}/);
  for (const f of ['cn-contracts', 'cn-secured', 'cn-escalation', 'cn-guarantees']) assert.match(src(`lib/construction/${f}.ts`), /import '\.\/cn-registry';/, f);
  assert.equal((src('lib/construction/cn-escalation.ts').match(/'PVB'/g) ?? []).length, 1, 'PVB used by CN-B3 only');
});
