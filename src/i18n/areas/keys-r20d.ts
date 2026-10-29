/**
 * R20-D: strings of the Go To mode, the Company / Data / Import sheets, the lock question, the "Back to …" chip and the
 * setup-wizard question. Row labels (F3, Alt+K …) stay in keys-r20a.
 */
import { defineArea } from '../area';
export const navT = defineArea(
  {
    gotoTitle: 'Go To', switchTitle: 'Switch To', gotoPh: 'Type a screen or report: trial, day book, outstanding…',
    backTo: 'Back to {name}', backThis: 'the last screen',
    users: 'Users and PINs', backup: 'Back up now', restore: 'Restore a backup', newYear: 'Start a new year', bin: 'Recycle bin',
    sync: 'Folder sync', tallyXml: 'Tally XML', excel: 'Excel or CSV file', bank: 'Bank statement',
    pickLetter: 'Press a letter, or ↑ ↓ and Enter.', noOther: 'Only one company on this device. Add one in Settings → Data.',
    lockQ: 'Lock the app now? Anything not saved on this screen is lost.', yes: 'Yes (Y)', no: 'No (N)',
    qTally: 'Have you used Tally before?', qYes: 'Yes, switch on Tally keys', qNo: 'No',
    qHint: 'Yes: F4–F10, Alt+G and the other Tally keys work here. You can change it any time from the ? key.',
  },
  {
    gotoTitle: 'गो टू', switchTitle: 'स्विच टू', gotoPh: 'स्क्रीन या रिपोर्ट लिखें: ट्रायल, डे बुक, बकाया…',
    backTo: '{name} पर वापस', backThis: 'पिछली स्क्रीन',
    users: 'उपयोगकर्ता और PIN', backup: 'अभी बैकअप लें', restore: 'बैकअप वापस लाएँ', newYear: 'नया वर्ष शुरू करें', bin: 'रीसायकल बिन',
    sync: 'फ़ोल्डर सिंक', tallyXml: 'Tally XML', excel: 'Excel या CSV फ़ाइल', bank: 'बैंक स्टेटमेंट',
    pickLetter: 'कोई अक्षर दबाएँ, या ↑ ↓ और Enter।', noOther: 'इस डिवाइस पर एक ही कंपनी है। सेटिंग्स → डेटा में जोड़ें।',
    lockQ: 'ऐप अभी लॉक करें? इस स्क्रीन पर जो सेव नहीं हुआ, वह चला जाएगा।', yes: 'हाँ (Y)', no: 'नहीं (N)',
    qTally: 'क्या आपने पहले Tally चलाया है?', qYes: 'हाँ, Tally कुंजियाँ चालू करें', qNo: 'नहीं',
    qHint: 'हाँ: F4–F10, Alt+G और बाकी Tally कुंजियाँ यहाँ चलेंगी। इसे कभी भी ? कुंजी से बदल सकते हैं।',
  },
);
export type NavKey = Parameters<typeof navT>[0];
