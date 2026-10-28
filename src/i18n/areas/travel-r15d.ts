/**
 * R15-D: outbound TCS, place of supply and events strings (editor chips, bill hints, the `tcs` and `events` views).
 * Shared words (trip, supplier, TCS, margin …) come from `travel-r15b.ts`. Lists are comma strings in id order.
 */
import { defineArea } from '../area';

export const tvdT = defineArea(
  {
    tcsHead: 'TCS — overseas tour package', tcsCalc: 'TCS {rate} % = {amount}', tcsApply: 'Apply TCS',
    tcsForce: 'Overseas tour package', tcsNr: 'Non-resident, not in India',
    notPackage: 'Ticket or hotel alone: no TCS (TV4).', nonResident: 'Non-resident: no TCS (TV5).', off: 'No TCS on this date.', noPan: 'No PAN: higher rate (TV5).',
    posHead: 'Place of supply', posApply: 'Use this POS', useExempt: 'Use the exempt regime',
    'pos.reg': 'Registered: its State (12(2), TV18)', 'pos.addr': 'Unregistered: address on record (12(2), TV18)',
    'pos.inbound': 'In India: POS India, not an export (13(3)(b), TV19)', 'pos.outside': 'Foreign tourist, tour abroad: exempt? (TV10)',
    'pos.event_reg': 'Event, registered: client\'s State (12(7)(a), TV21)', 'pos.event_venue': 'Event, unregistered: venue State (12(7)(a), TV21)',
    'pos.event_abroad': 'Event abroad: client\'s location (12(7)(a), TV21)', 'pos.unknown': 'Add the State or GSTIN.',
    hotel: 'Hotel alone: property\'s location (12(3), TV18)',
    exportChk: 'Sec 2(6): {ok} / {of} — {v}', verdicts: 'export,not an export,payment pending,not known',
    dmc: 'Abroad: no import RCM? Verify (TV20).', tdsHint: 'TDS hint: {label} (TV23)',
    events: 'Events', venue: 'Venue', city: 'City', state: 'State', guests: 'Guests', abroad: 'Abroad', head: 'Head', approved: 'Approved', booked: 'Booked',
    billedV: 'Billed by vendors', paid: 'Paid', over: 'Over budget', addHead: 'Add head', invoiced: 'Invoiced', received: 'Received',
    advances: 'Client advances (open)', noEvents: 'No event files yet.', feeRule: 'Fee: SAC {sac}, {rate} % (TV22)',
    fy: 'FY', buyer: 'Buyer', pan: 'PAN', docs: 'Invoices', base: 'Base', collected: 'TCS collected', quarter: 'Q', panMissing: 'PAN missing',
    near: 'Near the threshold', challans: 'Challans and returns', noTcs: 'None this FY.', tcsBase: 'TCS base', bases: 'Total incl. GST,Taxable value',
  } as const,
  {
    tcsHead: 'TCS — विदेशी टूर पैकेज', tcsCalc: 'TCS {rate} % = {amount}', tcsApply: 'TCS लगाएँ',
    tcsForce: 'विदेशी टूर पैकेज', tcsNr: 'अनिवासी, भारत में नहीं',
    notPackage: 'केवल टिकट या होटल: TCS नहीं (TV4)।', nonResident: 'अनिवासी: TCS नहीं (TV5)।', off: 'इस तारीख़ पर TCS नहीं।', noPan: 'PAN नहीं: ऊँची दर (TV5)।',
    posHead: 'आपूर्ति का स्थान', posApply: 'यह POS लें', useExempt: 'छूट व्यवस्था लें',
    'pos.reg': 'पंजीकृत: उसका राज्य (12(2), TV18)', 'pos.addr': 'अपंजीकृत: रिकॉर्ड का पता (12(2), TV18)',
    'pos.inbound': 'भारत में: POS भारत, निर्यात नहीं (13(3)(b), TV19)', 'pos.outside': 'विदेशी पर्यटक, विदेश टूर: छूट? (TV10)',
    'pos.event_reg': 'इवेंट, पंजीकृत: ग्राहक का राज्य (12(7)(a), TV21)', 'pos.event_venue': 'इवेंट, अपंजीकृत: आयोजन स्थल का राज्य (12(7)(a), TV21)',
    'pos.event_abroad': 'विदेश में इवेंट: ग्राहक का स्थान (12(7)(a), TV21)', 'pos.unknown': 'राज्य या GSTIN जोड़ें।',
    hotel: 'केवल होटल: संपत्ति का स्थान (12(3), TV18)',
    exportChk: 'धारा 2(6): {ok} / {of} — {v}', verdicts: 'निर्यात,निर्यात नहीं,भुगतान बाक़ी,पता नहीं',
    dmc: 'विदेश में: आयात RCM नहीं? जाँचें (TV20)।', tdsHint: 'TDS संकेत: {label} (TV23)',
    events: 'कार्यक्रम (इवेंट)', venue: 'आयोजन स्थल', city: 'शहर', state: 'राज्य', guests: 'मेहमान', abroad: 'विदेश', head: 'मद', approved: 'स्वीकृत', booked: 'बुक',
    billedV: 'वेंडर के बिल', paid: 'भुगतान', over: 'बजट से ऊपर', addHead: 'मद जोड़ें', invoiced: 'बिल किया', received: 'प्राप्त',
    advances: 'ग्राहक अग्रिम (बाक़ी)', noEvents: 'अभी कोई इवेंट फ़ाइल नहीं।', feeRule: 'शुल्क: SAC {sac}, {rate} % (TV22)',
    fy: 'वित्त वर्ष', buyer: 'ख़रीदार', pan: 'PAN', docs: 'बिल', base: 'आधार', collected: 'स्रोत पर कर संग्रह (TCS)', quarter: 'तिमाही', panMissing: 'PAN नहीं',
    near: 'सीमा के पास', challans: 'चालान और रिटर्न', noTcs: 'इस वर्ष कुछ नहीं।', tcsBase: 'TCS आधार', bases: 'GST सहित कुल,कर-योग्य मूल्य',
  },
);

/** The label of `id` in the comma list `key` whose ids are `ids`. */
export const tvdList = (key: 'verdicts' | 'bases', ids: readonly string[], id: string): string => tvdT(key).split(',')[ids.indexOf(id)] ?? id;
