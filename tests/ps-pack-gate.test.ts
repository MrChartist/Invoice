/**
 * Round 14 pack gate (PS-A): an existing company sees exactly what it saw — the professional desks are listed only with
 * the `practice` pack (their URLs still open), desks, rows and paper parts load only through `lazy(() => import(…))`, no
 * Round 14 table is read without the profile / pack, and ordinary documents never touch Round 14 code.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { resetParseCounts, tableParseCount } from '../src/lib/storage.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { visiblePackTabs } from '../src/lib/industry-packs.ts';
import { TIME_TABS } from '../src/pages/page-tabs.ts';
import { readChecklistInputs } from '../src/lib/checklist-steps.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'services' } as never);
});
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('no professional desk for an existing company; the pack lists both; the current tab still opens', () => {
  const s = localDb.settings.get();
  const ps = (cur?: string) => visiblePackTabs(TIME_TABS, localDb.settings.get(), cur).map((t) => t.id).filter((id) => ['matters', 'wip'].includes(id));
  assert.deepEqual(ps(), []);
  assert.deepEqual(ps('wip'), ['wip'], 'URL still opens');
  localDb.settings.save({ ...s, industry_packs: ['practice'] });
  assert.deepEqual(ps(), ['matters', 'wip']);
});

test('no Round 14 table is read without the profile / pack', () => {
  resetParseCounts();
  assert.equal(readChecklistInputs().facts.prof, undefined, 'no checklist facts without prof_kind');
  for (const t of ['engagements', 'conflict_checks']) assert.equal(tableParseCount(t), 0, t);
});

test('hosts load Round 14 code lazily', () => {
  assert.match(src('pages/Time.tsx'), /import\.meta\.glob<.*>\('\.\.\/components\/prof\/\*Desk\.tsx'\)/);
  for (const d of ['MattersDesk', 'WipDesk', 'ClientMoneyDesk', 'ExportSvcDesk', 'FirmDesk', 'CaDesk']) assert.ok(src('pages/Time.tsx').includes(`'${d}'`), d);
  assert.match(src('components/templates/TemplateEngine.tsx'), /lazy\(\(\) => import\('\.\/parts\/ProfBlock'\)\)/);
  assert.match(src('components/templates/TemplateEngine.tsx'), /lazy\(\(\) => import\('\.\/parts\/ProfAnnexurePage'\)\)/);
  for (const f of ['components/time/TimeForms.tsx', 'components/time/TimerCard.tsx']) assert.match(src(f), /lazy\(\(\) => import\('\.\.\/prof\/WhoRow'\)\)/, f);
  for (const f of ['components/time/BillClientModal.tsx', 'components/time/ProjectsBoard.tsx', 'components/settings/ProfileEditor.tsx', 'components/services-r10/CommissionDesk.tsx']) assert.match(src(f), /import\('\.\.\/prof\/ProfRows'\)/, f);
  for (const f of ['components/onboarding/SetupWizard.tsx', 'components/settings/FeaturesPanel.tsx']) assert.match(src(f), /import\('\.\.\/\.\.\/lib\/prof\/ps-profile'\)/, f);
  assert.ok(!/prof\//.test(src('components/templates/paper-helpers.ts').split('\n').filter((l) => l.startsWith('import') && !l.startsWith('import type')).join('\n')), 'the paper reads only the snapshot');
});
