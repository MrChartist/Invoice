/** R21-B: shifts, attendant settlement, day close and the daily sales register (shared pump words live in `fuel-r21a`). */
import { defineArea } from '../area';

export const fbT = defineArea(
  {
    eClosing: 'Nozzle {n}: type the closing reading.', eBelow: 'Nozzle {n}: the closing reading is below the opening.', eNegative: 'Nozzle {n}: the test litres are more than the meter litres.',
    eNoPrice: 'Nozzle {n}: no price in force at {at} (Inventory → Fuel → Prices).', eSplit: 'Nozzle {n}: the readings at the price change must lie between the opening and the closing.',
    eDup: 'Shift {n} of {d} is already open.', eAtt: 'Give at least one attendant the nozzles they hold.', eTwice: 'A nozzle can be held by one attendant only.',
    eNoShift: 'The shift was not found.', ePosted: 'The shift is posted: undo the day close first.', eReason: 'Nozzle {n}: the opening differs from the last closing — type the reason.',
    eCloseAt: 'The closing time must be after the shift opened.', eNotOpen: 'Only an open shift can be deleted.', eNothing: 'No closed shift on this day.', eNotPosted: 'The shift is not posted.',
    eSettled: 'This shortage is already settled.', eNoShort: 'Nothing short.', eOver: 'Nozzle {n}: bills and slips exceed the meter litres.',
    open: 'Open shift', no: 'Shift no.', start: 'Starts', atts: 'Attendants (comma separated)', heldBy: 'Held by', opening: 'Opening', closing: 'Closing', split: 'Reading at price change',
    reason: 'Reason', sold: 'Sold (L)', value: 'Value ₹', save: 'Save', close: 'Close shift', closeAt: 'Closed at', expected: 'Expected ₹', collected: 'Collected ₹', diff: 'Short − / excess +',
    counter: 'Counter litres (Bill of Supply)', dayClose: 'Day close', upi: 'UPI to', posted: 'Posted: {no}', recover: 'Recover in cash', writeOff: 'Write off', undo: 'Undo day close',
    noShifts: 'No shifts on this day.', 's.open': 'Open', 's.closed': 'Closed', 's.posted': 'Posted', done: 'Done.', excess: 'Excess ₹{v} is not a receipt: post it in Books to "Excess at pump" (other income).',
    'm.cash': 'Cash', 'm.upi': 'UPI', 'm.card': 'Card', 'm.fleet': 'Fleet card', 'm.loyalty': 'OMC loyalty', 'm.credit': 'Credit slips',
    print: 'Print', title: 'Daily sales register', rate: 'Rate', products: 'Products', collections: 'Collections', credit: 'Credit sales ₹{v}', people: 'Short / excess',
  } as const,
  {
    eClosing: 'नोज़ल {n}: क्लोज़िंग रीडिंग लिखें।', eBelow: 'नोज़ल {n}: क्लोज़िंग रीडिंग ओपनिंग से कम है।', eNegative: 'नोज़ल {n}: टेस्ट लीटर मीटर लीटर से ज़्यादा हैं।',
    eNoPrice: 'नोज़ल {n}: {at} पर कोई दर लागू नहीं (इन्वेंटरी → ईंधन → दरें)।', eSplit: 'नोज़ल {n}: दर बदलने पर की रीडिंग ओपनिंग और क्लोज़िंग के बीच होनी चाहिए।',
    eDup: '{d} की शिफ्ट {n} पहले से खुली है।', eAtt: 'कम से कम एक कर्मचारी को उसके नोज़ल दें।', eTwice: 'एक नोज़ल केवल एक कर्मचारी के पास हो सकता है।',
    eNoShift: 'शिफ्ट नहीं मिली।', ePosted: 'शिफ्ट पोस्ट हो चुकी है: पहले दिन का क्लोज़ वापस लें।', eReason: 'नोज़ल {n}: ओपनिंग पिछली क्लोज़िंग से अलग है — कारण लिखें।',
    eCloseAt: 'क्लोज़िंग का समय शिफ्ट खुलने के बाद होना चाहिए।', eNotOpen: 'केवल खुली शिफ्ट हटाई जा सकती है।', eNothing: 'इस दिन कोई बंद शिफ्ट नहीं।', eNotPosted: 'शिफ्ट पोस्ट नहीं हुई है।',
    eSettled: 'यह कमी पहले ही निपटाई जा चुकी है।', eNoShort: 'कोई कमी नहीं।', eOver: 'नोज़ल {n}: बिल और पर्चियाँ मीटर लीटर से ज़्यादा हैं।',
    open: 'शिफ्ट खोलें', no: 'शिफ्ट नं.', start: 'शुरू', atts: 'कर्मचारी (कॉमा से अलग)', heldBy: 'किसके पास', opening: 'ओपनिंग', closing: 'क्लोज़िंग', split: 'दर बदलने पर रीडिंग',
    reason: 'कारण', sold: 'बिक्री (L)', value: 'मूल्य ₹', save: 'सहेजें', close: 'शिफ्ट बंद करें', closeAt: 'बंद होने का समय', expected: 'अपेक्षित ₹', collected: 'वसूली ₹', diff: 'कमी − / अधिक +',
    counter: 'काउंटर लीटर (बिल ऑफ़ सप्लाई)', dayClose: 'दिन का क्लोज़', upi: 'UPI किस खाते में', posted: 'पोस्ट: {no}', recover: 'नकद वसूली', writeOff: 'बट्टे खाते डालें', undo: 'दिन का क्लोज़ वापस लें',
    noShifts: 'इस दिन कोई शिफ्ट नहीं।', 's.open': 'खुली', 's.closed': 'बंद', 's.posted': 'पोस्ट', done: 'हो गया।', excess: 'अधिक ₹{v} रसीद नहीं है: बही में "Excess at pump" (अन्य आय) में दर्ज करें।',
    'm.cash': 'नकद', 'm.upi': 'UPI', 'm.card': 'कार्ड', 'm.fleet': 'फ़्लीट कार्ड', 'm.loyalty': 'तेल कंपनी लॉयल्टी', 'm.credit': 'उधार पर्चियाँ',
    print: 'प्रिंट', title: 'दैनिक बिक्री रजिस्टर', rate: 'दर', products: 'उत्पाद', collections: 'वसूली', credit: 'उधार बिक्री ₹{v}', people: 'कमी / अधिक',
  },
);
