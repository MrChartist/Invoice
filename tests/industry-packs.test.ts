/** R5-A1: industry packs — the pack switch, the six business types, Ctrl+K rows and the "no change for others" rule. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PACK_IDS, PACK_TABS, activePacks, isPackOn, packTabOn, visibleTabs } from '../src/lib/industry-packs.ts';
import { BUSINESS_DEFAULTS, BUSINESS_TYPES, PACK_BUSINESS_TYPES, PRESETS, applyBusinessDefaults, applyBusinessType } from '../src/lib/shop-presets.ts';
import { enabledModules, isPathVisible, type BusinessType } from '../src/lib/shop-mode.ts';

test('no industry_packs and no / an old business type → no pack (existing companies unchanged)', () => {
  assert.deepEqual(activePacks(undefined), []);
  assert.deepEqual(activePacks({}), []);
  for (const t of ['kirana', 'restaurant', 'wholesale', 'services', 'manufacturer', 'full']) assert.deepEqual(activePacks({ business_type: t }), [], t);
});

test('each new type implies its pack; an explicit list (even empty) beats the type; unknown ids dropped', () => {
  const want: Record<string, string> = { ecommerce: 'marketplace', transport: 'transport', contractor: 'works', institution: 'fees', nonprofit: 'nonprofit', property: 'leases' };
  for (const [type, pack] of Object.entries(want)) assert.deepEqual(activePacks({ business_type: type }), [pack]);
  assert.deepEqual(activePacks({ business_type: 'ecommerce', industry_packs: [] }), []);
  assert.deepEqual(activePacks({ industry_packs: ['leases', 'bogus', '__proto__', 'marketplace'] }), ['marketplace', 'leases']);
  assert.equal(isPackOn({ industry_packs: ['works'] }, 'works'), true);
  assert.equal(isPackOn({ business_type: 'constructor' }, 'marketplace'), false, 'own-key lookup only');
  assert.equal(PACK_IDS.length, 6);
});

test('applyBusinessType / defaults for each new type', () => {
  const table: Record<string, { modules: string[]; due: number; tpl: string; landing: string }> = {
    ecommerce: { modules: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'gst', 'tds'], due: 0, tpl: 'gst_tax_invoice', landing: '/receivables?tab=marketplace' },
    transport: { modules: ['purchases', 'accounts', 'banking', 'reports', 'gst', 'tds', 'payroll', 'loans'], due: 30, tpl: 'gst_tax_invoice', landing: '/distribution?tab=transport' },
    contractor: { modules: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'gst', 'tds', 'payroll', 'time'], due: 30, tpl: 'corporate_navy', landing: '/time?tab=works' },
    institution: { modules: ['recurring', 'purchases', 'accounts', 'reports', 'gst', 'payroll'], due: 10, tpl: 'freelancer_light', landing: '/recurring?tab=fees' },
    nonprofit: { modules: ['recurring', 'purchases', 'accounts', 'banking', 'reports', 'tds', 'payroll'], due: 0, tpl: 'classic_orange', landing: '/receivables?tab=donations' },
    property: { modules: ['recurring', 'accounts', 'banking', 'reports', 'gst', 'tds'], due: 7, tpl: 'gst_tax_invoice', landing: '/recurring?tab=leases' },
  };
  for (const t of PACK_BUSINESS_TYPES) {
    const e = table[t];
    assert.ok(BUSINESS_TYPES.includes(t));
    assert.deepEqual(applyBusinessType(t), { business_type: t, modules: e.modules });
    assert.deepEqual([...PRESETS[t]], e.modules);
    assert.equal(BUSINESS_DEFAULTS[t].defaultDueDays, e.due);
    assert.equal(BUSINESS_DEFAULTS[t].templateId, e.tpl);
    assert.equal(BUSINESS_DEFAULTS[t].landing, e.landing);
    const s = applyBusinessDefaults({ defaultDueDays: 14 }, t as BusinessType);
    assert.equal(s.defaultDueDays, e.due);
    assert.deepEqual(activePacks(s as { business_type?: string }), activePacks({ business_type: t }));
  }
});

test('isPathVisible is unchanged for every existing path (regression)', () => {
  const paths = ['/', '/invoice', '/pos', '/tables', '/transactions', '/clients', '/recurring', '/time', '/receivables', '/distribution', '/expenses', '/inventory', '/manufacturing', '/books', '/reconcile', '/cheques', '/tds', '/loans', '/payroll', '/reports', '/gst-reports', '/exports', '/gateway', '/design', '/settings'];
  for (const p of paths) assert.equal(isPathVisible(p, null), true, p);
  const kirana = enabledModules(applyBusinessType('kirana'));
  assert.equal(isPathVisible('/pos', kirana), true);
  assert.equal(isPathVisible('/books', kirana), false);
  assert.equal(isPathVisible('/receivables', kirana), true, 'core');
});

test('PACK_TABS paths resolve to routes that exist in App.tsx', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const routes = new Set([...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(PACK_TABS.length >= 6);
  for (const t of PACK_TABS) assert.ok(routes.has(t.path.split('?')[0]), t.path);
  // Every landing of a pack type is a route too.
  for (const t of PACK_BUSINESS_TYPES) assert.ok(routes.has(BUSINESS_DEFAULTS[t].landing.split('?')[0]), t);
});

test('visibleTabs hides a pack tab while its pack is off, but keeps the one being shown', () => {
  const tabs = [{ id: 'aging' }, { id: 'marketplace', pack: 'marketplace' as const }];
  assert.deepEqual(visibleTabs(tabs, {}).map((t) => t.id), ['aging']);
  assert.deepEqual(visibleTabs(tabs, {}, 'marketplace').map((t) => t.id), ['aging', 'marketplace']);
  assert.deepEqual(visibleTabs(tabs, { business_type: 'ecommerce' }).map((t) => t.id), ['aging', 'marketplace']);
});

test('the Ctrl+K common-credit row is on for every pack that shows the GST tab (fees, nonprofit, leases)', async () => {
  const { PACK_GST_TABS } = await import('../src/lib/gst-tabs.ts');
  const row = PACK_TABS.find((t) => t.path.endsWith('tab=common-credit'))!;
  for (const p of PACK_GST_TABS['common-credit']!) assert.equal(packTabOn(row, [p]), true, p);
  assert.equal(packTabOn(row, ['marketplace']), false);
});
