import type { CalcTotals } from '../../lib/invoice-calc';
import type { InvoiceItem, InvoiceRecord, SenderProfile } from '../../types/invoice';
import { upiLink } from '../../lib/share';
import { shiftDay } from '../../lib/dates';
import { weightText, wtHolds } from '../../lib/trade/tr-weight';
import { jewelText } from '../../lib/retail/rt-jewel-text';

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
export function trackingText(item: (Pick<InvoiceItem, 'batch_no' | 'batch_mfg' | 'batch_expiry' | 'serials' | 'warranty_months' | 'wt'> & Partial<Pick<InvoiceItem, 'disc_chain' | 'disc_per_unit' | 'quantity' | 'unit' | 'jw'>> & { bin?: string }) | undefined): string {
  if (!item) return '';
  if (item.jw) return jewelText(item.jw); // R9 (RT-E2): the BIS sub-line (the tag no. is its serial)
  const parts: string[] = [];
  if (discountText(item)) parts.push(discountText(item)); // TR-A1
  if (item.bin) parts.push(`Bin ${item.bin}`); // 8.86: snapshot on delivery challan lines
  if (item.batch_no) parts.push(`Batch ${item.batch_no}`);
  if (item.batch_no && item.batch_mfg) parts.push(`Mfg ${monthYear(item.batch_mfg)}`);
  if (item.batch_no && item.batch_expiry) parts.push(`Exp ${monthYear(item.batch_expiry)}`);
  if (item.serials?.length) parts.push(`S/N: ${item.serials.join(', ')}`);
  if (item.serials?.length && item.warranty_months) parts.push(`Warranty ${item.warranty_months} month${item.warranty_months === 1 ? '' : 's'}`);
  if (item.wt && (item.quantity === undefined || wtHolds(item))) parts.push(weightText(item.wt)); // R8-B (TR-B1); QA8 T12 / T16: only while it still gives the quantity
  return parts.filter(Boolean).join(' · ');
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

/** TR-A1: the trade-discount snapshot of a line, e.g. "Disc 18 + 4 % + ₹5/unit" ('' without one). */
export function discountText(item: Partial<Pick<InvoiceItem, 'disc_chain' | 'disc_per_unit'>>): string {
  const chain = (item.disc_chain ?? []).filter((d) => d > 0);
  const t = [chain.length ? `${chain.join(' + ')} %` : '', (item.disc_per_unit ?? 0) > 0 ? `₹${item.disc_per_unit}/unit` : ''].filter(Boolean).join(' + ');
  return t ? `Disc ${t}` : '';
}

/** TR-A1: "2% cash discount if paid by 03-11-2026: ₹1,234.00" under the totals ('' without a term). */
export function cashDiscountText(invoice: Pick<InvoiceRecord, 'cash_discount' | 'issue_date' | 'doc_type'>, total: number, money: (amount: number) => string): string {
  const cd = invoice.cash_discount;
  if (!cd || !(cd.percent > 0) || invoice.doc_type === 'CREDIT_NOTE' || !(total > 0)) return '';
  const [y, m, d] = shiftDay(invoice.issue_date, cd.days).split('-');
  return `${cd.percent}% cash discount if paid by ${d}-${m}-${y}: ${money(Math.round(total * cd.percent) / 100)}`;
}

/** R8-B (TR-B1): "120 BAG · gross 6,072 kg − tare 72 kg − dhalta 60 kg = 5,940 kg" under a weighed line. */
export { weightText };

/** R9 (RT-B2): "Registered pharmacist: name (reg. no.)" from the sender snapshot ('' when none, so other bills print as before). */
export const pharmacistText = (sender: Pick<SenderProfile, 'pharmacist'>): string => (sender.pharmacist ? `Registered pharmacist: ${sender.pharmacist}` : '');
/** R9 (RT-E2): the BIS verification line snapshotted on the bill's jewellery lines (printed under the totals; '' otherwise). */
export const bisText = (invoice: Pick<InvoiceRecord, 'items'>): string => invoice.items?.find((i) => i.jw?.bis)?.jw?.bis ?? '';
