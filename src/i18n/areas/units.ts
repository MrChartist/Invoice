/**
 * Alternate units on document lines (WP-8): the few strings the invoice editor and the bill line editor
 * show. Kept apart from the inventory-masters area so the editor chunk only carries these.
 */
import { defineArea } from '../area';

export const unitT = defineArea({
  lineUnit: 'Unit for line {n}',
  equals: '= {qty} {unit}',
  landedAdd: 'Add landed cost (freight, loading…)',
  landedTitle: 'Landed cost',
  landedHint: 'Spread over the goods on this bill to load their stock cost. It does not change the bill total, GST or books: record the freight bill itself as an expense.',
  landedLabelPh: 'Freight, loading, insurance…',
  landedLabel: 'Landed cost {n} description',
  landedAmount: 'Landed cost {n} amount',
  landedRemove: 'Remove landed cost {n}',
  landedMore: 'Add another',
  landedBasis: 'Spread by',
  landedByValue: 'Line value',
  landedByQty: 'Quantity',
}, {
  lineUnit: 'पंक्ति {n} की इकाई',
  equals: '= {qty} {unit}',
  landedAdd: 'लैंडेड लागत जोड़ें (भाड़ा, लदाई…)',
  landedTitle: 'लैंडेड लागत',
  landedHint: 'इस बिल के माल पर बाँटकर उनकी स्टॉक लागत में जोड़ी जाती है। बिल राशि, GST या खाते नहीं बदलते: भाड़े का बिल अलग खर्च के रूप में दर्ज करें।',
  landedLabelPh: 'भाड़ा, लदाई, बीमा…',
  landedLabel: 'लैंडेड लागत {n} का विवरण',
  landedAmount: 'लैंडेड लागत {n} की राशि',
  landedRemove: 'लैंडेड लागत {n} हटाएँ',
  landedMore: 'और जोड़ें',
  landedBasis: 'बाँटने का आधार',
  landedByValue: 'पंक्ति मूल्य',
  landedByQty: 'मात्रा',
});
