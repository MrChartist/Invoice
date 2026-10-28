/** R19-A1 logistics profile: each kind's type / modules / packs / landing; `time` added; `transport` only with own lorries; explicit packs; checklist; existing companies unchanged. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { PRESETS, LOGISTICS_KINDS, applyLogisticsKind, logisticsLanding } from '../src/lib/shop-presets.ts';
import { PACK_IDS, PACK_OF_TYPE, PACK_TABS, activePacks, packTabOn, visiblePackTabs, visibleTabs } from '../src/lib/industry-packs.ts';
import { PACK_OF_TYPE_INLINE, PACK_ROUTES, isPathVisible } from '../src/lib/shop-mode.ts';
import { PACK_HREF } from '../src/lib/features-catalog.ts';
import { allSteps, readChecklistInputs, type ChecklistCtx, type ChecklistFactsV3 } from '../src/lib/checklist-steps.ts';
import { TIME_TABS } from '../src/pages/page-tabs.ts';
import { setTable } from '../src/lib/storage.ts';
import { addDefaultHeads, lgDefaultsFor, readLogisticsSettings, saveLogisticsSettings } from '../src/lib/logistics/lg-settings.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const PACKS = { forwarder: ['logistics'], cha: ['logistics', 'customs'], courier: ['logistics', 'courier'], warehouse: ['logistics', 'warehouse'], multi: ['logistics', 'customs'] } as const;

test('each kind: transport, the transport preset + time (registered keeps gst), explicit packs, landing, 30 days, GST template', () => {
  assert.deepEqual([...LOGISTICS_KINDS], ['forwarder', 'cha', 'courier', 'warehouse', 'multi']);
  for (const k of LOGISTICS_KINDS) {
    const p = applyLogisticsKind(k, { registered: true });
    assert.deepEqual([p.business_type, p.logistics_kind, p.defaultDueDays, p.templateId], ['transport', k, 30, 'gst_tax_invoice']);
    assert.deepEqual([...p.modules!].sort(), [...new Set([...PRESETS.transport, 'time'])].sort(), k);
    assert.deepEqual(p.industry_packs, [...PACKS[k]], `${k}: explicit list, no transport pack`);
    assert.equal(logisticsLanding(k), `/time?tab=shipments&view=${k === 'courier' ? 'courier' : k === 'warehouse' ? 'storage' : 'jobs'}`);
  }
  assert.ok(!applyLogisticsKind('cha').modules!.includes('gst'), 'unregistered: no gst module');
  assert.deepEqual(applyLogisticsKind('forwarder', { ownLorries: true }).industry_packs, ['logistics', 'transport'], 'own lorries add the R5-B pack');
  assert.deepEqual(applyLogisticsKind('multi', { extra: ['courier', 'warehouse'] }).industry_packs, ['logistics', 'customs', 'courier', 'warehouse']);
  assert.deepEqual(applyLogisticsKind('cha', { extra: ['courier'] }).industry_packs, ['logistics', 'customs'], 'extras only for multi');
  assert.deepEqual(applyLogisticsKind('cha', { currentPacks: ['svcexport'] }).industry_packs, ['svcexport', 'logistics', 'customs'], 'packs in union');
  for (const p of ['logistics', 'customs', 'courier', 'warehouse'] as const) {
    assert.ok(PACK_IDS.includes(p));
    assert.equal(PACK_HREF[p], '/time?tab=shipments');
  }
});

test('PACK_OF_TYPE / PACK_OF_TYPE_INLINE / PACK_ROUTES unchanged; /time stays visible; the desk follows the packs', () => {
  assert.deepEqual(PACK_OF_TYPE.transport, ['transport']);
  assert.equal(PACK_OF_TYPE_INLINE.transport, 'transport');
  assert.deepEqual(PACK_ROUTES['/time'], ['works']);
  assert.ok(!Object.values(PACK_ROUTES).some((ps) => ps.some((p) => ['logistics', 'customs', 'courier', 'warehouse'].includes(p))));
  const s = applyLogisticsKind('multi', { registered: true });
  assert.ok(isPathVisible('/time', new Set(s.modules), s.industry_packs));
  const desk = () => visiblePackTabs(TIME_TABS, localDb.settings.get()).map((t) => t.id).filter((id) => id === 'shipments' || id === 'exportsvc');
  localDb.settings.save({ ...localDb.settings.get(), business_type: 'transport' });
  assert.deepEqual(desk(), [], 'a transport company without the profile sees no Shipments tab');
  assert.deepEqual(visibleTabs(TIME_TABS, localDb.settings.get(), 'shipments').map((t) => t.id).filter((id) => id === 'shipments'), ['shipments'], 'URL still opens');
  localDb.settings.save({ ...localDb.settings.get(), ...s });
  assert.deepEqual(activePacks(localDb.settings.get()), ['logistics', 'customs']);
  assert.deepEqual(desk(), ['exportsvc', 'shipments'], 'the R14 exports-of-services tab also for logistics');
  for (const p of ['customs', 'courier', 'warehouse'] as const) assert.ok(PACK_TABS.filter((t) => t.path.startsWith('/time?tab=shipments')).every((t) => packTabOn(t, [p])), p);
});

test('settings defaults: USD, kg, split by POS / currency, accruals, gross, volumetric; heads kept / dropped; defaults never overwrite', () => {
  assert.deepEqual(readLogisticsSettings(), {}, 'absent = nothing logistics');
  const d = lgDefaultsFor();
  assert.deepEqual([d.default_currency, d.weight_unit, d.split, d.accrue, d.disb_posting, d.volumetric], ['USD', 'kg', 'pos_currency', true, 'gross', { air: 6000, courier: 5000, sea_kg_per_cbm: 1000 }]);
  assert.equal(lgDefaultsFor({ split: 'single' }).split, 'single');
  saveLogisticsSettings({ margin_alert_pct: 10, heads: [{ id: 'h', name: ' Air ', kind: 'freight_air', role: 'own', unit: 'per_kg', active: true }, { id: 'x', name: '', kind: 'other', role: 'own', unit: 'typed', active: true }, { id: 'y', name: 'Bad', kind: 'nope' as never, role: 'own', unit: 'typed', active: true }] });
  assert.deepEqual([readLogisticsSettings().heads?.map((h) => h.name), readLogisticsSettings().margin_alert_pct], [['Air'], 10]);
  saveLogisticsSettings({ heads: [{ id: 'lg-freight_air', name: 'My air', kind: 'freight_air', role: 'own', unit: 'per_kg', rate: 2, active: true }] });
  const s = addDefaultHeads('2026-11-05');
  assert.ok((s.heads?.length ?? 0) >= 10);
  assert.equal(s.heads?.find((h) => h.id === 'lg-freight_air')?.name, 'My air', 'an edited head is kept');
  assert.equal(addDefaultHeads('2026-11-05').heads?.length, s.heads?.length, 'idempotent');
});

test('checklist steps only with logistics_kind; facts from the data', () => {
  const f: ChecklistFactsV3 = { profileReady: true, clients: 1, items: 1, invoices: 1, messagesSent: 1, payments: 1 };
  const steps = (logisticsKind?: string) => allSteps(f, { businessType: 'transport', packs: ['logistics'], modules: null, role: 'owner', ...(logisticsKind ? { logisticsKind } : {}) } as ChecklistCtx).map((s) => s.kind).filter((k) => k.startsWith('lg'));
  assert.deepEqual(steps(), []);
  assert.deepEqual(steps('multi'), ['lgHeads', 'lgJob', 'lgBill']);
  assert.deepEqual(steps('courier'), ['lgHeads']);
  // R19-D: the manifest step needs the courier pack
  assert.deepEqual(allSteps(f, { businessType: 'transport', packs: ['logistics', 'courier'], modules: null, role: 'owner', logisticsKind: 'courier' } as ChecklistCtx).map((s) => s.kind).filter((k) => k.startsWith('lg')), ['lgHeads', 'lgManifest']);
  assert.equal(readChecklistInputs().facts.logistics, undefined);
  localDb.settings.save({ ...localDb.settings.get(), ...applyLogisticsKind('cha') });
  setTable('lg_jobs', [{ id: 'j', number: 'JOB/FY26-27/0001' }]);
  setTable('invoices', [{ id: 'i', lg: { job_id: 'j' } }, { id: 'k' }]);
  assert.deepEqual(readChecklistInputs().facts.logistics, { lgHeads: 0, lgJob: 1, lgBill: 1, lgManifest: 0 }); // R19-D: + manifests
});
