/**
 * R19-B: billing, GST and job costing strings (Shipments desk views `billing` / `costing`, the regime engine's hints).
 * Shared words (job, client, status, saved …) come from `logistics-r19a.ts`. Lists (`states`, `by`) are
 * comma-separated, in the order of their ids. Printed text on documents (place-of-supply reasons, the Rule 33 line) is
 * English, as on every paper.
 */
import { defineArea } from '../area';

export const lgbT = defineArea(
  {
    billing: 'Billing', costing: 'Costing', billDate: 'Bill date', month: 'Month', billJob: 'Bill job', billMonth: 'Bill delivered jobs (month)', docs: 'Documents',
    head: 'Head', qty: 'Qty', rate: 'Rate', currency: 'Currency', amount: 'Amount', regime: 'Place of supply / GST', addLine: 'Add line', fxRate: '₹ per {c}',
    states: 'Unbilled,Part-billed,Billed', made: '{n} document(s) made.', skipped: 'Already billed: {h}.', exempt: 'Exempt',
    eHead: 'A line names a charge head that is gone; pick a head.', eFx: 'No ₹ rate for {c} on the bill date: type it, or add it to the currency master.',
    eSingle: 'One document per job is set, but these lines need different places of supply (LG9). Bill them separately.',
    hLut: 'No LUT on record for this date: IGST is charged on the export of services. Add the LUT in the LUT register.',
    hOcean: 'No IGST on ocean freight under reverse charge for imports from 1 Oct 2023 (LG16).',
    revenue: 'Revenue', cost: 'Cost', margin: 'Margin', pct: 'Margin %', flags: 'Flags', unbilled: 'unbilled', uncosted: 'no cost', low: 'below alert',
    alert: 'Margin alert %', groupBy: 'Group by', by: 'Client,Lane,Salesperson,Month',
  } as const,
  {
    billing: 'बिलिंग', costing: 'लागत', billDate: 'बिल तिथि', month: 'माह', billJob: 'जॉब का बिल बनाएँ', billMonth: 'डिलीवर जॉब के बिल (माह)', docs: 'दस्तावेज़',
    head: 'शीर्ष', qty: 'मात्रा', rate: 'दर', currency: 'मुद्रा', amount: 'राशि', regime: 'आपूर्ति का स्थान / GST', addLine: 'पंक्ति जोड़ें', fxRate: '₹ प्रति {c}',
    states: 'बिल नहीं बना,आंशिक बिल,बिल बना', made: '{n} दस्तावेज़ बने।', skipped: 'पहले से बिल में: {h}।', exempt: 'छूट',
    eHead: 'एक पंक्ति का शुल्क शीर्ष अब नहीं है; शीर्ष चुनें।', eFx: 'बिल तिथि पर {c} की ₹ दर नहीं है: दर लिखें या मुद्रा सूची में जोड़ें।',
    eSingle: 'प्रति जॉब एक दस्तावेज़ चुना है, पर इन पंक्तियों का आपूर्ति स्थान अलग है (LG9)। अलग-अलग बिल बनाएँ।',
    hLut: 'इस तिथि का LUT दर्ज नहीं: सेवा निर्यात पर IGST लगेगा। LUT रजिस्टर में LUT जोड़ें।',
    hOcean: '1 अक्टूबर 2023 से आयात के समुद्री भाड़े पर रिवर्स चार्ज IGST नहीं (LG16)।',
    revenue: 'आय', cost: 'लागत', margin: 'मार्जिन', pct: 'मार्जिन %', flags: 'संकेत', unbilled: 'बिल नहीं', uncosted: 'लागत नहीं', low: 'सीमा से कम',
    alert: 'मार्जिन चेतावनी %', groupBy: 'समूह', by: 'ग्राहक,मार्ग,विक्रेता,माह',
  },
);
