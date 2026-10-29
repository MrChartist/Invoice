/**
 * Supplier bill capture from the e-invoice signed QR (8.40). Pure: turns decoded QR values into a
 * draft bill. The browser half (camera / image decoding, inbox insert) is `capture-browser.ts`.
 *
 * What the QR gives: supplier GSTIN, our GSTIN, invoice no. / type / date, invoice value incl. tax,
 * item count, main HSN and the IRN. What it does NOT give: the supplier's name, taxable value or GST
 * split. So the draft has one line "As per e-invoice …" carrying the whole value; when the bill has a
 * single item and the HSN master knows that HSN's rate on the bill date, the GST is backed out of the
 * value at that rate, otherwise the draft is flagged "check the GST split" (`review: ['gst']`) and the
 * value is kept as is. The posted bill is checked against the QR value (bill-guard.ts).
 *
 * Inter- vs intra-state: this app derives IGST from "place of supply ≠ our state", so a supplier from
 * another state gets the supplier's state code as place of supply (IGST), else ours (CGST + SGST).
 */

import type { PurchaseLine, PurchaseRecord, Vendor } from '../types/purchases';
import type { EinvoiceJsonData, EinvoiceQrData } from './einvoice-qr';
import type { DraftMeta } from './purchase-drafts';
import { computePurchaseTotals } from './purchases';
import { round2 } from './invoice-calc';
import { generateId } from './storage';

export interface CaptureContext {
  vendors: readonly Vendor[];
  /** GSTINs of our sender profiles (upper case). */
  ourGstins: readonly string[];
  /** Our state code (active profile), '' when unknown. */
  businessState: string;
  /** GST rate % for an HSN on a day, from the HSN master (undefined = unknown). */
  hsnRate?: (hsn: string, day: string) => number | undefined;
  today: string;
}

export interface CaptureResult {
  /** Draft bill fields (no id) — or null for a supplier credit note, which is not a bill. */
  bill: (Omit<PurchaseRecord, 'id'> & { draft: DraftMeta }) | null;
  vendor: Vendor | null;
  /** BuyerGstin is present and is none of our GSTINs. */
  buyerMismatch: boolean;
  creditNote: boolean;
}

export function findVendorByGstin(vendors: readonly Vendor[], gstin: string): Vendor | null {
  const g = gstin.trim().toUpperCase();
  return (g && vendors.find((v) => (v.gstin ?? '').trim().toUpperCase() === g)) || null;
}

export function isOurGstin(gstin: string, ours: readonly string[]): boolean {
  const g = gstin.trim().toUpperCase();
  return !g || ours.some((o) => o.trim().toUpperCase() === g);
}

const stateOf = (gstin: string) => (/^\d{2}/.test(gstin) ? gstin.slice(0, 2) : '');

