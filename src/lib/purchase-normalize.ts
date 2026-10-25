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
import { checkGstin } from './gstin';

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
  /**
   * total - taxable - tax: rounding, or any inconsistency in an imported row. Signed.
   * Cess (below) is NOT taken out, so readers that ignore cess still balance (cess then sits in round-off).
   */
  roundOff: number;
  /** Additive (WP-6): compensation cess on the bill (`cess_amount` / `cess`), >= 0; outside `tax`. */
  cess: number;
  itcEligible: boolean;
  reverseCharge: boolean;
  itcReversed: number;
  /** Upper-cased reversal reason (RULE_42 / RULE_43 / RULE_37 / SEC_17_5 / OTHER) or ''. */
  itcReversalReason: string;
  /** 'GOODS' / 'SERVICES' for imports, '' for domestic bills. */
  importType: '' | 'GOODS' | 'SERVICES';
  paid: number;
  /** Lower-cased raw status ('' when the row has none). */
  status: string;
  notes: string;
  /** TDS section code we deducted under ('' = none). */
  tdsSection: string;
  /** TDS amount on the bill (whether deducted at booking or on payment), >= 0. */
  tdsAmount: number;
  /** TDS deducted when the bill was booked (`tds_on` 'BILL', the default): it is never owed to the supplier. */
  tdsOnBill: number;
}

/** TDS deducted at booking: `tds_on` 'BILL' or unset, with a positive `tds_amount`, capped at the total. */
function tdsOnBillOf(r: Rec, total: number): number {
  const amt = Math.max(pickNum(r, ['tds_amount']) ?? 0, 0);
  if (!(amt > 0) || str(r.tds_on).toUpperCase() === 'PAYMENT') return 0;
  return round2(Math.min(amt, total));
}

const DATE_KEYS = ['date', 'bill_date', 'purchase_date', 'invoice_date', 'issue_date'] as const;
const NAME_KEYS = ['vendor_name', 'supplier_name', 'party_name', 'party'] as const;
const GSTIN_KEYS = ['vendor_gstin', 'supplier_gstin', 'gstin'] as const;
const TAXABLE_KEYS = ['taxable', 'taxable_value', 'taxable_amount'] as const;
const TAX_KEYS = ['tax_amount', 'gst_amount', 'total_tax', 'gst', 'tax'] as const;
const TOTAL_KEYS = ['total', 'grand_total', 'total_amount', 'amount'] as const;
const NUMBER_KEYS = ['bill_number', 'purchase_number', 'vendor_invoice_number', 'supplier_invoice_number', 'invoice_number', 'number', 'reference'] as const;
const SPLIT_KEYS = ['cgst', 'cgst_amount', 'sgst', 'sgst_amount', 'igst', 'igst_amount'] as const;

function readImportType(v: string): '' | 'GOODS' | 'SERVICES' {
  const t = v.toUpperCase();
  return t === 'GOODS' || t === 'SERVICES' ? t : '';
}

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
    cess: round2(Math.abs(pickNum(r, ['cess_amount', 'cess']) ?? 0)),
    itcEligible,
    reverseCharge: r.reverse_charge === true || r.rcm === true,
    itcReversed: round2(Math.max(pickNum(r, ['itc_reversed', 'itc_reversal']) ?? 0, 0)),
    itcReversalReason: pickStr(r, ['itc_reversal_reason']).toUpperCase(),
    importType: readImportType(pickStr(r, ['import_type'])),
    paid: round2(Math.abs(pickNum(r, ['amount_paid', 'paid_amount']) ?? 0)),
    status: pickStr(r, ['status']).toLowerCase(),
    notes: pickStr(r, ['notes', 'narration']),
    tdsSection: pickStr(r, ['tds_section']),
    tdsAmount: round2(Math.max(pickNum(r, ['tds_amount']) ?? 0, 0)),
    tdsOnBill: tdsOnBillOf(r, total),
  };
}

/**
 * Expense categories that are NOT a supply at all, so they never belong in GSTR-3B Table 5
 * (inward exempt / nil / non-GST supplies):
 *  - salaries, wages, payroll, bonus, gratuity, director's remuneration — services by an employee
 *    to the employer (Schedule III, entry 1);
 *  - PF / ESI / professional-tax / income-tax / TDS / GST payments — taxes and statutory dues;
 *  - depreciation — a book entry, not a purchase.
 * Bank interest on loans stays IN Table 5: it is an exempt supply (12/2017-CT(R) entry 27), not a
 * non-supply. Matched on the lower-cased category name. Verify unusual heads with your CA.
 */
export const NON_SUPPLY_CATEGORY_PATTERNS: readonly RegExp[] = [
  /salar/, /wage/, /payroll/, /\bbonus\b/, /gratuity/, /remuneration/,
  /provident fund/, /\bp\.?f\.?\b/, /\besic?\b/, /professional tax/, /income[- ]tax/, /\btds\b/, /gst (paid|payment)/,
  /depreciation/,
];

export function isNonSupplyCategory(category: string | undefined | null): boolean {
  const c = String(category ?? '').trim().toLowerCase();
  return !!c && NON_SUPPLY_CATEGORY_PATTERNS.some((re) => re.test(c));
}

/**
 * GST on the bill that WE pay to the government ourselves — reverse charge (Sec 9(3)/(4)), import
 * of services (RCM) and IGST on imported goods (paid at customs with the Bill of Entry) — when the
 * stored total actually includes it (an imported row may carry only the taxable value). That tax is
 * never owed to the supplier.
 */
