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

// R8 rows (kept here so the palette does not load the trade areas).
const r8T = defineArea(
  { 'r8.claims': 'Claims', 'r8.schemes': 'Scheme claims', 'r8.pricedrop': 'Price drop', 'r8.claimList': 'Claim list', 'r8.packaging': 'Packaging (crates)', 'r8.mandi': 'Mandi charges', 'r8.brokers': 'Brokers', 'r8.agency': 'Agency', 'r8.arrivals': 'Arrivals (agency lots)', 'r8.pattis': 'Bikri patti', 'r8.indents': 'Indents' } as const,
  { 'r8.claims': 'क्लेम', 'r8.schemes': 'स्कीम क्लेम', 'r8.pricedrop': 'प्राइस ड्रॉप', 'r8.claimList': 'क्लेम सूची', 'r8.packaging': 'पैकेजिंग (क्रेट)', 'r8.mandi': 'मंडी खर्चे', 'r8.brokers': 'दलाल', 'r8.agency': 'आढ़त', 'r8.arrivals': 'आवक (आढ़त लॉट)', 'r8.pattis': 'बिक्री पट्टी', 'r8.indents': 'इंडेंट' },
);

// R9 rows (kept here so the palette does not load the retail areas).
const r9T = defineArea(
  { 'r9.pharmacy': 'Pharmacy', 'r9.rx': 'Prescriptions', 'r9.doctors': 'Doctors', 'r9.registers': 'H1 / X registers', 'r9.refills': 'Refill reminders', 'r9.prices': 'Ceiling price & margins', 'r9.apparel': 'Apparel', 'r9.matrix': 'Size × colour stock', 'r9.alterations': 'Alteration slips', 'r9.bands': 'GST price bands', 'r9.devices': 'Devices', 'r9.imei': 'IMEI lookup & checks', 'r9.finance': 'Finance (EMI) deals', 'r9.buyback': 'Buy-back', 'r9.service': 'Repair jobs', 'r9.jewellery': 'Jewellery', 'r9.rates': 'Metal rates', 'r9.tags': 'Jewellery tags', 'r9.oldgold': 'Old gold', 'r9.karigar': 'Karigar account' } as const,
  { 'r9.pharmacy': 'फ़ार्मेसी', 'r9.rx': 'दवा पर्ची', 'r9.doctors': 'डॉक्टर', 'r9.registers': 'H1 / X रजिस्टर', 'r9.refills': 'रीफ़िल याद', 'r9.prices': 'सीलिंग प्राइस और मार्जिन', 'r9.apparel': 'कपड़े', 'r9.matrix': 'साइज़ × रंग स्टॉक', 'r9.alterations': 'आल्टरेशन पर्ची', 'r9.bands': 'GST प्राइस बैंड', 'r9.devices': 'डिवाइस', 'r9.imei': 'IMEI खोज और जाँच', 'r9.finance': 'फ़ाइनेंस (EMI)', 'r9.buyback': 'बाय-बैक', 'r9.service': 'रिपेयर जॉब', 'r9.jewellery': 'ज्वेलरी', 'r9.rates': 'धातु रेट', 'r9.tags': 'ज्वेलरी टैग', 'r9.oldgold': 'पुराना सोना', 'r9.karigar': 'कारीगर खाता' },
);

// R11 rows (kept here so the palette does not load the construction areas).
const r11T = defineArea(
  { 'r11.ra': 'RA bills (running account)', 'r11.contracts': 'Contracts', 'r11.advances': 'Advances (mobilisation, secured)', 'r11.escalation': 'Price variation / escalation', 'r11.guarantees': 'Bank guarantees', 'r11.subcon': 'Sub-contracts', 'r11.labour': 'Labour & muster', 'r11.plant': 'Plant & equipment', 'r11.reco': 'Material reconciliation', 'r11.pnl': 'Site P&L', 'r11.realty': 'Realty (builder desk)' } as const,
  { 'r11.ra': 'रनिंग बिल', 'r11.contracts': 'अनुबंध', 'r11.advances': 'अग्रिम (मोबिलाइज़ेशन, सिक्योर्ड)', 'r11.escalation': 'मूल्य परिवर्तन', 'r11.guarantees': 'बैंक गारंटी', 'r11.subcon': 'उप-ठेके', 'r11.labour': 'श्रम और मस्टर रोल', 'r11.plant': 'मशीनरी', 'r11.reco': 'सामग्री मिलान', 'r11.pnl': 'साइट लाभ-हानि', 'r11.realty': 'रियल्टी (बिल्डर डेस्क)' },
);

/** A row's label: a key of this package's area, else (B / C rows until they resolve their own) the key text. */
const label = (key: string, pack?: string): string => (pack === 'hotel' && Object.hasOwn(hT.en, key) ? hT(key as keyof typeof hT.en) : Object.hasOwn(mT.en, key) ? mT(key as keyof typeof mT.en) : Object.hasOwn(twT.en, key) ? twT(key as keyof typeof twT.en) : Object.hasOwn(cT.en, key) ? cT(key as keyof typeof cT.en) : Object.hasOwn(r8T.en, key) ? r8T(key as keyof typeof r8T.en) : Object.hasOwn(r9T.en, key) ? r9T(key as keyof typeof r9T.en) : Object.hasOwn(r11T.en, key) ? r11T(key as keyof typeof r11T.en) : key);

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
