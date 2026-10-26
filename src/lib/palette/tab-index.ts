/**
 * R6-B1: Ctrl+K finds every tab by its own name, its portal form and a few short words ("3b", "tb", "lr").
 *
 * Built from the pages' own tab registries (`GST_TAB_ROWS` = `GST_TAB_GROUPS`, the `src/pages/page-tabs.ts` lists, the TDS ids below) so a new
 * tab is indexed once it has a title in `discover-r6-tabs.ts` (`tests/palette-tabs.test.ts` fails otherwise). Tabs
 * that belong to an industry pack are the R5 "Industry packs" group's rows (`PACK_TABS`): they are left out here and
 * get the same synonyms through `withSynonyms`. A tab whose screen shop mode hides still shows, marked "(hidden)",
 * and opens. Pure (settings in, rows out); the palette loads this module on its first open.
 */
import type { StaticEntry } from '../search';
import { PACK_TABS, activePacks } from '../industry-packs';
import { enabledModules, isPathVisible } from '../shop-mode';
import {
  BOOKS_TABS, MFG_TABS, PAYROLL_TABS, EXPENSES_TABS, RECEIVABLES_TABS, REPORTS_TABS, INVENTORY_TABS, DISTRIBUTION_TABS, TIME_TABS,
  RECURRING_TABS, RECONCILE_TABS, SETTINGS_TABS,
} from '../../pages/page-tabs';
import { tabsT } from '../../i18n/areas/discover-r6-tabs';
import { GST_GROUP_SYNONYMS, synonymsFor } from './synonyms';

/**
 * GST page tabs by row (a copy of `GST_TAB_GROUPS` in `gst-tabs.ts`, which stays in the GST page's own chunk;
 * `tests/palette-tabs.test.ts` pins the two).
 */
export const GST_TAB_ROWS: Readonly<Record<'gstr1' | 'gstr3b' | 'recon' | 'tools', readonly string[]>> = {
  gstr1: ['overview', 'b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exp', 'nil', 'at', 'txpd', 'hsn', 'docs', 'amend', 'eco'],
  gstr3b: ['gstr3b', 'setoff', 'cashref', 'rcmdocs'],
  recon: ['gstr2b', 'purhsn', 'recon', 'guards', 'bygstin'],
  tools: ['compliance', 'composition', 'hsnmaster', 'gstr9c', 'isd', 'ewbcons', 'portal-files', 'eway-desk', 'export-desk', 'common-credit'],
};
const gstRowOf = (id: string) => (Object.keys(GST_TAB_ROWS) as (keyof typeof GST_TAB_ROWS)[]).find((k) => GST_TAB_ROWS[k].includes(id)) ?? 'tools';

/** TDS page tabs (the list stays inline in `Tds.tsx`, owned by R6-A; the test scans that file). */
export const TDS_TAB_IDS = ['overview', 'deductions', 'challans', 'returns', '27q', 'f16a', 'traces'] as const;

export type TabPageKey = 'books' | 'gst' | 'tds' | 'mfg' | 'payroll' | 'expenses' | 'receivables' | 'reports' | 'inventory' | 'distribution' | 'time' | 'recurring' | 'settings' | 'reconcile';

export interface TabPage {
  key: TabPageKey;
  route: string;
  ids: readonly string[];
}

const ids = (list: readonly ({ id: string } | string)[]) => list.map((t) => (typeof t === 'string' ? t : t.id));

/** Every page with tabs and its tab ids, in sidebar order. */
export const TAB_PAGES: readonly TabPage[] = [
  { key: 'recurring', route: '/recurring', ids: ids(RECURRING_TABS) },
  { key: 'time', route: '/time', ids: ids(TIME_TABS) },
  { key: 'receivables', route: '/receivables', ids: ids(RECEIVABLES_TABS) },
  { key: 'distribution', route: '/distribution', ids: ids(DISTRIBUTION_TABS) },
  { key: 'expenses', route: '/expenses', ids: ids(EXPENSES_TABS) },
  { key: 'inventory', route: '/inventory', ids: ids(INVENTORY_TABS) },
  { key: 'mfg', route: '/manufacturing', ids: ids(MFG_TABS) },
  { key: 'books', route: '/books', ids: ids(BOOKS_TABS) },
  { key: 'reconcile', route: '/reconcile', ids: ids(RECONCILE_TABS) },
  { key: 'tds', route: '/tds', ids: TDS_TAB_IDS },
  { key: 'payroll', route: '/payroll', ids: ids(PAYROLL_TABS) },
  { key: 'reports', route: '/reports', ids: ids(REPORTS_TABS) },
  { key: 'gst', route: '/gst-reports', ids: Object.values(GST_TAB_ROWS).flat() },
  { key: 'settings', route: '/settings', ids: ids(SETTINGS_TABS) },
];

export const tabHref = (route: string, id: string): string => `${route}?tab=${id}`;

/** Hrefs the R5 "Industry packs" group lists (left out of the Tabs group, never shown twice). */
export const PACK_HREFS: ReadonlySet<string> = new Set(PACK_TABS.map((t) => t.path));

type TitleKey = Parameters<typeof tabsT>[0];
export const titleKey = (page: TabPageKey, id: string): TitleKey => `${page}.${id}` as TitleKey;
export const hasTitle = (page: TabPageKey, id: string): boolean => Object.hasOwn(tabsT.en, `${page}.${id}`);

export interface TabIndexSettings {
  business_type?: string;
  modules?: unknown;
  industry_packs?: unknown;
}

/** The "Tabs" group rows for a company (its shop mode marks hidden screens). */
export function buildTabIndex(settings: TabIndexSettings | null | undefined): StaticEntry[] {
  const modules = enabledModules(settings as Parameters<typeof enabledModules>[0]);
  const packs = activePacks(settings);
  const out: StaticEntry[] = [];
  for (const page of TAB_PAGES) {
    const hidden = !isPathVisible(page.route, modules, packs);
    const group = tabsT(`page.${page.key}` as TitleKey);
    for (const id of page.ids) {
      const href = tabHref(page.route, id);
      if (PACK_HREFS.has(href) || !hasTitle(page.key, id)) continue;
      const extra = page.key === 'gst' ? GST_GROUP_SYNONYMS[gstRowOf(id)] ?? [] : [];
      out.push({
        id: `tab:${href}`,
        title: `${tabsT(titleKey(page.key, id))}${hidden ? ` ${tabsT('mark.hidden')}` : ''}`,
        subtitle: group,
        icon: 'page',
        href,
        keywords: [...synonymsFor(href), ...extra, group],
      });
    }
  }
  return out;
}

/** The R5 pack rows with this module's synonyms ("lr", "80g", "settlement" …) added to their keywords. */
export function withSynonyms(rows: readonly StaticEntry[]): StaticEntry[] {
  return rows.map((r) => (r.href && synonymsFor(r.href).length ? { ...r, keywords: [...(r.keywords ?? []), ...synonymsFor(r.href)] } : r));
}
