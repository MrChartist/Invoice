/**
 * R17-C: compliance and profitability strings (compliance pack, minimum wages and Labour Code hints, site P&L, the
 * purchase bill's site). Shared words (site, month, client, reliever, compliance, save) come from `manpower-r17a.ts`.
 */
import { defineArea } from '../area';

export const mcT = defineArea(
  {
    profit: 'Site P&L', noRun: 'No finalised payroll run for {m}: finalise it in Payroll first.', noMuster: 'No muster for this site and month.',
    cols: 'Name,Code,UAN,Duties,Gross,PF wages,PF EE,EPF ER,EPS,ESI EE,ESI ER,Deductions,Net',
    total: 'Total', trrn: 'PF TRRN', chal: 'ESI challan', paid: 'Paid on', amt: 'Amount', sts: 'Pending,Proved,Waived',
    holdPct: 'Client hold %', holdAmt: 'Client hold ₹', saved: 'Compliance saved.', print: 'Print annexure', proved: 'Proved',
    bills: 'Bills of the month', held: 'Held {h}: release expected once proved (the receivable stays open).',
    annex: 'Prepared from the contractor\'s payroll; verify with your CA / labour-law adviser (MP18).',
    mw: 'Minimum wages', rev: 'From,Post,Zone,Skill,Min ₹ / duty,₹ / month,Notification', add: 'Add revision',
    short: '{n} ({p}): paid ₹{a} a duty, minimum ₹{b}: owed ₹{c}', ok: 'No shortfall against the typed revisions.',
    'h.ot': '{w}: overtime paid below twice the ordinary rate', 'h.fte': '{w}: fixed-term past one year: provide gratuity',
    'h.wage': '{w}: PF wages under half of pay (50 % wage rule)', 'h.clra': 'Site {w} workers: no OSH / contract-labour licence on file',
    pl: 'Billed,Wages,Relievers,Employer PF / ESI,Site bills,Margin,Margin %',
  } as const,
  {
    profit: 'साइट का लाभ-हानि', noRun: '{m} का अंतिम पेरोल नहीं: पहले पेरोल में अंतिम करें।', noMuster: 'इस साइट और महीने का मस्टर नहीं।',
    cols: 'नाम,कोड,UAN,ड्यूटी,सकल,PF वेतन,PF कर्मचारी,EPF नियोक्ता,EPS,ESI कर्मचारी,ESI नियोक्ता,कटौती,शुद्ध',
    total: 'कुल', trrn: 'PF चालान (TRRN)', chal: 'ESI चालान', paid: 'भुगतान तिथि', amt: 'राशि', sts: 'बाकी,प्रमाणित,छूट',
    holdPct: 'ग्राहक रोक %', holdAmt: 'ग्राहक रोक ₹', saved: 'अनुपालन सहेजा गया।', print: 'अनुबंध छापें', proved: 'प्रमाणित',
    bills: 'महीने के बिल', held: '{h} रोका: प्रमाण के बाद मिलने की उम्मीद (बकाया खुला रहता है)।',
    annex: 'ठेकेदार के पेरोल से तैयार; अपने CA / श्रम-कानून सलाहकार से जाँचें (MP18)।',
    mw: 'न्यूनतम वेतन', rev: 'से,पोस्ट,ज़ोन,कौशल,न्यूनतम ₹ / ड्यूटी,₹ / माह,अधिसूचना', add: 'संशोधन जोड़ें',
    short: '{n} ({p}): ₹{a} प्रति ड्यूटी दिया, न्यूनतम ₹{b}: बकाया ₹{c}', ok: 'लिखे संशोधनों से कोई कमी नहीं।',
    'h.ot': '{w}: ओवरटाइम सामान्य दर के दोगुने से कम', 'h.fte': '{w}: निश्चित-अवधि एक साल से अधिक: ग्रेच्युटी दें',
    'h.wage': '{w}: PF वेतन कुल वेतन के आधे से कम (50 % नियम)', 'h.clra': 'साइट {w} कर्मचारी: OSH / ठेका-श्रम लाइसेंस नहीं',
    pl: 'बिल,वेतन,रिलीवर,नियोक्ता PF / ESI,साइट बिल,लाभ,लाभ %',
  },
);

/** Item `i` of the comma-separated list `key`. */
export const mcList = (key: 'cols' | 'sts' | 'rev' | 'pl', i: number): string => mcT(key).split(',')[i] ?? '';
