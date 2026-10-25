/** Demo-data banner on the Dashboard (lazy chunk). */
import { defineArea } from '../area';

export const demoT = defineArea(
  {
    demo: 'Demo data',
    pillTitle: 'Sample records are on this device. Remove them in Settings, Data.',
    text: 'You are looking at a fictional business ({n} sample invoices). Nothing here is real.',
    remove: 'Remove sample data',
    confirmTitle: 'Remove sample data?',
    confirmMsg: 'This deletes the sample records only. Anything you created yourself is kept.',
  } as const,
  {
    demo: 'डेमो डेटा',
    pillTitle: 'इस डिवाइस पर नमूना रिकॉर्ड हैं। इन्हें सेटिंग्स › डेटा में हटाएँ।',
    text: 'आप एक काल्पनिक व्यापार देख रहे हैं ({n} नमूना इनवॉइस)। यहाँ कुछ भी असली नहीं है।',
    remove: 'नमूना डेटा हटाएँ',
    confirmTitle: 'नमूना डेटा हटाएँ?',
    confirmMsg: 'इससे केवल नमूना रिकॉर्ड मिटते हैं। आपका ख़ुद बनाया सब कुछ बना रहता है।',
  },
);
