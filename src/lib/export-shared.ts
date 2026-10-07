/**
 * Shared, pure helpers for the export modules (Tally XML + accounting CSV).
 * No React, no storage, no browser APIs — safe to unit-test under node:test.
 *
 * Money that must balance is handled in integer paise (see `toPaise`) so
 * vouchers never drift by a floating-point fraction.
 */

import type { Client, InvoiceRecord, Payment } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { resolveStateCode, stateByCode } from './india-states';

/* ── Dates ────────────────────────────────────────────────────── */

export interface DateRange {
  /** Inclusive, 'YYYY-MM-DD'. Empty/undefined = open-ended. */
  from?: string;
  to?: string;
}

/** Normalise any date-ish value to 'YYYY-MM-DD' ('' when unparseable). */
export function isoDate(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const s = String(value ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (!s) return '';
  return isoDate(new Date(s));
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
}

export function emptySource(): ExportSource {
  return { invoices: [], payments: [], clients: [], items: [], purchases: [], vendors: [] };
}

/* ── Invoices ─────────────────────────────────────────────────── */

export type VoucherKind = 'SALES' | 'CREDIT_NOTE';

/** Which accounting voucher an invoice becomes, or null if it is not a ledger document. */
export function voucherKindOf(inv: InvoiceRecord, includeDrafts = false): VoucherKind | null {
  const t = inv.doc_type ?? 'INVOICE';
  if (t === 'QUOTATION' || t === 'PROFORMA' || t === 'DELIVERY_CHALLAN') return null;
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
  /** shipping + other charges (untaxed). */
  charges: number;
  total: number;
  /** total - (taxable + tax + charges): rounding plus any legacy inconsistency. Signed. */
  roundOff: number;
}

/** Read an invoice's money tolerantly (legacy rows may lack computed fields). */
export function invoiceAmounts(inv: InvoiceRecord): InvoiceAmounts {
  let taxable = round2(num(inv.taxable_value));
  if (!taxable && num(inv.subtotal) > 0) taxable = round2(num(inv.subtotal) - num(inv.discount_amount));
  const cgst = round2(num(inv.cgst_amount));
  const sgst = round2(num(inv.sgst_amount));
  const igst = round2(num(inv.igst_amount));
  const tax = round2(Math.max(num(inv.tax_amount), cgst + sgst + igst));
  const otherTax = round2(Math.max(0, tax - cgst - sgst - igst));
  const charges = round2(num(inv.shipping) + num(inv.other_charges));
  const parts = taxable + tax + charges;
  const total = round2(num(inv.total) !== 0 ? num(inv.total) : parts + num(inv.round_off));
  return { taxable, cgst, sgst, igst, otherTax, tax, charges, total, roundOff: round2(total - parts) };
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
}

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const pick = (r: Rec, keys: string[]): unknown => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
  return undefined;
};

export function normalizePurchase(raw: unknown, vendors: unknown[] = []): NormalPurchase | null {
  const r = asRec(raw);
  if (!Object.keys(r).length) return null;
  const vid = pick(r, ['vendor_id', 'supplier_id', 'party_id']);
  const vendorRow = asRec(
    vendors.find((v) => vid !== undefined && asRec(v).id === vid) ?? pick(r, ['vendor', 'supplier']),
  );
  const partyName =
    clean(pick(r, ['vendor_name', 'supplier_name', 'party_name'])) ||
    clean(vendorRow.company) ||
    clean(vendorRow.name);
  const partyGstin = clean(pick(r, ['vendor_gstin', 'supplier_gstin', 'gstin']) ?? vendorRow.gstin).toUpperCase();
  const cgst = round2(num(pick(r, ['cgst_amount', 'cgst'])));
  const sgst = round2(num(pick(r, ['sgst_amount', 'sgst'])));
  const igst = round2(num(pick(r, ['igst_amount', 'igst'])));
  const tax = round2(Math.max(num(pick(r, ['tax_amount', 'total_tax', 'tax'])), cgst + sgst + igst));
  let taxable = round2(num(pick(r, ['taxable_value', 'taxable_amount', 'taxable'])));
  const totalRaw = num(pick(r, ['total', 'grand_total', 'amount', 'total_amount']));
  if (!taxable) taxable = round2(num(pick(r, ['subtotal'])) - num(pick(r, ['discount_amount'])));
  if (!taxable && totalRaw) taxable = round2(totalRaw - tax);
  const total = totalRaw ? round2(totalRaw) : round2(taxable + tax);
  const date = isoDate(pick(r, ['bill_date', 'purchase_date', 'date', 'issue_date', 'created_at']));
  if (!date || !partyName || !total) return null;
  return {
    id: String(pick(r, ['id']) ?? ''),
    number: clean(
      pick(r, ['bill_number', 'purchase_number', 'vendor_invoice_number', 'invoice_number', 'number', 'reference']),
    ),
    date,
    partyName,
    partyGstin,
    stateCode: resolveStateCode({
      code: String(pick(r, ['place_of_supply', 'state_code']) ?? vendorRow.state_code ?? ''),
      gstin: partyGstin,
      name: String(vendorRow.state ?? ''),
    }),
    taxable,
    cgst,
    sgst,
    igst,
    tax,
    total,
    roundOff: round2(total - taxable - tax),
    status: clean(pick(r, ['status'])),
    notes: clean(pick(r, ['notes', 'narration'])),
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
        p !== null && p.status.toLowerCase() !== 'cancelled' && inRange(p.date, range),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}
