/**
 * R18-B: society billing run and GST strings (Bills and GST views, the regime chip, the inward-RCM hint). Shared words
 * (unit, period, total …) come from `society-r18a.ts`. `regimes` is comma-separated in the order of `REGIMES`.
 */
import { defineArea } from '../area';

export const hsbT = defineArea(
  {
    bills: 'Bills', gst: 'GST', period: 'Period', billDate: 'Bill date', due: 'Due date', run: 'Run period', planned: 'Planned: {n} bills ({b} bills of supply, {t} tax invoices, {p} plain, {o} non-member).',
    billed: 'Already billed: {n}.', noOwner: 'No member: {n}.', issued: 'Issued {n} documents.', held: '{n} held for approval.', undo: 'Undo run', reason: 'Reason', noRun: 'Run not found or already undone.', noReason: 'Give a reason to undo the run.',
    runs: 'Runs', status: 'Status', done: 'Issued', undone: 'Undone', docs: 'Documents', share: 'Share', counted: 'Counted', test: '₹7,500 test',
    commercial: 'Commercial units tested under Sl. 77(c): {u} (HS8).',
    levy: 'Special levy', levyName: 'Levy name', runLevy: 'Run levy',
    regimes: 'Not registered,Agency 18 %,Exempt — Sl. 77(c),Taxable — whole amount,Taxable — above the limit,Non-member 18 %',
    turnover: 'Turnover this FY', exempt: 'Exempt', taxable: 'Taxable', threshold: 'Registration threshold', above: 'Units above the limit in {p}: {n}',
    regHint: 'Registration may be required (Sec 22 / Circular 109 Q2). Verify with your CA.', both: 'GST is due only when the turnover is at or above the threshold and a unit is above the limit (Circular 109 Q2).',
    you: 'Your position', yes: 'Yes', no: 'No', itc: 'ITC split (Rule 42 / 43)',
    rcm: 'Security services from a non-body-corporate supplier: reverse charge (N 13/2017-CT(R) entry 14). Verify with your CA (HS15).',
    undoHeld: 'Undo refused: {u} have receipts or credit notes against this run\'s bills. Remove or cancel them first.',
  } as const,
  {
    bills: 'बिल', gst: 'GST', period: 'अवधि', billDate: 'बिल तिथि', due: 'देय तिथि', run: 'अवधि का बिल बनाएँ', planned: 'योजना: {n} बिल ({b} आपूर्ति बिल, {t} कर बीजक, {p} साधारण, {o} गैर-सदस्य)।',
    billed: 'पहले से बिल: {n}।', noOwner: 'सदस्य नहीं: {n}।', issued: '{n} दस्तावेज़ जारी।', held: '{n} स्वीकृति के लिए रुके।', undo: 'रन वापस लें', reason: 'कारण', noRun: 'रन नहीं मिला या पहले ही वापस लिया गया।', noReason: 'रन वापस लेने का कारण लिखें।',
    runs: 'रन', status: 'स्थिति', done: 'जारी', undone: 'वापस लिया', docs: 'दस्तावेज़', share: 'भेजें', counted: 'गिनी गई राशि', test: '₹7,500 जाँच',
    commercial: 'व्यावसायिक यूनिट Sl. 77(c) जाँच में: {u} (HS8)।',
    levy: 'विशेष शुल्क', levyName: 'शुल्क का नाम', runLevy: 'विशेष शुल्क का बिल',
    regimes: 'GST में पंजीकृत नहीं,एजेंसी 18 %,छूट — Sl. 77(c),कर योग्य — पूरी राशि,कर योग्य — सीमा से ऊपर,गैर-सदस्य 18 %',
    turnover: 'इस वित्त वर्ष का टर्नओवर', exempt: 'छूट', taxable: 'कर योग्य', threshold: 'पंजीकरण सीमा', above: '{p} में सीमा से ऊपर यूनिट: {n}',
    regHint: 'पंजीकरण आवश्यक हो सकता है (धारा 22 / परिपत्र 109 प्रश्न 2)। अपने CA से जाँचें।', both: 'GST तभी देय है जब टर्नओवर सीमा पर या उससे ऊपर हो और कोई यूनिट ₹7,500 से ऊपर हो (परिपत्र 109 प्रश्न 2)।',
    you: 'आपकी स्थिति', yes: 'हाँ', no: 'नहीं', itc: 'ITC विभाजन (नियम 42 / 43)',
    rcm: 'गैर-निगमित आपूर्तिकर्ता से सुरक्षा सेवाएँ: रिवर्स चार्ज (N 13/2017-CT(R) प्रविष्टि 14)। अपने CA से जाँचें (HS15)।',
    undoHeld: 'पूर्ववत नहीं: {u} के इस रन के बिलों पर रसीदें या क्रेडिट नोट हैं। पहले उन्हें हटाएँ या रद्द करें।',
  },
);
