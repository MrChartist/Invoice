/** R14: the words every professional desk uses — once (each desk's own area holds only that desk's words). */
import { defineArea } from '../area';

export const psT = defineArea(
  {
    matter: 'Matter', engagement: 'Engagement', client: 'Client', partner: 'Partner', staff: 'Timekeeper', fee: 'Fee', hours: 'Hours', rate: 'Rate', amount: 'Amount',
    standard: 'Standard value', billed: 'Billed', collected: 'Collected', writeDown: 'Write-up / down', reason: 'Reason', date: 'Date', from: 'From', to: 'To', total: 'Total',
    save: 'Save', add: 'Add', remove: 'Remove', close: 'Close', reopen: 'Reopen', open: 'Open', closed: 'Closed', none: '-', csv: 'CSV', saved: 'Saved.', model: 'Billing model', status: 'Status', print: 'Print',
    'm.hourly': 'Hourly', 'm.fixed': 'Fixed fee', 'm.milestone': 'Milestones', 'm.retainer': 'Retainer', 'm.capped': 'Capped', 'm.success': 'Success fee', 'm.blended': 'Blended rate',
    's.draft': 'Draft', 's.sent': 'Sent', 's.accepted': 'Accepted', 's.active': 'Active', 's.closed': 'Closed',
    who: 'Who (timekeeper)', swift: 'SWIFT / BIC', iban: 'IBAN', interBank: 'Intermediary bank', bankHint: 'Printed only on export documents.', details: 'Matter details', prebill: 'Open the pre-bill', cap: 'Hours / week', std: 'Standard rate', cost: 'Cost rate', target: 'Target %',
    wp: 'Working paper: verify with your CA. Professional-conduct notes are reminders, not advice.',
  } as const,
  {
    matter: 'मामला', engagement: 'नियुक्ति', client: 'मुवक्किल / क्लाइंट', partner: 'साझेदार', staff: 'टाइमकीपर', fee: 'फ़ीस', hours: 'घंटे', rate: 'दर', amount: 'राशि',
    standard: 'मानक मूल्य', billed: 'बिल किया', collected: 'वसूला', writeDown: 'कटौती / बढ़ोतरी', reason: 'कारण', date: 'तारीख़', from: 'से', to: 'तक', total: 'कुल',
    save: 'सहेजें', add: 'जोड़ें', remove: 'हटाएँ', close: 'बंद करें', reopen: 'फिर खोलें', open: 'खुला', closed: 'बंद', none: '-', csv: 'CSV', saved: 'सहेजा गया।', model: 'बिलिंग तरीका', status: 'स्थिति', print: 'प्रिंट',
    'm.hourly': 'घंटे के हिसाब से', 'm.fixed': 'तय फ़ीस', 'm.milestone': 'चरण', 'm.retainer': 'रिटेनर', 'm.capped': 'सीमित फ़ीस', 'm.success': 'सफलता फ़ीस', 'm.blended': 'मिश्रित दर',
    's.draft': 'ड्राफ़्ट', 's.sent': 'भेजा', 's.accepted': 'स्वीकृत', 's.active': 'सक्रिय', 's.closed': 'बंद',
    who: 'कौन (टाइमकीपर)', swift: 'SWIFT / BIC', iban: 'IBAN', interBank: 'मध्यस्थ बैंक', bankHint: 'केवल निर्यात दस्तावेज़ों पर छपता है।', details: 'मामले का विवरण', prebill: 'प्री-बिल खोलें', cap: 'घंटे / सप्ताह', std: 'मानक दर', cost: 'लागत दर', target: 'लक्ष्य %',
    wp: 'कार्य पत्र: अपने CA से जाँच लें। पेशेवर आचरण की बातें केवल याद दिलाने के लिए हैं, सलाह नहीं।',
  },
);
export type PsKey = Parameters<typeof psT>[0];