export function draftFromQr(qr: EinvoiceQrData, ctx: CaptureContext, extra: { inboxId?: string; attachments?: PurchaseRecord['attachments'] } = {}): CaptureResult {
  const vendor = findVendorByGstin(ctx.vendors, qr.sellerGstin);
  const buyerMismatch = !!qr.buyerGstin && !isOurGstin(qr.buyerGstin, ctx.ourGstins);
  if (qr.docType === 'CRN') return { bill: null, vendor, buyerMismatch, creditNote: true };

  const date = qr.docDate || ctx.today;
  const sellerState = stateOf(qr.sellerGstin);
  const ourState = ctx.businessState || stateOf(qr.buyerGstin);
  const pos = sellerState && ourState && sellerState !== ourState ? sellerState : ourState;
  const rate = qr.itemCount === 1 && qr.mainHsn ? ctx.hsnRate?.(qr.mainHsn, date) : undefined;
  const known = rate !== undefined && rate >= 0 && rate <= 40;
  const taxRate = known ? rate : 0;
  const what = `${qr.docType === 'DBN' ? 'Supplier debit note' : 'As per e-invoice'} ${qr.docNo || ''}${qr.itemCount > 1 ? ` (${qr.itemCount} items)` : ''}`.trim();
  const line: PurchaseLine = {
    id: generateId(),
    name: what.slice(0, 120),
    hsn: qr.mainHsn || undefined,
    unit: 'NOS',
    quantity: 1,
    rate: known ? round2(qr.total / (1 + taxRate / 100)) : qr.total,
    tax_rate: taxRate,
  };
  const totals = computePurchaseTotals([line], { placeOfSupply: pos, businessState: ourState, gstApplies: taxRate > 0 });
  const review: string[] = [];
  if (!known) review.push('gst');
  if (!vendor) review.push('vendor');
  const draft: DraftMeta = {
    source: 'capture',
    created_at: new Date().toISOString(),
    ...(extra.inboxId ? { inbox_id: extra.inboxId } : {}),
    ...(qr.total > 0 ? { expected_total: qr.total } : {}),
    ...(review.length ? { review } : {}),
    ...(buyerMismatch ? { foreign_buyer: qr.buyerGstin } : {}),
  };
  const bill: Omit<PurchaseRecord, 'id'> & { draft: DraftMeta } = {
    kind: 'PURCHASE',
    vendor_id: vendor?.id,
    vendor_name: vendor?.name ?? '',
    vendor_gstin: qr.sellerGstin || undefined,
    bill_number: qr.docNo,
    date,
    place_of_supply: pos || undefined,
    category: 'Purchases',
    lines: [line],
    taxable: totals.taxable,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    itc_eligible: !!qr.sellerGstin && taxRate > 0 && !buyerMismatch,
    total: totals.total,
    amount_paid: 0,
    notes: `e-Invoice${qr.irn ? ` IRN ${qr.irn}` : ''}${qr.total ? `; value ₹${qr.total.toFixed(2)}` : ''}${qr.itemCount ? `; ${qr.itemCount} item(s)` : ''} (read from the signed QR; signature not verified)`,
    ...(qr.irn ? { einvoice_irn: qr.irn } : {}),
    ...(qr.irnDate ? { einvoice_irn_date: qr.irnDate } : {}),
    ...(extra.attachments?.length ? { attachments: extra.attachments } : {}),
    draft,
  };
  return { bill, vendor, buyerMismatch, creditNote: false };
}

/**
 * 8.46: draft from the supplier's FULL e-invoice JSON (pasted, or a .json file): one bill line per invoice line with
 * its HSN, quantity, taxable value and GST rate, cess on the bill, place of supply from the JSON. The QR-only draft's
 * "check the GST split" flag is dropped; it comes back only when the lines do not add up to the invoice value.
 */
export function draftFromEinvoiceJson(j: EinvoiceJsonData, ctx: CaptureContext, extra: { inboxId?: string; attachments?: PurchaseRecord['attachments'] } = {}): CaptureResult {
  const base = draftFromQr(j.qr, ctx, extra);
  if (!base.bill) return base;
  const ourState = ctx.businessState || stateOf(j.qr.buyerGstin);
  const pos = j.pos && j.pos !== '96' && j.pos !== '97' ? j.pos : base.bill.place_of_supply ?? '';
  const lines: PurchaseLine[] = j.lines.map((l) => {
    const rate = round2(l.taxable / l.qty);
    const exact = Math.abs(round2(rate * l.qty) - l.taxable) < 0.005;
    return { id: generateId(), name: l.name, ...(l.hsn ? { hsn: l.hsn } : {}), unit: l.unit, quantity: exact ? l.qty : 1, rate: exact ? rate : l.taxable, tax_rate: l.rate };
  });
  const t = computePurchaseTotals(lines, { placeOfSupply: pos, businessState: ourState, gstApplies: lines.some((l) => l.tax_rate > 0) });
  const total = round2(t.total + j.cess);
  const review = (base.bill.draft.review ?? []).filter((r) => r !== 'gst');
  if (j.qr.total > 0 && Math.abs(total - j.qr.total) > 1) review.push('gst');
  const { review: _r, ...meta } = base.bill.draft;
  return {
    ...base,
    bill: {
      ...base.bill,
      vendor_name: base.bill.vendor_name || j.sellerName,
      place_of_supply: pos || undefined,
      lines,
      taxable: t.taxable,
      cgst: t.cgst,
      sgst: t.sgst,
      igst: t.igst,
      ...(j.cess > 0 ? { cess_amount: j.cess } : {}),
      total,
      itc_eligible: !!j.qr.sellerGstin && t.tax > 0 && !base.buyerMismatch,
      notes: `${base.bill.notes?.replace('(read from the signed QR; signature not verified)', '(read from the e-invoice JSON; signature not verified)')}`,
      draft: { ...meta, ...(review.length ? { review } : {}) },
    },
  };
}
