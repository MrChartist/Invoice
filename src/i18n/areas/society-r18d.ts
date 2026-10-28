/**
 * R18-D: society funds, registers, audit tracker and income-tax working paper strings (Funds and Registers views, the
 * bell notice). Shared words (unit, member, total …) come from `society-r18a.ts`.
 */
import { defineArea } from '../area';

export const hsdT = defineArea(
  {
    funds: 'Funds', registers: 'Registers', map: 'Map funds', mapped: 'Fund cost centres ready.', transfer: 'Transfer for {p}', posted: 'Transfer journal posted.', nothing: 'Nothing left to transfer.', yearEnd: 'Transfer at the year end',
    fy: 'Financial year', opening: 'Opening', billed: 'Billed', moved: 'Transferred', spent: 'Spent', closing: 'Closing', fundLow: '{f}: billed {b} is below the minimum {m} for the year (HS27).', statement: 'Fund statements (Books)',
    j: 'List of members (Form J)', members: 'Register of members', iReg: 'I register', share: 'Share register', nomination: 'Nomination register', print: 'Print',
    no: 'Member no.', admitted: 'Admitted on', cert: 'Share certificate', nominees: 'Nominees (name:share %:relation; …)', transfers: 'Transfers', save: 'Save', saved: 'Saved.',
    audit: 'Audit', auditor: 'Auditor', appointed: 'Appointed on', dueOn: 'Due date', report: 'Report on', rectified: 'Rectification report on',
    sDue: 'Due in {n} days', sOver: 'Overdue', sDone: 'Reported', sFixed: 'Rectified', aTitle: 'Society audit {fy} due on {d}', aOpen: 'Open registers',
    itax: 'Income tax (working paper)', mutual: 'Mutual receipts (members)', nonMutual: 'Non-member income, bank interest, dividends', ded: 'Deduction lines', tdsNote: 'TDS on contractors, professionals and rent: see the TDS rows of your payables; no new rows here (HS23).', bank: 'Interest from a co-operative bank under (2)(d): flagged (HS21).', wp: 'Working paper — verify with your CA. Nothing posts.',
    noFunds: 'Map the funds first, and pick a period.', covered: 'The fund transfer for {p} already covers part of this period: post transfers by the same kind of period (or reverse that journal first).',
  } as const,
  {
    funds: 'निधियाँ', registers: 'रजिस्टर', map: 'निधियाँ जोड़ें', mapped: 'निधि लागत केंद्र तैयार।', transfer: '{p} का हस्तांतरण', posted: 'हस्तांतरण जर्नल दर्ज।', nothing: 'हस्तांतरण के लिए कुछ नहीं।', yearEnd: 'वर्ष के अंत में हस्तांतरण',
    fy: 'वित्त वर्ष', opening: 'प्रारंभिक', billed: 'बिल किया', moved: 'हस्तांतरित', spent: 'ख़र्च', closing: 'अंतिम', fundLow: '{f}: बिल {b} वर्ष के न्यूनतम {m} से कम है (HS27)।', statement: 'निधि विवरण (बहीखाते)',
    j: 'सदस्य सूची (फ़ॉर्म J)', members: 'सदस्य रजिस्टर', iReg: 'I रजिस्टर', share: 'शेयर रजिस्टर', nomination: 'नामांकन रजिस्टर', print: 'प्रिंट',
    no: 'सदस्य क्र.', admitted: 'प्रवेश तिथि', cert: 'शेयर प्रमाणपत्र', nominees: 'नामांकित (नाम:हिस्सा %:संबंध; …)', transfers: 'हस्तांतरण', save: 'सहेजें', saved: 'सहेजा गया।',
    audit: 'लेखा परीक्षा', auditor: 'लेखा परीक्षक', appointed: 'नियुक्ति तिथि', dueOn: 'देय तिथि', report: 'रिपोर्ट तिथि', rectified: 'सुधार रिपोर्ट तिथि',
    sDue: '{n} दिन में देय', sOver: 'अतिदेय', sDone: 'रिपोर्ट मिली', sFixed: 'सुधार हुआ', aTitle: 'सोसाइटी लेखा परीक्षा {fy} {d} को देय', aOpen: 'रजिस्टर खोलें',
    itax: 'आयकर (कार्य-पत्र)', mutual: 'पारस्परिक प्राप्तियाँ (सदस्य)', nonMutual: 'गैर-सदस्य आय, बैंक ब्याज, लाभांश', ded: 'कटौती की पंक्तियाँ', tdsNote: 'ठेकेदार, पेशेवर और किराये पर TDS: अपने देय की TDS पंक्तियाँ देखें; यहाँ नई पंक्ति नहीं (HS23)।', bank: 'सहकारी बैंक से ब्याज (2)(d) में: चिह्नित (HS21)।', wp: 'कार्य-पत्र — अपने CA से जाँचें। कुछ दर्ज नहीं होता।',
    noFunds: 'पहले फंड जोड़ें और अवधि चुनें।', covered: '{p} का फंड हस्तांतरण इस अवधि का हिस्सा पहले से शामिल करता है: उसी प्रकार की अवधि से हस्तांतरण करें (या पहले वह जर्नल उलटें)।',
  },
);
