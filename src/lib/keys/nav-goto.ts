/**
 * R20-D1: Go To's index — every Gateway leaf this role may open (labels in both languages, Tally names when "Tally
 * terms" is on, the entry's keywords and the R20-D synonyms). Loaded by the palette on the first Go To only.
 */
import { can } from '../access';
import { getLanguage } from '../../i18n/index';
import { gwT, type GwKey } from '../../i18n/areas/gateway';
import { entryRoute, flattenMenu } from '../gateway/menu';
import { getTallyTerms } from '../gateway/period';
import { GOTO_SYNONYMS } from '../palette/synonyms';
import type { StaticEntry } from '../search';
import { gotoEntries } from './nav-actions';

export function gatewayGoto(): StaticEntry[] {
  const other = (k: GwKey) => (getLanguage() === 'hi' ? gwT.en[k] : gwT.hi[k]);
  const items = flattenMenu({ can, label: (k) => gwT(k), alt: other, terms: getTallyTerms() }).flatMap((it) => {
    const href = entryRoute(it.entry.target, it.screen);
    return href ? [{ id: it.entry.id, label: it.label, path: it.path, href, haystack: it.haystack }] : [];
  });
  return gotoEntries(items, GOTO_SYNONYMS);
}
