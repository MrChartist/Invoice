/** R14 (PS-A2) Matters desk strings: matters, engagements, conflict checks, engagement letters. */
import { defineArea } from '../area';

export const pmT = defineArea(
  {
    'v.matters': 'Matters', 'v.engagements': 'Engagements', 'v.conflicts': 'Conflict checks', 'v.letters': 'Letters',
    code: 'Matter code', name: 'Matter name', kind: 'Kind', 'k.matter': 'Matter', 'k.assignment': 'Assignment', 'k.project': 'Project', area: 'Practice area', court: 'Court / forum', caseNo: 'Case no.',
    parties: 'Parties', party: 'Party name', role: 'Role', 'r.client': 'Client', 'r.opposite': 'Opposite party', 'r.related': 'Related', 'r.witness': 'Witness', 'r.other': 'Other', pan: 'PAN', gstin: 'GSTIN',
    responsible: 'Responsible', opened: 'Opened', newMatter: 'Open a matter', check: 'Conflict check', skip: 'Owner: skip the check, reason', wip: 'Unbilled WIP', received: 'Received', cm: 'Client money', last: 'Last activity',
    title: 'Title', capField: 'Cap', blended: 'Blended rate / h', currency: 'Currency', milestones: 'Milestones', label: 'Label', pct: '%', due: 'Due', done: 'Done on', ref: 'Reference',
    retainer: 'Hour-block retainer', event: 'Success event', basis: 'Basis', base: 'Base amount', disb: 'Disbursements', 'd.agent': 'Recovered at actual (pure agent)', 'd.markup': 'With markup', 'd.included': 'Included in the fee',
    start: 'Start', end: 'End', renew: 'Renew on', matters: 'Matters covered', ethics: 'Owner\'s reason', newEng: 'New engagement', letter: 'Make letter', closeEng: 'Close', renewals: 'Renewals due in 30 days: {n}',
    terms: 'Names, PANs or GSTINs (one per line)', search: 'Search', hits: '{n} possible match(es)', clear: 'Record: clear', conflict: 'Record: conflict', waive: 'Owner: waive with consent', consent: 'Consent kept at', noHits: 'No match in clients, suppliers or matter parties.',
    'res.clear': 'Clear', 'res.conflict': 'Conflict', 'res.waived': 'Waived', rule: 'BCI Rule 33 / ICAI independence: the app records the check; the decision is yours (PS28).',
    quote: 'Letter (quotation)', accepted: 'Accepted', noLetter: 'No letter yet', warn: 'Warning',
  } as const,
  {
    'v.matters': 'मामले', 'v.engagements': 'नियुक्तियाँ', 'v.conflicts': 'हितों का टकराव जाँच', 'v.letters': 'नियुक्ति पत्र',
    code: 'मामला कोड', name: 'मामले का नाम', kind: 'प्रकार', 'k.matter': 'मामला', 'k.assignment': 'असाइनमेंट', 'k.project': 'प्रोजेक्ट', area: 'प्रैक्टिस क्षेत्र', court: 'अदालत / फ़ोरम', caseNo: 'केस नंबर',
    parties: 'पक्षकार', party: 'पक्षकार का नाम', role: 'भूमिका', 'r.client': 'मुवक्किल', 'r.opposite': 'विरोधी पक्ष', 'r.related': 'संबंधित', 'r.witness': 'गवाह', 'r.other': 'अन्य', pan: 'PAN', gstin: 'GSTIN',
    responsible: 'ज़िम्मेदार', opened: 'खोला', newMatter: 'मामला खोलें', check: 'टकराव जाँच', skip: 'मालिक: जाँच छोड़ें, कारण', wip: 'अबिल्ड कार्य', received: 'प्राप्त', cm: 'क्लाइंट का पैसा', last: 'आख़िरी गतिविधि',
    title: 'शीर्षक', capField: 'सीमा', blended: 'मिश्रित दर / घंटा', currency: 'मुद्रा', milestones: 'चरण', label: 'नाम', pct: '%', due: 'देय', done: 'पूरा हुआ', ref: 'संदर्भ',
    retainer: 'घंटा-ब्लॉक रिटेनर', event: 'सफलता घटना', basis: 'आधार', base: 'आधार राशि', disb: 'खर्चे', 'd.agent': 'वास्तविक पर वसूली (शुद्ध एजेंट)', 'd.markup': 'मार्कअप के साथ', 'd.included': 'फ़ीस में शामिल',
    start: 'शुरू', end: 'अंत', renew: 'नवीनीकरण', matters: 'शामिल मामले', ethics: 'मालिक का कारण', newEng: 'नई नियुक्ति', letter: 'नियुक्ति पत्र बनाएँ', closeEng: 'बंद करें', renewals: '30 दिन में नवीनीकरण: {n}',
    terms: 'नाम, PAN या GSTIN (हर लाइन में एक)', search: 'खोजें', hits: '{n} संभावित मिलान', clear: 'दर्ज करें: साफ़', conflict: 'दर्ज करें: टकराव', waive: 'मालिक: सहमति से छूट', consent: 'सहमति कहाँ रखी है', noHits: 'क्लाइंट, सप्लायर या पक्षकारों में कोई मिलान नहीं।',
    'res.clear': 'साफ़', 'res.conflict': 'टकराव', 'res.waived': 'छूट', rule: 'BCI नियम 33 / ICAI स्वतंत्रता: ऐप जाँच दर्ज करता है; फ़ैसला आपका है (PS28)।',
    quote: 'पत्र (कोटेशन)', accepted: 'स्वीकृत', noLetter: 'अभी पत्र नहीं', warn: 'चेतावनी',
  },
);
export type PmKey = Parameters<typeof pmT>[0];
