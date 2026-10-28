/**
 * R16-D4: one-line notes for GST Council recommendations that are not yet notified (`src/lib/pending-changes.ts`).
 * Keys are the pending row ids. Lazy: imported only through `pending-changes.ts`.
 */
import { defineArea } from '../area';

export const pendT = defineArea(
  {
    lead: 'Recommended by the GST Council on 8 Oct 2026, not yet notified — verify with your CA:',
    head: 'Announced, not yet in force',
    pf1_services: 'Net ITC of an inverted-duty refund to include input services availed from 1 Nov 2026; this paper still counts inputs only.',
    pf1_capital: 'Capital goods ITC from 1 Apr 2027 to count over 60 months in the refund; not included here.',
    pf2_rule89: 'Rule 89(4)(C): the 1.5× cap on zero-rated goods turnover to be removed; the cap is still applied.',
    pf3_latefee: 'Late fee waived (turnover up to ₹5 crore) when the return is filed by the end of the month it was due; the late fee is still shown.',
    pf4_3b: 'From the April 2027 return: new way to amend liability and ITC (GSTR-1 / 1A / IFF ↔ 3B, IMS, Rules 86C / 86D statements).',
    pf5_export: 'IGST Sec 2(6)(v) (supply to your own branch abroad) to be deleted; the export check still applies it.',
    pf7_rcm: 'RCM on plastic, e-waste and tyre scrap and used cooking oil from unregistered suppliers, and 2 % GST TDS on B2B supplies of these.',
    pf8_einv: 'e-Invoicing for RCM inward supplies from unregistered persons and for import of services (₹5 crore and above); the self-invoice has no IRN yet.',
    hs2_valuation: 'Court order under appeal, not a Council recommendation: the Madras High Court (2021) held that a society above ₹7,500 a month pays GST only on the excess; the app taxes the whole amount (Circular 109/28/2019-GST) unless "excess" is chosen.',
  } as const,
  {
    lead: 'GST परिषद की 8 अक्टूबर 2026 की सिफ़ारिश, अभी अधिसूचित नहीं — अपने CA से जाँचें:',
    head: 'घोषित, अभी लागू नहीं',
    pf1_services: 'उल्टे शुल्क (इनवर्टेड ड्यूटी) रिफ़ंड के शुद्ध ITC में 1 नवंबर 2026 से ली गई इनपुट सेवाएँ भी; यह पत्र अभी केवल इनपुट गिनता है।',
    pf1_capital: '1 अप्रैल 2027 से पूँजीगत माल का ITC 60 महीनों में रिफ़ंड में; यहाँ शामिल नहीं।',
    pf2_rule89: 'नियम 89(4)(C): शून्य-दर माल टर्नओवर पर 1.5 गुना सीमा हटेगी; सीमा अभी लागू है।',
    pf3_latefee: 'विलंब शुल्क माफ़ (₹5 करोड़ तक टर्नओवर) यदि रिटर्न देय महीने के अंत तक भरा जाए; विलंब शुल्क अभी दिखाया जाता है।',
    pf4_3b: 'अप्रैल 2027 के रिटर्न से: देनदारी और ITC सुधारने का नया तरीका (GSTR-1 / 1A / IFF ↔ 3B, IMS, नियम 86C / 86D विवरण)।',
    pf5_export: 'IGST धारा 2(6)(v) (विदेश में अपनी शाखा को आपूर्ति) हटेगी; निर्यात जाँच अभी इसे लागू करती है।',
    pf7_rcm: 'अपंजीकृत आपूर्तिकर्ता से प्लास्टिक, ई-कचरा, टायर स्क्रैप और प्रयुक्त खाद्य तेल पर RCM, और इनकी B2B आपूर्ति पर 2 % GST TDS।',
    pf8_einv: 'अपंजीकृत व्यक्ति से RCM आवक आपूर्ति और सेवाओं के आयात (₹5 करोड़ और ऊपर) पर ई-इनवॉइस; स्व-बीजक पर अभी IRN नहीं।',
    hs2_valuation: 'अपील में लंबित न्यायालय आदेश, परिषद की सिफ़ारिश नहीं: मद्रास उच्च न्यायालय (2021) के अनुसार ₹7,500 मासिक से ऊपर पर GST केवल अतिरिक्त राशि पर; ऐप पूरी राशि पर कर लगाता है (परिपत्र 109/28/2019-GST) जब तक "अतिरिक्त" न चुना जाए।',
  },
);
