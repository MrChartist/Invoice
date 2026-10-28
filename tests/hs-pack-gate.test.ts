/**
 * Round 18 pack gate (R18-A): an existing company sees exactly what it saw — the Society desk is listed only with the
 * `society` pack (its URL still opens), the desk and the paper part load only through lazy imports, no Round 18 data is
 * read without the profile, and ordinary documents never touch Round 18 code.
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
  installSettings({ business_type: 'nonprofit' } as never);
});
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('no Round 18 facts without the profile', () => {
  assert.equal(readChecklistInputs().facts.society, undefined);
});

test('hosts load Round 18 code lazily; the paper reads only the snapshot', () => {
  assert.match(src('pages/Recurring.tsx'), /lazy\(\(\) => import\('\.\.\/components\/society\/SocietyDesk'\)\)/);
  assert.match(src('components/templates/TemplateEngine.tsx'), /lazy\(\(\) => import\('\.\/parts\/SocietyBlock'\)\)/);
  assert.match(src('components/templates/TemplateEngine.tsx'), /invoice\.hs && layout !== 'receipt'/, 'never on receipt paper');
  for (const f of ['components/onboarding/SetupWizard.tsx', 'components/settings/FeaturesPanel.tsx']) assert.ok(!/from '[^']*lib\/society\//.test(src(f)), `${f}: no static society engine import`);
  assert.ok(!/society\//.test(src('components/templates/paper-helpers.ts').split('\n').filter((l) => l.startsWith('import') && !l.startsWith('import type')).join('\n')));
});
