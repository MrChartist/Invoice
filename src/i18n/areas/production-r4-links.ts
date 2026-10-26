/**
 * R4-A entry points on Inventory screens (Batches / Serial lookup "Trace" links, the item form's QC checkbox). Kept apart from `production-r4.ts` so those
 * screens do not download the whole production catalogue.
 */
import { defineArea } from '../area';

export const pLinkT = defineArea({
  trace: 'Trace',
  traceBatch: 'Trace batch {batch}',
  traceSerial: 'Trace serial {serial}',
  qcOnReceipt: 'Hold receipts for QC (goods received go to the QC hold godown until checked)',
} as const, {
  trace: 'ट्रेस',
  traceBatch: 'बैच {batch} ट्रेस करें',
  traceSerial: 'सीरियल {serial} ट्रेस करें',
  qcOnReceipt: 'प्राप्त माल QC के लिए रोकें (जाँच तक माल QC होल्ड गोदाम में जाएगा)',
});