export function selfAssessedTaxOf(c: Pick<PurchaseCore, 'reverseCharge' | 'importType' | 'tax' | 'taxable' | 'total'>): number {
  if (!(c.reverseCharge || c.importType !== '') || !(c.tax > 0)) return 0;
  const totalIncludesTax = Math.abs(c.total - (c.taxable + c.tax)) <= Math.abs(c.total - c.taxable);
  return totalIncludesTax ? round2(c.tax) : 0;
}

/**
 * What the supplier is owed on a bill: its total less any self-assessed GST inside it, less TDS we
 * deducted when booking the bill (that part is owed to the government — TDS payable).
 */
export function supplierPayableOf(c: Pick<PurchaseCore, 'reverseCharge' | 'importType' | 'tax' | 'taxable' | 'total'> & Partial<Pick<PurchaseCore, 'tdsOnBill'>>): number {
  return round2(c.total - selfAssessedTaxOf(c) - Math.max(c.tdsOnBill ?? 0, 0));
}

/**
 * `supplierPayable(bill)` — the one definition of the supplier's side of a purchases row, for every
 * reader that needs "what we owe the vendor" (balance, status, payment checks, MSME tracker, payables
 * aging, cash forecast, cheques, bank matching, Books payables, Tally / ledger creditor). Stored bills
 * are never rewritten: an RCM / import bill keeps `total` = taxable + tax, and this takes the tax out.
 */
export function supplierPayable(raw: unknown): number {
  const c = readPurchase(raw);
  if (c) return supplierPayableOf(c);
  return round2(Math.abs(num(asRec(raw).total)));
}

/**
 * GST heads for a row that carries only a lump tax figure (or just a rate) and no
 * cgst/sgst/igst split — older or imported data. The lump is split by supplier state vs
 * the buyer's (filer's) state: different → IGST, same or unknown → CGST + SGST.
 * Rows with an explicit split are returned unchanged. Shared by GST reports and the
 * accounting / Tally exports so every module splits a legacy row the same way.
 */
export function splitLumpTax(
  c: PurchaseCore,
  raw: unknown,
  filerStateCode: string,
  supplierStateCode: string = checkGstin(c.partyGstin).stateCode ?? c.vendorStateCode,
): { taxable: number; igst: number; cgst: number; sgst: number; tax: number } {
  if (c.hasSplit) return { taxable: c.taxable, igst: c.igst, cgst: c.cgst, sgst: c.sgst, tax: c.tax };
  const o = asRec(raw);
  let tax = c.taxField;
  if (tax === undefined) {
    const rate = pickNum(o, ['tax_rate', 'gst_rate']);
    if (rate !== undefined) tax = round2((c.taxable * rate) / 100);
  }
  tax = round2(tax ?? 0);
  let igst = 0;
  let cgst = 0;
  let sgst = 0;
  const inter = supplierStateCode && filerStateCode ? supplierStateCode !== filerStateCode : false;
  if (inter) igst = tax;
  else {
    sgst = round2(tax / 2);
    cgst = round2(tax - sgst);
  }
  let taxable = c.taxable;
  // A lump tax that readPurchase could not see (rate only) was not taken out of the total.
  if (c.taxField === undefined && pickNum(o, ['taxable', 'taxable_value', 'taxable_amount', 'subtotal']) === undefined) {
    taxable = round2(Math.max(c.total - tax, 0));
  }
  return { taxable: round2(taxable), igst, cgst, sgst, tax };
}

/** One stock-relevant line of a bill. */
export interface PurchaseLineCore {
  name: string;
  hsn: string;
  quantity: number;
  /** Unit cost after the line discount, before tax. */
  unitCost: number;
  /* Stock tracking (6.6 / 6.10 / 6.11); '' / [] when the line carries none. */
  batchNo: string;
  /** yyyy-mm-dd or ''. */
  mfgDate: string;
  expiryDate: string;
  mrp: number;
  serials: string[];
  godownId: string;
  /** Additive (WP-3): the receipt-note (GRN) line this bill line bills, or ''. */
  grnLineId: string;
  /** Additive (WP-6): GST rate % of the line (`tax_rate` / `gst_rate`), 0 when absent; unit (`unit`) or ''. */
  taxRate: number;
  unit: string;
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
      batchNo: pickStr(line, ['batch_no', 'batch']),
      mfgDate: isoDay(pickStr(line, ['mfg_date'])),
      expiryDate: isoDay(pickStr(line, ['expiry_date', 'expiry'])),
      mrp: Math.max(num(line.mrp), 0),
      serials: Array.isArray(line.serials) ? line.serials.map((x) => str(x)).filter(Boolean) : [],
      godownId: pickStr(line, ['godown_id']),
      grnLineId: pickStr(line, ['grn_line_id']),
      taxRate: Math.max(pickNum(line, ['tax_rate', 'gst_rate']) ?? 0, 0),
      unit: pickStr(line, ['unit', 'uqc']),
    });
  }
  return out;
}

/** Type guard used by tests: a row that is exactly the shape the purchases module writes. */
export function isPurchaseRecord(v: unknown): v is PurchaseRecord {
  const r = asRec(v);
  return typeof r.id === 'string' && typeof r.date === 'string' && Array.isArray(r.lines) && typeof r.total === 'number';
}
