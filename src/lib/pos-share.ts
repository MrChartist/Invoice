/**
 * "WhatsApp this bill" from the counter (8E, roadmap 8.148): the bill summary (`invoiceSummaryText`)
 * plus a UPI pay link for any balance left on account, sent to the customer's phone (the F3 customer,
 * or one typed when the bill has none). It is only a wa.me link the cashier opens: nothing is sent
 * by the app. Pure.
 */
import type { InvoiceRecord } from '../types/invoice';
import { invoiceSummaryText, invoiceUpiLink, normalizePhone, whatsappLink } from './share';
import { receivableBalance } from './rcm';

/** Message text for a saved POS bill. */
export function posBillText(bill: InvoiceRecord): string {
  let text = invoiceSummaryText(bill);
  if (receivableBalance(bill) > 0.004) {
    const upi = invoiceUpiLink(bill);
    if (upi) text += `\nPay now: ${upi}`;
  }
  return text;
}

/** The phone to send to: the one typed, else the bill's customer phone; null when neither is a valid number. */
export function posBillPhone(bill: Pick<InvoiceRecord, 'client'>, typed?: string): string | null {
  return normalizePhone(typed?.trim() || bill.client?.phone || '');
}

/** R3-A5: file name of a counter bill shared as an image (thermal roll → PNG): "INV-FY26-27-0012.png". */
export function posBillImageName(bill: Pick<InvoiceRecord, 'invoice_number'>): string {
  return `${(bill.invoice_number || 'bill').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'bill'}.png`;
}

/** wa.me link for the bill, or null without a usable phone. */
export function posWhatsappHref(bill: InvoiceRecord, typed?: string): string | null {
  const phone = posBillPhone(bill, typed);
  return phone ? whatsappLink(phone, posBillText(bill)) : null;
}
