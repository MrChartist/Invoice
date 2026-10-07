import type { CalcTotals } from '../../lib/invoice-calc';
import type { InvoiceRecord, SenderProfile } from '../../types/invoice';

export function buildUpiUrl(sender: SenderProfile): string {
  if (!sender.upiId) return '';
  const payee = encodeURIComponent(sender.accountName || sender.companyName);
  return `upi://pay?pa=${sender.upiId}&pn=${payee}&cu=INR`;
}

/** Split CGST + SGST is being charged. */
export function isTaxed(invoice: InvoiceRecord, totals: CalcTotals): boolean {
  return invoice.gst_mode !== 'NONE' && invoice.gst_mode !== 'SINGLE' && totals.tax_amount > 0;
}

/** Legacy single "Tax" line. */
export function isSingleTax(invoice: InvoiceRecord, totals: CalcTotals): boolean {
  return invoice.gst_mode === 'SINGLE' && totals.tax_amount > 0;
}
