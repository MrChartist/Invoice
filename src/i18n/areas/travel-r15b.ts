/**
 * R15-B: travel core strings (picker, Trips desk, editor / bill rows). The words used by more than one package (trip,
 * booking, supplier, passengers, sell, cost, margin, cancellation, refund, TCS) live here once; C / D import them.
 * Lists (`comps`, `sts`, `bsts`, `regs`, `scopes`, `filters`) are comma-separated, in the order of their ids.
 */
import { defineArea } from '../area';

export const tvT = defineArea(
  {
    title: 'Travel, tours and events', custom: 'Custom',
    'kind.tour_operator': 'Tour operator', 'kind.agent': 'Travel / ticketing agent', 'kind.inbound': 'Inbound tours / DMC', 'kind.events': 'Events / weddings / MICE', 'kind.other': 'Other travel service',
    'hint.tour_operator': 'Packages, 5 % / 18 %, TCS on outbound.', 'hint.agent': 'Service fee + pure agent, tickets, statements.', 'hint.inbound': 'Foreign tourists, currency, POS check.', 'hint.events': 'Budgets, vendors, event POS.', 'hint.other': 'Trips and bookings.',
    bsp: 'IATA / BSP agent (else via a consolidator)', alsoTravel: 'We also book travel',
    trip: 'Trip', trips: 'Trips', booking: 'Booking', bookings: 'Bookings', supplier: 'Supplier', pax: 'Passengers', sell: 'Sell', cost: 'Cost', margin: 'Margin', cancellation: 'Cancellation', refund: 'Refund', tcs: 'TCS',
    newTrip: 'New trip / event', name: 'Name', client: 'Client', code: 'Code', event: 'Event', scope: 'Scope', destination: 'Destination', from: 'From', to: 'To',
    paxNames: 'Passengers (a, b, …)', regime: 'GST regime', status: 'Status', component: 'Component', ref: 'PNR / ref.', fx: 'Rate',
    pureAgent: 'Pure agent (at actual)', save: 'Save', add: 'Add', remove: 'Remove', confirm: 'Confirm', bill: 'Bill', open: 'Open', billed: 'Billed',
    unbilled: 'Unbilled', unpaid: 'Supplier unpaid', unconfirmed: 'Unconfirmed', none: 'No trips yet.', total: 'Total',
    itcBlocked: 'No input ITC on a 5 % trip (TV8).', loss: 'Cancellation loss', commission: 'Commission',
    margins: 'Trip margin', month: 'Month', itcList: 'ITC claimed on 5 % trips', reason: 'Reason', regimeDefault: 'Default regime', mix: '5 % line mixed with other rates (TV9).',
    itcReason: 'Why claim ITC?', needReason: 'ITC on a 5 % trip needs a reason (TV8).', made: 'Draft {n} made.', wp: 'Working papers — verify with your CA.',
    comps: 'Air,Rail,Bus,Hotel,Transfer,Sightseeing,Visa,Insurance,Package,Venue,Catering,Decor,Artist,AV,Manpower,Other',
    sts: 'Enquiry,Confirmed,Travelled,Closed,Cancelled', bsts: 'Held,Confirmed,Cancelled', scopes: 'Domestic,Outbound,Inbound',
    regs: '5 % (no ITC),18 %,Agent fee + pure agent,Exempt (abroad)',
    filters: 'All,Unconfirmed,Unbilled,Supplier unpaid,Next 7 days',
  } as const,
  {
    title: 'यात्रा, टूर और इवेंट', custom: 'कस्टम',
    'kind.tour_operator': 'टूर ऑपरेटर', 'kind.agent': 'ट्रैवल / टिकटिंग एजेंट', 'kind.inbound': 'इनबाउंड टूर / DMC', 'kind.events': 'इवेंट / शादी / MICE', 'kind.other': 'अन्य यात्रा सेवा',
    'hint.tour_operator': 'टूर पैकेज, 5 % / 18 %, विदेशी टूर पर TCS।', 'hint.agent': 'सेवा शुल्क + शुद्ध एजेंट, टिकट, विवरण।', 'hint.inbound': 'विदेशी पर्यटक, मुद्रा, POS जाँच।', 'hint.events': 'बजट, वेंडर, इवेंट POS।', 'hint.other': 'यात्रा फ़ाइल और बुकिंग।',
    bsp: 'IATA / BSP एजेंट (वरना कंसॉलिडेटर से)', alsoTravel: 'हम यात्रा भी बुक करते हैं',
    trip: 'यात्रा फ़ाइल', trips: 'यात्रा फ़ाइलें', booking: 'बुकिंग', bookings: 'बुकिंग', supplier: 'आपूर्तिकर्ता', pax: 'यात्री', sell: 'बिक्री', cost: 'लागत', margin: 'मार्जिन', cancellation: 'रद्दीकरण', refund: 'धनवापसी', tcs: 'TCS',
    newTrip: 'नई यात्रा / इवेंट', name: 'नाम', client: 'ग्राहक', code: 'कोड', event: 'कार्यक्रम (इवेंट)', scope: 'दायरा', destination: 'गंतव्य', from: 'से', to: 'तक',
    paxNames: 'यात्री (a, b, …)', regime: 'GST व्यवस्था', status: 'स्थिति', component: 'घटक', ref: 'PNR / संदर्भ', fx: 'दर',
    pureAgent: 'शुद्ध एजेंट के रूप में वसूली', save: 'सहेजें', add: 'जोड़ें', remove: 'हटाएँ', confirm: 'पक्का करें', bill: 'बिल बनाएँ', open: 'खोलें', billed: 'बिल हुआ',
    unbilled: 'बिना बिल', unpaid: 'आपूर्तिकर्ता बकाया', unconfirmed: 'अपुष्ट', none: 'अभी कोई यात्रा नहीं।', total: 'कुल',
    itcBlocked: '5 % यात्रा पर इनपुट ITC नहीं (TV8)।', loss: 'रद्दीकरण हानि', commission: 'कमीशन',
    margins: 'यात्रा मार्जिन', month: 'महीना', itcList: '5 % यात्राओं पर लिया गया ITC', reason: 'कारण', regimeDefault: 'डिफ़ॉल्ट व्यवस्था', mix: '5 % पंक्ति दूसरी दरों के साथ (TV9)।',
    itcReason: 'ITC लेने का कारण', needReason: '5 % यात्रा पर ITC लेने के लिए कारण लिखें (TV8)।', made: 'ड्राफ़्ट {n} बना।', wp: 'कार्य-पत्र — अपने CA से जाँचें।',
    comps: 'हवाई टिकट,रेल,बस,होटल,ट्रांसफ़र,भ्रमण,वीज़ा,बीमा,टूर पैकेज,आयोजन स्थल,कैटरिंग,सजावट,कलाकार,AV,मैनपावर,अन्य',
    sts: 'पूछताछ,पक्का,यात्रा हुई,बंद,रद्द', bsts: 'होल्ड,पक्का,रद्द', scopes: 'देशी,विदेश यात्रा,विदेशी पर्यटक',
    regs: '5 % (बिना ITC),18 %,एजेंट शुल्क + शुद्ध एजेंट,छूट (विदेश में)',
    filters: 'सभी,अपुष्ट,बिना बिल,आपूर्तिकर्ता बकाया,अगले 7 दिन',
  },
);

/** The label of `id` in the comma-separated list `key` whose ids are `ids`. */
export const tvList = (key: 'comps' | 'sts' | 'bsts' | 'scopes' | 'regs' | 'filters', ids: readonly string[], id: string): string => tvT(key).split(',')[ids.indexOf(id)] ?? id;
