/**
 * R5-A1: the "Industry packs" palette group — every `PACK_TABS` row, searched like the other destinations. Rows of a
 * pack that is off say "(pack off)" and still open the tab (progressive disclosure, never removal). Loaded on the
 * palette's first open only.
 */
import type { StaticEntry } from '../../lib/search';
import { PACK_TABS, activePacks, packTabOn } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import { mT } from '../../i18n/areas/packs-marketplace-r5';
import { reachT } from '../../i18n/areas/reach';
import { defineArea } from '../../i18n/area';

// R5-C rows (kept here so the palette does not load the R5-C area).
const cT = defineArea({ 'tab.fees': 'Fees', 'tab.leases': 'Leases', 'tab.donations': 'Donations', 'tab.funds': 'Funds', 'tab.commonCredit': 'Common credit (Rule 42 / 43)' } as const, { 'tab.fees': 'फ़ीस', 'tab.leases': 'लीज़', 'tab.donations': 'दान', 'tab.funds': 'फ़ंड', 'tab.commonCredit': 'साझा क्रेडिट (Rule 42 / 43)' });

import { twT } from '../../i18n/areas/packs-transport-works-r5'; // R5-B resolver
// R8 rows (kept here so the palette does not load the trade areas).
const r8T = defineArea(
  { 'r8.claims': 'Claims', 'r8.schemes': 'Scheme claims', 'r8.pricedrop': 'Price drop', 'r8.claimList': 'Claim list', 'r8.packaging': 'Packaging (crates)', 'r8.mandi': 'Mandi charges', 'r8.brokers': 'Brokers', 'r8.agency': 'Agency', 'r8.arrivals': 'Arrivals (agency lots)', 'r8.pattis': 'Bikri patti', 'r8.indents': 'Indents' } as const,
  { 'r8.claims': 'क्लेम', 'r8.schemes': 'स्कीम क्लेम', 'r8.pricedrop': 'प्राइस ड्रॉप', 'r8.claimList': 'क्लेम सूची', 'r8.packaging': 'पैकेजिंग (क्रेट)', 'r8.mandi': 'मंडी खर्चे', 'r8.brokers': 'दलाल', 'r8.agency': 'आढ़त', 'r8.arrivals': 'आवक (आढ़त लॉट)', 'r8.pattis': 'बिक्री पट्टी', 'r8.indents': 'इंडेंट' },
);

/** A row's label: a key of this package's area, else (B / C rows until they resolve their own) the key text. */
const label = (key: string): string => (Object.hasOwn(mT.en, key) ? mT(key as keyof typeof mT.en) : Object.hasOwn(twT.en, key) ? twT(key as keyof typeof twT.en) : Object.hasOwn(cT.en, key) ? cT(key as keyof typeof cT.en) : Object.hasOwn(r8T.en, key) ? r8T(key as keyof typeof r8T.en) : key);

export function packDestinations(): StaticEntry[] {
  const on = activePacks(localDb.settings.get());
  return PACK_TABS.map((t) => ({
    id: `pack:${t.path}`,
    title: `${label(t.labelKey)}${packTabOn(t, on) ? '' : ` ${mT('packOff')}`}`,
    subtitle: `${mT('paletteGroup')} · ${reachT(`pack.${t.pack}`)}`,
    icon: 'page',
    href: t.path,
    keywords: ['industry pack', t.pack, reachT(`pack.${t.pack}`)],
  }));
}
