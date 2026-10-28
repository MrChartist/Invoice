/**
 * R16-C: commission invoices to principals, ticket re-issue, the bed-bank preset's columns (the hotel folio's
 * agent-commission button, C5, is in `hotel-billing-r7.ts`). Shared words (commission, supplier, booking …) come from `travel-r15b.ts`.
 */
import { defineArea } from '../area';

export const r16cT = defineArea(
  {
    billComm: 'Bill commission', commDone: 'Commission draft {n}: TDS expected u/s {s} ₹{a}.', commNoTds: 'Commission draft {n}: no TDS expected yet ({s}).', rcm: 'Insurer pays the GST (reverse charge).',
    reissue: 'Re-issue', newNo: 'New ticket no.', diff: 'Fare difference', penalty: 'Change penalty', fee: 'Re-issue fee', reDone: 'Re-issue draft {n}.', reCredit: 'Credit note {n} for the fare difference.',
    hotel: 'Hotel', nights: 'Nights',
  } as const,
  {
    billComm: 'कमीशन का बिल बनाएँ', commDone: 'कमीशन ड्राफ़्ट {n}: धारा {s} में TDS अपेक्षित ₹{a}।', commNoTds: 'कमीशन ड्राफ़्ट {n}: अभी TDS अपेक्षित नहीं ({s})।', rcm: 'GST बीमा कंपनी देगी (रिवर्स चार्ज)।',
    reissue: 'टिकट दोबारा जारी करें', newNo: 'नया टिकट नं.', diff: 'किराए का अंतर', penalty: 'बदलाव शुल्क (एयरलाइन)', fee: 'री-इश्यू शुल्क', reDone: 'री-इश्यू ड्राफ़्ट {n}।', reCredit: 'किराए के अंतर का क्रेडिट नोट {n}।',
    hotel: 'होटल', nights: 'रातें',
  },
);
