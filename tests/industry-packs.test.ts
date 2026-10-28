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
  assert.ok(PACK_IDS.includes('hotel')); // R7-A
  assert.ok(PACK_IDS.length >= 9, 'six R5 packs + three R8 trading packs'); // R8-C
  for (const p of ['distributor', 'commodity', 'agency']) assert.ok(PACK_IDS.includes(p as never), p);
  // R9 (RT-A1): four retail packs; `kirana` implies none (existing kirana companies unchanged); no shell route change.
  for (const p of ['pharmacy', 'apparel', 'electronics', 'jewellery']) assert.ok(PACK_IDS.includes(p as never), p);
  for (const p of ['agri', 'dairy', 'mill', 'coldstore', 'agri_inputs', 'fpo']) assert.ok(PACK_IDS.includes(p as never), p); // R12 (AG-A1)
  for (const p of ['shopfloor', 'fabrication', 'garments', 'plastics', 'press', 'foodmfg']) assert.ok(PACK_IDS.includes(p as never), p); // R13 (MF-A1)
  for (const p of ['travel', 'events']) assert.ok(PACK_IDS.includes(p as never), p); // R15-B1
  assert.deepEqual(activePacks({ business_type: 'kirana' }), []);
  assert.ok(PACK_TABS.filter((t) => ['pharmacy', 'apparel', 'electronics', 'jewellery'].includes(t.pack)).every((t) => t.path.startsWith('/inventory?tab=')));
});

