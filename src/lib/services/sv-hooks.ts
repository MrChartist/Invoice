/**
 * SV-A4 hooks, loaded by `bill-guard.ts` / `gst-guards.ts` (one dynamic import each, which keep the exported checks) for service companies only: the 5%-without-ITC caution on purchase bills
 * (`bill-guard.ts`, the GTA pattern) and the exceptions-report checks (`gst-guards.ts`, the price-band pattern).
 * Working papers — verify with your CA (SV11, SV12).
 */
import type { InvoiceRecord } from '../../types/invoice';
import { getTable } from '../storage';
import { defineArea } from '../../i18n/area';
import { itcCautionFor, svExceptions } from './sv-tax';
import { readServiceSettings } from './sv-settings';

const hT = defineArea(
  { caution: 'Your services are taxed at 5% without ITC. ITC is not available on inputs used for them; ITC on goods you resell is (Rule 42 split). Tag this bill "taxable only" if it is goods for resale. Verify with your CA.' } as const,
  { caution: 'आपकी सेवाओं पर 5% GST बिना ITC लगता है। उनमें लगने वाले इनपुट पर ITC नहीं मिलता; दोबारा बेचे जाने वाले सामान पर मिलता है (Rule 42 बँटवारा)। यह बिल दोबारा बेचने के सामान का है तो इसे "केवल कर-योग्य" टैग करें। CA से पुष्टि करें।' },
);

/** The bill guard's check (it imports this module dynamically and keeps the function: no static cycle, no shared chunk). */
export const billCaution = (bill: Parameters<typeof itcCautionFor>[0]): string => (itcCautionFor(bill, getTable<InvoiceRecord>('invoices'), readServiceSettings()) ? hT('caution') : '');
export { svExceptions };
