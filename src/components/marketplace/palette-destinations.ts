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
  { 'r11.ra': 'RA bills (running account)', 'r11.realty': 'Realty (builder desk)', 'r11.realty.projects': 'Realty projects (RERA)', 'r11.realty.units': 'Flats / units grid', 'r11.realty.bookings': 'Bookings & cost sheets', 'r11.realty.plans': 'Payment plans (CLP)', 'r11.realty.demands': 'Demand letters (stage demands)', 'r11.realty.rera': 'RERA 70% account', 'r11.realty.cancellations': 'Booking cancellations', 'r11.realty.procurement': '80% procurement test (RCM)', 'r11.subcon': 'Sub-contract work orders & bills', 'r11.labour': 'Labour contractors & site muster', 'r11.plant': 'Plant log sheets & hire', 'r11.reco': 'Cement / steel reconciliation', 'r11.pnl': 'Site P&L (works)' } as const,
  { 'r11.ra': 'रनिंग बिल', 'r11.realty': 'रियल्टी (बिल्डर डेस्क)', 'r11.realty.projects': 'रियल्टी प्रोजेक्ट (रेरा)', 'r11.realty.units': 'फ़्लैट / यूनिट ग्रिड', 'r11.realty.bookings': 'बुकिंग और कॉस्ट शीट', 'r11.realty.plans': 'भुगतान योजना (CLP)', 'r11.realty.demands': 'माँग पत्र (चरण माँग)', 'r11.realty.rera': 'रेरा 70% खाता', 'r11.realty.cancellations': 'बुकिंग रद्दीकरण', 'r11.realty.procurement': '80% ख़रीद जाँच (RCM)', 'r11.subcon': 'उप-ठेका कार्य आदेश और बिल', 'r11.labour': 'लेबर ठेकेदार और साइट हाज़िरी', 'r11.plant': 'प्लांट लॉग शीट और किराया', 'r11.reco': 'सीमेंट / स्टील मिलान', 'r11.pnl': 'साइट लाभ-हानि (वर्क्स)' },
);

// R10 rows (kept here so the palette does not load the service areas).
const r10T = defineArea(
  { 'r10.appointments': 'Appointments (front desk)', 'r10.day': 'Appointment book (day)', 'r10.week': 'Appointment book (week)', 'r10.queue': 'Walk-in queue & tokens', 'r10.birthdays': 'Reminders & birthdays', 'r10.commission': 'Staff & commission', 'r10.staff': 'Service staff', 'r10.plans': 'Commission plans', 'r10.statement': 'Commission statement & payout', 'r10.clinic': 'Clinic desk', 'r10.patients': 'Patients', 'r10.opd': 'OPD visits & tokens', 'r10.ipd': 'In-patient bills', 'r10.lab': 'Lab orders & reports', 'r10.tests': 'Lab test master', 'r10.referrals': 'Referring doctors', 'r10.rates': 'Rate list', 'r10.members': 'Members desk', 'r10.memberPlans': 'Membership plans & packages', 'r10.memberList': 'Members', 'r10.checkin': 'Check-in', 'r10.classes': 'Classes & PT sessions', 'r10.recipes': 'Service recipes (back-bar)', 'r10.batches': 'Coaching batches & timetable', 'r10.attendance': 'Attendance', 'r10.refunds': 'Coaching refunds', 'r10.workshop': 'Workshop desk', 'r10.jobs': 'Job cards', 'r10.estimates': 'Estimates & approvals', 'r10.claims': 'Insurance / payer claims', 'r10.reminders': 'Service reminders', 'r10.labour': 'Labour operations', 'r10.vehicles': 'Vehicles & appliances' } as const,
  { 'r10.appointments': 'अपॉइंटमेंट (फ्रंट डेस्क)', 'r10.day': 'अपॉइंटमेंट बुक (दिन)', 'r10.week': 'अपॉइंटमेंट बुक (सप्ताह)', 'r10.queue': 'वॉक-इन कतार और टोकन', 'r10.birthdays': 'रिमाइंडर और जन्मदिन', 'r10.commission': 'स्टाफ और कमीशन', 'r10.staff': 'सेवा स्टाफ', 'r10.plans': 'कमीशन प्लान', 'r10.statement': 'कमीशन स्टेटमेंट और भुगतान', 'r10.clinic': 'क्लिनिक डेस्क', 'r10.patients': 'मरीज़', 'r10.opd': 'OPD विज़िट और टोकन', 'r10.ipd': 'भर्ती मरीज़ के बिल', 'r10.lab': 'लैब ऑर्डर और रिपोर्ट', 'r10.tests': 'लैब जाँच सूची', 'r10.referrals': 'रेफ़र करने वाले डॉक्टर', 'r10.rates': 'रेट सूची', 'r10.members': 'सदस्य डेस्क', 'r10.memberPlans': 'सदस्यता प्लान और पैकेज', 'r10.memberList': 'सदस्य', 'r10.checkin': 'चेक-इन', 'r10.classes': 'क्लास और PT सेशन', 'r10.recipes': 'सेवा रेसिपी (बैक-बार)', 'r10.batches': 'कोचिंग बैच और समय-सारणी', 'r10.attendance': 'हाज़िरी', 'r10.refunds': 'कोचिंग रिफ़ंड', 'r10.workshop': 'वर्कशॉप डेस्क', 'r10.jobs': 'जॉब कार्ड', 'r10.estimates': 'एस्टिमेट और मंज़ूरी', 'r10.claims': 'बीमा / भुगतानकर्ता क्लेम', 'r10.reminders': 'सर्विस रिमाइंडर', 'r10.labour': 'लेबर काम', 'r10.vehicles': 'वाहन और उपकरण' },
);

