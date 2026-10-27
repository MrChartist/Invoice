/**
 * Round 11 pack gate (CN-A): an existing company sees exactly what it saw — the realty tab is listed only with the
 * realty pack on (its URL still opens it), the construction paper parts and the editor panel load only through
 * `lazy(() => import(…))`, and ordinary documents never touch Round 11 code.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { visibleTabs } from '../src/lib/industry-packs.ts';
import { RECEIVABLES_TABS } from '../src/pages/page-tabs.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'contractor' } as never);
});
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('the realty tab is listed only with the realty pack (URL still opens it)', () => {
  const s = localDb.settings.get();
  assert.ok(!visibleTabs(RECEIVABLES_TABS, s).some((t) => t.id === 'realty'));
  assert.ok(visibleTabs(RECEIVABLES_TABS, s, 'realty').some((t) => t.id === 'realty'));
  localDb.settings.save({ ...s, industry_packs: ['realty', 'works'] });
  assert.ok(visibleTabs(RECEIVABLES_TABS, localDb.settings.get()).some((t) => t.id === 'realty'));
});

test('hosts load Round 11 code lazily', () => {
  assert.match(src('pages/Receivables.tsx'), /const RealtyDesk = lazy\(\(\) => import\('\.\.\/components\/construction\/RealtyDesk'\)\);/);
  assert.match(src('components/creator/DocumentMetaCard.tsx'), /const ContractPanel = lazy\(\(\) => import\('\.\/ContractPanel'\)\);/);
  assert.match(src('components/creator/DocumentMetaCard.tsx'), /\(s\.boq_terms\?\.cn \|\| s\.ra_no \|\| worksOn\) && <Suspense/);
  for (const f of ['components/onboarding/SetupWizard.tsx', 'components/settings/FeaturesPanel.tsx']) assert.match(src(f), /import\('\.\.\/\.\.\/lib\/construction\/cn-profile'\)/, f);
  assert.ok(!/construction/.test(src('components/templates/parts/PaperItemsTable.tsx')), 'item table reads only the snapshot helper');
});
