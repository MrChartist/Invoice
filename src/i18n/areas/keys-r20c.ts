/**
 * R20-C: the report keys' sheets and status strip (filter, totals of shown rows, ticks, hidden rows, views,
 * exceptions). Row labels stay in keys-r20a.
 */
import { defineArea } from '../area';
export const repKeysT = defineArea(
  {
    filterTitle: 'Filter this report', filterSub: 'Esc on the report clears it.',
    amtFrom: 'Amount from (₹)', amtTo: 'Amount up to (₹)', dateFrom: 'Date from', dateTo: 'Date to', text: 'Party / ledger contains',
    narr: 'Narration contains', side: 'Side', any: 'Any', dr: 'Debit', cr: 'Credit', apply: 'Apply', clear: 'Clear',
    filtered: 'Filtered: {n} of {total} rows', selected: '{n} ticked', hidden: '{n} hidden', showAll: 'Show all', shownTotals: 'Totals of what you see', net: 'Net', untick: 'Untick', hideNote: 'Hidden rows left out.',
    viewsTitle: 'Saved views', viewsSub: 'Screen, tab, period and options, on this device.', viewName: 'Name of the view',
    save: 'Save view', remove: 'Delete', noViews: 'No saved views for this screen yet.',
    saved: 'View saved',
  },
  {
    filterTitle: 'इस रिपोर्ट को छाँटें', filterSub: 'रिपोर्ट पर Esc दबाने से हट जाता है।',
    amtFrom: 'राशि से (₹)', amtTo: 'राशि तक (₹)', dateFrom: 'तारीख़ से', dateTo: 'तारीख़ तक', text: 'पार्टी / खाते में',
    narr: 'विवरण में', side: 'पक्ष', any: 'कोई भी', dr: 'नामे', cr: 'जमा', apply: 'लागू करें', clear: 'हटाएँ',
    filtered: 'छँटा हुआ: {total} में से {n} पंक्तियाँ', selected: '{n} चुनी', hidden: '{n} छिपी', showAll: 'सब दिखाएँ', shownTotals: 'जो दिख रहा है उसका जोड़', net: 'शुद्ध', untick: 'चुनाव हटाएँ', hideNote: 'छिपी पंक्तियाँ शामिल नहीं।',
    viewsTitle: 'सहेजे गए व्यू', viewsSub: 'स्क्रीन, टैब, अवधि और विकल्प, इस डिवाइस पर।', viewName: 'व्यू का नाम',
    save: 'व्यू सहेजें', remove: 'हटाएँ', noViews: 'इस स्क्रीन का कोई व्यू अभी नहीं है।',
    saved: 'व्यू सहेजा गया',
  },
);
