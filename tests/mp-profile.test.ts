/** R17-A1 manpower profile: each kind's type / modules / packs / landing; defaults; checklist; existing companies unchanged. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { MANPOWER_KINDS, MANPOWER_LANDING, PRESETS, SERVICE_KINDS, applyManpowerKind, applyServiceKind } from '../src/lib/shop-presets.ts';
import { PACK_IDS, PACK_OF_TYPE, activePacks, visiblePackTabs } from '../src/lib/industry-packs.ts';
import { PACK_ROUTES } from '../src/lib/shop-mode.ts';
import { PACK_HREF } from '../src/lib/features-catalog.ts';
import { allSteps, readChecklistInputs, type ChecklistCtx, type ChecklistFactsV3 } from '../src/lib/checklist-steps.ts';
import { TIME_TABS } from '../src/pages/page-tabs.ts';
import { setTable } from '../src/lib/storage.ts';
import { applyManpowerDefaults, manpowerDefaultsFor, readManpowerSettings, saveManpowerSettings } from '../src/lib/manpower/mp-settings.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('each kind: services / manpower, modules, packs, landing, due 7 days, GST template; registered adds gst; packs in union', () => {
  assert.ok((SERVICE_KINDS as readonly string[]).includes('manpower'));
  assert.deepEqual([...MANPOWER_KINDS], ['security', 'facility', 'staffing', 'labour', 'other']);
  for (const k of MANPOWER_KINDS) {
    const p = applyManpowerKind(k, { registered: true });
    assert.deepEqual([p.business_type, p.service_kind, p.manpower_kind, p.defaultDueDays, p.templateId], ['services', 'manpower', k, 7, 'gst_tax_invoice']);
    for (const m of [...PRESETS.services, 'payroll', 'accounts', 'banking', 'tds', 'recurring', 'purchases', 'time', 'gst']) assert.ok(p.modules!.includes(m as never), `${k} ${m}`);
    assert.deepEqual(p.industry_packs, k === 'security' ? ['manpower', 'security'] : ['manpower']);
    assert.match(MANPOWER_LANDING[k], /^\/time\?tab=deploy/);
  }
  assert.equal(applyManpowerKind('facility').modules!.filter((m) => m === 'gst').length, PRESETS.services.includes('gst') ? 1 : 0);
  assert.deepEqual(applyManpowerKind('labour', { currentPacks: ['works'] }).industry_packs, ['works', 'manpower'], 'a construction contractor keeps works');
  assert.equal(MANPOWER_LANDING.security, '/time?tab=deploy&view=sites');
  for (const p of ['manpower', 'security'] as const) {
    assert.ok(PACK_IDS.includes(p));
    assert.equal(PACK_HREF[p], '/time?tab=deploy');
  }
});

test('PACK_OF_TYPE / PACK_ROUTES unchanged; a services company without manpower_kind sees no desk; the desk follows the pack', () => {
  assert.equal(PACK_OF_TYPE.services, undefined);
  assert.ok(!Object.values(PACK_ROUTES).some((ps) => ps.includes('manpower') || ps.includes('security')));
  localDb.settings.save({ ...localDb.settings.get(), ...applyServiceKind('other') });
  const desk = () => visiblePackTabs(TIME_TABS, localDb.settings.get()).map((t) => t.id).filter((id) => id === 'deploy');
  assert.deepEqual(desk(), []);
  assert.deepEqual(visiblePackTabs(TIME_TABS, localDb.settings.get(), 'deploy').map((t) => t.id).filter((id) => id === 'deploy'), ['deploy'], 'URL still opens');
  localDb.settings.save({ ...localDb.settings.get(), ...applyManpowerKind('security') });
  assert.deepEqual(activePacks(localDb.settings.get()), ['manpower', 'security']);
  assert.deepEqual(desk(), ['deploy']);
});

test('settings defaults by kind; a value the user set is kept; unknown (B–D) keys kept', () => {
  assert.deepEqual(manpowerDefaultsFor('security'), { billing_days: 'calendar', shift_hours: 12, bill_date: 'month_end', service_charge_pct: 0 });
  assert.equal(manpowerDefaultsFor('facility').shift_hours, 8);
  assert.equal(manpowerDefaultsFor('security', { shift_hours: 8 }).shift_hours, 8);
  saveManpowerSettings({ licences: [{ id: 'l', kind: 'psara', no: 'P1', valid_till: '2027-01-01' }] });
  applyManpowerDefaults('security');
  assert.deepEqual([readManpowerSettings().shift_hours, readManpowerSettings().licences?.length], [12, 1]);
  saveManpowerSettings({ service_charge_pct: 150 });
  assert.equal(readManpowerSettings().service_charge_pct, undefined, 'out-of-range service charge dropped');
});

test('checklist steps only with manpower_kind; facts from the data', () => {
  const f: ChecklistFactsV3 = { profileReady: true, clients: 1, items: 1, invoices: 1, messagesSent: 1, payments: 1 };
  const steps = (manpowerKind?: string) => allSteps(f, { businessType: 'services', serviceKind: 'manpower', packs: [], modules: null, role: 'owner', ...(manpowerKind ? { manpowerKind } : {}) } as ChecklistCtx).map((s) => s.kind).filter((k) => ['firstSite', 'firstBill'].includes(k));
  assert.deepEqual(steps(), []);
  assert.deepEqual(steps('security'), ['firstSite', 'firstBill']);
  assert.equal(readChecklistInputs().facts.manpower, undefined);
  localDb.settings.save({ ...localDb.settings.get(), ...applyManpowerKind('facility') });
  setTable('cost_centres', [{ id: 's', name: 'Tower', kind: 'project', active: true, created_at: '', mp: { code: 'S-001', contract: {}, posts: [], status: 'active' } }]);
  assert.deepEqual(readChecklistInputs().facts.manpower, { firstSite: 1, firstBill: 0 });
});
