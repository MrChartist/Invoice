/**
 * PENDING #22 (CN-A1): the construction settings switches form — the patch it saves (blank clears, bad % refused), the
 * saved switches read back, Works views kept, and the lazy form mounted under the picker in Settings → Features.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { constructionFormPatch, readConstructionSettings, saveConstructionSettings, type ConstructionForm } from '../src/lib/construction/cn-settings.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const form = (over: Partial<ConstructionForm> = {}): ConstructionForm => ({
  ra_paper: 'pwd', mb_column: true, government: true, certificate: true, certificate_text: '  Work done as per drawings.  ', signoff_boxes: true,
  deviation_pct: '30', split_caution: false, photo_pages: false, manpower_preset: false, labour_withhold_pct: '', ...over,
});

test('the form patch: numbers parsed, blanks cleared, bad % refused', () => {
  const p = constructionFormPatch(form());
  assert.deepEqual([p.ra_paper, p.deviation_pct, p.certificate_text, p.labour_withhold_pct], ['pwd', 30, 'Work done as per drawings.', undefined]);
  assert.throws(() => constructionFormPatch(form({ deviation_pct: '120' })), /deviation limit/);
  assert.throws(() => constructionFormPatch(form({ labour_withhold_pct: 'x' })), /labour hold/);
});

test('saved switches read back; the profile views stay', () => {
  saveConstructionSettings({ views: { contracts: true }, deviation_pct: 25, certificate_text: 'Old' });
  saveConstructionSettings(constructionFormPatch(form({ certificate_text: '', deviation_pct: '', labour_withhold_pct: '15' })));
  const s = readConstructionSettings();
  assert.deepEqual([s.ra_paper, s.mb_column, s.government, s.signoff_boxes, s.labour_withhold_pct], ['pwd', true, true, true, 15]);
  assert.equal(s.deviation_pct, undefined, 'blank = the default limit');
  assert.equal(s.certificate_text, undefined, 'blank = the standard certificate');
  assert.deepEqual(s.views, { contracts: true });
  const panel = readFileSync(new URL('../src/components/settings/FeaturesPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /lazy\(\(\) => import\('\.\.\/construction\/ConstructionSettingsForm'\)\)/);
});
