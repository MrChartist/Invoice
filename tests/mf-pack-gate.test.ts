/**
 * Round 13 pack gate (MF-A): an existing company sees exactly what it saw — the manufacturing desks are listed only with
 * their pack (their URLs still open), desks and paper parts load only through `lazy(() => import(…))`, no Round 13 table
 * is read without the profile / pack, and ordinary documents never touch Round 13 code.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { resetParseCounts, tableParseCount } from '../src/lib/storage.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { visibleTabs } from '../src/lib/industry-packs.ts';
import { MFG_PACK_TABS } from '../src/pages/page-tabs.ts';
import { readChecklistInputs } from '../src/lib/checklist-steps.ts';
import { opsForRelease } from '../src/lib/mfg/mf-routings.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'manufacturer' } as never);
});
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('no manufacturing desk for an existing company; each pack lists its desk; the current tab still opens', () => {
  const s = localDb.settings.get();
  assert.deepEqual(visibleTabs(MFG_PACK_TABS, s).map((t) => t.id), []);
  assert.deepEqual(visibleTabs(MFG_PACK_TABS, s, 'floor').map((t) => t.id), ['floor'], 'URL still opens');
  localDb.settings.save({ ...s, industry_packs: ['shopfloor'] });
  assert.deepEqual(visibleTabs(MFG_PACK_TABS, localDb.settings.get()).map((t) => t.id), ['floor', 'statutory'], 'a trader who assembles may turn on the shop floor only');
});

test('no Round 13 table is read without the profile / pack', () => {
  resetParseCounts();
  assert.equal(readChecklistInputs().facts.mfg, undefined, 'no checklist facts without mfg_kind');
  assert.equal(opsForRelease({ item_id: 'x', planned_qty: 1 }), undefined, 'release reads no routing with the pack off');
  for (const t of ['work_centres', 'routings', 'job_cards']) assert.equal(tableParseCount(t), 0, t);
});

test('hosts load Round 13 code lazily', () => {
  for (const d of ['FloorDesk', 'ShopDesk', 'MouldingDesk', 'PressDesk', 'GarmentsDesk', 'FoodDesk', 'StatutoryDesk']) assert.match(src('pages/Manufacturing.tsx'), new RegExp(`lazy\\(\\(\\) => import\\('\\.\\./components/mfg/${d}'\\)\\)`), d);
  assert.match(src('components/manufacturing/MrpTab.tsx'), /lazy\(\(\) => import\('\.\.\/mfg\/DatedPlanView'\)\)/);
  assert.match(src('components/inventory/ItemFormModal.tsx'), /lazy\(\(\) => import\('\.\.\/mfg\/LeadTimeRow'\)\)/);
  assert.match(src('components/payroll/AttendanceTab.tsx'), /lazy\(\(\) => import\('\.\.\/mfg\/PayrollUnitsRow'\)\)/);
  assert.match(src('components/settings/PaymentTermsPanel.tsx'), /lazy\(\(\) => import\('\.\.\/mfg\/MfProfileRow'\)\)/);
  assert.match(src('components/production/OutputDialog.tsx'), /import\('\.\.\/\.\.\/lib\/mfg\/mf-jobcards'\)/);
  for (const f of ['components/onboarding/SetupWizard.tsx', 'components/settings/FeaturesPanel.tsx']) assert.match(src(f), /import\('\.\.\/\.\.\/lib\/mfg\/mf-profile'\)/, f);
  assert.ok(!/mfg\//.test(src('components/templates/paper-helpers.ts').split('\n').filter((l) => l.startsWith('import') && !l.startsWith('import type')).join('\n')), 'the paper reads only the snapshot');
});
