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
  assert.deepEqual(CN_TABLE_ACTIONS, { construction_settings: 'settings.manage' });
  assert.deepEqual(CN_WATCHED, {});
  assert.equal(TABLE_ACTIONS.construction_settings, 'settings.manage', 'registered at runtime');
  assert.ok(TABLE_MEANING.construction_settings);
});

test('first-paint maps carry no Round 11 row; writers import the registry', () => {
  assert.ok(!src('lib/access.ts').includes('construction_settings'));
  assert.ok(!src('lib/audit-edits.ts').includes('construction_settings'));
  assert.match(src('lib/construction/cn-settings.ts'), /from '\.\/cn-registry'/);
  for (const t of Object.keys(WATCHED_TABLES)) assert.ok(!t.startsWith('realty_') && !t.startsWith('sub_'), t);
});

test('the six CN-B deduction kinds are in the union (labelled); reserved series prefixes are unused', () => {
  for (const k of ['secured_advance', 'material_recovery', 'water_power', 'hire_charges', 'advance_interest', 'withheld']) assert.ok(k in DEDUCTION_LABELS, k);
  const all = readdirSync(new URL('../src/lib/', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.ts')).map((f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8')).join('\n');
  for (const p of ['SWO', 'SCB', 'BKG', 'DMD', 'MUS', 'PLG', 'PVB']) assert.equal((all.match(new RegExp(`'${p}'`, 'g')) ?? []).length, 0, `${p} free for its package`);
});