// R12 rows (kept here so the palette does not load the agri areas).
const r12T = defineArea(
  { 'r12.farm': 'Farm desk', 'r12.farm.farmers': 'Farmers & members', 'r12.farm.vouchers': 'Farmer purchase vouchers (FPV)', 'r12.farm.cycles': 'Farmer payment cycles', 'r12.farm.quality': 'Quality-cut tables', 'r12.farm.batches': 'Farm batches (flock / pond / herd)', 'r12.dairy': 'Dairy desk', 'r12.dairy.charts': 'Fat / SNF rate charts', 'r12.dairy.collection': 'Milk collection (shifts)', 'r12.dairy.bills': 'Milk bills', 'r12.dairy.dispatch': 'Milk dispatch & reconciliation', 'r12.dairy.products': 'Dairy products', 'r12.dairy.cards': 'Household milk cards', 'r12.mill': 'Mill desk', 'r12.mill.intake': 'Gate entry & weighbridge', 'r12.mill.batches': 'Milling batches (outturn)', 'r12.mill.cmr': 'Custom milling (CMR)', 'r12.mill.yield': 'Mill yield reports', 'r12.cold': 'Cold storage desk', 'r12.cold.lots': 'Cold storage lots & receipts', 'r12.cold.gatepasses': 'Gate passes', 'r12.cold.rent': 'Storage rent', 'r12.cold.loans': 'Loans against lots', 'r12.cold.chambers': 'Chambers', 'r12.inputs': 'Input dealer desk', 'r12.inputs.licences': 'Dealer licences', 'r12.inputs.subsidy': 'Subsidised fertiliser (PoS)', 'r12.inputs.credit': 'Credit till harvest', 'r12.members': 'Members desk (FPO / co-op)', 'r12.members.register': 'Member register', 'r12.members.shares': 'Shares & certificates', 'r12.members.patronage': 'Patronage / price difference', 'r12.members.papers': '80P / 80PA papers' } as const,
  { 'r12.farm': 'खेती डेस्क', 'r12.farm.farmers': 'किसान और सदस्य', 'r12.farm.vouchers': 'किसान ख़रीद वाउचर (FPV)', 'r12.farm.cycles': 'किसान भुगतान चक्र', 'r12.farm.quality': 'गुणवत्ता कटौती तालिका', 'r12.farm.batches': 'फ़ार्म बैच (फ़्लॉक / तालाब / झुंड)', 'r12.dairy': 'डेयरी डेस्क', 'r12.dairy.charts': 'फैट / एसएनएफ दर तालिका', 'r12.dairy.collection': 'दूध संग्रह (पाली)', 'r12.dairy.bills': 'दूध बिल', 'r12.dairy.dispatch': 'दूध डिस्पैच और मिलान', 'r12.dairy.products': 'डेयरी उत्पाद', 'r12.dairy.cards': 'घरेलू दूध कार्ड', 'r12.mill': 'मिल डेस्क', 'r12.mill.intake': 'गेट एंट्री और कांटा', 'r12.mill.batches': 'मिलिंग बैच (आउटटर्न)', 'r12.mill.cmr': 'कस्टम मिलिंग (CMR)', 'r12.mill.yield': 'मिल उपज रिपोर्ट', 'r12.cold': 'शीतगृह डेस्क', 'r12.cold.lots': 'शीतगृह लॉट और रसीद', 'r12.cold.gatepasses': 'गेट पास', 'r12.cold.rent': 'भंडारण किराया', 'r12.cold.loans': 'लॉट पर ऋण', 'r12.cold.chambers': 'चैंबर', 'r12.inputs': 'खाद-बीज डेस्क', 'r12.inputs.licences': 'विक्रेता लाइसेंस', 'r12.inputs.subsidy': 'सब्सिडी खाद (PoS)', 'r12.inputs.credit': 'फ़सल तक उधार', 'r12.members': 'सदस्य डेस्क (FPO / सहकारी)', 'r12.members.register': 'सदस्य रजिस्टर', 'r12.members.shares': 'अंश और प्रमाणपत्र', 'r12.members.patronage': 'संरक्षण बोनस / मूल्य अंतर', 'r12.members.papers': '80P / 80PA पत्र' },
);

/** A row's label: a key of this package's area, else (B / C rows until they resolve their own) the key text. */
const label = (key: string, pack?: string): string => (pack === 'hotel' && Object.hasOwn(hT.en, key) ? hT(key as keyof typeof hT.en) : Object.hasOwn(mT.en, key) ? mT(key as keyof typeof mT.en) : Object.hasOwn(twT.en, key) ? twT(key as keyof typeof twT.en) : Object.hasOwn(cT.en, key) ? cT(key as keyof typeof cT.en) : Object.hasOwn(r8T.en, key) ? r8T(key as keyof typeof r8T.en) : Object.hasOwn(r9T.en, key) ? r9T(key as keyof typeof r9T.en) : Object.hasOwn(r11T.en, key) ? r11T(key as keyof typeof r11T.en) : Object.hasOwn(r10T.en, key) ? r10T(key as keyof typeof r10T.en) : Object.hasOwn(r12T.en, key) ? r12T(key as keyof typeof r12T.en) : key);

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
