/** AG-A1 agri profile: each kind's type / modules / packs / landing / switches; checklist steps; existing companies unchanged. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { AGRI_KINDS, AGRI_PROFILES, PRESETS, applyAgriKind } from '../src/lib/shop-presets.ts';
import { agriSwitchesFor, applyAgriSwitches } from '../src/lib/agri/ag-profile.ts';
import { readAgriSettings, saveAgriSettings } from '../src/lib/agri/ag-settings.ts';
import { PACK_OF_TYPE, activePacks, visibleTabs } from '../src/lib/industry-packs.ts';
import { PACK_HREF } from '../src/lib/features-catalog.ts';
import { allSteps, type ChecklistCtx, type ChecklistFactsV3 } from '../src/lib/checklist-steps.ts';
import { INVENTORY_PACK_TABS } from '../src/pages/page-tabs.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('each kind: type, modules, packs, landing; registered adds gst; inputs sets retail_kind general', () => {
  assert.deepEqual([...AGRI_KINDS], ['fpo', 'coop', 'dairy', 'mill', 'cold', 'inputs', 'farm', 'other']);
  assert.deepEqual(applyAgriKind('dairy'), { agri_kind: 'dairy', industry_packs: ['agri', 'dairy'], business_type: 'manufacturer', modules: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'pos', 'recurring'] });
  assert.deepEqual(applyAgriKind('fpo').industry_packs, ['agri', 'fpo', 'commodity']);
  assert.deepEqual(applyAgriKind('mill', { mill_kind: 'dal' }).mill_kind, 'dal');
  assert.equal(applyAgriKind('mill').mill_kind, 'rice');
  assert.deepEqual(applyAgriKind('mill').modules, [...PRESETS.manufacturer]);
  assert.deepEqual(applyAgriKind('cold').industry_packs, ['agri', 'coldstore']);
  const inp = applyAgriKind('inputs');
  assert.deepEqual([inp.business_type, inp.retail_kind, inp.industry_packs], ['kirana', 'general', ['agri', 'agri_inputs']]);
  assert.deepEqual(applyAgriKind('other', { currentPacks: ['works'] }), { agri_kind: 'other', industry_packs: ['works', 'agri'] }, 'other: type and modules unchanged, agri added');
  for (const k of AGRI_KINDS) {
    const p = applyAgriKind(k, { registered: true });
    if (k !== 'other') assert.ok(p.modules!.includes('gst') && p.modules!.includes('inventory'), `${k}: gst when registered; inventory kept (PACK_ROUTES unchanged)`);
    assert.ok(p.industry_packs.includes('agri'), `${k} turns on agri`);
  }
  assert.equal(AGRI_PROFILES.dairy.landing, '/inventory?tab=dairy&view=collection');
  assert.equal(AGRI_PROFILES.mill.landing, '/inventory?tab=mill&view=intake');
  assert.equal(AGRI_PROFILES.farm.landing, '/inventory?tab=farm&view=batches');
  for (const p of ['agri', 'dairy', 'mill', 'coldstore', 'agri_inputs', 'fpo'] as const) assert.match(PACK_HREF[p], /^\/inventory\?tab=/);
});

test('PACK_OF_TYPE unchanged; existing manufacturer / kirana companies see no agri tab', () => {
  assert.equal(PACK_OF_TYPE.manufacturer, undefined);
  assert.equal(PACK_OF_TYPE.kirana, undefined);
  for (const t of ['manufacturer', 'kirana'] as const) {
    localDb.settings.save({ ...localDb.settings.get(), business_type: t });
    assert.deepEqual(activePacks(localDb.settings.get()), []);
    assert.deepEqual(visibleTabs(INVENTORY_PACK_TABS, localDb.settings.get()).map((x) => x.id), []);
  }
  localDb.settings.save({ ...localDb.settings.get(), ...applyAgriKind('mill') });
  assert.deepEqual(visibleTabs(INVENTORY_PACK_TABS, localDb.settings.get()).map((x) => x.id), ['farm', 'mill'], 'Farm and Mill desks only');
});

test('switches: filled per kind, a switch the user set is kept; cycles default by kind', () => {
  assert.deepEqual(agriSwitchesFor('dairy', {}).cycles, { length: '10day', pay_lag_days: 2 });
  assert.equal(agriSwitchesFor('dairy', { switches: { analyser: false } }).switches!.analyser, false);
  applyAgriSwitches('farm');
  assert.equal(readAgriSettings().switches!.batches, true);
  saveAgriSettings({ centres: [{ id: '', name: 'Rampur', kind: 'milk' }] });
  assert.equal(readAgriSettings().centres![0].name, 'Rampur');
  assert.ok(readAgriSettings().centres![0].id, 'an id is given');
  assert.equal(readAgriSettings().switches!.batches, true, 'other fields kept');
});

test('checklist steps by kind (none without agri_kind)', () => {
  const f: ChecklistFactsV3 = { profileReady: true, clients: 1, items: 1, invoices: 1, messagesSent: 1, payments: 1 };
  const steps = (agriKind?: string, millKind?: string) => allSteps(f, { businessType: 'manufacturer', packs: [], modules: null, role: 'owner', ...(agriKind ? { agriKind } : {}), ...(millKind ? { millKind } : {}) } as ChecklistCtx).map((s) => s.kind);
  const AG = ['farmers', 'rateChart', 'firstShift', 'millBom', 'cmrAgreement', 'chambers', 'rentPlan', 'agriLicence', 'shareCapital', 'farmBatch'];
  assert.deepEqual(steps().filter((k) => AG.includes(k)), []);
  assert.deepEqual(steps('dairy').filter((k) => AG.includes(k)), ['farmers', 'rateChart', 'firstShift']);
  assert.deepEqual(steps('mill').filter((k) => AG.includes(k)), ['farmers', 'millBom', 'cmrAgreement']);
  assert.deepEqual(steps('mill', 'flour').filter((k) => AG.includes(k)), ['farmers', 'millBom'], 'CMR for rice mills only');
  assert.deepEqual(steps('cold').filter((k) => AG.includes(k)), ['farmers', 'chambers', 'rentPlan']);
  assert.deepEqual(steps('inputs').filter((k) => AG.includes(k)), ['farmers', 'agriLicence']);
  assert.deepEqual(steps('coop').filter((k) => AG.includes(k)), ['farmers', 'shareCapital']);
  assert.deepEqual(steps('farm').filter((k) => AG.includes(k)), ['farmers', 'farmBatch']);
});
