/**
 * R20-B: strings of the voucher and document entry keys (confirms, toasts, side sheets). Row labels stay in keys-r20a.
 */
import { defineArea } from '../area';
export const kbT = defineArea(
  {
    delAsk: 'Delete {label}?', deleted: 'Deleted {label}.', undo: 'Undo', undone: '{label} is back.', yes: 'Yes (Y)', no: 'No (N)',
    cancelTitle: 'Cancel {label}', reason: 'Reason for cancelling', paidAck: 'Payments are recorded against it — cancel anyway',
    cancelled: 'Cancelled {label}.', vCancel: 'A voucher is not cancelled here: delete it (Alt+D) — Undo brings it back.',
    dupDone: 'Copy of {label}: it saves with a new number.', lineGone: 'Line removed.', noLine: 'Put the cursor in a line first.',
    unsaved: 'Your changes are not saved. Open the other entry anyway?', noNarr: 'No earlier narration found.', draftBack: 'Lines you typed before leaving are back.',
    kind: 'Kind', regular: 'Regular', memo: 'Memorandum',
    stockTitle: 'Stock of {name}', notTracked: '{name} is not a tracked stock item.', inHand: 'In hand', value: 'Value', avg: 'Average cost',
    pending: 'Pending: {so} to deliver, {po} to receive', lastBuy: 'Last purchases', lastSale: 'Last sales',
    partyTitle: 'Facts: {name}', noParty: 'Pick a party first.', outstanding: 'Outstanding', lastBills: 'Last documents', none: 'Nothing yet.',
    taxTitle: 'Tax break-up', rate: 'Rate', taxable: 'Taxable', tax: 'Tax', total: 'Total', noTax: 'No GST on this document.',
  },
  {
    delAsk: '{label} हटाएँ?', deleted: '{label} हटाया।', undo: 'वापस लाएँ', undone: '{label} वापस आ गया।', yes: 'हाँ (Y)', no: 'नहीं (N)',
    cancelTitle: '{label} रद्द करें', reason: 'रद्द करने का कारण', paidAck: 'इस पर भुगतान दर्ज हैं — फिर भी रद्द करें',
    cancelled: '{label} रद्द किया।', vCancel: 'वाउचर यहाँ रद्द नहीं होता: इसे हटाएँ (Alt+D) — "वापस लाएँ" से लौट आता है।',
    dupDone: '{label} की प्रतिलिपि: सेव करने पर नया नंबर मिलेगा।', lineGone: 'पंक्ति हटाई।', noLine: 'पहले किसी पंक्ति में कर्सर रखें।',
    unsaved: 'बदलाव सेव नहीं हुए। फिर भी दूसरी एंट्री खोलें?', noNarr: 'पहले का कोई विवरण नहीं मिला।', draftBack: 'जाने से पहले लिखी पंक्तियाँ वापस आ गईं।',
    kind: 'प्रकार', regular: 'सामान्य', memo: 'मेमोरेंडम',
    stockTitle: '{name} का स्टॉक', notTracked: '{name} स्टॉक में ट्रैक होने वाला आइटम नहीं है।', inHand: 'हाथ में', value: 'मूल्य', avg: 'औसत लागत',
    pending: 'बाकी: {so} देना, {po} आना', lastBuy: 'पिछली खरीद', lastSale: 'पिछली बिक्री',
    partyTitle: 'जानकारी: {name}', noParty: 'पहले पार्टी चुनें।', outstanding: 'बकाया', lastBills: 'पिछले दस्तावेज़', none: 'अभी कुछ नहीं।',
    taxTitle: 'टैक्स का ब्योरा', rate: 'दर', taxable: 'कर योग्य', tax: 'टैक्स', total: 'कुल', noTax: 'इस दस्तावेज़ पर GST नहीं।',
  },
);
