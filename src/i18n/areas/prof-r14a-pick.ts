/** R14 (PS-A1) professional picker strings (wizard under Services → Professional, Settings → Features "Professional profile"). */
import { defineArea } from '../area';

export const psPickT = defineArea(
  {
    title: 'Professional profile', lede: 'Pick your profession: it switches on your desks on Time (matters, WIP, and your profession\'s desk). Change it later in Settings → Features; nothing is deleted.',
    'kind.ca': 'CA / CS / CMA firm', 'kind.legal': 'Advocate / law firm', 'kind.design': 'Architect / interior designer', 'kind.consulting': 'Consulting / IT / software', 'kind.agency': 'Marketing / media agency', 'kind.freelancer': 'Freelancer', 'kind.other': 'Other professional',
    'hint.ca': 'Compliance billing, UDIN, practice desk.', 'hint.legal': 'Matters, conflicts, RCM, client money.', 'hint.design': 'Stage fees on project cost.', 'hint.consulting': 'Time and fixed fees, exports.', 'hint.agency': 'Retainers, media pass-through.', 'hint.freelancer': 'Simple time, dollar invoices.', 'hint.other': 'Matters and WIP only.',
    sub: 'Which kind?', 'sub.icai': 'CA (ICAI)', 'sub.icsi': 'CS (ICSI)', 'sub.icmai': 'CMA (ICMAI)', 'sub.litigation': 'Litigation', 'sub.advisory': 'Advisory', 'sub.both': 'Both', 'sub.architect': 'Architect', 'sub.interior': 'Interior designer', 'sub.engineer': 'Consulting engineer',
    'sub.domestic': 'Clients in India', 'sub.exports': 'Also clients abroad', 'sub.creative': 'Creative / retainers', 'sub.media_buying': 'Also buys media',
    form: 'Firm form', 'form.proprietorship': 'Proprietor', 'form.partnership': 'Partnership', 'form.llp': 'LLP', 'form.company': 'Company',
    enrolment: 'Enrolment no. (optional)', barCouncil: 'State Bar Council', membership: 'Membership no. (optional)', frn: 'Firm registration no.', custom: 'Custom (keep packs as set)',
  } as const,
  {
    title: 'पेशेवर प्रोफ़ाइल', lede: 'अपना पेशा चुनें: इससे समय पर आपके डेस्क चालू होंगे (मामले, अबिल्ड कार्य, और आपके पेशे का डेस्क)। बाद में सेटिंग्स → फ़ीचर में बदल सकते हैं; कुछ नहीं हटता।',
    'kind.ca': 'CA / CS / CMA फ़र्म', 'kind.legal': 'वकील / लॉ फ़र्म', 'kind.design': 'आर्किटेक्ट / इंटीरियर डिज़ाइनर', 'kind.consulting': 'कंसल्टिंग / IT / सॉफ़्टवेयर', 'kind.agency': 'मार्केटिंग / मीडिया एजेंसी', 'kind.freelancer': 'फ़्रीलांसर', 'kind.other': 'अन्य पेशेवर',
    'hint.ca': 'अनुपालन बिलिंग, यूडीआईएन, प्रैक्टिस डेस्क।', 'hint.legal': 'मामले, हितों का टकराव, RCM, क्लाइंट का पैसा।', 'hint.design': 'प्रोजेक्ट लागत पर चरण शुल्क।', 'hint.consulting': 'समय और तय फ़ीस, निर्यात।', 'hint.agency': 'रिटेनर, मीडिया लागत पास-थ्रू।', 'hint.freelancer': 'सरल समय-पत्रक, डॉलर इनवॉइस।', 'hint.other': 'केवल मामले और अबिल्ड कार्य।',
    sub: 'किस तरह का?', 'sub.icai': 'CA (ICAI)', 'sub.icsi': 'CS (ICSI)', 'sub.icmai': 'CMA (ICMAI)', 'sub.litigation': 'मुकदमेबाज़ी', 'sub.advisory': 'सलाह', 'sub.both': 'दोनों', 'sub.architect': 'आर्किटेक्ट', 'sub.interior': 'इंटीरियर डिज़ाइनर', 'sub.engineer': 'कंसल्टिंग इंजीनियर',
    'sub.domestic': 'भारत के क्लाइंट', 'sub.exports': 'विदेशी क्लाइंट भी', 'sub.creative': 'क्रिएटिव / रिटेनर', 'sub.media_buying': 'मीडिया भी ख़रीदते हैं',
    form: 'फ़र्म का स्वरूप', 'form.proprietorship': 'प्रोप्राइटर', 'form.partnership': 'साझेदारी', 'form.llp': 'LLP', 'form.company': 'कंपनी',
    enrolment: 'नामांकन नंबर (वैकल्पिक)', barCouncil: 'राज्य बार काउंसिल', membership: 'सदस्यता नंबर (वैकल्पिक)', frn: 'फ़र्म पंजीकरण नंबर', custom: 'कस्टम (पैक जैसे हैं वैसे रहें)',
  },
);
