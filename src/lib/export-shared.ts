/**
 * Shared, pure helpers for the export modules (Tally XML + accounting CSV).
 * No React, no storage, no browser APIs — safe to unit-test under node:test.
 *
 * Money that must balance is handled in integer paise (see `toPaise`) so
 * vouchers never drift by a floating-point fraction.
 */

import type { Client, InvoiceRecord, Payment } from '../types/invoice';
import type { AdvanceRecord } from '../types/advances';
import type { TallyBooksSource } from './tally-books';
import type { PurchaseReturn } from '../types/purchases';
import { chargesAreTaxed, num, round2 } from './invoice-calc';
import { inrRecord } from './fx';
import { rcmTaxOf, supplierView } from './rcm';
import { resolveStateCode, stateByCode } from './india-states';
import { isoDay } from './dates';
import { isVoidStatus, readPurchase, selfAssessedTaxOf, splitLumpTax, supplierPayableOf } from './purchase-normalize';

/* ── Dates ────────────────────────────────────────────────────── */

export interface DateRange {
  /** Inclusive, 'YYYY-MM-DD'. Empty/undefined = open-ended. */
  from?: string;
  to?: string;
}

/** Normalise any date-ish value to 'YYYY-MM-DD' ('' when unparseable). */
export function isoDate(value: unknown): string {
  // Bare days keep their written day; real instants (…Z) become the LOCAL day.
  return isoDay(value);
}

export type DateFormat = 'iso' | 'dmy';

