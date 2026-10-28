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
  } as const,
  {
    statutory: 'वैधानिक', arrears: 'वेतन संशोधन का बकाया', rev: 'संशोधन', delta: '₹ प्रति ड्यूटी अधिक', ref: 'अधिसूचना', add: 'जोड़ें',
    pass: 'आगे लागू (अनुबंध वृद्धि या चुना गया)', cols: 'मूल बिल,साइट,महीना,बकाया,बना', make: 'डेबिट नोट बनाएँ', makeInv: 'पूरक इनवॉइस बनाएँ',
    made: '{n} बकाया दस्तावेज़ बने।', none: 'इस संशोधन तक कोई बिल किया महीना नहीं।', staff: 'कर्मचारियों का बकाया: {n} लोग, {a}', payroll: 'पेरोल बकाया',
    tds: 'ग्राहकवार TDS प्राप्य', tdsCols: 'ग्राहक,तिमाही,बिल,कर-योग्य,अपेक्षित,दर्ज,अंतर',
    lic: 'लाइसेंस नवीनीकरण', kind: 'प्रकार', kinds: 'PSARA,OSH,ठेका श्रम,व्यापार,अन्य', no: 'लाइसेंस नं.', till: 'वैध तिथि तक', state: 'राज्य',
    guard: 'गार्ड लाइसेंस', due: 'अगले 60 दिनों में कुछ देय नहीं।',
  },
);
