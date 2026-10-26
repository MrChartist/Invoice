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
// R7-A: hotel front-desk rows (kept here so the palette does not load the front-desk area)
const hT = defineArea(
  { 'tab.frontdesk': 'Front desk', 'view.calendar': 'Room calendar', 'view.reservations': 'Reservations', 'view.folios': 'Folios', 'view.housekeeping': 'Housekeeping', 'view.audit': 'Night audit', 'view.guests': 'Guest register', 'view.formc': 'Form C', 'view.reports': 'Hotel reports', 'view.setup': 'Rooms & rates' } as const,
  { 'tab.frontdesk': 'फ्रंट डेस्क', 'view.calendar': 'रूम कैलेंडर', 'view.reservations': 'बुकिंग', 'view.folios': 'फ़ोलियो', 'view.housekeeping': 'हाउसकीपिंग', 'view.audit': 'नाइट ऑडिट', 'view.guests': 'गेस्ट रजिस्टर', 'view.formc': 'Form C', 'view.reports': 'होटल रिपोर्ट', 'view.setup': 'कमरे और रेट' },
);

/** A row's label: a key of this package's area, else (B / C rows until they resolve their own) the key text. */
const label = (key: string, pack?: string): string => (pack === 'hotel' && Object.hasOwn(hT.en, key) ? hT(key as keyof typeof hT.en) : Object.hasOwn(mT.en, key) ? mT(key as keyof typeof mT.en) : Object.hasOwn(twT.en, key) ? twT(key as keyof typeof twT.en) : Object.hasOwn(cT.en, key) ? cT(key as keyof typeof cT.en) : key);

export function packDestinations(): StaticEntry[] {
  const on = activePacks(localDb.settings.get());
  return PACK_TABS.map((t) => ({
    id: `pack:${t.path}`,
    title: `${label(t.labelKey, t.pack)}${packTabOn(t, on) ? '' : ` ${mT('packOff')}`}`,
    subtitle: `${mT('paletteGroup')} · ${reachT(`pack.${t.pack}`)}`,
    icon: 'page',
    href: t.path,
    keywords: ['industry pack', t.pack, reachT(`pack.${t.pack}`)],
  }));
}
