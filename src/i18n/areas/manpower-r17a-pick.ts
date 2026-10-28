/** R17-A1: the manpower picker's strings (setup wizard and Settings → Features; kept out of the `f-manpower` chunk). */
import { defineArea } from '../area';

export const mpPickT = defineArea(
  {
    title: 'Security, housekeeping and manpower supply', custom: 'Custom',
    'kind.security': 'Security agency', 'kind.facility': 'Housekeeping / facility management', 'kind.staffing': 'Contract / temporary staffing', 'kind.labour': 'Labour contractor', 'kind.other': 'Other manpower supply',
    'hint.security': 'Guards, posts, shifts, RCM on guards, PSARA.', 'hint.facility': 'Posts, duties, consumables, school exemption.', 'hint.staffing': 'Cost-plus billing, service charge.', 'hint.labour': 'Duty / man-day billing.', 'hint.other': 'Sites, posts and bills.',
  } as const,
  {
    title: 'सुरक्षा, हाउसकीपिंग और मानव-शक्ति आपूर्ति', custom: 'कस्टम',
    'kind.security': 'सुरक्षा एजेंसी', 'kind.facility': 'हाउसकीपिंग / फ़ैसिलिटी मैनेजमेंट', 'kind.staffing': 'अनुबंध / अस्थायी स्टाफ़िंग', 'kind.labour': 'श्रम ठेकेदार', 'kind.other': 'अन्य मानव-शक्ति आपूर्ति',
    'hint.security': 'सुरक्षा गार्ड, पोस्ट, शिफ्ट, गार्ड सेवा पर RCM, PSARA।', 'hint.facility': 'पोस्ट, ड्यूटी, उपभोग्य सामग्री, स्कूल छूट।', 'hint.staffing': 'लागत-आधारित बिल, सेवा शुल्क।', 'hint.labour': 'ड्यूटी / मानव-दिवस बिल।', 'hint.other': 'साइट, पोस्ट और बिल।',
  },
);
