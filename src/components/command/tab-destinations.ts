/**
 * R6-B1: the palette's lazy "Tabs" and "Features" groups. Loaded on the palette's first open (one dynamic import),
 * so the tab registries, synonyms and titles never reach first paint.
 */
import { searchAll, type SearchResult, type StaticEntry } from '../../lib/search';
import { localDb } from '../../lib/localDb';
import { TAB_PAGES, buildTabIndex, tabAllowed, withSynonyms } from '../../lib/palette/tab-index';
import { can, type AccessAction } from '../../lib/access';
import { FEATURE_ROWS } from '../../lib/features-catalog';
import { featureText } from '../settings/feature-text';
import { tabsT } from '../../i18n/areas/discover-r6-tabs';

export { withSynonyms };

/** Every tab of every page this role may open (QA7 G8), marked "(hidden)" where shop mode hides its screen. */
export function tabDestinations(allow: (a: AccessAction) => boolean = can): StaticEntry[] {
  return buildTabIndex(localDb.settings.get(), allow);
}

/**
 * Settings → Features rows (modules, packs, advanced options); each opens the Features tab filtered to it. QA7 G8:
 * offered only while the role may open that tab.
 */
export function featureDestinations(allow: (a: AccessAction) => boolean = can): StaticEntry[] {
  const settings = TAB_PAGES.find((p) => p.key === 'settings');
  if (settings && !tabAllowed(settings, 'features', allow)) return [];
  return FEATURE_ROWS.map((row) => {
    const { title, who } = featureText(row);
    return {
      id: `feat:${row.id}`,
      title,
      subtitle: `${tabsT('group.features')} · ${who}`,
      icon: 'page',
      href: `/settings?tab=features&q=${encodeURIComponent(title)}`,
      keywords: ['feature', 'switch on', 'enable', row.id.split('.')[1]],
    };
  });
}

/** A help topic as the palette needs it (`helpIndex()` rows). */
export interface HelpIndexRow {
  id: string;
  title: string;
  hiTitle?: string;
}

/** R6-A2: every help topic (lazy registry + topic chunks), loaded once; `helpRows` maps it per open. */
export const loadHelpIndex = async (): Promise<HelpIndexRow[]> => (await import('../../lib/help/registry')).helpIndex();

/** QA7 G9: help rows in the language of THIS open (the titles used to keep the language of the first open). */
export function helpRows(rows: readonly HelpIndexRow[], lang: string): StaticEntry[] {
  const hi = lang === 'hi';
  return rows.map((r) => ({
    id: `help:${r.id}`,
    title: hi && r.hiTitle ? r.hiTitle : r.title,
    icon: 'page',
    href: `help:${r.id}`,
    keywords: [(hi ? r.title : r.hiTitle) ?? '', r.id.replace(/[:-]/g, ' ')],
  }));
}

/** Scores static rows only (no documents are read): the palette's extra groups. */
export function searchRows(query: string, rows: StaticEntry[], perGroup = 6): SearchResult[] {
  if (!rows.length || !query.trim()) return [];
  return searchAll(query, { data: { pages: rows, actions: [], invoices: [], clients: [], items: [] }, perGroup });
}

export const discoverLabels = () => ({ tabs: tabsT('group.tabs'), help: tabsT('group.help'), features: tabsT('group.features'), tryHint: tabsT('try') });
