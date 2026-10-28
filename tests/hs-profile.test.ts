/** R18-A1 society profile: each kind's type / modules / packs / landing; explicit packs; checklist; existing companies unchanged. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { PRESETS, SOCIETY_KINDS, applySocietyKind, societyLanding } from '../src/lib/shop-presets.ts';
import { PACK_IDS, PACK_OF_TYPE, PACK_TABS, activePacks, packTabOn, visiblePackTabs, visibleTabs } from '../src/lib/industry-packs.ts';
import { PACK_OF_TYPE_INLINE, PACK_ROUTES, isPathVisible } from '../src/lib/shop-mode.ts';
import { PACK_HREF } from '../src/lib/features-catalog.ts';
import { allSteps, readChecklistInputs, type ChecklistCtx, type ChecklistFactsV3 } from '../src/lib/checklist-steps.ts';
import { BOOKS_TABS, RECURRING_TABS } from '../src/pages/page-tabs.ts';
import { setTable } from '../src/lib/storage.ts';
import { readSocietySettings, saveSocietySettings, societyDefaultsFor } from '../src/lib/society/hs-settings.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('each kind: nonprofit (services for an agency), the type\'s modules + recurring / accounts / banking, registered adds gst, explicit packs', () => {
  assert.deepEqual([...SOCIETY_KINDS], ['chs', 'aoa', 'rwa', 'commercial', 'agency']);
  for (const k of SOCIETY_KINDS) {
    const type = k === 'agency' ? 'services' : 'nonprofit';
    const p = applySocietyKind(k, { registered: true });
    assert.deepEqual([p.business_type, p.society_kind, p.defaultDueDays, p.templateId], [type, k, 15, 'gst_tax_invoice']);
    for (const m of [...PRESETS[type], 'recurring', 'accounts', 'banking', 'gst']) assert.ok(p.modules!.includes(m as never), `${k} ${m}`);
    assert.deepEqual(p.industry_packs, ['society'], 'an explicit list: the nonprofit type never adds its donations pack');
    assert.equal(societyLanding(k), `/recurring?tab=society&view=${k === 'agency' ? 'bills' : 'units'}`);
  }
  assert.ok(!applySocietyKind('chs').modules!.includes('gst'), 'unregistered: no gst module (nonprofit preset has none)');
  assert.deepEqual(applySocietyKind('rwa', { currentPacks: ['leases'] }).industry_packs, ['leases', 'society'], 'packs in union');
  assert.ok(PACK_IDS.includes('society'));
  assert.equal(PACK_HREF.society, '/recurring?tab=society');
});

test('PACK_OF_TYPE / PACK_OF_TYPE_INLINE / PACK_ROUTES unchanged; /recurring stays visible; the desk follows the pack', () => {
  assert.deepEqual(PACK_OF_TYPE.nonprofit, ['nonprofit']);
  assert.equal(PACK_OF_TYPE_INLINE.nonprofit, 'nonprofit');
  assert.ok(!Object.values(PACK_ROUTES).some((ps) => ps.includes('society')));
  const s = applySocietyKind('chs');
  assert.ok(isPathVisible('/recurring', new Set(s.modules), s.industry_packs));
  const desk = () => visibleTabs(RECURRING_TABS, localDb.settings.get()).map((t) => t.id).filter((id) => id === 'society');
  localDb.settings.save({ ...localDb.settings.get(), business_type: 'nonprofit' });
  assert.deepEqual(desk(), [], 'a non-profit without the profile sees no Society tab');
  assert.deepEqual(visibleTabs(RECURRING_TABS, localDb.settings.get(), 'society').map((t) => t.id).filter((id) => id === 'society'), ['society'], 'URL still opens');
  localDb.settings.save({ ...localDb.settings.get(), ...applySocietyKind('chs') });
  assert.deepEqual(activePacks(localDb.settings.get()), ['society']);
  assert.deepEqual(desk(), ['society']);
  assert.ok(visiblePackTabs(BOOKS_TABS, localDb.settings.get()).some((t) => t.id === 'funds'), 'Books → Funds also for society');
  assert.ok(PACK_TABS.filter((t) => t.path.includes('common-credit')).every((t) => packTabOn(t, ['society'])), 'common credit also for society');
});

test('settings defaults: sender State, monthly, bill day 1, 15 days, sq ft; stored values and B–D keys kept; bad heads dropped', () => {
  assert.deepEqual(societyDefaultsFor('27'), { state: '27', cycle: 'monthly', bill_day: 1, due_days: 15, area_unit: 'sqft', heads: [] });
  assert.equal(societyDefaultsFor('x').state, undefined);
  assert.equal(societyDefaultsFor('27', { cycle: 'quarterly' }).cycle, 'quarterly');
  assert.deepEqual(readSocietySettings(), {}, 'absent = nothing society');
  saveSocietySettings({ interest: { pct: 12, from: 'due', on_interest: false }, heads: [{ id: 'h', name: ' Service ', kind: 'service', basis: 'per_unit', rate: 3000, active: true }, { id: 'x', name: '', kind: 'service', basis: 'per_unit', rate: 1, active: true }, { id: 'y', name: 'Bad', kind: 'nope' as never, basis: 'per_unit', rate: 1, active: true }] });
  const s = readSocietySettings();
  assert.deepEqual([s.heads?.map((h) => h.name), s.interest?.pct], [['Service'], 12]);
});

test('checklist steps only with society_kind; facts from the data', () => {
  const f: ChecklistFactsV3 = { profileReady: true, clients: 1, items: 1, invoices: 1, messagesSent: 1, payments: 1 };
  const steps = (societyKind?: string) => allSteps(f, { businessType: 'nonprofit', packs: ['society'], modules: null, role: 'owner', ...(societyKind ? { societyKind } : {}) } as ChecklistCtx).map((s) => s.kind).filter((k) => k.startsWith('society'));
  assert.deepEqual(steps(), []);
  assert.deepEqual(steps('chs'), ['societyUnits', 'societyTariff', 'societyRun', 'societyFunds', 'societyAudit']); // R18-B: societyRun; R18-D: funds, audit
  assert.equal(readChecklistInputs().facts.society, undefined);
  localDb.settings.save({ ...localDb.settings.get(), ...applySocietyKind('chs') });
  setTable('society_units', [{ id: 'u', code: 'A-101', use: 'residential', occupancy: 'owner', parking: [], status: 'active', updated_at: '' }]);
  assert.deepEqual(readChecklistInputs().facts.society, { societyUnits: 1, societyTariff: 0, societyRun: 0, societyFunds: 0, societyAudit: 0 });
});
