/**
 * R7-B hotel folio and billing (Folios view, check-out, cancellations, OTA payouts, the "Room" settle / tender). Common
 * words come from the front-desk area (`hT`). Trade words stay English in Hindi too (folio, OTA, TCS, TDS, GST).
 */
import { defineArea } from '../area';

export const bT = defineArea(
  {
    'tab.folios': 'Folios', 'tab.cancel': 'Cancellations', 'tab.ota': 'OTA payouts',
    wp: 'A folio is not a tax document: GST is charged on the check-out invoice. Working paper — verify with your CA.',
    folio: 'Folio', payer: 'Payer', toBill: 'To bill', date: 'Date', desc: 'Description', qty: 'Qty', rate: 'Rate', gst: 'GST %',
    house: 'House folio', client: 'Client', item: 'Catalogue item', post: 'Post charge', split: 'Split', transfer: 'Transfer', void: 'Void',
    window: 'Window', toFolio: 'To folio', moved: 'from {f}', pin: 'Owner PIN (above the void limit)', pinBad: 'Wrong PIN.',
    proforma: 'Pro-forma — not a tax invoice', 'bk.guest': 'Guest', 'bk.company': 'Company', 'bk.agent': 'Travel agent',
    routing: 'Window {w} kinds', tdsDefault: 'TDS deducted', commissionPct: 'Commission %', commission: 'Agent commission due {a} (194H): book it as a bill when the agent invoices — verify with your CA.', agentBill: 'Agent commission bill', agentDone: 'Commission bill draft saved with 194H — post it from the bill drafts.', // R16-C5
    interim: 'Interim invoice', interimDue: 'Interim invoice due ({d})', company: 'Guest company',
    adv: 'Advance', pay: 'Payment', credit: 'Payment (else on credit)', rateChip: 'Rate changed on {d} — {n} nights affected',
    saveInvoices: 'Save invoices', saved: 'Saved: {n}', 'band.low': '5% band', 'band.high': '18% band', 'band.mixed': 'Mixed bands',
    free: 'Free cancellation', waive: 'Waive', refund: 'Refund rest by', payout: 'Payout', ref: 'Ref', commPct: 'Commission',
    due: 'Due', net: 'Net', gap: 'Difference {g}', postPayout: 'Post payout', roomCharge: 'Charge to room',
    sig: 'Print signature slip', charged: 'Charged to room {r}', noRooms: 'No guest is in house.',
    undo: 'Undo room charge', toPost: '{n} night(s) not posted by the night audit ({d}): they are posted when you save.', postNow: 'Post them now',
    yearEndGo: 'Interim invoices dated 31 March',
  } as const,
  {
    'tab.folios': 'फ़ोलियो', 'tab.cancel': 'रद्द बुकिंग', 'tab.ota': 'OTA भुगतान',
    wp: 'फ़ोलियो टैक्स दस्तावेज़ नहीं है: GST चेक-आउट इनवॉइस पर लगता है। कार्य-पत्र — CA से जाँचें।',
    folio: 'फ़ोलियो', payer: 'भुगतानकर्ता', toBill: 'बिल बाकी', date: 'तारीख़', desc: 'विवरण', qty: 'मात्रा', rate: 'दर', gst: 'GST %',
    house: 'हाउस फ़ोलियो', client: 'ग्राहक', item: 'कैटलॉग आइटम', post: 'शुल्क जोड़ें', split: 'बाँटें', transfer: 'ट्रांसफ़र', void: 'रद्द करें',
    window: 'विंडो', toFolio: 'किस फ़ोलियो में', moved: '{f} से', pin: 'मालिक का PIN (रद्द सीमा से ऊपर)', pinBad: 'गलत PIN।',
    proforma: 'प्रो-फ़ॉर्मा — टैक्स इनवॉइस नहीं', 'bk.guest': 'मेहमान', 'bk.company': 'कंपनी', 'bk.agent': 'ट्रैवल एजेंट',
    routing: 'विंडो {w} के प्रकार', tdsDefault: 'काटा गया TDS', commissionPct: 'कमीशन %', commission: 'एजेंट कमीशन देय {a} (194H): एजेंट का बिल आने पर बिल दर्ज करें — CA से जाँचें।', agentBill: 'एजेंट कमीशन बिल', agentDone: '194H सहित कमीशन बिल ड्राफ़्ट सहेजा — बिल ड्राफ़्ट से पोस्ट करें।',
    interim: 'अंतरिम इनवॉइस', interimDue: 'अंतरिम इनवॉइस देय ({d})', company: 'मेहमान की कंपनी',
    adv: 'एडवांस', pay: 'भुगतान', credit: 'भुगतान (वरना उधार)', rateChip: '{d} को दर बदली — {n} रातें प्रभावित',
    saveInvoices: 'इनवॉइस सेव करें', saved: 'सेव हुआ: {n}', 'band.low': '5% बैंड', 'band.high': '18% बैंड', 'band.mixed': 'मिले-जुले बैंड',
    free: 'मुफ़्त रद्द', waive: 'माफ़ करें', refund: 'बाकी वापसी', payout: 'भुगतान राशि', ref: 'रेफ़', commPct: 'कमीशन',
    due: 'देय', net: 'शुद्ध', gap: 'अंतर {g}', postPayout: 'भुगतान दर्ज करें', roomCharge: 'कमरे के बिल में',
    sig: 'हस्ताक्षर पर्ची प्रिंट', charged: 'कमरा {r} के बिल में जोड़ा', noRooms: 'कोई मेहमान ठहरा नहीं है।',
    undo: 'रूम चार्ज वापस लें', toPost: '{n} रात(ें) नाइट ऑडिट में दर्ज नहीं ({d}): सेव करने पर दर्ज होंगी।', postNow: 'अभी दर्ज करें',
    yearEndGo: '31 मार्च की तारीख़ के अंतरिम इनवॉइस',
  },
);
