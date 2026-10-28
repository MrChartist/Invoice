/** R11 (CN-A1, PENDING #22) construction settings switches form (Settings → Features, contractor). Lazy with its form. */
import { defineArea } from '../area';

export const cnSetT = defineArea(
  {
    title: 'Construction settings', hint: 'The profile sets these; change any of them here. Owner only.',
    paper: 'RA bill paper', 'paper.standard': 'Standard', 'paper.pwd': 'PWD / CPWD style', 'paper.summary': 'Summary',
    mb: 'Print the M-book column', government: 'We work for government departments / PSUs', certificate: "Print the contractor's certificate",
    certText: 'Certificate text (blank = the standard text)', boxes: 'Print "Measured by / Checked by / Passed for payment" boxes',
    deviation: 'Deviation limit, % over the BOQ quantity', split: 'Show the supply + installation caution', photos: 'Photo pages on by default',
    manpower: 'Manpower-supply bill preset (SAC 998519)', withhold: "Hold on a labour contractor's bill until PF / ESI is proved (%)",
    save: 'Save settings', saved: 'Construction settings saved.',
  } as const,
  {
    title: 'निर्माण सेटिंग्स', hint: 'प्रोफ़ाइल इन्हें तय करती है; यहाँ कोई भी बदलें। केवल मालिक।',
    paper: 'रनिंग बिल पेपर', 'paper.standard': 'मानक', 'paper.pwd': 'PWD / CPWD शैली', 'paper.summary': 'सारांश',
    mb: 'M-बुक कॉलम छापें', government: 'हम सरकारी विभागों / PSU के लिए काम करते हैं', certificate: 'ठेकेदार का प्रमाणपत्र छापें',
    certText: 'प्रमाणपत्र का पाठ (ख़ाली = मानक पाठ)', boxes: '"मापा / जाँचा / भुगतान हेतु पारित" बॉक्स छापें',
    deviation: 'विचलन सीमा, BOQ मात्रा से % अधिक', split: 'आपूर्ति + स्थापना की चेतावनी दिखाएँ', photos: 'फ़ोटो पेज डिफ़ॉल्ट रूप से चालू',
    manpower: 'मैनपावर-आपूर्ति बिल प्रीसेट (SAC 998519)', withhold: 'PF / ESI सिद्ध होने तक लेबर ठेकेदार के बिल पर रोक (%)',
    save: 'सेटिंग्स सहेजें', saved: 'निर्माण सेटिंग्स सहेजी गईं।',
  },
);
