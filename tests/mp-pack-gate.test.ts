/**
 * Round 17 pack gate (R17-A): an existing company sees exactly what it saw — the Deploy desk is listed only with the
 * `manpower` / `security` pack (its URL still opens), desk, editor row and paper part load only through lazy imports,
 * no Round 17 data is read without the profile, and ordinary documents never touch Round 17 code.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { readChecklistInputs } from '../src/lib/checklist-steps.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'services' } as never);
});
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('no Round 17 facts without the profile', () => {
  assert.equal(readChecklistInputs().facts.manpower, undefined);
});

test('hosts load Round 17 code lazily; the paper reads only the snapshot', () => {
  assert.match(src('pages/Time.tsx'), /import\.meta\.glob<.*>\('\.\.\/components\/manpower\/\*Desk\.tsx'\)/);
  assert.match(src('components/templates/TemplateEngine.tsx'), /lazy\(\(\) => import\('\.\/parts\/ManpowerBlock'\)\)/);
  assert.match(src('components/templates/TemplateEngine.tsx'), /invoice\.mp && layout !== 'receipt'/, 'never on receipt paper');
  assert.match(src('components/creator/ItemsTable.tsx'), /lazy\(\(\) => import\('\.\.\/manpower\/ManpowerRows'\)\)/);
  assert.match(src('components/creator/ItemsTable.tsx'), /manpowerOn && <Suspense/);
  for (const f of ['components/onboarding/SetupWizard.tsx', 'components/settings/FeaturesPanel.tsx']) assert.match(src(f), /import\('\.\.\/\.\.\/lib\/manpower\/mp-settings'\)/, f);
  assert.ok(!/manpower\//.test(src('components/templates/paper-helpers.ts').split('\n').filter((l) => l.startsWith('import') && !l.startsWith('import type')).join('\n')));
});
