/**
 * R17-B: duty register and billing strings (muster view, payroll push, deploy list, bills view, billing settings).
 * Shared words (site, post, duty, muster, reliever, month, client, service charge) come from `manpower-r17a.ts`.
 */
import { defineArea } from '../area';

export const mbT = defineArea(
  {
    bills: 'Bills', person: 'Person', ot: 'OT hours', copy: 'Copy last month', add: 'Add person', saveDraft: 'Save draft',
    lock: 'Lock', unlock: 'Unlock', locked: 'Locked: read-only', draft: 'Draft', saved: 'Muster saved.', pick: 'Pick a site.',
    total: '{d} of {f} duties', imp: 'Import CSV / XLSX', unknown: 'Codes not found: {c}', imported: '{n} rows imported.',
    push: 'Send to payroll', missing: 'Not locked: {s}. Send the locked ones anyway?', lopNow: 'LOP now', lop: 'LOP', confirm: 'Confirm', pushed: 'Attendance written for {n} people.',
    staff: 'Deployed staff', deployTo: 'Deploy', release: 'Release',
    billed: 'Billed', unbilled: 'Unbilled', bill: 'Bill', billAll: 'Bill all locked', lockFirst: 'Lock first', none: 'No muster',
    made: '{n} draft bills made.', already: 'Already billed: {s}', again: 'Bill again',
    set: 'Billing settings', days: 'Billing days', cal: 'Calendar', date: 'Bill date', end: 'Month end', next: '1st of next month',
    printTds: 'Print expected TDS on bills', extra: 'Extra-duty attendance type', cp: 'Cost-plus %: PF, ESI, bonus, leave, relieving; uniform ₹ / head', saveSet: 'Save settings',
    // QA20 V8: muster warnings and the GST TDS hint (built by the engines at render time)
    'w.two': '{n}: {d} duties is more than {m} (two a day).', 'w.all': '{n}: {d} duties across all sites this month (over 31).', 'w.left': '{n} left on {d}, before this month.',
    gstTds: 'GST TDS u/s 51 expected at {r} % (contract value above ₹{t}): verify with your CA (MP13).',
  } as const,
  {
    bills: 'बिल', person: 'व्यक्ति', ot: 'ओवरटाइम घंटे', copy: 'पिछला महीना कॉपी करें', add: 'व्यक्ति जोड़ें', saveDraft: 'ड्राफ़्ट सहेजें',
    lock: 'लॉक करें', unlock: 'अनलॉक करें', locked: 'लॉक: केवल पढ़ें', draft: 'ड्राफ़्ट', saved: 'मस्टर सहेजा गया।', pick: 'साइट चुनें।',
    total: '{f} में से {d} ड्यूटी', imp: 'CSV / XLSX आयात', unknown: 'ये कोड नहीं मिले: {c}', imported: '{n} पंक्तियाँ आयात हुईं।',
    push: 'पेरोल में भेजें', missing: 'लॉक नहीं: {s}। फिर भी लॉक वाले भेजें?', lopNow: 'अभी LOP', lop: 'LOP', confirm: 'पुष्टि करें', pushed: '{n} लोगों की हाज़िरी लिखी गई।',
    staff: 'तैनात कर्मचारी', deployTo: 'तैनात करें', release: 'हटाएँ',
    billed: 'बिल हुआ', unbilled: 'बिल बाकी', bill: 'बिल बनाएँ', billAll: 'सभी लॉक वाले बिल करें', lockFirst: 'पहले लॉक करें', none: 'मस्टर नहीं',
    made: '{n} ड्राफ़्ट बिल बने।', already: 'पहले ही बिल हुआ: {s}', again: 'फिर से बिल करें',
    set: 'बिलिंग सेटिंग', days: 'बिलिंग दिन', cal: 'कैलेंडर', date: 'बिल की तारीख', end: 'महीने का अंत', next: 'अगले महीने की 1 तारीख',
    printTds: 'बिल पर अपेक्षित TDS छापें', extra: 'अतिरिक्त ड्यूटी हाज़िरी प्रकार', cp: 'लागत-आधारित %: PF, ESI, बोनस, छुट्टी, रिलीविंग; वर्दी ₹ / व्यक्ति', saveSet: 'सेटिंग सहेजें',
    'w.two': '{n}: {d} ड्यूटी, {m} (दिन में दो) से अधिक।', 'w.all': '{n}: इस महीने सभी साइटों पर {d} ड्यूटी (31 से अधिक)।', 'w.left': '{n} ने {d} को छोड़ा, इस महीने से पहले।',
    gstTds: 'धारा 51 के तहत GST TDS {r} % अपेक्षित (अनुबंध मूल्य ₹{t} से अधिक): अपने CA से पुष्टि करें (MP13)।',
  },
);
