/**
 * R18-C: society dues strings (Dues view: defaulters, receipts with interest first, interest waiver, dues certificate,
 * transfer of membership, notice-board list, reminder wording). Shared words (unit, member, owner, total …) come from
 * `society-r18a.ts`.
 */
import { defineArea } from '../area';

export const hscT = defineArea(
  {
    dues: 'Dues', asOf: 'As at', open: 'Open dues', interest: 'Interest billed', accrued: 'Interest to date', months: 'Months overdue', promise: 'Last promise', overdue: 'Overdue',
    m1: '1+ months', m3: '3+ months', none: 'No dues open.', receipt: 'Receipt', amount: 'Amount', date: 'Date', save: 'Save receipt', alloc: 'Interest first, then the oldest bills — change any amount.',
    saved: 'Receipt saved.', cert: 'Dues certificate', certLine: 'Dues of {u} ({m}) as at {d}: principal {p}, interest to date {i}, billed after the date {a}. Total {t}. Certificate {no}, valid till {v}. Only what the books hold.',
    print: 'Print', transfer: 'Transfer membership', to: 'New member', premium: 'Transfer premium', settled: 'Dues settled', done: 'Membership transferred.',
    waive: 'Waive interest', reason: 'Reason', resolution: 'GB resolution', waived: 'Interest waived by a financial credit note.', needWhy: 'Give the reason and the general-body resolution.', tooMuch: 'More than the open interest.',
    statement: 'Statement', notice: 'Notice-board list', wording: 'Use society reminder wording', worded: 'Reminders now use the society wording.', remind: 'Remind',
    e_date: 'Enter the date.', e_to: 'Pick the new member.', e_same: 'The new member already owns the unit.', e_dues: 'Dues are open: settle them or tick "Dues settled".',
    noUnit: 'Unit not found.', noMember: 'No member.',
  } as const,
  {
    dues: 'बकाया', asOf: 'तिथि तक', open: 'खुला बकाया', interest: 'बिल किया ब्याज', accrued: 'आज तक का ब्याज', months: 'बकाया महीने', promise: 'अंतिम वादा', overdue: 'अतिदेय',
    m1: '1+ महीने', m3: '3+ महीने', none: 'कोई बकाया नहीं।', receipt: 'रसीद', amount: 'राशि', date: 'तिथि', save: 'रसीद सहेजें', alloc: 'पहले ब्याज, फिर सबसे पुराने बिल — कोई भी राशि बदलें।',
    saved: 'रसीद सहेजी गई।', cert: 'बकाया प्रमाणपत्र (NOC)', certLine: '{u} ({m}) का {d} तक बकाया: मूल {p}, आज तक का ब्याज {i}, तिथि के बाद के बिल {a}। कुल {t}। प्रमाणपत्र {no}, {v} तक मान्य। केवल बहीखाते की राशि।',
    print: 'प्रिंट', transfer: 'सदस्यता हस्तांतरण', to: 'नया सदस्य', premium: 'हस्तांतरण प्रीमियम', settled: 'बकाया चुकता', done: 'सदस्यता हस्तांतरित।',
    waive: 'ब्याज माफ़ करें', reason: 'कारण', resolution: 'आम सभा प्रस्ताव', waived: 'वित्तीय क्रेडिट नोट से ब्याज माफ़।', needWhy: 'कारण और आम सभा का प्रस्ताव लिखें।', tooMuch: 'खुले ब्याज से अधिक।',
    statement: 'विवरण', notice: 'सूचना-पट्ट सूची', wording: 'सोसाइटी की रिमाइंडर भाषा लगाएँ', worded: 'रिमाइंडर अब सोसाइटी की भाषा में।', remind: 'याद दिलाएँ',
    e_date: 'तिथि लिखें।', e_to: 'नया सदस्य चुनें।', e_same: 'नया सदस्य पहले से यूनिट का मालिक है।', e_dues: 'बकाया खुला है: चुकाएँ या "बकाया चुकता" चुनें।',
    noUnit: 'यूनिट नहीं मिली।', noMember: 'कोई सदस्य नहीं।',
  },
);
