/**
 * R15-C: air tickets, supplier statements and cancellation strings. Shared words (trip, booking,
 * supplier, cost, sell, cancellation, refund, commission …) come from `travel-r15b.ts`. Lists are comma-separated in
 * the order of their ids (`cvList`).
 */
import { defineArea } from '../area';

export const cvT = defineArea(
  {
    tickets: 'Air tickets', addTicket: 'Add ticket', pax: 'Passenger', airline: 'Airline', tno: 'Ticket no.', pnr: 'PNR', sector: 'Sector', intl: 'International',
    basic: 'Basic fare', taxes: 'Taxes / YQ', agst: 'Airline GST', fee: 'Our fee (all tickets)', value: 'Service value', toInvoice: 'Add to invoice', ticket: 'Ticket',
    feeHigh: 'Your fee is above the deemed value — check with your CA (TV11).',
    sc: 'Supplier charge', ourFee: 'Our fee', rin: 'Refund due from supplier', rout: 'Refund to client', billed: 'Billed', cancelTrip: 'Cancel trip', done: 'Cancelled: {n} credit note(s).',
    statements: 'Supplier statements', file: 'File', import: 'Import', imported: '{n} rows imported.', ref: 'Statement ref.', doc: 'Doc. no.', type: 'Type', gross: 'Gross', net: 'Net',
    makeBill: 'Make bill', billMade: 'Bill made.', again: 'Match again', dispute: 'Dispute', record: 'Record', adm: 'ADM', refundFlag: 'Refund to pass on',
    cls: 'Economy,Other', methods: 'Deemed (Rule 32(3)),Actual fee', kinds: 'BSP,Consolidator,Bed bank', sts: 'Matched,Difference,Missing,Ours only',
  } as const,
  {
    tickets: 'हवाई टिकट', addTicket: 'टिकट जोड़ें', pax: 'यात्री', airline: 'एयरलाइन', tno: 'टिकट नं.', pnr: 'PNR', sector: 'सेक्टर', intl: 'अंतरराष्ट्रीय',
    basic: 'मूल किराया', taxes: 'कर व शुल्क', agst: 'एयरलाइन GST', fee: 'हमारा सेवा शुल्क (सभी टिकट)', value: 'सेवा मूल्य', toInvoice: 'बिल में जोड़ें', ticket: 'टिकट',
    feeHigh: 'आपका शुल्क मान्य मूल्य से अधिक है — अपने CA से पूछें (TV11)।',
    sc: 'आपूर्तिकर्ता शुल्क', ourFee: 'हमारा शुल्क', rin: 'आपूर्तिकर्ता से धनवापसी', rout: 'ग्राहक को धनवापसी', billed: 'बिल हुआ', cancelTrip: 'यात्रा रद्द करें', done: 'रद्द: {n} क्रेडिट नोट।',
    statements: 'आपूर्तिकर्ता विवरण', file: 'फ़ाइल', import: 'आयात करें', imported: '{n} पंक्तियाँ आयात हुईं।', ref: 'विवरण संदर्भ', doc: 'दस्तावेज़ नं.', type: 'प्रकार', gross: 'सकल', net: 'शुद्ध',
    makeBill: 'बिल बनाएँ', billMade: 'बिल बना।', again: 'फिर मिलाएँ', dispute: 'विवाद', record: 'दर्ज करें', adm: 'ADM', refundFlag: 'ग्राहक को धनवापसी बाकी',
    cls: 'इकॉनमी,अन्य', methods: 'मान्य मूल्य (नियम 32(3)),वास्तविक शुल्क', kinds: 'BSP,कंसॉलिडेटर,बेड बैंक', sts: 'मिला,अंतर,नहीं मिला,केवल हमारे',
  },
);

/** The label of `id` in the comma-separated list `key` whose ids are `ids`. */
export const cvList = (key: 'cls' | 'methods' | 'kinds' | 'sts', ids: readonly string[], id: string): string => cvT(key).split(',')[ids.indexOf(id)] ?? id;
