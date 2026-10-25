/**
 * Branch-wise books (WP-9 × WP-2): branch filter on reports / lists, Sec 25(4) inter-branch
 * transfer invoices. Imported only by lazy chunks (Books, Gateway, Transactions, purchases, inventory).
 */
import { defineArea } from '../area';

export const branchT = defineArea(
  {
    filterLabel: 'Branch',
    allBranches: 'All branches',
    noBranch: 'No branch (company level)',
    scopeNote: 'Branch view: only this branch’s documents, bills and vouchers. Company-level entries (openings, depreciation, payroll) are under “No branch”; report-time closing stock is company-wide and left out.',
    taxPair: 'Tax invoice + bill',
    taxPairTitle: 'Inter-branch transfer {number}',
    taxPairIntro: '{from} ({fromGstin}) and {to} ({toGstin}) are separate GST registrations, so this transfer is a supply between distinct persons (Sec 25(4)). Raise a tax invoice from {from} and the matching purchase bill at {to}; both post to “Branch transfer” accounts so they cancel out in the company books.',
    taxPairRate: 'Value per unit (₹, before GST)',
    taxPairItem: 'Item',
    taxPairQty: 'Qty',
    taxPairCa: 'Value per Rule 28 (open market value; the declared value is accepted when the receiving branch can take full credit). Working paper — verify with your CA.',
    taxPairRaise: 'Raise invoice and bill',
    taxPairDone: 'Tax invoice {number} and the matching bill saved.',
    taxPairRaised: 'Invoice {number}',
    taxPairNeeded: 'Different GSTINs: needs a tax invoice',
    cancel: 'Cancel',
  } as const,
  {
    filterLabel: 'शाखा',
    allBranches: 'सभी शाखाएँ',
    noBranch: 'कोई शाखा नहीं (कंपनी स्तर)',
    scopeNote: 'शाखा दृश्य: केवल इस शाखा के दस्तावेज़, बिल और वाउचर। कंपनी-स्तर की प्रविष्टियाँ (ओपनिंग, मूल्यह्रास, पेरोल) “कोई शाखा नहीं” में हैं; रिपोर्ट-समय का अंतिम स्टॉक पूरी कंपनी का है और यहाँ शामिल नहीं।',
    taxPair: 'टैक्स इनवॉइस + बिल',
    taxPairTitle: 'शाखाओं के बीच ट्रांसफ़र {number}',
    taxPairIntro: '{from} ({fromGstin}) और {to} ({toGstin}) अलग GST पंजीकरण हैं, इसलिए यह ट्रांसफ़र अलग व्यक्तियों के बीच आपूर्ति है (धारा 25(4))। {from} से टैक्स इनवॉइस और {to} पर उसका खरीद बिल बनाएँ; दोनों “Branch transfer” खातों में जाते हैं, इसलिए कंपनी की बहियों में एक-दूसरे को काट देते हैं।',
    taxPairRate: 'प्रति इकाई मूल्य (₹, GST से पहले)',
    taxPairItem: 'आइटम',
    taxPairQty: 'मात्रा',
    taxPairCa: 'मूल्य नियम 28 के अनुसार (खुला बाज़ार मूल्य; प्राप्त करने वाली शाखा पूरा क्रेडिट ले सके तो घोषित मूल्य मान्य)। कार्य-पत्र — अपने CA से सत्यापित करें।',
    taxPairRaise: 'इनवॉइस और बिल बनाएँ',
    taxPairDone: 'टैक्स इनवॉइस {number} और उसका बिल सहेजे गए।',
    taxPairRaised: 'इनवॉइस {number}',
    taxPairNeeded: 'अलग GSTIN: टैक्स इनवॉइस चाहिए',
    cancel: 'रद्द करें',
  },
);
