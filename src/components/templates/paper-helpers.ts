import type { CalcTotals } from '../../lib/invoice-calc';
import type { InvoiceItem, InvoiceRecord, SenderProfile } from '../../types/invoice';
import { upiLink } from '../../lib/share';

/** `YYYY-MM-DD` → `MM/YYYY`, the way batch dates are printed on packs. */
function monthYear(day: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(day);
  return m ? `${m[2]}/${m[1]}` : day;
}

/**
 * The batch / expiry / serial / warranty sub-line printed under a tracked stock line
 * (6.6 / 6.11), e.g. "Batch B12 · Mfg 01/2026 · Exp 06/2027" or "S/N: 3567…, 3567… · Warranty 12 months".
 * '' for untracked lines, so ordinary documents print exactly as before.
 */
export function trackingText(item: (Pick<InvoiceItem, 'batch_no' | 'batch_mfg' | 'batch_expiry' | 'serials' | 'warranty_months'> & { bin?: string }) | undefined): string {
  if (!item) return '';
  const parts: string[] = [];
  if (item.bin) parts.push(`Bin ${item.bin}`); // 8.86: snapshot on delivery challan lines
  if (item.batch_no) parts.push(`Batch ${item.batch_no}`);
  if (item.batch_no && item.batch_mfg) parts.push(`Mfg ${monthYear(item.batch_mfg)}`);
  if (item.batch_no && item.batch_expiry) parts.push(`Exp ${monthYear(item.batch_expiry)}`);
  if (item.serials?.length) parts.push(`S/N: ${item.serials.join(', ')}`);
  if (item.serials?.length && item.warranty_months) parts.push(`Warranty ${item.warranty_months} month${item.warranty_months === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

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

/**
 * Outward reverse charge calculated the current way (`rcm_tax_excluded`): the GST is printed as
 * "payable by the recipient" in its own note, never as a row that adds up to the total. Older
 * reverse-charge documents (tax inside their stored total) render exactly as they always did.
 */
export function isRcmTotals(totals: CalcTotals): boolean {
  return (totals.rcm_tax ?? 0) > 0;
}

/** Rule 46(p): the tax payable on reverse charge, printed under the totals. */
export function rcmTaxNote(totals: CalcTotals, money: (amount: number) => string): string {
  if (!isRcmTotals(totals)) return '';
  const heads = [
    totals.cgst_amount > 0 && `CGST ${money(totals.cgst_amount)}`,
    totals.sgst_amount > 0 && `SGST ${money(totals.sgst_amount)}`,
    totals.igst_amount > 0 && `IGST ${money(totals.igst_amount)}`,
    totals.cess_amount > 0 && `Cess ${money(totals.cess_amount)}`,
  ].filter(Boolean);
  return `Tax payable by the recipient under reverse charge (Sec 9(3)/9(4) CGST Act, Rule 46(p)): ${heads.join(', ')} — total ${money(totals.rcm_tax)}. Not included in the amount payable.`;
}

/** Legacy single "Tax" line. */
export function isSingleTax(invoice: InvoiceRecord, totals: CalcTotals): boolean {
  return invoice.gst_mode === 'SINGLE' && totals.tax_amount > 0;
}
