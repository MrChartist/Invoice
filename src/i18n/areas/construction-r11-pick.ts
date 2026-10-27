/** R11 (CN-A1) construction picker strings (wizard + Settings → Features), apart from `construction-r11a.ts` so those screens stay small. */
import { defineArea } from '../area';

export const cnPickT = defineArea(
  {
    title: 'Your construction business', lede: 'Pick what you build: it switches on the right Works views, the RA bill paper and the checks. You can change it later in Settings → Features.',
    'kind.civil': 'Civil / EPC / road contractor', 'kind.subcontractor': 'Sub-contractor', 'kind.builder': 'Builder / real-estate developer', 'kind.interiors': 'Interiors / fit-out contractor', 'kind.mep': 'Electrical / plumbing / HVAC (MEP)', 'kind.labour': 'Labour contractor / manpower supplier', 'kind.other': 'Other contractor',
    'hint.civil': 'Contracts, RA bills with M-book and abstract, advances, escalation, guarantees.', 'hint.subcontractor': 'Back-to-back BOQ, RA bills, retention, muster.', 'hint.builder': 'Units, bookings, stage demands, RERA account.', 'hint.interiors': 'BOQ quotes, supply + installation, photo pages.', 'hint.mep': 'Supply + installation split, sub-contracts, guarantees.', 'hint.labour': 'Manpower-supply bills, muster, compliance proof.', 'hint.other': 'Works tab as today.',
    government: 'Do you work for government departments / PSUs?', custom: 'Custom (keep switches as set)',
  } as const,
  {
    title: 'आपका निर्माण कारोबार', lede: 'आप क्या बनाते हैं चुनें: इससे सही वर्क्स व्यू, रनिंग बिल पेपर और जाँच चालू होंगी। बाद में सेटिंग्स → फ़ीचर में बदल सकते हैं।',
    'kind.civil': 'सिविल / EPC / सड़क ठेकेदार', 'kind.subcontractor': 'उप-ठेकेदार', 'kind.builder': 'बिल्डर / रियल-एस्टेट डेवलपर', 'kind.interiors': 'इंटीरियर / फ़िट-आउट ठेकेदार', 'kind.mep': 'बिजली / प्लंबिंग / HVAC (MEP)', 'kind.labour': 'लेबर ठेकेदार / मैनपावर सप्लायर', 'kind.other': 'अन्य ठेकेदार',
    'hint.civil': 'अनुबंध, एम-बुक और सार के साथ रनिंग बिल, अग्रिम, मूल्य परिवर्तन, बैंक गारंटी।', 'hint.subcontractor': 'बैक-टू-बैक BOQ, रनिंग बिल, रिटेंशन, मस्टर रोल।', 'hint.builder': 'यूनिट, बुकिंग, चरण माँग पत्र, रेरा खाता।', 'hint.interiors': 'BOQ कोटेशन, आपूर्ति + इंस्टॉलेशन, फ़ोटो पेज।', 'hint.mep': 'आपूर्ति + इंस्टॉलेशन अलग, उप-ठेके, बैंक गारंटी।', 'hint.labour': 'मैनपावर सप्लाई बिल, मस्टर रोल, अनुपालन प्रमाण।', 'hint.other': 'वर्क्स टैब पहले जैसा।',
    government: 'क्या आप सरकारी विभागों / PSU के लिए काम करते हैं?', custom: 'कस्टम (स्विच जैसे हैं वैसे रहें)',
  },
);
