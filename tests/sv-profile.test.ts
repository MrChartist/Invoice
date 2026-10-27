/** SV-A1 service profile: kinds' modules / packs / landing / switches, checklist steps, existing services companies, TIME_TABS. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { PRESETS, SERVICE_KINDS, SERVICE_PROFILES, applyServiceKind, isServiceKind } from '../src/lib/shop-presets.ts';
import { applyServiceSwitches, serviceSwitchesFor } from '../src/lib/services/sv-profile.ts';
import { readServiceSettings, saveServiceSettings } from '../src/lib/services/sv-settings.ts';
import { PACK_IDS, PACK_OF_TYPE, activePacks, visiblePackTabs } from '../src/lib/industry-packs.ts';
import { PACK_HREF, FEATURE_ROWS } from '../src/lib/features-catalog.ts';
import { allSteps, type ChecklistCtx, type ChecklistFactsV3 } from '../src/lib/checklist-steps.ts';
import { TIME_TABS } from '../src/pages/page-tabs.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('each kind: modules, packs, landing, template, due days; every kind keeps `time`; coaching keeps `recurring`', () => {
  assert.deepEqual([...SERVICE_KINDS], ['clinic', 'lab', 'salon', 'fitness', 'coaching', 'workshop', 'appliance', 'professional', 'other']);
  assert.deepEqual(applyServiceKind('salon'), { business_type: 'services', modules: ['pos', 'time', 'purchases', 'inventory', 'reports', 'payroll'], service_kind: 'salon', industry_packs: ['salon'] });
  assert.deepEqual(applyServiceKind('clinic').industry_packs, ['clinic']);
  assert.deepEqual(applyServiceKind('lab').industry_packs, ['clinic']);
  assert.deepEqual(applyServiceKind('fitness').industry_packs, ['fitness']);
  assert.deepEqual(applyServiceKind('coaching').industry_packs, ['fees']);
  assert.deepEqual(applyServiceKind('appliance').industry_packs, ['workshop']);
  assert.deepEqual(applyServiceKind('professional'), { business_type: 'services', modules: [...PRESETS.services], service_kind: 'professional', industry_packs: [] }, "professional = today's preset");
  assert.ok(applyServiceKind('other').modules!.includes('pos'));
  for (const k of SERVICE_KINDS) {
    assert.ok(applyServiceKind(k).modules!.includes('time'), `${k} keeps /time (PACK_ROUTES unchanged)`);
    assert.ok(applyServiceKind(k, { registered: true }).modules!.includes('gst'), `${k} registered adds gst`);
  }
  assert.ok(applyServiceKind('coaching').modules!.includes('recurring'));
  assert.equal(SERVICE_PROFILES.salon.landing, '/time?tab=appointments');
  assert.equal(SERVICE_PROFILES.lab.landing, '/time?tab=clinic&view=lab');
  assert.equal(SERVICE_PROFILES.fitness.landing, '/time?tab=members');
  assert.equal(SERVICE_PROFILES.coaching.landing, '/recurring?tab=fees&view=batches');
  assert.equal(SERVICE_PROFILES.coaching.defaultDueDays, 10);
  assert.equal(SERVICE_PROFILES.workshop.templateId, 'gst_tax_invoice');
  assert.ok(isServiceKind('gym') === false && isServiceKind('fitness'));
});

test('pharmacy (clinic only) adds inventory and the R9 pharmacy pack', () => {
  const c = applyServiceKind('clinic', { pharmacy: true });
  assert.ok(c.modules!.includes('inventory'));
  assert.deepEqual(c.industry_packs, ['clinic', 'pharmacy']);
  assert.ok(PACK_IDS.includes('pharmacy'));
  assert.deepEqual(applyServiceKind('salon', { pharmacy: true }).industry_packs, ['salon'], 'only the clinic asks');
});

test('pack ids, no implied pack for `services`, features rows', () => {
  for (const p of ['clinic', 'salon', 'fitness', 'workshop'] as const) {
    assert.ok(PACK_IDS.includes(p));
    assert.ok(PACK_HREF[p].startsWith('/time?tab='));
    assert.ok(FEATURE_ROWS.some((r) => r.id === `pack.${p}`));
  }
  assert.equal(PACK_OF_TYPE.services, undefined);
  assert.deepEqual(activePacks({ business_type: 'services' }), []);
  assert.ok(FEATURE_ROWS.some((r) => r.id === 'adv.serviceProfile'));
});

test('switches fill unset ones only; existing services company unchanged', () => {
  assert.deepEqual(serviceSwitchesFor('salon'), { staff_required: true, itc_caution: true, no_itc_as_exempt: true });
  assert.deepEqual(serviceSwitchesFor('clinic', { rule46a: false }).rule46a, false, 'a switch the user turned off stays off');
  assert.equal(serviceSwitchesFor('fitness').checkin_gate, 'warn');
  assert.deepEqual(serviceSwitchesFor('professional'), {});
  assert.deepEqual(readServiceSettings(), {}, 'nothing written for an existing company');
  saveServiceSettings({ itc_caution: false });
  applyServiceSwitches('salon');
  const s = readServiceSettings();
  assert.equal(s.itc_caution, false);
  assert.equal(s.staff_required, true);
  assert.equal(localDb.settings.get().service_kind, undefined);
});

const facts: ChecklistFactsV3 = { profileReady: true, clients: 1, items: 1, invoices: 1, messagesSent: 1, payments: 1, lastBackup: 'x' };
const ctx = (over: Partial<ChecklistCtx>): ChecklistCtx => ({ businessType: 'services', packs: [], modules: null, role: 'owner', ...over });
const kinds = (c: ChecklistCtx) => allSteps(facts, c).map((s) => s.kind);

test('checklist steps by kind', () => {
  assert.ok(kinds(ctx({})).includes('serviceProfile'));
  assert.ok(!kinds(ctx({ serviceKind: 'salon' })).includes('serviceProfile'));
  assert.deepEqual(kinds(ctx({ serviceKind: 'clinic' })).filter((k) => ['doctorProfile', 'serviceMenu', 'staff'].includes(k)), ['doctorProfile', 'serviceMenu']);
  assert.deepEqual(kinds(ctx({ serviceKind: 'salon' })).filter((k) => ['serviceMenu', 'staff'].includes(k)), ['serviceMenu', 'staff']);
  assert.ok(kinds(ctx({ serviceKind: 'lab' })).includes('labTest'));
  assert.deepEqual(kinds(ctx({ serviceKind: 'fitness' })).filter((k) => ['memberPlan', 'staff'].includes(k)), ['staff', 'memberPlan']);
  assert.ok(kinds(ctx({ serviceKind: 'coaching' })).includes('batch'));
  for (const k of ['workshop', 'appliance']) assert.ok(kinds(ctx({ serviceKind: k })).includes('labourOp') && kinds(ctx({ serviceKind: k })).includes('jobCard'));
  assert.ok(!kinds(ctx({ businessType: 'kirana' })).includes('serviceProfile'));
});

test('TIME_TABS: R10 rows listed through `alsoPacks`; a pack-off tab still opens by URL', () => {
  const ids = (s: Parameters<typeof visiblePackTabs>[1], cur?: string) => visiblePackTabs(TIME_TABS, s, cur).map((t) => t.id);
  const none = ids({ business_type: 'services' });
  for (const t of ['appointments', 'commission', 'clinic', 'members', 'workshop']) assert.ok(!none.includes(t as never), `${t} hidden`);
  assert.ok(ids({ business_type: 'services' }, 'appointments').includes('appointments'));
  const salon = ids({ industry_packs: ['salon'] });
  assert.ok(salon.includes('appointments') && salon.includes('commission') && salon.includes('members'));
  assert.ok(!salon.includes('clinic') && !salon.includes('workshop'));
  const ws = ids({ industry_packs: ['workshop'] });
  assert.ok(ws.includes('appointments') && ws.includes('commission') && ws.includes('workshop') && !ws.includes('members'));
});
