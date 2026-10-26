/** R6-B1: Ctrl+K finds every page tab (and the pack rows) by its name, its portal form and short words. */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { PACK_HREFS, TAB_PAGES, TDS_TAB_IDS, buildTabIndex, hasTitle, tabHref, withSynonyms } from '../src/lib/palette/tab-index.ts';
import { TAB_SYNONYMS, synonymsFor } from '../src/lib/palette/synonyms.ts';
import { PACK_TABS } from '../src/lib/industry-packs.ts';
import { applyBusinessType } from '../src/lib/shop-presets.ts';
import { searchAll, type StaticEntry } from '../src/lib/search.ts';
import { localDb } from '../src/lib/localDb.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const src = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

/** Every row the palette offers for tabs: the Tabs group plus the R5 pack rows (with synonyms). */
async function paletteRows(): Promise<StaticEntry[]> {
  const { packDestinations } = await import('../src/components/marketplace/palette-destinations.ts');
  return [...buildTabIndex(localDb.settings.get()), ...withSynonyms(packDestinations())];
}
const tabHits = (q: string, rows: StaticEntry[]) =>
  searchAll(q, { data: { pages: rows, actions: [], invoices: [], clients: [], items: [] }, perGroup: 50 }).filter((r) => r.href?.includes('?tab='));

test('every ?tab= id of every page registry has a palette row (Tabs group or the pack group)', async () => {
  const rows = await paletteRows();
  const hrefs = new Set(rows.map((r) => r.href));
  let n = 0;
  for (const page of TAB_PAGES) {
    for (const id of page.ids) {
      const href = tabHref(page.route, id);
      n++;
      assert.ok(hrefs.has(href), `${href} is not findable in Ctrl+K`);
      if (!PACK_HREFS.has(href)) assert.ok(hasTitle(page.key, id), `${page.key}.${id} has no title in discover-r6-tabs.ts`);
    }
  }
  assert.ok(n > 150, `only ${n} tabs indexed`);
  for (const t of PACK_TABS) assert.ok(hrefs.has(t.path), t.path);
});

test('static scan: pages read their tab lists from *-tabs.ts; the TDS ids match Tds.tsx', () => {
  const pages = ['Books', 'Manufacturing', 'Payroll', 'Expenses', 'Receivables', 'Reports', 'Inventory', 'Distribution', 'Time', 'Recurring', 'Reconcile', 'Settings'];
  for (const page of pages) assert.ok(src(`pages/${page}.tsx`).includes(`from './page-tabs'`), `${page}.tsx does not read its list from page-tabs.ts`);
  const tds = src('pages/Tds.tsx');
  const block = tds.slice(tds.indexOf('const TABS'), tds.indexOf('];', tds.indexOf('const TABS')));
  assert.deepEqual([...block.matchAll(/id: '([^']+)'/g)].map((m) => m[1]), [...TDS_TAB_IDS]);
  assert.ok(src('pages/GstReports.tsx').includes('gst-tabs'), 'GST page reads gst-tabs.ts');
});

test('pin: the palette copy of the GST rows equals GST_TAB_GROUPS, and every GST_TABS id is in it', async () => {
  const { GST_TAB_GROUPS, GST_TABS } = await import('../src/lib/gst-tabs.ts');
  const { GST_TAB_ROWS } = await import('../src/lib/palette/tab-index.ts');
  assert.deepEqual(Object.fromEntries(GST_TAB_GROUPS.map((g) => [g.id, [...g.tabs]])), Object.fromEntries(Object.entries(GST_TAB_ROWS).map(([k, v]) => [k, [...v]])));
  assert.deepEqual(GST_TABS.map((t) => t.id).sort(), Object.values(GST_TAB_ROWS).flat().sort());
});

test('no *-tabs.ts imports a component (only types), so the palette never pulls page code', () => {
  const dir = new URL('../src/pages/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('-tabs.ts'));
  assert.ok(files.includes('page-tabs.ts'));
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    for (const line of text.split('\n').filter((l) => /^import\s/.test(l))) assert.match(line, /^import type /, `${f}: ${line}`);
  }
});

test('"3b", "GSTR-3B", "consignment", "LR", "80g", "trial balance" each find a tab', async () => {
  const rows = await paletteRows();
  const expect: Record<string, string> = {
    '3b': '/gst-reports?tab=gstr3b',
    'GSTR-3B': '/gst-reports?tab=gstr3b',
    consignment: '/distribution?tab=transport',
    LR: '/distribution?tab=transport',
    '80g': '/receivables?tab=donations',
    'trial balance': '/books?tab=tb',
    tb: '/books?tab=tb',
    'p&l': '/books?tab=pnl',
    '26q': '/tds?tab=returns',
    b2cl: '/gst-reports?tab=b2cl',
    cdnur: '/gst-reports?tab=cdnur',
    'ra bill': '/time?tab=works',
    amazon: '/receivables?tab=marketplace',
    'तलपट': '/books?tab=tb',
  };
  for (const [q, href] of Object.entries(expect)) {
    const hits = tabHits(q, rows);
    assert.ok(hits.length >= 1, `"${q}" found nothing`);
    assert.ok(hits.some((h) => h.href === href || h.href?.startsWith(`${href}&`)), `"${q}" → ${hits.slice(0, 5).map((h) => h.href).join(', ')}`);
  }
  assert.equal(tabHits('3b', rows)[0].href, '/gst-reports?tab=gstr3b', 'the 3B tab leads for "3b"');
});

test('a tab of a screen shop mode hides still shows, marked (hidden); a full company marks nothing', () => {
  const kirana = buildTabIndex({ ...applyBusinessType('kirana') });
  const tb = kirana.find((r) => r.href === '/books?tab=tb')!;
  assert.match(tb.title, /\(hidden\)$/);
  assert.ok(!kirana.find((r) => r.href === '/receivables?tab=aging')!.title.includes('(hidden)'), 'core screens are never hidden');
  const full = buildTabIndex({});
  assert.ok(full.every((r) => !r.title.includes('(hidden)')));
  // A pack row of a pack that is off says so (the R5 group), and still opens its tab.
  assert.ok(PACK_TABS.some((t) => t.path === '/distribution?tab=transport'));
});

test('synonyms: pack sub-views inherit their tab words; every synonym key is a real tab or pack row', () => {
  assert.ok(synonymsFor('/distribution?tab=transport&view=trips').includes('trip'));
  assert.ok(synonymsFor('/time?tab=works&view=sites').length > 0);
  const known = new Set<string>([...TAB_PAGES.flatMap((p) => p.ids.map((id) => tabHref(p.route, id))), ...PACK_TABS.map((t) => t.path)]);
  for (const key of Object.keys(TAB_SYNONYMS)) assert.ok(known.has(key), `synonyms for an unknown tab: ${key}`);
});
