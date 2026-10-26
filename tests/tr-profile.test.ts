/** TR-C5 trade profile: each kind's modules / packs / landing, existing wholesale companies unchanged, checklist, tabs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TRADE_KINDS, TRADE_PROFILES, applyTradeKind, PRESETS } from '../src/lib/shop-presets.ts';
import { PACK_IDS, PACK_OF_TYPE, PACK_TABS, activePacks, visiblePackTabs } from '../src/lib/industry-packs.ts';
import { PACK_ROUTES, enabledModules, isPathVisible } from '../src/lib/shop-mode.ts';
import { DISTRIBUTION_TABS } from '../src/pages/page-tabs.ts';
import { allSteps, type ChecklistCtx, type ChecklistFactsV3 } from '../src/lib/checklist-steps.ts';
import { PACK_HREF } from '../src/lib/features-catalog.ts';

test('each trade kind: business type wholesale, its modules, explicit packs, landing, due days, switches', () => {
  const want = {
    distributor: { packs: ['distributor'], landing: '/distribution?tab=claims', due: 21, disc: true, pack: true },
    wholesaler: { packs: [], landing: '/invoice', due: 30, disc: true, pack: false },
    commodity: { packs: ['commodity'], landing: '/invoice', due: 15, disc: false, pack: true },
    agent: { packs: ['agency', 'commodity'], landing: '/distribution?tab=agency', due: 7, disc: false, pack: true },
  } as const;
  for (const k of TRADE_KINDS) {
    const s = applyTradeKind(k);
    assert.equal(s.business_type, 'wholesale');
    assert.equal(s.trade_kind, k);
    assert.deepEqual(s.industry_packs, [...want[k].packs]);
    assert.deepEqual([...activePacks(s)].sort(), [...want[k].packs].sort());
    assert.equal(TRADE_PROFILES[k].landing, want[k].landing);
    assert.equal(TRADE_PROFILES[k].defaultDueDays, want[k].due);
    assert.equal(TRADE_PROFILES[k].templateId, 'gst_tax_invoice');
    assert.equal(s.trade_discounts, want[k].disc);
    assert.equal(s.returnable_packaging, want[k].pack);
    // The landing route is visible in the sidebar for that profile.
    assert.ok(isPathVisible(want[k].landing, enabledModules(s), activePacks(s)), k);
  }
  assert.deepEqual(applyTradeKind('agent').modules, ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'gst', 'tds']);
  assert.ok(!applyTradeKind('agent').modules!.includes('pos'));
  assert.deepEqual(applyTradeKind('wholesaler').modules, [...PRESETS.wholesale]);
});

test('existing wholesale companies are unchanged: no implied pack; three new pack ids; PACK_ROUTES pinned', () => {
  assert.deepEqual(activePacks({ business_type: 'wholesale' }), []);
  assert.equal(PACK_OF_TYPE.wholesale, undefined);
  for (const p of ['distributor', 'commodity', 'agency'] as const) {
    assert.ok(PACK_IDS.includes(p));
    assert.ok(PACK_HREF[p].startsWith('/distribution?tab='));
  }
  assert.deepEqual([...PACK_ROUTES['/distribution']].sort(), ['agency', 'commodity', 'distributor', 'transport']);
  assert.ok(PACK_TABS.filter((t) => t.path.startsWith('/distribution?tab=agency')).length === 4);
});

test('visiblePackTabs honours alsoPacks; a tab of an off pack still opens by URL', () => {
  const ids = (packs: string[], current?: string) => visiblePackTabs(DISTRIBUTION_TABS, { industry_packs: packs }, current).map((t) => t.id);
  assert.deepEqual(ids([]), ['masters', 'reports', 'plan', 'van', 'orders', 'credit']);
  assert.deepEqual(ids(['agency']), ['masters', 'reports', 'plan', 'van', 'orders', 'credit', 'packaging', 'mandi', 'brokers', 'agency']);
  assert.deepEqual(ids(['distributor']), ['masters', 'reports', 'plan', 'van', 'orders', 'credit', 'claims', 'packaging']);
  assert.deepEqual(ids(['commodity']), ['masters', 'reports', 'plan', 'van', 'orders', 'credit', 'packaging', 'mandi', 'brokers']);
  assert.ok(ids([], 'agency').includes('agency'));
});

test('checklist: "Pick your trade" for wholesale until chosen; trade steps per pack', () => {
  const none: ChecklistFactsV3 = { profileReady: false, clients: 0, items: 0, invoices: 0, messagesSent: 0, payments: 0 };
  const ctx = (over: Partial<ChecklistCtx>): ChecklistCtx => ({ businessType: 'wholesale', packs: [], modules: null, role: 'owner', ...over });
  const keys = (c: ChecklistCtx, f = none) => allSteps(f, c).map((s) => s.key);
  assert.ok(keys(ctx({})).includes('tradeProfile'));
  assert.ok(!keys(ctx({ tradeKind: 'wholesaler' })).includes('tradeProfile'));
  assert.ok(!keys(ctx({ businessType: 'full' })).includes('tradeProfile'));
  const agent = keys(ctx({ tradeKind: 'agent', packs: ['commodity', 'agency'] }));
  for (const k of ['packFirst:agency', 'packFirst:commodity', 'principal', 'weightItem']) assert.ok(agent.includes(k), k);
  const dist = keys(ctx({ tradeKind: 'distributor', packs: ['distributor'] }));
  for (const k of ['packFirst:distributor', 'schemeScope']) assert.ok(dist.includes(k), k);
  assert.equal(allSteps({ ...none, principals: 1 }, ctx({ tradeKind: 'agent', packs: ['agency'] })).find((s) => s.key === 'principal')!.done, true);
});
