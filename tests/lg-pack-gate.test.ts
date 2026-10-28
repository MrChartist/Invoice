/**
 * Round 19 pack gate (R19-A): an existing company sees exactly what it saw — the Shipments desk is listed only with a
 * logistics pack (its URL still opens), the desk and the paper part load only through lazy imports, no Round 19 data is
 * read without the profile, and ordinary documents never touch Round 19 code.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { readChecklistInputs } from '../src/lib/checklist-steps.ts';
import { lgLineText, trackingText } from '../src/components/templates/paper-helpers.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'transport' } as never);
});
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('no Round 19 facts without the profile', () => {
  assert.equal(readChecklistInputs().facts.logistics, undefined);
});

test('hosts load Round 19 code lazily; the paper reads only the snapshot', () => {
  assert.match(src('pages/Time.tsx'), /import\.meta\.glob<[^\n]*>\('\.\.\/components\/logistics\/\*Desk\.tsx'\)/);
  assert.match(src('components/templates/TemplateEngine.tsx'), /lazy\(\(\) => import\('\.\/parts\/LogisticsBlock'\)\)/);
  assert.match(src('components/templates/TemplateEngine.tsx'), /invoice\.lg && layout !== 'receipt'/, 'never on receipt paper');
  for (const f of ['components/onboarding/SetupWizard.tsx', 'components/settings/FeaturesPanel.tsx']) assert.ok(!/from '[^']*lib\/logistics\//.test(src(f)), `${f}: no static logistics engine import`);
  assert.ok(!/logistics\//.test(src('components/templates/paper-helpers.ts').split('\n').filter((l) => l.startsWith('import') && !l.startsWith('import type')).join('\n')));
  assert.ok(!/logistics/.test(src('pages/Time.tsx').split('\n').filter((l) => l.startsWith('import ')).join('\n')), 'Time imports no logistics module statically');
});

test('the profile pickers carry only an explicit pack list (the transport type\'s implied pack is not switched on)', () => {
  assert.match(src('components/onboarding/SetupWizard.tsx'), /applyLogisticsKind\(lgk, \{ registered: a\.gstRegistered, ownLorries: lgPick\.lorries, extra: lgPick\.extra, currentPacks: Array\.isArray\(localDb\.settings\.get\(\)\.industry_packs\)/);
  assert.match(src('components/settings/FeaturesPanel.tsx'), /\(Array\.isArray\(settings\.industry_packs\) \? packsOn : \[\]\)\.filter/);
});

test('ordinary lines print as before; a pure-agent line of a job document says so', () => {
  assert.equal(lgLineText({ charge_head_id: 'rule33' }, undefined), '');
  assert.equal(lgLineText({}, { job_no: 'JOB/FY26-27/0001' }), '');
  assert.equal(lgLineText({ charge_head_id: 'rule33' }, { job_no: 'JOB/FY26-27/0001' }), 'Paid on your behalf — recovered at actual (Rule 33)');
  assert.equal(trackingText({ id: 'l1', batch_no: 'B1' } as never), 'Batch B1');
});
