/**
 * ONE reader for rows of the `purchases` table.
 *
 * Books, GST reports, the accounting exports and inventory all need the same
 * facts about a bill (date, party, taxable value, GST split, ITC flag, status).
 * They used to carry four slightly different tolerant readers, which is how a
 * "draft" bill could be exported but not booked, or a bill dated by `bill_date`
 * in one report and by `date` in another. They now all go through
 * `readPurchase`, which understands the real `PurchaseRecord`
 * (src/types/purchases.ts) first and tolerates legacy / imported aliases second.
 *
 * Pure: no storage, no browser APIs. Never mutates its input.
 */

import type { PurchaseRecord } from '../types/purchases';
import { num, round2 } from './invoice-calc';
import { isoDay } from './dates';

type Rec = Record<string, unknown>;

const asRec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

/** First non-empty string among `keys`. */
export function pickStr(r: Rec, keys: readonly string[]): string {
  for (const k of keys) {
    const v = str(r[k]);
    if (v) return v;
  }
  return '';
}

/** First finite number among `keys` (empty strings / null are skipped); undefined if none. */
export function pickNum(r: Rec, keys: readonly string[]): number | undefined {
  for (const k of keys) {
    const v = r[k];
    if (v === undefined || v === null || v === '') continue;
    const n = num(v, NaN);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

const VOID_STATUSES = new Set(['draft', 'cancelled', 'canceled', 'void']);

/** Draft / cancelled / void bills never count in any report or stock figure. */
export function isVoidStatus(status: unknown): boolean {
  return VOID_STATUSES.has(str(status).toLowerCase());
}

export interface PurchaseCore {
  id: string;
  kind: 'PURCHASE' | 'EXPENSE';
  isExpense: boolean;
  /** The supplier's own bill number. */
  number: string;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  partyName: string;
  /** Upper-cased, may be ''. */
  partyGstin: string;
  /** Place of supply written on the bill (2-digit code) or ''. */
  placeOfSupply: string;
  /** State code taken from the vendor master / `supplier_state_code`, or ''. */
  vendorStateCode: string;
  category: string;
  /** Non-negative figures. */
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** True when the row carries an explicit cgst/sgst/igst split (even if zero). */
  hasSplit: boolean;
  /** Explicit "tax" total when the row has one (tax_amount / gst_amount / total_tax ...), else undefined. */
  taxField: number | undefined;
  /** Total GST on the bill: the larger of the explicit total and the split sum. */
  tax: number;
  total: number;
  /** total - taxable - tax: rounding, or any inconsistency in an imported row. Signed. */
  roundOff: number;
  itcEligible: boolean;
  reverseCharge: boolean;
  itcReversed: number;
  paid: number;
  /** Lower-cased raw status ('' when the row has none). */
  status: string;
  notes: string;
}

const DATE_KEYS = ['date', 'bill_date', 'purchase_date', 'invoice_date', 'issue_date'] as const;
const NAME_KEYS = ['vendor_name', 'supplier_name', 'party_name', 'party'] as const;
const GSTIN_KEYS = ['vendor_gstin', 'supplier_gstin', 'gstin'] as const;
const TAXABLE_KEYS = ['taxable', 'taxable_value', 'taxable_amount'] as const;
const TAX_KEYS = ['tax_amount', 'gst_amount', 'total_tax', 'gst', 'tax'] as const;
const TOTAL_KEYS = ['total', 'grand_total', 'total_amount', 'amount'] as const;
const NUMBER_KEYS = ['bill_number', 'purchase_number', 'vendor_invoice_number', 'supplier_invoice_number', 'invoice_number', 'number', 'reference'] as const;
const SPLIT_KEYS = ['cgst', 'cgst_amount', 'sgst', 'sgst_amount', 'igst', 'igst_amount'] as const;

/**
 * Read one purchases row. Returns null for things that are not bills at all
 * (not an object, or no usable date). Void / draft rows ARE returned (check
 * `isVoidStatus(core.status)`) so a caller can count what it skipped.
 */
export function readPurchase(raw: unknown, vendors: readonly unknown[] = []): PurchaseCore | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Rec;

  const date = isoDay(pickStr(r, DATE_KEYS));
  if (!date) return null;

  const vendorId = pickStr(r, ['vendor_id', 'supplier_id', 'party_id']);
  const vendorRow = asRec(
    (vendorId && vendors.find((v) => str(asRec(v).id) === vendorId)) || r.vendor || r.supplier,
  );

  const cgst = Math.abs(pickNum(r, ['cgst', 'cgst_amount']) ?? 0);
  const sgst = Math.abs(pickNum(r, ['sgst', 'sgst_amount']) ?? 0);
  const igst = Math.abs(pickNum(r, ['igst', 'igst_amount']) ?? 0);
  const splitSum = cgst + sgst + igst;
  const hasSplit = SPLIT_KEYS.some((k) => r[k] !== undefined && r[k] !== null);
  const taxFieldRaw = pickNum(r, TAX_KEYS);
  const taxField = taxFieldRaw === undefined ? undefined : Math.abs(taxFieldRaw);
  const tax = round2(Math.max(taxField ?? 0, splitSum));

  const totalRaw = pickNum(r, TOTAL_KEYS);
  let taxable = pickNum(r, TAXABLE_KEYS);
  if (taxable === undefined) {
    const sub = pickNum(r, ['subtotal']);
    if (sub !== undefined) taxable = sub - Math.abs(pickNum(r, ['discount_amount']) ?? 0);
  }
  if (taxable === undefined) taxable = totalRaw !== undefined ? Math.max(Math.abs(totalRaw) - tax, 0) : 0;
  taxable = Math.abs(taxable);
  const total = round2(totalRaw !== undefined ? Math.abs(totalRaw) : taxable + tax);

  const kind = pickStr(r, ['kind', 'type', 'doc_type', 'record_type']).toUpperCase();
  const isExpense = kind.includes('EXPENSE');

  const itcFlag = r.itc_eligible ?? r.itcEligible;
  const itcStatus = pickStr(r, ['itc_status']).toLowerCase();
  const itcEligible = !(itcFlag === false || itcStatus === 'ineligible' || itcStatus === 'blocked');

  return {
    id: pickStr(r, ['id']),
    kind: isExpense ? 'EXPENSE' : 'PURCHASE',
    isExpense,
    number: pickStr(r, NUMBER_KEYS),
    date,
    partyName: pickStr(r, NAME_KEYS) || pickStr(vendorRow, ['company', 'name']),
    partyGstin: (pickStr(r, GSTIN_KEYS) || pickStr(vendorRow, ['gstin'])).toUpperCase(),
    placeOfSupply: pickStr(r, ['place_of_supply']),
    vendorStateCode: pickStr(r, ['supplier_state_code', 'state_code']) || pickStr(vendorRow, ['state_code']),
    category: pickStr(r, ['category', 'expense_category', 'head']),
    taxable: round2(taxable),
    cgst: round2(cgst),
    sgst: round2(sgst),
    igst: round2(igst),
    hasSplit,
    taxField: taxField === undefined ? undefined : round2(taxField),
    tax,
    total,
    roundOff: round2(total - round2(taxable) - tax),
    itcEligible,
    reverseCharge: r.reverse_charge === true || r.rcm === true,
    itcReversed: round2(Math.max(pickNum(r, ['itc_reversed', 'itc_reversal']) ?? 0, 0)),
    paid: round2(Math.abs(pickNum(r, ['amount_paid', 'paid_amount']) ?? 0)),
    status: pickStr(r, ['status']).toLowerCase(),
    notes: pickStr(r, ['notes', 'narration']),
  };
}

/** One stock-relevant line of a bill. */
export interface PurchaseLineCore {
  name: string;
  hsn: string;
  quantity: number;
  /** Unit cost after the line discount, before tax. */
  unitCost: number;
}

/** The lines of a bill (`lines`, else legacy `items`), with unit cost resolved. */
export function readPurchaseLines(raw: unknown): PurchaseLineCore[] {
  const r = asRec(raw);
  const lines = Array.isArray(r.lines) ? r.lines : Array.isArray(r.items) ? r.items : [];
  const out: PurchaseLineCore[] = [];
  for (const l of lines) {
    const line = asRec(l);
    const quantity = num(line.quantity ?? line.qty);
    let rate = num(line.rate ?? line.unit_price);
    if (!rate && num(line.amount)) rate = num(line.amount) / (quantity || 1);
    rate *= 1 - Math.min(Math.max(num(line.discount_percent), 0), 100) / 100;
    out.push({
      name: pickStr(line, ['name', 'description']),
      hsn: pickStr(line, ['hsn']),
      quantity,
      unitCost: rate,
    });
  }
  return out;
}

/** Type guard used by tests: a row that is exactly the shape the purchases module writes. */
export function isPurchaseRecord(v: unknown): v is PurchaseRecord {
  const r = asRec(v);
  return typeof r.id === 'string' && typeof r.date === 'string' && Array.isArray(r.lines) && typeof r.total === 'number';
}
