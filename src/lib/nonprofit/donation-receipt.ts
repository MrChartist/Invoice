/**
 * R5-C3 donation receipt: the app's self-contained receipt page (`receipts.ts`, script-free) with the entity's PAN,
 * 80G URN and validity, the donor's id, mode, amount in words and the "Form 10BE will be issued after Form 10BD is
 * filed" line. Section / form labels follow the receipt date through the ITA 2025 helpers (80G → Sec 133(1)(b)(ii),
 * 10BD / 10BE → Form 113 / 114 from FY 2026-27) — verify with your CA.
 */
import type { Client, SenderProfile } from '../../types/invoice';
import type { Donation } from '../../types/institutions-r5';
import { amountInWords } from '../amount-in-words';
import { receiptHtml } from '../receipts';
import { ACT_WORDS_PRINT, formText, sectionText, type ActWords } from '../ita2025';
import { fyOf } from './donations';

/** Section label on a date ("80G" before 1 Apr 2026, "Sec 133(1)(b)(ii) [old 80G]" from then). */
export const donationSectionText = (section: string, date: string, w: ActWords = ACT_WORDS_PRINT) => (section === 'none' ? '-' : section === '80G' ? sectionText('80G', date, w) : `Sec ${section}`);

/** "Form 10BD" for FY 2025-26, "Form 113 [old 10BD]" for FY 2026-27 on (chosen by the FY of the donation). */
export const tenBdText = (date: string, w: ActWords = ACT_WORDS_PRINT) => formText('10BD', `${fyOf(date)}-04-01`, w);
export const tenBeText = (date: string, w: ActWords = ACT_WORDS_PRINT) => formText('10BE', `${fyOf(date)}-04-01`, w);

export function donationReceiptHtml(d: Donation, donor: Client | undefined, p: SenderProfile | null, opts: { labels: { mode: string; type: string }; cashLimit?: number }): string {
  const npo = p?.npo;
  const sec = donationSectionText(d.section, d.date);
  const notes = [
    ...(d.mode === 'cash' && d.section === '80G' && opts.cashLimit && d.amount > opts.cashLimit ? [`Cash donation above ₹${opts.cashLimit}: not deductible under ${sec}.`] : []),
    ...(d.section !== 'none' ? [`${tenBeText(d.date)} will be issued after ${tenBdText(d.date)} is filed.`] : []),
  ];
  return receiptHtml({
    title: `Donation receipt${d.cancelled ? ': CANCELLED' : ''}`, number: d.number, date: d.date, from: d.anonymous ? 'Anonymous' : donor?.company || donor?.name || '', fromGstin: '',
    business: p?.companyName ?? '', businessGstin: p?.companyGstin ?? '', businessAddress: p?.companyAddress ?? '', amount: d.amount, currency: 'INR', amountWords: amountInWords(d.amount, 'INR'),
    method: opts.labels.mode, reference: d.reference ?? '', against: '', invoiceTotal: d.amount, balanceAfter: 0,
    rows: [
      ['Donor ID', d.anonymous || !donor?.donor?.id_no ? '' : `${donor.donor.id_code.toUpperCase()} ${donor.donor.id_no}`], ['Section', sec], ['Mode', opts.labels.mode], ['Donation type', opts.labels.type],
      ['Reference', d.reference ?? ''], ['Purpose', d.purpose ?? ''], ['PAN of the institution', npo?.pan ?? ''],
      ['Approval (URN)', npo?.urn_80g ? `${npo.urn_80g}${npo.urn_80g_date ? ` dated ${npo.urn_80g_date}` : ''}${npo.urn_80g_valid_to ? `, valid to ${npo.urn_80g_valid_to}` : ''}` : ''],
    ],
    notes,
  });
}
