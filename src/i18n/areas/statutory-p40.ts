/**
 * PENDING 40 (7.131) — 7R follow-ups: ITC refund claims netted in the carried credit, TRACES flags in the TDS
 * Deductions tab, Sec 195A grossing-up and Form 15CA / 15CB on the 27Q paper, books column on GSTR-9C Table 9.
 * English + Hindi.
 */
import { defineArea } from '../area';

export const p40T = defineArea(
  {
    carryRefund: 'ITC refund claims filed since then debit the credit ledger (Rule 89(3)): {amount} netted in.',
    vNrTaxBorne: 'We bear the tax (Sec 195A grossing-up)',
    f15Title: '{ca} / {cb} (Rule 37BB)',
    f15Hint: 'Part A: chargeable, the payee’s remittances this FY up to ₹5 lakh. Part B: a Sec 197 / 195(2) certificate or order is on file. Part C: above ₹5 lakh — get the accountant’s certificate first. Part D: not chargeable. Remittances in the Rule 37BB(3) list need no form. Working paper — verify with your CA.',
    f15Part: 'Part',
    f15Why: 'Why',
    f15Fy: 'FY remittances',
    q27Gross: 'Grossed up (Sec 195A)',
    q27Sc: 'Surcharge',
    tracesFlag: 'TRACES: {kinds}',
    c9BooksCol: 'Books',
    c9Diff: 'Difference',
    c9NotByRate: 'Tax in the books not on a document line by rate',
    c9BooksHint: 'Books: tax on the FY’s sales and credit notes by line rate, as the books carry them (drafts and cancelled documents left out); tax not on a document line by rate (legacy single-tax rows, foreign-currency documents) has its own row. Difference = books − documents.',
  },
  {
    carryRefund: 'तब से दाख़िल ITC रिफ़ंड दावे क्रेडिट लेजर से घटते हैं (नियम 89(3)): {amount} घटाया गया।',
    vNrTaxBorne: 'कर हम वहन करते हैं (धारा 195A ग्रॉसिंग-अप)',
    f15Title: '{ca} / {cb} (नियम 37BB)',
    f15Hint: 'भाग A: कर योग्य, इस वित्त वर्ष में प्राप्तकर्ता को भेजी राशि ₹5 लाख तक। भाग B: धारा 197 / 195(2) प्रमाणपत्र या आदेश उपलब्ध। भाग C: ₹5 लाख से अधिक — पहले लेखाकार का प्रमाणपत्र लें। भाग D: कर योग्य नहीं। नियम 37BB(3) सूची की राशि के लिए फ़ॉर्म नहीं। वर्किंग पेपर — अपने CA से जाँचें।',
    f15Part: 'भाग',
    f15Why: 'कारण',
    f15Fy: 'वित्त वर्ष में भेजी राशि',
    q27Gross: 'ग्रॉस-अप (धारा 195A)',
    q27Sc: 'सरचार्ज',
    tracesFlag: 'TRACES: {kinds}',
    c9BooksCol: 'बही',
    c9Diff: 'अंतर',
    c9NotByRate: 'बही में कर जो किसी दस्तावेज़ पंक्ति पर दर अनुसार नहीं',
    c9BooksHint: 'बही: वित्त वर्ष की बिक्री और क्रेडिट नोट पर कर, पंक्ति की दर अनुसार, जैसे बही में है (ड्राफ़्ट और रद्द दस्तावेज़ छोड़कर); जो कर किसी दस्तावेज़ पंक्ति पर दर अनुसार नहीं (पुरानी एकल-कर पंक्तियाँ, विदेशी मुद्रा दस्तावेज़) उसकी अलग पंक्ति है। अंतर = बही − दस्तावेज़।',
  },
);
