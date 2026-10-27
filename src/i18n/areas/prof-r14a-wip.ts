/** R14 (PS-A3 / A4) WIP desk strings: WIP, pre-bill, realisation, utilisation, profitability, year end. */
import { defineArea } from '../area';

export const pwT = defineArea(
  {
    'v.wip': 'WIP', 'v.prebill': 'Pre-bill', 'v.realisation': 'Realisation', 'v.utilisation': 'Utilisation', 'v.profit': 'Profitability', 'v.yearend': 'Year end',
    by: 'Group by', 'by.matter': 'Matter', 'by.client': 'Client', 'by.partner': 'Partner', 'by.staff': 'Timekeeper', 'by.work_type': 'Work type', 'by.engagement': 'Engagement',
    oldest: 'Oldest', capLeft: 'Cap left', costs: 'Costs', older: 'Older', days: '≤ {n} days', writeOff: 'Write off selected', reverse: 'Reverse write-off (owner)',
    pick: 'Client', all: 'All matters', desc: 'Work', billH: 'Bill hours', exclude: 'Exclude', defer: 'Later', target: 'Bill this amount for the time', annexure: 'Attach the timesheet annexure',
    milestone: 'Milestones to bill', create: 'Create draft', nothing: 'Nothing unbilled for this client.', preview: 'This bill: {billed} for time worth {standard} ({diff})',
    worked: 'Worked', billing: 'Billing', collection: 'Collection', overall: 'Overall',
    defs: 'Billing realisation = billed ÷ standard value of the time billed (WIP written off counts at nil). Collection = collected (receipts and TDS deducted, less credit notes) ÷ billed. Overall = collected ÷ standard.',
    capacity: 'Hours / week', stdRate: 'Standard rate', costRate: 'Cost rate', targetPct: 'Target %', available: 'Available', billable: 'Billable', nonBill: 'Non-billable', util: 'Utilisation', newStaff: 'Add timekeeper', name: 'Name', rateFrom: 'Rates from',
    contribution: 'Contribution', margin: 'Margin', cost: 'Staff cost', unrecovered: 'Unrecovered costs', private: 'Cost rates are management data and never print.',
    closing: 'Closing date', expected: 'Expected realisation', net: 'Unbilled work (net)', method: 'Method', poc: 'Percentage of completion', completed: 'Completed service (≤ 90 days)',
    note: 'AS 9 / ICDS IV: service revenue by percentage of completion; an engagement of up to 90 days may use the completed-service method (PS23).', accrueFrom: 'Accrual journal from (owner)', post: 'Post accrual (reversed next day)', posted: 'Posted {n}.',
  } as const,
  {
    'v.wip': 'अबिल्ड कार्य', 'v.prebill': 'प्री-बिल', 'v.realisation': 'वसूली दर', 'v.utilisation': 'उपयोग दर', 'v.profit': 'लाभप्रदता', 'v.yearend': 'वर्ष अंत',
    by: 'समूह', 'by.matter': 'मामला', 'by.client': 'क्लाइंट', 'by.partner': 'साझेदार', 'by.staff': 'टाइमकीपर', 'by.work_type': 'काम का प्रकार', 'by.engagement': 'नियुक्ति',
    oldest: 'सबसे पुराना', capLeft: 'बची सीमा', costs: 'खर्चे', older: 'पुराना', days: '≤ {n} दिन', writeOff: 'चुने हुए बट्टे खाते डालें', reverse: 'बट्टा खाता वापस (मालिक)',
    pick: 'क्लाइंट', all: 'सभी मामले', desc: 'काम', billH: 'बिल घंटे', exclude: 'छोड़ें', defer: 'बाद में', target: 'समय के लिए यह राशि बिल करें', annexure: 'समय-पत्रक संलग्नक जोड़ें',
    milestone: 'बिल करने वाले चरण', create: 'ड्राफ़्ट बनाएँ', nothing: 'इस क्लाइंट का कुछ अबिल्ड नहीं।', preview: 'यह बिल: {standard} मूल्य के समय के लिए {billed} ({diff})',
    worked: 'किया', billing: 'बिलिंग', collection: 'वसूली', overall: 'कुल',
    defs: 'बिलिंग वसूली दर = बिल ÷ बिल किए समय का मानक मूल्य (बट्टे खाते का कार्य शून्य पर)। वसूली = वसूला (प्राप्ति और कटा TDS, क्रेडिट नोट घटाकर) ÷ बिल। कुल = वसूला ÷ मानक।',
    capacity: 'घंटे / सप्ताह', stdRate: 'मानक दर', costRate: 'लागत दर', targetPct: 'लक्ष्य %', available: 'उपलब्ध', billable: 'बिल योग्य', nonBill: 'बिल योग्य नहीं', util: 'उपयोग दर', newStaff: 'टाइमकीपर जोड़ें', name: 'नाम', rateFrom: 'दरें कब से',
    contribution: 'योगदान', margin: 'मार्जिन', cost: 'स्टाफ़ लागत', unrecovered: 'न वसूले खर्चे', private: 'लागत दरें प्रबंधन डेटा हैं और कभी प्रिंट नहीं होतीं।',
    closing: 'समापन तारीख़', expected: 'अनुमानित वसूली', net: 'अबिल्ड कार्य (शुद्ध)', method: 'तरीका', poc: 'पूर्णता का प्रतिशत', completed: 'पूरी सेवा (≤ 90 दिन)',
    note: 'AS 9 / ICDS IV: सेवा आय पूर्णता के प्रतिशत से; 90 दिन तक की नियुक्ति पूरी-सेवा तरीका ले सकती है (PS23)।', accrueFrom: 'उपार्जन जर्नल कब से (मालिक)', post: 'उपार्जन पोस्ट करें (अगले दिन उलटा)', posted: '{n} पोस्ट हुआ।',
  },
);
