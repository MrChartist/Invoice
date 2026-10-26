/**
 * Round 6 package C — open-roadmap closures (QC hold on bills, payables openings, voucher-receipt TDS, POS refund bank,
 * import of suppliers / ledgers / opening balances, the GST filing strip, previous-balance block). Imported only by
 * lazy screens. Statutory wording that is not certain stays English ("verify with your CA").
 */
import { defineArea } from '../area';

export const c6T = defineArea({
  allocTds: 'TDS ₹{amount} (booked to TDS receivable)',
  downloadedOn: 'Downloaded on {date}',
  markFiled: '{form} filed',
  openingRef: 'Opening',
  impOpenings: 'Suppliers, ledgers & openings',
  impOpeningsText: 'Supplier list, opening trial balance and unpaid bills on the day the books begin (Excel, Vyapar, Busy, Tally …).',
}, {
  allocTds: 'TDS ₹{amount} (TDS प्राप्य में दर्ज)',
  downloadedOn: '{date} को डाउनलोड किया',
  markFiled: '{form} भरा',
  openingRef: 'ओपनिंग',
  impOpenings: 'सप्लायर, लेजर और ओपनिंग',
  impOpeningsText: 'सप्लायर सूची, ओपनिंग ट्रायल बैलेंस और किताबें शुरू होने के दिन के बकाया बिल (Excel, Vyapar, Busy, Tally …)।',
});
