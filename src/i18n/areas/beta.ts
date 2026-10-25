/** Private beta: Help → "Report a problem" and its diagnostic dialog (layout/ReportProblemDialog). */
import { defineArea } from '../area';

export const betaT = defineArea(
  {
    reportItem: 'Report a problem',
    reportItemHint: 'Beta: make a diagnostic report to paste into your feedback message.',
    title: 'Report a problem',
    subtitle: 'Nothing is sent from this device. Copy the report and paste it into the beta feedback channel.',
    privacy: 'The report holds the app build, your browser, the current screen (record ids masked), the last errors and a storage summary. It holds no names, amounts, numbers or other business data. Read it before you share it.',
    steps: 'Above the report, write what you did, what you expected and what happened instead. A screenshot helps.',
    reportLabel: 'Diagnostic report',
    copy: 'Copy report',
    copied: 'Copied — paste it into your feedback message.',
    copyFailed: 'Could not copy. Select the text and copy it yourself.',
    refresh: 'Refresh',
    close: 'Close',
    preparing: 'Preparing the report…',
  } as const,
  {
    reportItem: 'समस्या बताएँ',
    reportItemHint: 'बीटा: अपने फ़ीडबैक संदेश में चिपकाने के लिए एक डायग्नोस्टिक रिपोर्ट बनाएँ।',
    title: 'समस्या बताएँ',
    subtitle: 'इस डिवाइस से कुछ भी नहीं भेजा जाता। रिपोर्ट कॉपी करें और बीटा फ़ीडबैक चैनल में चिपकाएँ।',
    privacy: 'रिपोर्ट में ऐप बिल्ड, आपका ब्राउज़र, मौजूदा स्क्रीन (रिकॉर्ड आईडी छिपी हुई), हाल की गड़बड़ियाँ और स्टोरेज का सार होता है। इसमें कोई नाम, रकम, नंबर या अन्य कारोबारी डेटा नहीं होता। शेयर करने से पहले इसे पढ़ लें।',
    steps: 'रिपोर्ट के ऊपर लिखें कि आपने क्या किया, क्या होना चाहिए था और क्या हुआ। स्क्रीनशॉट से मदद मिलती है।',
    reportLabel: 'डायग्नोस्टिक रिपोर्ट',
    copy: 'रिपोर्ट कॉपी करें',
    copied: 'कॉपी हो गई — इसे अपने फ़ीडबैक संदेश में चिपकाएँ।',
    copyFailed: 'कॉपी नहीं हो सकी। टेक्स्ट चुनकर ख़ुद कॉपी करें।',
    refresh: 'रीफ़्रेश',
    close: 'बंद करें',
    preparing: 'रिपोर्ट तैयार हो रही है…',
  },
);
