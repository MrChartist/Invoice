/**
 * AG-D shared registrations: every AG-D table is backed up, synced (dated / numbered in DATED / NUMBERED), in the
 * open-export schema and — through the lazy `ag-registry.ts` — in TABLE_ACTIONS and WATCHED_TABLES; the AG-D writers
 * and the two all-table lazy writers import the registry; the series prefixes live only in `ag-shared.ts`; first-paint
 * maps carry no R12 row; the rules file stays out of first paint; the pack gate holds for the shared mounts.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { AG_DATED, AG_NUMBERED, AG_OBJECTS, AG_SERIES, AG_TABLES } from '../src/lib/agri/ag-shared.ts';
import { BACKUP_RECORD_TABLES } from '../src/lib/backup.ts';
import { TABLE_MEANING } from '../src/lib/trust/open-export-schema.ts';
import { TABLE_ACTIONS } from '../src/lib/access.ts';
import { WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { AG_TABLE_ACTIONS, AG_WATCHED } from '../src/lib/agri/ag-registry.ts';
import { DEMO_EXTRA_TABLES } from '../src/lib/demo-data.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const D_TABLES = [AG_TABLES.coldLots, AG_TABLES.coldRentPlans, AG_TABLES.agriLoans, AG_TABLES.memberShares];

test('AG-D tables: backup, open-export schema, rights, audit label, demo rows', () => {
  assert.deepEqual(D_TABLES, ['cold_lots', 'cold_rent_plans', 'agri_loans', 'member_shares']);
  assert.deepEqual([AG_SERIES.csr, AG_SERIES.gpo, AG_SERIES.las, AG_SERIES.shc], ['CSR', 'GPO', 'LAS', 'SHC']);
  for (const t of D_TABLES) {
    assert.ok(BACKUP_RECORD_TABLES.includes(t), `${t} backed up`);
    assert.ok(TABLE_MEANING[t], `${t} in the open-export schema`);
    assert.equal(TABLE_ACTIONS[t], AG_TABLE_ACTIONS[t], `${t} rights registered`);
    assert.equal(WATCHED_TABLES[t], AG_WATCHED[t], `${t} audited`);
    assert.ok((DEMO_EXTRA_TABLES as readonly string[]).includes(t), `${t} can hold Demo rows`);
  }
  assert.ok(TABLE_MEANING[AG_OBJECTS.agriSettings]);
  assert.equal(TABLE_ACTIONS[AG_OBJECTS.agriSettings], 'settings.manage');
});

test('dated / numbered in the sync engine; series prefixes only in ag-shared.ts', () => {
  const sync = src('lib/sync-engine.ts');
  for (const [t, f] of Object.entries(AG_DATED)) assert.ok(sync.includes(`[\`\${DB_PREFIX}${t}\`]: '${f}'`), `${t} dated by ${f}`);
  for (const t of Object.keys(AG_NUMBERED)) assert.ok(new RegExp(`\\$\\{DB_PREFIX\\}${t}\`\\]: \\{ num: 'number'`).test(sync), `${t} numbered`);
  const all = readdirSync(new URL('../src/lib/', import.meta.url), { recursive: true }).filter((f) => String(f).endsWith('.ts')).map((f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8')).join('\n');
  for (const p of [AG_SERIES.csr, AG_SERIES.gpo, AG_SERIES.las, AG_SERIES.shc]) assert.equal((all.match(new RegExp(`'${p}'`, 'g')) ?? []).length, 1, `${p} used only in ag-shared.ts`);
});

test('writers and the lazy all-table writers import the registry; no R12 row in first-paint maps; rules stay lazy', () => {
  for (const f of ['lib/sync-engine.ts', 'lib/trust/recycle-bin.ts', 'lib/agri/ag-cold-lots.ts', 'lib/agri/ag-gatepass.ts', 'lib/agri/ag-cold-rent.ts', 'lib/agri/ag-loans.ts', 'lib/agri/ag-members.ts', 'lib/agri/ag-patronage.ts']) assert.ok(/import '\.{1,2}\/(agri\/)?ag-registry'/.test(src(f)), f);
  for (const t of [...D_TABLES, AG_OBJECTS.agriSettings]) {
    assert.ok(!src('lib/access.ts').includes(`  ${t}:`), `${t} not in access.ts`);
    assert.ok(!src('lib/audit-edits.ts').includes(`  ${t}:`), `${t} not in audit-edits.ts`);
  }
  for (const f of ['lib/tax-rules.ts', 'lib/shop-mode.ts', 'App.tsx', 'main.tsx', 'lib/stock-tracking.ts', 'lib/agri/ag-expiry.ts']) assert.ok(!/from '[^']*agri-rules'/.test(src(f)), `${f} does not import agri-rules`);
});

test('pack gate: the shared mounts and the bell load AG-D code only with its pack on', () => {
  assert.match(src('pages/Pos.tsx'), /isPackOn\(settings, 'agri_inputs'\) && <Suspense fallback=\{null\}><PosInputsStrip/);
  assert.match(src('components/gst-reports/ComplianceView.tsx'), /isPackOn\(localDb\.settings\.get\(\), 'fpo'\) && <Suspense fallback=\{null\}><MembersCalendar/);
  assert.match(src('components/command/NotificationBell.tsx'), /for \(const p of \['agri_inputs', 'coldstore', 'fpo'\]\) gate\(p, '-'/);
  assert.match(src('pages/page-tabs.ts'), /\{ id: 'cold', pack: 'coldstore' \}[\s\S]*\{ id: 'inputs', pack: 'agri_inputs' \}[\s\S]*\{ id: 'members', pack: 'fpo' \}/);
});
