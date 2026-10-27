/** PS-A1 professional profile: each kind's type / modules / packs / landing / switches; firm form; checklist; existing companies unchanged. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { PROF_KINDS, PROF_PROFILES, PRESETS, applyProfKind, applyServiceKind } from '../src/lib/shop-presets.ts';
import { applyProfSwitches, profSwitchesFor, readFirmForm, writeFirmForm } from '../src/lib/prof/ps-profile.ts';
import { readProfSettings, saveProfSettings, wipRules } from '../src/lib/prof/ps-settings.ts';
import { PACK_IDS, PACK_OF_TYPE, activePacks, visiblePackTabs } from '../src/lib/industry-packs.ts';
import { PACK_ROUTES } from '../src/lib/shop-mode.ts';
import { PACK_HREF } from '../src/lib/features-catalog.ts';
import { allSteps, type ChecklistCtx, type ChecklistFactsV3 } from '../src/lib/checklist-steps.ts';
import { TIME_TABS } from '../src/pages/page-tabs.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('each kind: services / professional, modules, packs, landing; registered adds gst; partnership / LLP adds partners; exports add svcexport', () => {
  assert.deepEqual([...PROF_KINDS], ['ca', 'legal', 'design', 'consulting', 'agency', 'freelancer', 'other']);
  for (const k of PROF_KINDS) {
    const p = applyProfKind(k, { registered: true });
    assert.equal(p.business_type, 'services');
    assert.equal(p.service_kind, 'professional');
    assert.ok(p.modules!.includes('time') && p.modules!.includes('gst'), k);
    assert.ok(p.industry_packs.includes('practice'), k);
  }
  assert.deepEqual(applyProfKind('legal').industry_packs, ['practice', 'legal']);
  assert.deepEqual(applyProfKind('ca', { firmForm: 'partnership' }).industry_packs, ['practice', 'cafirm', 'partners']);
  assert.deepEqual(applyProfKind('consulting', { sub: 'exports', firmForm: 'llp' }).industry_packs, ['practice', 'svcexport', 'partners']);
  assert.deepEqual(applyProfKind('agency').industry_packs, ['practice', 'media']);
  assert.equal(applyProfKind('legal', { sub: 'nonsense' }).prof_sub, 'litigation');
  assert.equal(applyProfKind('other').prof_sub, undefined);
  assert.ok(applyProfKind('ca').modules!.includes('accounts'));
  assert.deepEqual(applyProfKind('freelancer').modules, [...PRESETS.services]);
  assert.deepEqual(applyProfKind('design', { currentPacks: ['works'] }).industry_packs, ['works', 'practice', 'design'], 'packs in union');
  assert.equal(PROF_PROFILES.consulting.landing, '/time?tab=wip&view=wip');
  assert.equal(PROF_PROFILES.legal.defaultDueDays, 15);
  for (const p of ['practice', 'cafirm', 'legal', 'design', 'media', 'svcexport', 'partners'] as const) {
    assert.ok(PACK_IDS.includes(p), p);
    assert.match(PACK_HREF[p], /^\/time\?tab=/);
  }
});

test('PACK_OF_TYPE / PACK_ROUTES unchanged; a services company without prof_kind sees no desk; the desks follow the pack', () => {
  assert.equal(PACK_OF_TYPE.services, undefined);
  assert.ok(!Object.values(PACK_ROUTES).some((ps) => ps.includes('practice')));
  const r10 = applyServiceKind('professional');
  localDb.settings.save({ ...localDb.settings.get(), ...r10 });
  assert.deepEqual(activePacks(localDb.settings.get()), []);
  assert.deepEqual(visiblePackTabs(TIME_TABS, localDb.settings.get()).map((t) => t.id).filter((id) => id === 'matters' || id === 'wip'), []);
  localDb.settings.save({ ...localDb.settings.get(), ...applyProfKind('consulting') });
  assert.deepEqual(visiblePackTabs(TIME_TABS, localDb.settings.get()).map((t) => t.id).filter((id) => id === 'matters' || id === 'wip'), ['matters', 'wip']);
});

test('switches fill only unset ones; ids saved; settings keep B–D sub-objects; WIP reasons and buckets', () => {
  assert.equal(profSwitchesFor('legal', { switches: { conflict_first: false } }).switches!.conflict_first, false);
  assert.equal(profSwitchesFor('consulting', {}, 'exports').switches!.export_check, true);
  applyProfSwitches('legal', 'litigation', { enrolment: ' D/1234/2010 ', bar_council: 'Delhi' });
  assert.deepEqual(readProfSettings().legal, { enrolment: 'D/1234/2010', bar_council: 'Delhi' });
  assert.equal(readProfSettings().switches!.client_money, true);
  saveProfSettings({ wip: { reasons: ['Cap', ' ', 'Cap'], buckets: [60, 30, -1] }, ...({ partners_cfg: { ratio: [1, 1] } } as object) });
  assert.deepEqual(wipRules(), { reasons: ['Cap'], buckets: [30, 60] });
  assert.deepEqual((readProfSettings() as { partners_cfg?: unknown }).partners_cfg, { ratio: [1, 1] }, 'object-valued keys of B–D kept');
});

test('the firm form is the annual pack entity type (one value)', async () => {
  assert.equal(readFirmForm(), undefined);
  await writeFirmForm('partnership', '2026-06-01');
  assert.equal(readFirmForm(), 'partnership');
  assert.equal(localDb.settings.get().prof_kind, undefined);
});

test('checklist steps by kind (none without prof_kind)', () => {
  const f: ChecklistFactsV3 = { profileReady: true, clients: 1, items: 1, invoices: 1, messagesSent: 1, payments: 1 };
  const PS = ['firstMatter', 'staffCapacity', 'enrolment', 'conflictCheck'];
  const steps = (profKind?: string) => allSteps(f, { businessType: 'services', serviceKind: 'professional', packs: [], modules: null, role: 'owner', ...(profKind ? { profKind } : {}) } as ChecklistCtx).map((s) => s.kind).filter((k) => PS.includes(k));
  assert.deepEqual(steps(), []);
  assert.deepEqual(steps('consulting'), ['firstMatter', 'staffCapacity']);
  assert.deepEqual(steps('legal'), ['firstMatter', 'staffCapacity', 'enrolment', 'conflictCheck']);
});
