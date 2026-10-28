/**
 * Round 15 pack gate (R15-B): an existing company sees exactly what it saw — the Trips desk is listed only with the
 * `travel` / `events` pack (its URL still opens), desks, rows and paper parts load only through `lazy(() => import(…))`,
 * no Round 15 table is read without the profile / pack, and ordinary documents never touch Round 15 code.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { resetParseCounts, tableParseCount } from '../src/lib/storage.ts';
import { installSettings } from './helpers/world.ts';
import { readChecklistInputs } from '../src/lib/checklist-steps.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'services' } as never);
});
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('no Round 15 table is read without the profile / pack', () => {
  resetParseCounts();
  assert.equal(readChecklistInputs().facts.travel, undefined, 'no checklist facts without travel_kind');
  assert.equal(tableParseCount('travel_bookings'), 0);
});

test('hosts load Round 15 code lazily; the paper reads only the snapshot', () => {
  assert.match(src('pages/Time.tsx'), /import\.meta\.glob<.*>\('\.\.\/components\/travel\/\*Desk\.tsx'\)/);
  assert.match(src('components/templates/TemplateEngine.tsx'), /lazy\(\(\) => import\('\.\/parts\/TravelBlock'\)\)/);
  assert.match(src('components/templates/TemplateEngine.tsx'), /invoice\.tv && layout !== 'receipt'/, 'never on receipt paper');
  assert.match(src('components/creator/ItemsTable.tsx'), /lazy\(\(\) => import\('\.\.\/travel\/TravelRows'\)\)/);
  assert.match(src('components/purchases/BillModal.tsx'), /lazy\(\(\) => import\('\.\.\/travel\/TripPick'\)\)/);
  for (const f of ['components/onboarding/SetupWizard.tsx', 'components/settings/FeaturesPanel.tsx']) assert.match(src(f), /import\('\.\.\/\.\.\/lib\/travel\/tv-profile'\)/, f);
  assert.match(src('lib/gst-guards.ts'), /import\('\.\/travel\/tv-itc'\)/);
  assert.ok(!/travel\//.test(src('components/templates/paper-helpers.ts').split('\n').filter((l) => l.startsWith('import') && !l.startsWith('import type')).join('\n')));
});