test('applyBusinessType / defaults for each new type', () => {
  const table: Record<string, { modules: string[]; due: number; tpl: string; landing: string }> = {
    ecommerce: { modules: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'gst', 'tds'], due: 0, tpl: 'gst_tax_invoice', landing: '/receivables?tab=marketplace' },
    transport: { modules: ['purchases', 'accounts', 'banking', 'reports', 'gst', 'tds', 'payroll', 'loans'], due: 30, tpl: 'gst_tax_invoice', landing: '/distribution?tab=transport' },
    contractor: { modules: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'gst', 'tds', 'payroll', 'time'], due: 30, tpl: 'corporate_navy', landing: '/time?tab=works' },
    institution: { modules: ['recurring', 'purchases', 'accounts', 'reports', 'gst', 'payroll'], due: 10, tpl: 'freelancer_light', landing: '/recurring?tab=fees' },
    nonprofit: { modules: ['recurring', 'purchases', 'accounts', 'banking', 'reports', 'tds', 'payroll'], due: 0, tpl: 'classic_orange', landing: '/receivables?tab=donations' },
    property: { modules: ['recurring', 'accounts', 'banking', 'reports', 'gst', 'tds'], due: 7, tpl: 'gst_tax_invoice', landing: '/recurring?tab=leases' },
    hotel: { modules: ['pos', 'inventory', 'purchases', 'accounts', 'banking', 'reports', 'gst', 'tds', 'payroll'], due: 0, tpl: 'gst_tax_invoice', landing: '/tables?tab=frontdesk' }, // R7-A
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

/* ── R6-B2: pack routes stay in the sidebar ─────────────────── */

const R10_PACKS: readonly string[] = ['clinic', 'salon', 'fitness', 'workshop',
  // R14: the professional packs live on /time like R10's — every professional kind keeps `time` (PACK_ROUTES unchanged).
  'practice', 'cafirm', 'legal', 'design', 'media', 'svcexport', 'partners',
  // R15: the travel packs too — every travel kind keeps `time`.
  'travel', 'events',
  // R17: the manpower packs too — every manpower kind keeps `time`.
  'manpower', 'security'];

test('R6-B2 pin: the shell copies PACK_ROUTES / PACK_OF_TYPE_INLINE equal PACK_TABS / PACK_OF_TYPE', async () => {
  const { PACK_ROUTES, PACK_OF_TYPE_INLINE, moduleOfPath } = await import('../src/lib/shop-mode.ts');
  const { PACK_OF_TYPE } = await import('../src/lib/industry-packs.ts');
  const want = new Map<string, Set<string>>();
  for (const t of PACK_TABS) {
    const route = t.path.split('?')[0];
    if (!moduleOfPath(route)) continue; // core routes (e.g. /receivables) are always visible
    if (t.path.startsWith('/inventory?') || t.path.startsWith('/manufacturing?')) continue; // R13: manufacturing desks live on /manufacturing (module `inventory`, kept by every kind). R9: the retail desks live on /inventory, which every retail profile keeps (PACK_ROUTES unchanged)
    // R10: the service packs need no shell copy — every service profile keeps `time`, and the common-credit tab needs the
    // `gst` module anyway (an unregistered clinic has no GST pages); PACK_ROUTES stays unchanged (first paint 0).
    const packs = [t.pack, ...(t.alsoPacks ?? [])].filter((p) => !R10_PACKS.includes(p));
    if (!packs.length) continue;
    const set = want.get(route) ?? new Set<string>();
    for (const p of packs) set.add(p);
    want.set(route, set);
  }
  assert.deepEqual(Object.keys(PACK_ROUTES).sort(), [...want.keys()].sort());
  for (const [route, packs] of want) assert.deepEqual([...PACK_ROUTES[route]].sort(), [...packs].sort(), route);
  const inline: Record<string, string[]> = Object.fromEntries(Object.entries(PACK_OF_TYPE_INLINE).map(([k, v]) => [k, [v]]));
  assert.deepEqual(inline, Object.fromEntries(Object.entries(PACK_OF_TYPE).map(([k, v]) => [k, [...(v ?? [])]])));
});

test('R6-B2: impliedPacks agrees with activePacks for every business type and explicit lists', async () => {
  const { impliedPacks } = await import('../src/lib/shop-mode.ts');
  for (const t of [...BUSINESS_TYPES, undefined]) assert.deepEqual(impliedPacks({ business_type: t }), activePacks({ business_type: t }), String(t));
  assert.deepEqual(impliedPacks({ business_type: 'transport', industry_packs: ['works'] }), ['works']);
  assert.deepEqual(impliedPacks({ business_type: 'constructor' }), []);
  assert.deepEqual(impliedPacks(null), []);
});

test('R6-B2: a transport company sees /distribution; a contractor sees /time with time off; packs off hide them', async () => {
  const { impliedPacks } = await import('../src/lib/shop-mode.ts');
  const transport = applyBusinessType('transport');
  const tm = enabledModules(transport);
  assert.equal(isPathVisible('/distribution', tm), false, 'no inventory module, no pack argument');
  assert.equal(isPathVisible('/distribution', tm, impliedPacks(transport)), true);
  assert.equal(isPathVisible('/distribution?tab=transport', tm, impliedPacks(transport)), true);
  const contractor = { ...applyBusinessType('contractor'), modules: PRESETS.contractor.filter((m) => m !== 'time') };
  const cm = enabledModules(contractor);
  assert.equal(isPathVisible('/time', cm), false);
  assert.equal(isPathVisible('/time', cm, impliedPacks(contractor)), true);
  // A kirana with no pack: Books stays hidden even with the argument; the nonprofit pack keeps /books.
  const kirana = enabledModules(applyBusinessType('kirana'));
  assert.equal(isPathVisible('/books', kirana, []), false);
  assert.equal(isPathVisible('/books', kirana, ['nonprofit']), true);
  assert.equal(isPathVisible('/gst-reports', kirana, ['leases']), true, 'common credit is shared by fees / nonprofit / leases');
  assert.equal(isPathVisible('/payroll', kirana, ['fees', 'nonprofit', 'leases', 'transport', 'works', 'marketplace']), false);
});

test('R6-B2: isPathVisible without packs is unchanged for every existing path', () => {
  const paths = ['/', '/invoice', '/pos', '/tables', '/transactions', '/clients', '/recurring', '/time', '/receivables', '/expenses', '/inventory', '/manufacturing', '/books', '/reconcile', '/cheques', '/tds', '/loans', '/payroll', '/reports', '/gst-reports', '/exports', '/gateway', '/design', '/settings', '/practice'];
  for (const type of BUSINESS_TYPES) {
    const m = enabledModules(applyBusinessType(type));
    for (const p of paths) assert.equal(isPathVisible(p, m, []), isPathVisible(p, m), `${type} ${p}`);
  }
  assert.equal(isPathVisible('/distribution', enabledModules(applyBusinessType('wholesale'))), true, 'wholesale keeps inventory');
});
