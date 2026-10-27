/** CN-A1 construction profile: kinds' modules / packs / landing / switches, checklist steps, existing contractor companies. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { CONSTRUCTION_KINDS, CONSTRUCTION_PROFILES, PRESETS, applyConstructionKind, isConstructionKind } from '../src/lib/shop-presets.ts';
import { applyConstructionSwitches, constructionSwitchesFor } from '../src/lib/construction/cn-profile.ts';
import { readConstructionSettings, saveConstructionSettings, worksViewOn } from '../src/lib/construction/cn-settings.ts';
import { PACK_IDS, PACK_OF_TYPE, activePacks } from '../src/lib/industry-packs.ts';
import { PACK_HREF, FEATURE_ROWS } from '../src/lib/features-catalog.ts';
import { allSteps, type ChecklistCtx, type ChecklistFactsV3 } from '../src/lib/checklist-steps.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('each kind: modules, packs, landing, template, due days; registered adds gst; every kind keeps `time`', () => {
  assert.deepEqual([...CONSTRUCTION_KINDS], ['civil', 'subcontractor', 'builder', 'interiors', 'mep', 'labour', 'other']);
  assert.deepEqual(applyConstructionKind('civil'), { business_type: 'contractor', modules: [...PRESETS.contractor], construction_kind: 'civil', industry_packs: ['works'] });
  assert.deepEqual(applyConstructionKind('builder').industry_packs, ['realty', 'works']);
  assert.ok(applyConstructionKind('builder').modules!.includes('recurring'));
  assert.ok(!applyConstructionKind('interiors').modules!.includes('payroll'));
  assert.deepEqual(applyConstructionKind('labour').modules, ['purchases', 'accounts', 'banking', 'reports', 'gst', 'tds', 'payroll', 'time']);
  assert.equal(applyConstructionKind('other').industry_packs, undefined, 'other = today: the implied works pack');
  assert.deepEqual(applyConstructionKind('other').modules, [...PRESETS.contractor]);
  for (const k of CONSTRUCTION_KINDS) {
    assert.ok(applyConstructionKind(k).modules!.includes('time'), `${k} keeps /time (PACK_ROUTES unchanged)`);
    assert.ok(applyConstructionKind(k, { registered: true }).modules!.includes('gst'));
  }
  assert.equal(CONSTRUCTION_PROFILES.civil.landing, '/time?tab=works&view=contracts');
  assert.equal(CONSTRUCTION_PROFILES.builder.landing, '/receivables?tab=realty');
  assert.equal(CONSTRUCTION_PROFILES.interiors.defaultDueDays, 15);
  assert.equal(CONSTRUCTION_PROFILES.mep.templateId, 'gst_tax_invoice');
  assert.ok(isConstructionKind('mep') && !isConstructionKind('contractor'));
});

test('the realty pack id; PACK_OF_TYPE unchanged (contractor implies works); features rows', () => {
  assert.ok((PACK_IDS as readonly string[]).includes('realty'));
  assert.deepEqual(PACK_OF_TYPE.contractor, ['works']);
  assert.equal(PACK_HREF.realty, '/receivables?tab=realty');
  assert.ok(FEATURE_ROWS.some((r) => r.id === 'pack.realty'));
  const row = FEATURE_ROWS.find((r) => r.id === 'adv.construction')!;
  assert.equal(row.isOn({ construction_kind: 'civil' } as never), true);
  assert.equal(row.isOn({} as never), false);
});

test('switches by kind; government switches; views only ever added; audited', () => {
  assert.deepEqual(constructionSwitchesFor('civil', { government: true }), {
    ra_paper: 'pwd', views: { contracts: true, advances: true, escalation: true, guarantees: true, subcon: true, plant: true, labour: true, reco: true }, mb_column: true, government: true, signoff_boxes: true,
  });
  assert.equal(constructionSwitchesFor('civil').ra_paper, 'standard', 'pwd only for civil + government');
  assert.equal(constructionSwitchesFor('civil').signoff_boxes, undefined);
  assert.deepEqual(constructionSwitchesFor('other'), {});
  assert.deepEqual(constructionSwitchesFor('interiors'), { ra_paper: 'standard', split_caution: true, photo_pages: true });
  assert.equal(constructionSwitchesFor('labour').manpower_preset, true);
  assert.deepEqual(constructionSwitchesFor('mep', {}, { views: { pnl: true } }).views, { pnl: true, contracts: true, subcon: true, guarantees: true }, 'existing views kept');
  applyConstructionSwitches('builder');
  const s = readConstructionSettings();
  assert.ok(worksViewOn(s, 'pnl') && !worksViewOn(s, 'plant'));
  assert.ok(getTable<{ summary: string }>('audit_log').some((a) => /Construction profile:/.test(a.summary)), 'audited');
  saveConstructionSettings({ deviation_pct: 500 as never });
  assert.equal(readConstructionSettings().deviation_pct, undefined, 'out-of-range value dropped');
});

test('an existing contractor company (no construction_kind) is unchanged', () => {
  localDb.settings.save({ ...localDb.settings.get(), business_type: 'contractor', modules: [...PRESETS.contractor] });
  const s = localDb.settings.get();
  assert.equal(s.construction_kind, undefined);
  assert.deepEqual(activePacks(s), ['works']);
  assert.deepEqual(readConstructionSettings(), {});
});

const none: ChecklistFactsV3 = { profileReady: false, clients: 0, items: 0, invoices: 0, messagesSent: 0, payments: 0 };
const ctx = (constructionKind?: string): ChecklistCtx => ({ businessType: 'contractor', packs: ['works'], modules: null, role: 'owner', ...(constructionKind ? { constructionKind } : {}) });
const keys = (c: ChecklistCtx, f: ChecklistFactsV3 = none) => allSteps(f, c).filter((s) => !s.done).map((s) => s.key);

test('checklist steps by kind', () => {
  assert.ok(keys(ctx()).includes('constructionProfile'));
  assert.ok(!keys(ctx('civil')).includes('constructionProfile'));
  assert.ok(keys(ctx('civil')).includes('contract') && keys(ctx('civil')).includes('boq'));
  assert.ok(keys(ctx('mep')).includes('contract'));
  assert.deepEqual(['realtyProject', 'units', 'paymentPlan'].filter((k) => keys(ctx('builder')).includes(k)), ['realtyProject', 'units', 'paymentPlan']);
  assert.ok(keys(ctx('labour')).includes('labourContract'));
  assert.ok(keys(ctx('subcontractor')).includes('boq') && !keys(ctx('subcontractor')).includes('contract'));
  assert.ok(!keys(ctx('civil'), { ...none, boqs: 1 }).includes('boq'), 'done by data');
  assert.ok(!keys(ctx('other')).some((k) => ['contract', 'boq', 'labourContract'].includes(k)));
});
