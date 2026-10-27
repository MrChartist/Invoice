/**
 * Round 12 pack gate (AG-A): an existing company sees exactly what it saw — the agri desks are listed only with their
 * pack (their URLs still open), desks / views / paper parts load only through `lazy(() => import(…))`, the class-rate
 * hook loads only for an agri company, and ordinary documents never touch Round 12 code. The Farm desk's tables are
 * read only when its view is open (the desk is not mounted while the pack is off).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { visibleTabs } from '../src/lib/industry-packs.ts';
import { INVENTORY_PACK_TABS } from '../src/pages/page-tabs.ts';
import { readChecklistInputs } from '../src/lib/checklist-steps.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'manufacturer' } as never);
});
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('no agri desk for an existing company; each pack lists its desk; the current tab still opens', () => {
  const s = localDb.settings.get();
  assert.deepEqual(visibleTabs(INVENTORY_PACK_TABS, s).map((t) => t.id), []);
  assert.deepEqual(visibleTabs(INVENTORY_PACK_TABS, s, 'farm').map((t) => t.id), ['farm'], 'URL still opens');
  localDb.settings.save({ ...s, industry_packs: ['coldstore'] });
  assert.deepEqual(visibleTabs(INVENTORY_PACK_TABS, localDb.settings.get()).map((t) => t.id), ['cold'], 'a trader may turn on only cold storage');
  assert.equal(readChecklistInputs().facts.agri, undefined, 'no agri table read without agri_kind');
});

test('hosts load Round 12 code lazily', () => {
  for (const d of ['FarmDesk', 'DairyDesk', 'MillDesk', 'ColdDesk', 'InputsDesk', 'MembersDesk']) assert.match(src('pages/Inventory.tsx'), new RegExp(`const ${d} = lazy\\(\\(\\) => import\\('\\.\\./components/agri/${d}'\\)\\);`), d);
  for (const v of ['FarmersView', 'VouchersView', 'CyclesView', 'QualityView', 'BatchesView']) assert.match(src('components/agri/FarmDesk.tsx'), new RegExp(`lazy\\(\\(\\) => import\\('\\./${v}'\\)\\)`), v);
  assert.match(src('components/templates/TemplateEngine.tsx'), /const LazyAgriBlock = lazy\(\(\) => import\('\.\/parts\/AgriBlock'\)\);/);
  assert.match(src('components/templates/TemplateEngine.tsx'), /invoice\.ag && layout !== 'receipt' && <Suspense/);
  assert.match(src('components/purchases/BillModal.tsx'), /const VoucherAgriPanel = lazy\(\(\) => import\('\.\.\/agri\/VoucherAgriPanel'\)\);/);
  assert.match(src('lib/gst-guards.ts'), /void import\('\.\/agri\/ag-hooks'\)/);
  for (const f of ['components/onboarding/SetupWizard.tsx', 'components/settings/FeaturesPanel.tsx']) assert.match(src(f), /import\('\.\.\/\.\.\/lib\/agri\/ag-profile'\)/, f);
  assert.ok(!/agri\//.test(src('components/templates/paper-helpers.ts').split('\n').filter((l) => l.startsWith('import') && !l.startsWith('import type')).join('\n')), 'the paper reads only the snapshot');
  assert.ok(!/from '[^']*agri\/ag-(?!cash)/.test(src('lib/retail/rt-cash-guard.ts')), 'the cash guard loads only the pure 6DD(e) check');
});
