/**
 * R17-D: arrears, TDS receivable, licences and renewals strings (the `statutory` view). Shared words (site, month,
 * client, duties, save) come from `manpower-r17a.ts`.
 */
import { defineArea } from '../area';

export const mdT = defineArea(
  {
    statutory: 'Statutory', arrears: 'Wage-revision arrears', rev: 'Revision', delta: '₹ more a duty', ref: 'Notification', add: 'Add',
    pass: 'Passes through (contract escalation or ticked)', cols: 'Original bill,Site,Month,Arrears,Raised', make: 'Make debit notes', makeInv: 'Make supplementary invoices',
    made: '{n} arrears documents made.', none: 'No billed month reaches this revision.', staff: 'Owed to staff: {n} people, {a}', payroll: 'Payroll arrears',
    tds: 'TDS receivable by client', tdsCols: 'Client,Quarter,Bills,Taxable,Expected,Booked,Difference',
    lic: 'Licences and renewals', kind: 'Kind', kinds: 'PSARA,OSH,Contract labour,Trade,Other', no: 'Licence no.', till: 'Valid till', state: 'State',
    guard: 'Guard licence', due: 'Nothing due in the next 60 days.',
    // QA20 V8: licence / contract notices (bell and the statutory view), the RCM-only note, the print window
    'a.exp': '{w} expires {d}', 'a.expd': '{w} expired {d}', 'a.renew': 'Renew it now.', 'a.left': '{n} days left: start the renewal.', 'a.open': 'Open',
    'a.lic': '{k} licence {no}', 'a.guard': 'Guard licence of {n}', 'a.site': 'Contract of {c} {n}', 'a.vda': 'Minimum wage / VDA revision month',
    'a.vdaD': 'Type the revision that applies to your posts when it is notified; arrears follow from it.',
    rcmOnly: 'Only reverse-charge supplies: registration may not be required (N 5/2017-CT). Verify with your CA (MP9).', popup: 'Allow pop-ups to print.',
  } as const,
  {
    statutory: 'वैधानिक', arrears: 'वेतन संशोधन का बकाया', rev: 'संशोधन', delta: '₹ प्रति ड्यूटी अधिक', ref: 'अधिसूचना', add: 'जोड़ें',
    pass: 'आगे लागू (अनुबंध वृद्धि या चुना गया)', cols: 'मूल बिल,साइट,महीना,बकाया,बना', make: 'डेबिट नोट बनाएँ', makeInv: 'पूरक इनवॉइस बनाएँ',
    made: '{n} बकाया दस्तावेज़ बने।', none: 'इस संशोधन तक कोई बिल किया महीना नहीं।', staff: 'कर्मचारियों का बकाया: {n} लोग, {a}', payroll: 'पेरोल बकाया',
    tds: 'ग्राहकवार TDS प्राप्य', tdsCols: 'ग्राहक,तिमाही,बिल,कर-योग्य,अपेक्षित,दर्ज,अंतर',
    lic: 'लाइसेंस नवीनीकरण', kind: 'प्रकार', kinds: 'PSARA,OSH,ठेका श्रम,व्यापार,अन्य', no: 'लाइसेंस नं.', till: 'वैध तिथि तक', state: 'राज्य',
    guard: 'गार्ड लाइसेंस', due: 'अगले 60 दिनों में कुछ देय नहीं।',
    'a.exp': '{w} की अवधि {d} को समाप्त होगी', 'a.expd': '{w} की अवधि {d} को समाप्त हो गई', 'a.renew': 'अभी नवीनीकरण करें।', 'a.left': '{n} दिन बाकी: नवीनीकरण शुरू करें।', 'a.open': 'खोलें',
    'a.lic': '{k} लाइसेंस {no}', 'a.guard': '{n} का गार्ड लाइसेंस', 'a.site': '{c} {n} का अनुबंध', 'a.vda': 'न्यूनतम वेतन / VDA संशोधन का महीना',
    'a.vdaD': 'अधिसूचना आने पर अपने पदों पर लागू संशोधन दर्ज करें; बकाया उसी से बनेगा।',
    rcmOnly: 'केवल रिवर्स चार्ज वाली आपूर्ति: पंजीकरण शायद ज़रूरी नहीं (N 5/2017-CT)। अपने CA से पुष्टि करें (MP9)।', popup: 'छापने के लिए पॉप-अप की अनुमति दें।',
  },
);