/** 'YYYY-MM-DD' -> 'YYYY-MM-DD' or 'DD-MM-YYYY'. */
export function fmtDate(iso: string, format: DateFormat = 'iso'): string {
  if (!iso) return '';
  if (format === 'iso') return iso;
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

export function inRange(date: string, range: DateRange): boolean {
  const d = isoDate(date);
  if (!d) return !range.from && !range.to;
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

/** Indian financial-year range: startYear 2025 -> 2025-04-01 .. 2026-03-31. */
export function fyRange(startYear: number): DateRange {
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

export function fyLabel(startYear: number): string {
  return `FY${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;
}

/** Start year of the Indian FY containing the given 'YYYY-MM-DD'. */
export function fyStartYearOf(iso: string): number {
  const [y, m] = iso.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

/* ── Money ────────────────────────────────────────────────────── */

export function toPaise(n: number): number {
  return Math.round(round2(num(n)) * 100);
}

/** Fixed 2dp, never "-0.00". */
export function fixed2(n: number): string {
  const r = round2(num(n));
  return (r === 0 ? 0 : r).toFixed(2);
}

/* ── Text ─────────────────────────────────────────────────────── */

export function clean(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/\s+/g, ' ').trim();
}

export function slug(value: string): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
}

/* ── Source data ──────────────────────────────────────────────── */

export interface ExportSource {
  invoices: InvoiceRecord[];
  payments: Payment[];
  clients: Client[];
  /** items_catalog rows (InvoiceItem-shaped, read defensively). */
  items: Array<Record<string, unknown>>;
  /** Raw `purchases` rows — shape owned by another module, read defensively. */
  purchases: unknown[];
  /** Raw `vendors` rows — shape owned by another module, read defensively. */
  vendors: unknown[];
  /** Advance receipts (5.3). Optional: absent = none. */
  advances?: AdvanceRecord[];
  /** Additive (WP-3): purchase returns / supplier credit notes (`purchase_returns`). Optional. */
  purchaseReturns?: PurchaseReturn[];
  /**
   * Additive (WP-7, P0-12 / P1-22): the rest of the books for the Tally export — supplier payments,
   * manual vouchers, fixed assets, stock transfers, user groups, openings, cost centres. Optional.
   */
  books?: TallyBooksSource;
}

export function emptySource(): ExportSource {
  return { invoices: [], payments: [], clients: [], items: [], purchases: [], vendors: [] };
}

/* ── Invoices ─────────────────────────────────────────────────── */

export type VoucherKind = 'SALES' | 'CREDIT_NOTE';

/** Which accounting voucher an invoice becomes, or null if it is not a ledger document. */
export function voucherKindOf(inv: InvoiceRecord, includeDrafts = false): VoucherKind | null {
  const t = inv.doc_type ?? 'INVOICE';
  if (t === 'QUOTATION' || t === 'PROFORMA' || t === 'DELIVERY_CHALLAN' || t === 'SALES_ORDER') return null;
  if (inv.status === 'Cancelled') return null;
  if (inv.status === 'Draft' && !includeDrafts) return null;
  return t === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'SALES';
}

export function partyNameOf(client: Partial<Client> | undefined | null): string {
  return clean(client?.company) || clean(client?.name) || 'Cash Customer';
}

export interface InvoiceAmounts {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Tax with no CGST/SGST/IGST split (legacy "SINGLE" mode). */
  otherTax: number;
  tax: number;
  /** shipping + other charges, taxed or not. */
  charges: number;
  /**
   * The charges were taxed (`charges_taxable`): they are INSIDE `taxable` and their GST is inside
   * cgst/sgst/igst. A ledger posts them to the freight ledger and `taxable - charges` to Sales.
   */
  chargesTaxed: boolean;
  /** GST cess (kept out of `tax`, which is CGST+SGST+IGST). */
  cess: number;
  /** TCS collected on the invoice: a liability to the government, not income. */
  tcs: number;
  /** What the customer owes (an outward reverse-charge document's tax is NOT in it). */
  total: number;
  /** total - (taxable + tax + untaxed charges + cess + tcs): rounding plus any legacy inconsistency. Signed. */
  roundOff: number;
  /**
   * Outward reverse charge: GST + cess shown on the document as payable by the RECIPIENT. The heads
   * above (cgst / sgst / igst / tax / cess) are then 0 — the supplier neither collects nor owes it.
   */
  rcmTax: number;
}

/**
 * Read an invoice's money tolerantly (legacy rows may lack computed fields). Always in rupees:
 * a foreign-currency document is converted at its exchange rate (`src/lib/fx.ts`); one without
 * a rate stays at face value.
 */
export function invoiceAmounts(source: InvoiceRecord): InvoiceAmounts {
  const converted = inrRecord(source);
  const rcmTax = rcmTaxOf(converted);
  // Outward reverse charge: no output tax, and only the taxable value is receivable (src/lib/rcm.ts).
  const inv = supplierView(converted);
  let taxable = round2(num(inv.taxable_value));
  if (!taxable && num(inv.subtotal) > 0) taxable = round2(num(inv.subtotal) - num(inv.discount_amount));
  const cgst = round2(num(inv.cgst_amount));
  const sgst = round2(num(inv.sgst_amount));
  const igst = round2(num(inv.igst_amount));
  const tax = round2(Math.max(num(inv.tax_amount), cgst + sgst + igst));
  const otherTax = round2(Math.max(0, tax - cgst - sgst - igst));
  const chargesTaxed = chargesAreTaxed(source);
  const charges = chargesTaxed
    ? round2(Math.max(num(inv.shipping), 0) + num(inv.other_charges))
    : round2(num(inv.shipping) + num(inv.other_charges));
  const cess = round2(num(inv.cess_amount));
  const tcs = round2(num(inv.tcs_amount));
  const parts = round2(taxable + tax + (chargesTaxed ? 0 : charges) + cess + tcs);
  const total = round2(num(inv.total) !== 0 ? num(inv.total) : parts + num(inv.round_off));
  return { taxable, cgst, sgst, igst, otherTax, tax, charges, chargesTaxed, cess, tcs, total, roundOff: round2(total - parts), rcmTax };
}

export function invoiceStateCode(inv: InvoiceRecord): string {
  return resolveStateCode({
    code: inv.place_of_supply || inv.client?.state_code,
    gstin: inv.client?.gstin,
    name: inv.client?.state,
  });
}

export function stateNameOf(code: string): string {
  return stateByCode(code)?.name ?? '';
}

export function filterInvoices(
  invoices: InvoiceRecord[],
  range: DateRange,
  includeDrafts = false,
): InvoiceRecord[] {
  return invoices
    .filter((i) => voucherKindOf(i, includeDrafts) !== null && inRange(i.issue_date, range))
    .sort(
      (a, b) =>
        isoDate(a.issue_date).localeCompare(isoDate(b.issue_date)) ||
        clean(a.invoice_number).localeCompare(clean(b.invoice_number)),
    );
}

/** Payments (receipts) dated in range whose invoice is a known ledger document. */
export function filterPayments(
  payments: Payment[],
  invoices: InvoiceRecord[],
  range: DateRange,
): Payment[] {
  const known = new Set(invoices.map((i) => i.id));
  return payments
    .filter((p) => known.has(p.invoice_id) && num(p.amount) > 0 && inRange(p.date, range))
    .sort(
      (a, b) =>
        isoDate(a.date).localeCompare(isoDate(b.date)) || String(a.id).localeCompare(String(b.id)),
    );
}

/* ── Purchases (defensive: shape belongs to another module) ───── */

export interface NormalPurchase {
  id: string;
  number: string;
  date: string;
  partyName: string;
  partyGstin: string;
  stateCode: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
  roundOff: number;
  status: string;
  notes: string;
  /** Additive: false when the GST on this bill is NOT claimed as input credit. */
  itcEligible: boolean;
  /**
   * Additive: GST inside `total` that WE pay to the government (reverse charge / import of services
   * → 'RCM'; IGST on imported goods paid at customs → 'CUSTOMS'). Never owed to the supplier.
   */
  selfTax: number;
  selfTaxKind: '' | 'RCM' | 'CUSTOMS';
  /** Additive: what the supplier is owed — total − selfTax − TDS deducted on booking (`supplierPayable`). */
  payable: number;
  /** Additive (Tally parity): TDS deducted on booking the bill, and its section code ('' = none). */
  tds: number;
  tdsSection: string;
}

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});

export function normalizePurchase(raw: unknown, vendors: unknown[] = []): NormalPurchase | null {
  const r = asRec(raw);
  if (!Object.keys(r).length) return null;
  // One shared reader for the purchases table (see purchase-normalize.ts).
  const c = readPurchase(r, vendors);
  const date = c?.date || isoDate(r.created_at);
  if (!c || !date || !c.partyName || !c.total) return null;
  // A legacy row with only a lump tax: split it like GST reports do (the bill's place of supply
  // stands for the buyer's state), so Tally / registers never post it all as IGST.
  const heads = splitLumpTax(c, r, c.placeOfSupply);
  return {
    id: c.id,
    number: c.number,
    date,
    partyName: c.partyName,
    partyGstin: c.partyGstin,
    stateCode: resolveStateCode({
      code: c.placeOfSupply || c.vendorStateCode,
      gstin: c.partyGstin,
      name: '',
    }),
    taxable: heads.taxable,
    cgst: heads.cgst,
    sgst: heads.sgst,
    igst: heads.igst,
    tax: heads.tax,
    total: c.total,
    roundOff: round2(c.total - heads.taxable - heads.tax),
    status: clean(r.status),
    notes: c.notes,
    itcEligible: c.itcEligible,
    selfTax: selfAssessedTaxOf(c),
    selfTaxKind: selfAssessedTaxOf(c) > 0 ? (c.importType === 'GOODS' ? 'CUSTOMS' : 'RCM') : '',
    payable: supplierPayableOf(c),
    tds: c.tdsOnBill,
    tdsSection: c.tdsSection,
  };
}

export function filterPurchases(
  purchases: unknown[],
  vendors: unknown[],
  range: DateRange,
): NormalPurchase[] {
  return purchases
    .map((p) => normalizePurchase(p, vendors))
    .filter(
      (p): p is NormalPurchase =>
        p !== null && !isVoidStatus(p.status) && inRange(p.date, range),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}
