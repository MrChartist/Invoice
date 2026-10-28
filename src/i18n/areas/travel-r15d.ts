/**
 * R15-D: outbound TCS, place of supply and events strings (editor chips, bill hints, the `tcs` and `events` views).
 * Shared words (trip, supplier, TCS, margin …) come from `travel-r15b.ts`. Lists are comma strings in id order.
 */
import { defineArea } from '../area';

export const tvdT = defineArea(
  {
    tcsHead: 'TCS — overseas tour package', tcsCalc: 'TCS {rate} % = {amount}', tcsApply: 'Apply TCS', applied: 'TCS applied.',
    tcsForce: 'Overseas tour programme package', tcsNr: 'Buyer is a non-resident not in India',
    notPackage: 'Not a package (a ticket or a hotel alone) — no TCS (as reported, TV4).', nonResident: 'Non-resident not in India — no TCS (TV5).',
    off: 'No tour-package TCS on this date.', noPan: 'No PAN — the higher rate applies (TV5).',
    posHead: 'Place of supply', posApply: 'Use this POS', useExempt: 'Use the exempt regime',
    'pos.reg': 'Registered client → its State (Sec 12(2), TV18).', 'pos.addr': 'Unregistered client → the address on record (Sec 12(2), TV18).',
    'pos.inbound': 'Performed in India — POS India, not an export even in foreign currency (Sec 13(3)(b), TV19).',
    'pos.outside': 'Tour wholly outside India for a foreign tourist — the exempt regime may apply (TV10).',
    'pos.event_reg': 'Event, registered client → the client\'s State (Sec 12(7)(a), TV21).',
    'pos.event_venue': 'Event, unregistered client → where the event is held (Sec 12(7)(a), TV21).',
    'pos.event_abroad': 'Event abroad → the client\'s location (Sec 12(7)(a), TV21).',
    'pos.unknown': 'Add the client\'s State or GSTIN (or the event\'s State).',
    hotel: 'Hotel billed on its own: POS is the property\'s location (Sec 12(3), TV18).',
    exportChk: 'Export check (Sec 2(6)): {ok} / {of} — {v}', verdicts: 'export,not an export,payment pending,not known',
    dmc: 'Foreign supplier, services abroad: no import RCM where the POS is outside India — verify (TV20).', tdsHint: 'TDS hint: {label} (TV23)',
    events: 'Events', venue: 'Venue', city: 'City', state: 'State', guests: 'Guests', abroad: 'Abroad', head: 'Head', approved: 'Approved', booked: 'Booked',
    billedV: 'Billed by vendors', paid: 'Paid', over: 'Over budget', addHead: 'Add head', invoiced: 'Invoiced', received: 'Received',
    advances: 'Client advances (open)', noEvents: 'No event files yet — tick "Event" on a new file.', feeRule: 'Event management fee: SAC {sac}, GST {rate} % (TV22).',
    fy: 'FY', buyer: 'Buyer', pan: 'PAN', docs: 'Invoices', base: 'Base', collected: 'TCS collected', quarter: 'Quarter', panMissing: 'PAN missing',
    near: 'Near the threshold (slab years)', challans: 'Challans and returns', noTcs: 'No tour-package TCS in this FY.', tcsBase: 'TCS base', bases: 'Invoice total incl. GST,Taxable value',
  } as const,
  {
    tcsHead: 'TCS — विदेशी टूर पैकेज', tcsCalc: 'TCS {rate} % = {amount}', tcsApply: 'TCS लगाएँ', applied: 'TCS लगाया गया।',
    tcsForce: 'विदेशी टूर पैकेज (यात्रा + ठहराव)', tcsNr: 'ख़रीदार अनिवासी है, भारत में नहीं',
    notPackage: 'पैकेज नहीं (केवल टिकट या होटल) — TCS नहीं (जैसा बताया गया, TV4)।', nonResident: 'अनिवासी, भारत में नहीं — TCS नहीं (TV5)।',
    off: 'इस तारीख़ पर टूर पैकेज TCS नहीं।', noPan: 'PAN नहीं — ऊँची दर लगेगी (TV5)।',
    posHead: 'आपूर्ति का स्थान', posApply: 'यह POS लें', useExempt: 'छूट व्यवस्था लें',
    'pos.reg': 'पंजीकृत ग्राहक → उसका राज्य (धारा 12(2), TV18)।', 'pos.addr': 'अपंजीकृत ग्राहक → रिकॉर्ड का पता (धारा 12(2), TV18)।',
    'pos.inbound': 'भारत में सेवा — POS भारत, विदेशी मुद्रा में भी निर्यात नहीं (धारा 13(3)(b), TV19)।',
    'pos.outside': 'विदेशी पर्यटक का पूरी तरह भारत के बाहर टूर — छूट व्यवस्था लग सकती है (TV10)।',
    'pos.event_reg': 'इवेंट, पंजीकृत ग्राहक → ग्राहक का राज्य (धारा 12(7)(a), TV21)।',
    'pos.event_venue': 'इवेंट, अपंजीकृत ग्राहक → जहाँ इवेंट होता है (धारा 12(7)(a), TV21)।',
    'pos.event_abroad': 'विदेश में इवेंट → ग्राहक का स्थान (धारा 12(7)(a), TV21)।',
    'pos.unknown': 'ग्राहक का राज्य या GSTIN (या इवेंट का राज्य) जोड़ें।',
    hotel: 'होटल अलग से बिल: POS संपत्ति का स्थान (धारा 12(3), TV18)।',
    exportChk: 'निर्यात जाँच (धारा 2(6)): {ok} / {of} — {v}', verdicts: 'निर्यात,निर्यात नहीं,भुगतान बाक़ी,पता नहीं',
    dmc: 'विदेशी आपूर्तिकर्ता, विदेश में सेवा: POS भारत के बाहर हो तो आयात RCM नहीं — जाँचें (TV20)।', tdsHint: 'TDS संकेत: {label} (TV23)',
    events: 'कार्यक्रम (इवेंट)', venue: 'आयोजन स्थल', city: 'शहर', state: 'राज्य', guests: 'मेहमान', abroad: 'विदेश', head: 'मद', approved: 'स्वीकृत', booked: 'बुक',
    billedV: 'वेंडर के बिल', paid: 'भुगतान', over: 'बजट से ऊपर', addHead: 'मद जोड़ें', invoiced: 'बिल किया', received: 'प्राप्त',
    advances: 'ग्राहक अग्रिम (बाक़ी)', noEvents: 'अभी कोई इवेंट फ़ाइल नहीं — नई फ़ाइल पर "इवेंट" चुनें।', feeRule: 'इवेंट प्रबंधन शुल्क: SAC {sac}, GST {rate} % (TV22)।',
    fy: 'वित्त वर्ष', buyer: 'ख़रीदार', pan: 'PAN', docs: 'बिल', base: 'आधार', collected: 'स्रोत पर कर संग्रह (TCS)', quarter: 'तिमाही', panMissing: 'PAN नहीं',
    near: 'सीमा के पास (स्लैब वर्ष)', challans: 'चालान और रिटर्न', noTcs: 'इस वर्ष टूर पैकेज TCS नहीं।', tcsBase: 'TCS आधार', bases: 'GST सहित बिल कुल,कर-योग्य मूल्य',
  },
);

/** The label of `id` in the comma list `key` whose ids are `ids`. */
export const tvdList = (key: 'verdicts' | 'bases', ids: readonly string[], id: string): string => tvdT(key).split(',')[ids.indexOf(id)] ?? id;
