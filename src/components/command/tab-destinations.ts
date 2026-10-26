/**
 * R6-B1: the palette's lazy "Tabs" and "Features" groups. Loaded on the palette's first open (one dynamic import),
 * so the tab registries, synonyms and titles never reach first paint.
 */
import { searchAll, type SearchResult, type StaticEntry } from '../../lib/search';
import { localDb } from '../../lib/localDb';
import { buildTabIndex, withSynonyms } from '../../lib/palette/tab-index';
import { FEATURE_ROWS } from '../../lib/features-catalog';
import { featureText } from '../settings/feature-text';
import { tabsT } from '../../i18n/areas/discover-r6-tabs';

export { withSynonyms };

/** Every tab of every page, marked "(hidden)" where shop mode hides its screen. */
export function tabDestinations(): StaticEntry[] {
  return buildTabIndex(localDb.settings.get());
}

/** Settings → Features rows (modules, packs, advanced options); each opens the Features tab filtered to it. */
export function featureDestinations(): StaticEntry[] {
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

/** Scores static rows only (no documents are read): the palette's extra groups. */
export function searchRows(query: string, rows: StaticEntry[], perGroup = 6): SearchResult[] {
  if (!rows.length || !query.trim()) return [];
  return searchAll(query, { data: { pages: rows, actions: [], invoices: [], clients: [], items: [] }, perGroup });
}

export const discoverLabels = () => ({ tabs: tabsT('group.tabs'), help: tabsT('group.help'), features: tabsT('group.features'), tryHint: tabsT('try') });
