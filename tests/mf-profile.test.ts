/** MF-A1 manufacturing profile: each kind's type / modules / packs / landing / switches; checklist steps; existing companies unchanged. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { MFG_KINDS, MFG_PROFILES, PRESETS, applyAgriKind, applyMfgKind } from '../src/lib/shop-presets.ts';
import { applyMfgSwitches, mfgSwitchesFor } from '../src/lib/mfg/mf-profile.ts';
import { readMfgSettings, rejectReasons, saveMfgSettings } from '../src/lib/mfg/mf-settings.ts';
import { PACK_OF_TYPE, activePacks, visibleTabs } from '../src/lib/industry-packs.ts';
import { PACK_ROUTES } from '../src/lib/shop-mode.ts';
import { PACK_HREF } from '../src/lib/features-catalog.ts';
import { allSteps, type ChecklistCtx, type ChecklistFactsV3 } from '../src/lib/checklist-steps.ts';
import { MFG_PACK_TABS } from '../src/pages/page-tabs.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('each kind: type, modules, packs, landing, sub-choice; registered adds gst; inventory and payroll kept', () => {
  assert.deepEqual([...MFG_KINDS], ['engineering', 'textile', 'plastics', 'printing', 'food', 'other']);
  const e = applyMfgKind('engineering');
  assert.deepEqual([e.business_type, e.industry_packs, e.mfg_sub], ['manufacturer', ['shopfloor', 'fabrication'], 'drawing']);
  assert.deepEqual(applyMfgKind('textile', { sub: 'yarn' }).mfg_sub, 'yarn');
  assert.deepEqual(applyMfgKind('textile', { sub: 'nonsense' }).mfg_sub, 'garments');
  assert.deepEqual(applyMfgKind('plastics').industry_packs, ['shopfloor', 'plastics']);
  assert.deepEqual(applyMfgKind('printing').industry_packs, ['shopfloor', 'press']);
  assert.ok(applyMfgKind('food').modules!.includes('pos'));
  assert.deepEqual(applyMfgKind('other', { currentPacks: ['works'] }), { mfg_kind: 'other', industry_packs: ['works', 'shopfloor'] }, 'other: type and modules unchanged');
  for (const k of MFG_KINDS.filter((x) => x !== 'other')) {
    const p = applyMfgKind(k, { registered: true });
    for (const m of ['gst', 'inventory', 'payroll'] as const) assert.ok(p.modules!.includes(m), `${k}: ${m}`);
    assert.ok(p.industry_packs.includes('shopfloor'));
  }
  assert.deepEqual(applyMfgKind('engineering').modules, [...PRESETS.manufacturer]);
  assert.equal(MFG_PROFILES.engineering.landing, '/manufacturing?tab=floor&view=cards');
  assert.equal(MFG_PROFILES.textile.landing, '/manufacturing?tab=garments&view=styles');
  assert.equal(MFG_PROFILES.food.defaultDueDays, 15);
  for (const p of ['shopfloor', 'fabrication', 'garments', 'plastics', 'press', 'foodmfg'] as const) assert.match(PACK_HREF[p], /^\/manufacturing\?tab=/);
});

test('packs union with an agri company; PACK_OF_TYPE / PACK_ROUTES unchanged; existing manufacturers see no desk', () => {
  const mill = applyAgriKind('mill');
  const both = applyMfgKind('food', { currentPacks: mill.industry_packs });
  assert.deepEqual(both.industry_packs, ['agri', 'mill', 'commodity', 'shopfloor', 'foodmfg']);
  assert.equal(PACK_OF_TYPE.manufacturer, undefined);
  assert.ok(!Object.keys(PACK_ROUTES).includes('/manufacturing'));
  localDb.settings.save({ ...localDb.settings.get(), business_type: 'manufacturer' });
  assert.deepEqual(activePacks(localDb.settings.get()), []);
  assert.deepEqual(visibleTabs(MFG_PACK_TABS, localDb.settings.get()).map((t) => t.id), []);
  localDb.settings.save({ ...localDb.settings.get(), ...applyMfgKind('engineering') });
  assert.deepEqual(visibleTabs(MFG_PACK_TABS, localDb.settings.get()).map((t) => t.id), ['floor', 'shop', 'statutory'], 'Floor, Shop and Statutory desks only');
});

test('switches: filled per kind, a switch the user set is kept; settings keep B–D sub-objects', () => {
  assert.equal(mfgSwitchesFor('textile', {}, 'yarn').switches!.cut_plans, undefined, 'cut plans for garment units only');
  assert.equal(mfgSwitchesFor('textile', {}, 'garments').switches!.cut_plans, true);
  assert.equal(mfgSwitchesFor('engineering', { switches: { drawings: false } }).switches!.drawings, false);
  applyMfgSwitches('food');
  assert.equal(readMfgSettings().switches!.shelf_life, true);
  saveMfgSettings({ reject_reasons: ['Crack', ' ', 'Crack'], ...({ moulds: [{ id: 'm1' }] } as object) });
  assert.deepEqual(rejectReasons(), ['Crack']);
  assert.deepEqual((readMfgSettings() as { moulds?: unknown }).moulds, [{ id: 'm1' }], 'object-valued keys of B–D kept');
  assert.equal(readMfgSettings().switches!.shelf_life, true, 'other fields kept');
});

test('checklist steps by kind (none without mfg_kind)', () => {
  const f: ChecklistFactsV3 = { profileReady: true, clients: 1, items: 1, invoices: 1, messagesSent: 1, payments: 1 };
  const MF = ['workCentres', 'udyam', 'firstDrawing', 'firstStyle', 'fabricators', 'firstMould', 'pressMaster', 'fssai', 'shelfLife'];
  const steps = (mfgKind?: string) => allSteps(f, { businessType: 'manufacturer', packs: [], modules: null, role: 'owner', ...(mfgKind ? { mfgKind } : {}) } as ChecklistCtx).map((s) => s.kind).filter((k) => MF.includes(k));
  assert.deepEqual(steps(), []);
  assert.deepEqual(steps('engineering'), ['workCentres', 'udyam', 'firstDrawing']);
  assert.deepEqual(steps('textile'), ['workCentres', 'udyam', 'firstStyle', 'fabricators']);
  assert.deepEqual(steps('plastics'), ['workCentres', 'udyam', 'firstMould']);
  assert.deepEqual(steps('printing'), ['workCentres', 'udyam', 'pressMaster']);
  assert.deepEqual(steps('food'), ['workCentres', 'udyam', 'fssai', 'shelfLife']);
  assert.deepEqual(steps('other'), ['workCentres', 'udyam']);
});
