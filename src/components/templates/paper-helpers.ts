import type { CalcTotals } from '../../lib/invoice-calc';
import type { InvoiceRecord, SenderProfile } from '../../types/invoice';
import { upiLink } from '../../lib/share';

/** Printed UPI QR. Built by the validating `upiLink`, so a malformed or doctored VPA never reaches a QR. */
export function buildUpiUrl(sender: SenderProfile): string {
  if (!sender.upiId) return '';
  return upiLink({ pa: sender.upiId, pn: sender.accountName || sender.companyName }) ?? '';
}

/**
 * Split CGST + SGST is being charged (intra-state). IGST invoices are NOT "taxed" here: they
 * print an IGST line instead; counting them printed "CGST 0.00 / SGST 0.00" and no IGST at all.
 */
export function isTaxed(invoice: InvoiceRecord, totals: CalcTotals): boolean {
  return invoice.gst_mode === 'CGST_SGST' && totals.tax_amount > 0;
}

/** Legacy single "Tax" line. */
export function isSingleTax(invoice: InvoiceRecord, totals: CalcTotals): boolean {
  return invoice.gst_mode === 'SINGLE' && totals.tax_amount > 0;
}
