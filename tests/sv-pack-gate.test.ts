/**
 * Round 10 pack gate (SV-A): an existing company sees exactly what it saw — the service desks are listed only with a
 * service pack (their URLs still open), the editor / POS / desk parts load only through `lazy(() => import(…))`, the
 * service hooks load only for a service company, and ordinary documents never touch Round 10 code.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { visiblePackTabs } from '../src/lib/industry-packs.ts';
import { TIME_TABS } from '../src/pages/page-tabs.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'services' } as never);
});
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('an existing services company: no desk tab listed', () => {
  const s = localDb.settings.get();
  assert.ok(!visiblePackTabs(TIME_TABS, s).some((t) => ['appointments', 'commission', 'clinic', 'members', 'workshop'].includes(t.id)));
  localDb.settings.save({ ...s, service_kind: 'salon', industry_packs: ['salon'] });
  assert.ok(visiblePackTabs(TIME_TABS, localDb.settings.get()).some((t) => t.id === 'appointments'));
});

test('hosts load Round 10 code lazily', () => {
  assert.match(src('pages/Time.tsx'), /const FrontDesk = lazy\(\(\) => import\('\.\.\/components\/services-r10\/FrontDesk'\)\);/);
  assert.match(src('pages/Time.tsx'), /const R10Stub = lazy\(/);
  assert.match(src('components/creator/ItemsTable.tsx'), /const SvLineRow = lazy\(\(\) => import\('\.\.\/services-r10\/SvEditor'\)/);
  assert.match(src('components/creator/ItemsTable.tsx'), /\(svOn \|\| !!item\.sv\) && <Suspense/);
  assert.match(src('pages/Pos.tsx'), /const PosAppointment = lazy\(\(\) => import\('\.\.\/components\/services-r10\/PosAppointment'\)\);/);
  for (const f of ['components/onboarding/SetupWizard.tsx', 'components/settings/FeaturesPanel.tsx']) assert.match(src(f), /import\('\.\.\/\.\.\/lib\/services\/sv-profile'\)/, f);
  for (const f of ['lib/bill-guard.ts', 'lib/gst-guards.ts']) {
    assert.match(src(f), /if \(svOn\) void import\('\.\/services\/sv-hooks'\)\.then/, f);
    assert.ok(!/from '\.\/services\/sv-(tax|hooks)'/.test(src(f)), `${f} never imports the service engines statically`);
  }
  assert.ok(!/from '\.\.\/(bill-guard|gst-guards)'/.test(src('lib/services/sv-hooks.ts')), 'no static cycle back to the hosts (no shared chunk)');
  assert.ok(!/services/.test(src('components/templates/paper-helpers.ts').split('\n').filter((l) => l.startsWith('import')).join('\n')), 'the paper reads only the snapshot');
});
