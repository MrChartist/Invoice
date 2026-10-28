/** R15-B1 travel profile: each kind's type / modules / packs / landing / switches; checklist; existing companies unchanged. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { PRESETS, SERVICE_KINDS, TRAVEL_KINDS, TRAVEL_LANDING, applyServiceKind, applyTravelKind } from '../src/lib/shop-presets.ts';
import { applyTravelSwitches, travelSwitchesFor } from '../src/lib/travel/tv-profile.ts';
import { readTravelSettings, saveTravelSettings } from '../src/lib/travel/tv-settings.ts';
import { PACK_IDS, PACK_OF_TYPE, activePacks, visiblePackTabs } from '../src/lib/industry-packs.ts';
import { PACK_ROUTES } from '../src/lib/shop-mode.ts';
import { PACK_HREF } from '../src/lib/features-catalog.ts';
import { allSteps, readChecklistInputs, type ChecklistCtx, type ChecklistFactsV3 } from '../src/lib/checklist-steps.ts';
import { TIME_TABS } from '../src/pages/page-tabs.ts';
import { setTable } from '../src/lib/storage.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('each kind: services / travel, modules, packs, landing, due 7 days; registered adds gst; packs in union', () => {
  assert.ok((SERVICE_KINDS as readonly string[]).includes('travel'));
  assert.deepEqual([...TRAVEL_KINDS], ['tour_operator', 'agent', 'inbound', 'events', 'other']);
  for (const k of TRAVEL_KINDS) {
    const p = applyTravelKind(k, { registered: true });
    assert.equal(p.business_type, 'services');
    assert.equal(p.service_kind, 'travel');
    assert.equal(p.travel_kind, k);
    assert.equal(p.defaultDueDays, 7);
    for (const m of [...PRESETS.services.filter((x) => x !== 'gst'), 'accounts', 'purchases', 'time', 'gst']) assert.ok(p.modules!.includes(m as never), `${k} ${m}`);
    assert.deepEqual(p.industry_packs, k === 'events' ? ['events'] : ['travel']);
  }
  assert.deepEqual(applyTravelKind('agent').modules!.filter((m) => m === 'gst').length, PRESETS.services.includes('gst') ? 1 : 0, 'registered adds gst once');
  assert.deepEqual(applyTravelKind('events', { alsoTravel: true }).industry_packs, ['events', 'travel']);
  assert.deepEqual(applyTravelKind('tour_operator', { currentPacks: ['practice'] }).industry_packs, ['practice', 'travel'], 'packs in union');
  assert.equal(TRAVEL_LANDING.tour_operator, '/time?tab=trips&view=trips');
  assert.equal(TRAVEL_LANDING.agent, '/time?tab=trips&view=bookings');
  assert.equal(TRAVEL_LANDING.events, '/time?tab=trips&view=events');
  for (const p of ['travel', 'events'] as const) {
    assert.ok(PACK_IDS.includes(p), p);
    assert.equal(PACK_HREF[p], '/time?tab=trips');
  }
});

test('PACK_OF_TYPE / PACK_ROUTES unchanged; a services company without travel_kind sees no desk; the desk follows the pack', () => {
  assert.equal(PACK_OF_TYPE.services, undefined);
  assert.ok(!Object.values(PACK_ROUTES).some((ps) => ps.includes('travel') || ps.includes('events')));
  localDb.settings.save({ ...localDb.settings.get(), ...applyServiceKind('other') });
  const desk = () => visiblePackTabs(TIME_TABS, localDb.settings.get()).map((t) => t.id).filter((id) => id === 'trips');
  assert.deepEqual(desk(), []);
  assert.deepEqual(visiblePackTabs(TIME_TABS, localDb.settings.get(), 'trips').map((t) => t.id).filter((id) => id === 'trips'), ['trips'], 'URL still opens');
  localDb.settings.save({ ...localDb.settings.get(), ...applyTravelKind('events') });
  assert.deepEqual(activePacks(localDb.settings.get()), ['events']);
  assert.deepEqual(desk(), ['trips'], 'events alone lists the desk');
});

test('regime default and switches by kind; a value the user set is kept; settings keep C / D sub-objects', () => {
  assert.equal(travelSwitchesFor('tour_operator').regime_default, 'to5');
  assert.equal(travelSwitchesFor('agent').switches!.pure_agent, true);
  assert.equal(travelSwitchesFor('inbound').switches!.export_chip, true);
  assert.equal(travelSwitchesFor('events').switches!.event_pos, true);
  assert.equal(travelSwitchesFor('tour_operator', { regime_default: 'to18', switches: { itc_block: false } }).regime_default, 'to18');
  assert.equal(travelSwitchesFor('tour_operator', { switches: { itc_block: false } }).switches!.itc_block, false);
  applyTravelSwitches('agent', true);
  assert.deepEqual(readTravelSettings().iata, { bsp: true });
  saveTravelSettings({ statement_maps: { bsp: { doc_no: 'Document' } } });
  assert.equal(readTravelSettings().regime_default, 'agent');
  assert.deepEqual(readTravelSettings().statement_maps, { bsp: { doc_no: 'Document' } });
});

test('checklist steps by kind (none without travel_kind); facts from the data', () => {
  const f: ChecklistFactsV3 = { profileReady: true, clients: 1, items: 1, invoices: 1, messagesSent: 1, payments: 1 };
  const TV = ['firstTrip', 'firstEvent', 'firstSupplier', 'regime', 'firstStatement'];
  const steps = (travelKind?: string) => allSteps(f, { businessType: 'services', serviceKind: 'travel', packs: [], modules: null, role: 'owner', ...(travelKind ? { travelKind } : {}) } as ChecklistCtx).map((s) => s.kind).filter((k) => TV.includes(k));
  assert.deepEqual(steps(), []);
  assert.deepEqual(steps('tour_operator'), ['firstTrip', 'firstSupplier', 'regime']);
  assert.deepEqual(steps('agent'), ['firstTrip', 'firstSupplier', 'firstStatement']);
  assert.deepEqual(steps('events'), ['firstTrip', 'firstEvent', 'firstSupplier']);
  localDb.settings.save({ ...localDb.settings.get(), ...applyTravelKind('agent') });
  setTable('cost_centres', [{ id: 'c', name: 'Goa', kind: 'project', active: true, created_at: '', tv: { code: '2611-001', kind: 'trip' } }]);
  setTable('import_runs', [{ id: 'r', at: '', kind: 'supplier_statement', created: 4, updated: 0, skipped: 0, errors: 0 }]);
  const t = readChecklistInputs().facts.travel!;
  assert.deepEqual([t.firstTrip, t.firstEvent, t.firstSupplier, t.regime, t.firstStatement], [1, 0, 0, 0, 1]);
  saveTravelSettings({ regime_ok: true });
  assert.equal(readChecklistInputs().facts.travel!.regime, 1);
});
