/**
 * Books — Day book, Cash/Bank book, Profit & Loss, indicative Balance Sheet.
 *
 * Everything here is pure (no React, no DOM). The only storage touch is
 * `loadBooksData()` / `getProfitSnapshot()` / opening-balance helpers, which go
 * through getTable/setTable (fail-soft, safe in Node where localStorage is
 * absent).
 *
 * Conventions
 *  - Dates are ISO `YYYY-MM-DD` strings; periods are inclusive on both ends.
 *    String comparison is used throughout so timezones can never shift a day.
 *  - Money is rounded with round2 at every aggregation step.
 *  - GST charged on sales is a LIABILITY, never income. GST paid on purchases
 *    is an ITC asset when eligible, otherwise it is part of the cost.
 *  - Voucher debit/credit is from the PARTY ledger's point of view (Tally):
 *      Sales      Dr party        Credit note  Cr party
 *      Receipt    Cr party        Purchase     Cr party
 *      Expense    Cr party        Payment      Dr party
 */

import { round2, num } from './invoice-calc';
import { getTable, setTable, generateId } from './storage';
import type { InvoiceRecord, Payment } from '../types/invoice';

/* ════════════════════════════════════════════════════════════════
   Types
   ════════════════════════════════════════════════════════════════ */

export type VoucherType = 'Sales' | 'Credit Note' | 'Receipt' | 'Purchase' | 'Expense' | 'Payment';
export const VOUCHER_TYPES: VoucherType[] = [
  'Sales',
  'Credit Note',
  'Receipt',
  'Purchase',
  'Expense',
  'Payment',
];

export type CashAccount = 'cash' | 'bank';
export type Basis = 'accrual' | 'cash';

export interface Voucher {
  /** Unique across the stream: `<kind>:<source id>`. */
  id: string;
  date: string;
  type: VoucherType;
  /** Document number / reference shown in the "Vch No." column. */
  number: string;
  party: string;
  narration: string;
  /** Party-ledger debit / credit (see file header). */
  debit: number;
  credit: number;
  /** Payment method for Receipt / Payment vouchers. */
  method?: string;
  /** Which cash/bank book the voucher moves money in, if any. */
  account?: CashAccount;
  /** Invoice id for Sales / Credit Note / Receipt vouchers — drill-through. */
  invoice_id?: string;
  /** In-app link for drill-through (`/invoice/:id`). */
  link?: string;
}

export interface Period {
  /** Inclusive, ISO date. */
  start: string;
  /** Inclusive, ISO date. */
  end: string;
}

export interface OpeningBalance {
  id: string;
  account: CashAccount;
  amount: number;
  as_of: string;
}

/** Loose shape of a purchase / expense row — read defensively. */
export interface RawPurchase {
  id?: string;
  [key: string]: unknown;
}

export interface BooksData {
  invoices: InvoiceRecord[];
  transactions: Payment[];
  purchases: RawPurchase[];
  vendors: Array<{ id?: string; name?: string; [key: string]: unknown }>;
  purchasePayments: Array<{
    id?: string;
    purchase_id?: string;
    amount?: number;
    date?: string;
    method?: string;
    reference?: string;
  }>;
  openings: OpeningBalance[];
}

export const EMPTY_BOOKS: BooksData = {
  invoices: [],
  transactions: [],
  purchases: [],
  vendors: [],
  purchasePayments: [],
  openings: [],
};

export const OPENING_TABLE = 'book_opening';

/* ════════════════════════════════════════════════════════════════
   Dates & periods
   ════════════════════════════════════════════════════════════════ */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isoOf(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Normalise anything date-like to `YYYY-MM-DD` ('' when unusable). */
export function toIsoDate(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ''
      : isoOf(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value !== 'string' || !value) return '';
  const m = ISO_RE.exec(value);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : toIsoDate(d);
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** Indian FY start year for an ISO date: Apr–Dec → that year, Jan–Mar → previous. */
export function fyStartYearOf(iso: string): number {
  const m = ISO_RE.exec(iso);
  if (!m) return new Date().getFullYear();
  const y = parseInt(m[1], 10);
  return parseInt(m[2], 10) >= 4 ? y : y - 1;
}

export function fyPeriod(startYear: number): Period {
  return { start: isoOf(startYear, 4, 1), end: isoOf(startYear + 1, 3, 31) };
}

export type PeriodPreset =
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'this_fy'
  | 'last_fy'
  | 'custom';

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  this_fy: 'This FY',
  last_fy: 'Last FY',
  custom: 'Custom',
};

/**
 * Resolve a preset against `today`. The quarter is the Indian-FY quarter
 * (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar). `custom` returns this month.
 */
export function periodForPreset(preset: PeriodPreset, today: Date = new Date()): Period {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const todayIso = isoOf(y, m, today.getDate());
  switch (preset) {
    case 'last_month': {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { start: isoOf(ly, lm, 1), end: isoOf(ly, lm, daysInMonth(ly, lm)) };
    }
    case 'this_quarter': {
      // FY quarter index: Apr=0..Jun=0, Jul..Sep=1, Oct..Dec=2, Jan..Mar=3
      const fyMonthIdx = (m + 8) % 12; // Apr→0 … Mar→11
      const q = Math.floor(fyMonthIdx / 3);
      const startFyMonth = q * 3; // 0,3,6,9
      const startCal = ((startFyMonth + 3) % 12) + 1; // 4,7,10,1
      const startYear = startCal > m ? y - 1 : y;
      const endCalRaw = startCal + 2;
      const endCal = endCalRaw > 12 ? endCalRaw - 12 : endCalRaw;
      const endYear = endCalRaw > 12 ? startYear + 1 : startYear;
      return {
        start: isoOf(startYear, startCal, 1),
        end: isoOf(endYear, endCal, daysInMonth(endYear, endCal)),
      };
    }
    case 'this_fy':
      return fyPeriod(fyStartYearOf(todayIso));
    case 'last_fy':
      return fyPeriod(fyStartYearOf(todayIso) - 1);
    case 'this_month':
    case 'custom':
    default:
      return { start: isoOf(y, m, 1), end: isoOf(y, m, daysInMonth(y, m)) };
  }
}

export function inPeriod(date: string, p: Period): boolean {
  return !!date && date >= p.start && date <= p.end;
}

/** The ISO date before `iso` (calendar-safe). */
export function dayBefore(iso: string): string {
  const m = ISO_RE.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() - 1);
  return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** `YYYY-MM` keys for every month overlapping the period, in order. */
export function monthsIn(p: Period): string[] {
  const s = ISO_RE.exec(p.start);
  const e = ISO_RE.exec(p.end);
  if (!s || !e) return [];
  const out: string[] = [];
  let y = +s[1];
  let m = +s[2];
  const ey = +e[1];
  const em = +e[2];
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard++ < 600) {
    out.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[(parseInt(m, 10) || 1) - 1]} ${(y ?? '').slice(2)}`;
}

/* ════════════════════════════════════════════════════════════════
   Normalisation of source rows
   ════════════════════════════════════════════════════════════════ */

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function firstStr(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = str(row[k]);
    if (v) return v;
  }
  return '';
}

function firstNum(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (v === undefined || v === null || v === '') continue;
    const n = num(v, NaN);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const SALES_TYPES = new Set(['INVOICE', 'TAX_INVOICE']);

function isLive(inv: InvoiceRecord): boolean {
  return inv.status !== 'Draft' && inv.status !== 'Cancelled';
}

function isSale(inv: InvoiceRecord): boolean {
  return isLive(inv) && SALES_TYPES.has(inv.doc_type ?? 'INVOICE');
}

function isCreditNote(inv: InvoiceRecord): boolean {
  return isLive(inv) && inv.doc_type === 'CREDIT_NOTE';
}

function partyOfInvoice(inv: InvoiceRecord): string {
  return str(inv.client?.company) || str(inv.client?.name) || 'Cash sale';
}

/** Taxable / GST / total of an invoice-like row, tolerant of legacy rows. */
function invoiceAmounts(inv: InvoiceRecord) {
  const total = Math.abs(num(inv.total));
  const tax = Math.abs(num(inv.tax_amount));
  let taxable = Math.abs(num(inv.taxable_value, NaN));
  if (!Number.isFinite(taxable)) taxable = Math.max(total - tax, 0);
  return {
    total: round2(total),
    taxable: round2(taxable),
    tax: round2(tax),
    cgst: round2(Math.abs(num(inv.cgst_amount))),
    sgst: round2(Math.abs(num(inv.sgst_amount))),
    igst: round2(Math.abs(num(inv.igst_amount))),
  };
}

export interface NormPurchase {
  id: string;
  number: string;
  date: string;
  party: string;
  category: string;
  /** Expense (indirect) vs Purchase (direct cost). */
  isExpense: boolean;
  taxable: number;
  gst: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  itcEligible: boolean;
  /** Paid amount recorded on the row itself (fallback when no payment rows). */
  paidOnRow: number;
}

export function normalizePurchase(
  raw: RawPurchase,
  vendors: BooksData['vendors'] = [],
): NormPurchase | null {
  const row = raw as Record<string, unknown>;
  const status = str(row.status).toLowerCase();
  if (status === 'draft' || status === 'cancelled' || status === 'canceled' || status === 'void') {
    return null;
  }
  const date = toIsoDate(firstStr(row, ['date', 'bill_date', 'purchase_date', 'issue_date']));
  if (!date) return null;

  const cgst = Math.abs(firstNum(row, ['cgst_amount', 'cgst']) ?? 0);
  const sgst = Math.abs(firstNum(row, ['sgst_amount', 'sgst']) ?? 0);
  const igst = Math.abs(firstNum(row, ['igst_amount', 'igst']) ?? 0);
  const splitGst = cgst + sgst + igst;
  const gst = Math.abs(firstNum(row, ['tax_amount', 'gst_amount', 'gst', 'tax']) ?? splitGst);
  let total = firstNum(row, ['total', 'grand_total', 'amount']);
  let taxable = firstNum(row, ['taxable_value', 'taxable', 'subtotal']);
  if (taxable === null) taxable = total !== null ? Math.max(total - gst, 0) : 0;
  if (total === null) total = taxable + gst;

  const vendorId = firstStr(row, ['vendor_id']);
  const vendorName =
    firstStr(row, ['vendor_name', 'party', 'supplier_name']) ||
    str(vendors.find((v) => v.id === vendorId)?.name) ||
    '';

  const kind = firstStr(row, ['kind', 'type', 'doc_type', 'record_type']).toUpperCase();
  const itcFlag = row.itc_eligible ?? row.itcEligible;
  const itcStatus = firstStr(row, ['itc_status']).toLowerCase();
  const itcEligible =
    itcFlag === false || itcStatus === 'ineligible' || itcStatus === 'blocked' ? false : true;

  return {
    id: str(row.id) || `${date}-${total}`,
    number: firstStr(row, ['purchase_number', 'bill_number', 'invoice_number', 'number', 'reference']),
    date,
    party: vendorName || 'Unknown vendor',
    category: firstStr(row, ['category', 'expense_category', 'head']) || '',
    isExpense: kind.includes('EXPENSE'),
    taxable: round2(Math.abs(taxable)),
    gst: round2(gst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    igst: round2(igst),
    total: round2(Math.abs(total)),
    itcEligible,
    paidOnRow: round2(Math.abs(firstNum(row, ['amount_paid', 'paid_amount']) ?? 0)),
  };
}

/** Cost part of a purchase: taxable + GST that cannot be claimed as ITC. */
export function purchaseCost(p: NormPurchase): number {
  return round2(p.taxable + (p.itcEligible ? 0 : p.gst));
}

export function purchaseItc(p: NormPurchase): number {
  return p.itcEligible ? p.gst : 0;
}

function categoryOf(p: NormPurchase): string {
  return p.category || (p.isExpense ? 'Other expenses' : 'Purchases');
}

/** Cash → cash book; UPI / Bank transfer / Cheque / Card / anything else → bank. */
export function accountForMethod(method: unknown): CashAccount {
  return str(method).toLowerCase() === 'cash' ? 'cash' : 'bank';
}

/* ════════════════════════════════════════════════════════════════
   Voucher stream
   ════════════════════════════════════════════════════════════════ */

const TYPE_ORDER: Record<VoucherType, number> = {
  Sales: 0,
  Purchase: 1,
  Expense: 2,
  'Credit Note': 3,
  Receipt: 4,
  Payment: 5,
};

export function buildVouchers(data: BooksData): Voucher[] {
  const out: Voucher[] = [];
  const invById = new Map(data.invoices.map((i) => [i.id, i]));

  for (const inv of data.invoices) {
    const sale = isSale(inv);
    if (!sale && !isCreditNote(inv)) continue;
    const date = toIsoDate(inv.issue_date);
    if (!date) continue;
    const a = invoiceAmounts(inv);
    out.push({
      id: `${sale ? 'sale' : 'cn'}:${inv.id}`,
      date,
      type: sale ? 'Sales' : 'Credit Note',
      number: inv.invoice_number || '',
      party: partyOfInvoice(inv),
      narration: sale
        ? `Sales invoice${a.tax ? ` (incl. GST ${a.tax.toFixed(2)})` : ''}`
        : 'Credit note issued',
      debit: sale ? a.total : 0,
      credit: sale ? 0 : a.total,
      invoice_id: inv.id,
      link: `/invoice/${inv.id}`,
    });
  }

  for (const t of data.transactions) {
    const date = toIsoDate(t.date);
    const amount = round2(Math.abs(num(t.amount)));
    if (!date || amount === 0) continue;
    const inv = invById.get(t.invoice_id);
    out.push({
      id: `rcpt:${t.id}`,
      date,
      type: 'Receipt',
      number: str(t.reference) || inv?.invoice_number || '',
      party: inv ? partyOfInvoice(inv) : 'Unknown customer',
      narration: `Against ${inv?.invoice_number || 'invoice'}${t.note ? ` — ${t.note}` : ''}`,
      debit: 0,
      credit: amount,
      method: str(t.method) || 'Bank transfer',
      account: accountForMethod(t.method),
      invoice_id: inv?.id,
      link: inv ? `/invoice/${inv.id}` : undefined,
    });
  }

  const purchases = data.purchases
    .map((p) => normalizePurchase(p, data.vendors))
    .filter((p): p is NormPurchase => p !== null);
  const purchById = new Map(purchases.map((p) => [p.id, p]));

  for (const p of purchases) {
    out.push({
      id: `${p.isExpense ? 'exp' : 'pur'}:${p.id}`,
      date: p.date,
      type: p.isExpense ? 'Expense' : 'Purchase',
      number: p.number,
      party: p.party,
      narration: `${categoryOf(p)}${p.gst ? ` (GST ${p.gst.toFixed(2)}${p.itcEligible ? ' ITC' : ' no ITC'})` : ''}`,
      debit: 0,
      credit: p.total,
    });
  }

  for (const pp of data.purchasePayments) {
    const date = toIsoDate(pp.date);
    const amount = round2(Math.abs(num(pp.amount)));
    if (!date || amount === 0) continue;
    const p = purchById.get(str(pp.purchase_id));
    out.push({
      id: `pay:${pp.id ?? `${pp.purchase_id}-${date}-${amount}`}`,
      date,
      type: 'Payment',
      number: str(pp.reference) || p?.number || '',
      party: p?.party ?? 'Unknown vendor',
      narration: `Against ${p?.number || 'bill'}`,
      debit: amount,
      credit: 0,
      method: str(pp.method) || 'Bank transfer',
      account: accountForMethod(pp.method),
    });
  }

  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      a.number.localeCompare(b.number) ||
      a.id.localeCompare(b.id),
  );
}

export interface DayBook {
  vouchers: Voucher[];
  totalDebit: number;
  totalCredit: number;
}

function summarise(vouchers: Voucher[]): DayBook {
  return {
    vouchers,
    totalDebit: round2(vouchers.reduce((s, v) => s + v.debit, 0)),
    totalCredit: round2(vouchers.reduce((s, v) => s + v.credit, 0)),
  };
}

/** Tally Day Book for a single date, optionally narrowed to some voucher types. */
export function dayBook(vouchers: Voucher[], date: string, types?: VoucherType[]): DayBook {
  return summarise(
    vouchers.filter((v) => v.date === date && (!types || types.includes(v.type))),
  );
}

/** Day book across a period (grouped by the caller). */
export function dayBookRange(vouchers: Voucher[], period: Period, types?: VoucherType[]): DayBook {
  return summarise(
    vouchers.filter((v) => inPeriod(v.date, period) && (!types || types.includes(v.type))),
  );
}

/* ════════════════════════════════════════════════════════════════
   Cash book / Bank book
   ════════════════════════════════════════════════════════════════ */

/** Latest opening row for `account` whose as_of ≤ `date` (inclusive). */
export function openingFor(
  openings: OpeningBalance[],
  account: CashAccount,
  date: string,
): OpeningBalance | null {
  let best: OpeningBalance | null = null;
  for (const o of openings) {
    if (o.account !== account || !o.as_of || o.as_of > date) continue;
    if (!best || o.as_of >= best.as_of) best = o;
  }
  return best;
}

function movement(v: Voucher): number {
  // Receipts add money; Payments take it out (Dr party = we paid).
  return v.type === 'Receipt' ? v.credit : v.type === 'Payment' ? -v.debit : 0;
}

/** Balance of the account at the END of `date`, including opening balance. */
export function accountBalanceAt(
  vouchers: Voucher[],
  openings: OpeningBalance[],
  account: CashAccount,
  date: string,
): number {
  const o = openingFor(openings, account, date);
  const from = o?.as_of ?? '';
  let bal = round2(num(o?.amount));
  for (const v of vouchers) {
    if (v.account !== account || v.date > date || v.date < from) continue;
    bal = round2(bal + movement(v));
  }
  return bal;
}

export interface BookRow {
  date: string;
  voucher: Voucher;
  receipt: number;
  payment: number;
  balance: number;
}

export interface CashBook {
  account: CashAccount;
  opening: number;
  rows: BookRow[];
  totalReceipts: number;
  totalPayments: number;
  closing: number;
  /** True if no opening balance has been entered for this account. */
  openingMissing: boolean;
}

export function cashBook(
  vouchers: Voucher[],
  openings: OpeningBalance[],
  account: CashAccount,
  period: Period,
): CashBook {
  const o = openingFor(openings, account, period.end);
  const before = dayBefore(period.start);
  // Opening entered mid-period: the book starts from that amount, and
  // vouchers dated earlier than as_of are ignored below.
  const opening =
    o && o.as_of > before
      ? round2(num(o.amount))
      : accountBalanceAt(vouchers, openings, account, before);
  const rows: BookRow[] = [];
  let bal = opening;
  let totalReceipts = 0;
  let totalPayments = 0;
  for (const v of vouchers) {
    if (v.account !== account || !inPeriod(v.date, period)) continue;
    if (o && v.date < o.as_of) continue; // before the books were opened
    const m = movement(v);
    const receipt = m > 0 ? m : 0;
    const payment = m < 0 ? -m : 0;
    bal = round2(bal + m);
    totalReceipts = round2(totalReceipts + receipt);
    totalPayments = round2(totalPayments + payment);
    rows.push({ date: v.date, voucher: v, receipt, payment, balance: bal });
  }
  return {
    account,
    opening,
    rows,
    totalReceipts,
    totalPayments,
    closing: round2(opening + totalReceipts - totalPayments),
    openingMissing: !o,
  };
}

/* ════════════════════════════════════════════════════════════════
   Profit & Loss
   ════════════════════════════════════════════════════════════════ */

/** One P&L-relevant movement. `amount` is positive; `kind` decides the side. */
export interface PnlEvent {
  date: string;
  kind: 'sales' | 'credit_note' | 'expense';
  amount: number;
  category: string;
  /** Direct cost (purchases) vs indirect (expenses) — drives gross profit. */
  direct: boolean;
  /** Source document id, for transparency. */
  ref: string;
}

/**
 * Turn the source data into P&L events for the chosen basis.
 *
 *  accrual: sales/credit notes at invoice date; purchases at bill date.
 *  cash:    income when money is RECEIVED, apportioned to the taxable part
 *           of the invoice (receipt × taxable/total); costs when money is
 *           PAID, apportioned to the cost part of the bill. Credit notes
 *           still reduce income on their issue date (they are adjustments,
 *           and refunds are not tracked as separate payments).
 */
export function pnlEvents(data: BooksData, basis: Basis): PnlEvent[] {
  const events: PnlEvent[] = [];
  const invById = new Map(data.invoices.map((i) => [i.id, i]));

  for (const inv of data.invoices) {
    const date = toIsoDate(inv.issue_date);
    if (!date) continue;
    if (isCreditNote(inv)) {
      events.push({
        date,
        kind: 'credit_note',
        amount: invoiceAmounts(inv).taxable,
        category: 'Credit notes',
        direct: false,
        ref: inv.id,
      });
    } else if (isSale(inv) && basis === 'accrual') {
      events.push({
        date,
        kind: 'sales',
        amount: invoiceAmounts(inv).taxable,
        category: 'Sales',
        direct: false,
        ref: inv.id,
      });
    }
  }

  if (basis === 'cash') {
    for (const t of data.transactions) {
      const date = toIsoDate(t.date);
      const paid = round2(Math.abs(num(t.amount)));
      if (!date || paid === 0) continue;
      const inv = invById.get(t.invoice_id);
      let amount = paid;
      if (inv) {
        if (!isSale(inv)) continue; // receipts only count against sales invoices
        const a = invoiceAmounts(inv);
        amount = a.total > 0 ? round2((paid * a.taxable) / a.total) : paid;
      }
      events.push({ date, kind: 'sales', amount, category: 'Sales', direct: false, ref: t.id });
    }
  }

  const purchases = data.purchases
    .map((p) => normalizePurchase(p, data.vendors))
    .filter((p): p is NormPurchase => p !== null);

  if (basis === 'accrual') {
    for (const p of purchases) {
      events.push({
        date: p.date,
        kind: 'expense',
        amount: purchaseCost(p),
        category: categoryOf(p),
        direct: !p.isExpense,
        ref: p.id,
      });
    }
  } else {
    const byId = new Map(purchases.map((p) => [p.id, p]));
    const paidRows = new Map<string, number>();
    for (const pp of data.purchasePayments) {
      const p = byId.get(str(pp.purchase_id));
      const date = toIsoDate(pp.date);
      const paid = round2(Math.abs(num(pp.amount)));
      if (!p || !date || paid === 0) continue;
      paidRows.set(p.id, round2((paidRows.get(p.id) ?? 0) + paid));
      const cost = p.total > 0 ? round2((paid * purchaseCost(p)) / p.total) : paid;
      events.push({
        date,
        kind: 'expense',
        amount: cost,
        category: categoryOf(p),
        direct: !p.isExpense,
        ref: p.id,
      });
    }
    // Bills marked paid on the row itself with no payment rows: paid on bill date.
    for (const p of purchases) {
      if (paidRows.has(p.id) || p.paidOnRow <= 0) continue;
      const cost = p.total > 0 ? round2((p.paidOnRow * purchaseCost(p)) / p.total) : p.paidOnRow;
      events.push({
        date: p.date,
        kind: 'expense',
        amount: cost,
        category: categoryOf(p),
        direct: !p.isExpense,
        ref: p.id,
      });
    }
  }
  return events;
}

export interface ExpenseRow {
  category: string;
  amount: number;
  direct: boolean;
}

export interface ProfitLoss {
  basis: Basis;
  period: Period;
  sales: number;
  creditNotes: number;
  /** sales − credit notes (excludes GST). */
  income: number;
  directCosts: number;
  grossProfit: number;
  indirectExpenses: number;
  expenses: ExpenseRow[];
  totalExpenses: number;
  netProfit: number;
  /** Net profit ÷ income, in percent (0 when there is no income). */
  margin: number;
}

function foldEvents(events: PnlEvent[], period: Period, basis: Basis): ProfitLoss {
  let sales = 0;
  let creditNotes = 0;
  const cats = new Map<string, ExpenseRow>();
  for (const e of events) {
    if (!inPeriod(e.date, period)) continue;
    if (e.kind === 'sales') sales = round2(sales + e.amount);
    else if (e.kind === 'credit_note') creditNotes = round2(creditNotes + e.amount);
    else {
      const key = `${e.direct ? 'd' : 'i'}|${e.category}`;
      const row = cats.get(key) ?? { category: e.category, amount: 0, direct: e.direct };
      row.amount = round2(row.amount + e.amount);
      cats.set(key, row);
    }
  }
  const expenses = [...cats.values()].sort((a, b) => b.amount - a.amount);
  const directCosts = round2(expenses.filter((r) => r.direct).reduce((s, r) => s + r.amount, 0));
  const indirectExpenses = round2(
    expenses.filter((r) => !r.direct).reduce((s, r) => s + r.amount, 0),
  );
  const income = round2(sales - creditNotes);
  const grossProfit = round2(income - directCosts);
  const netProfit = round2(grossProfit - indirectExpenses);
  return {
    basis,
    period,
    sales,
    creditNotes,
    income,
    directCosts,
    grossProfit,
    indirectExpenses,
    expenses,
    totalExpenses: round2(directCosts + indirectExpenses),
    netProfit,
    margin: income > 0 ? round2((netProfit / income) * 100) : 0,
  };
}

export function profitAndLoss(data: BooksData, period: Period, basis: Basis = 'accrual'): ProfitLoss {
  return foldEvents(pnlEvents(data, basis), period, basis);
}

export interface TrendPoint {
  month: string;
  label: string;
  income: number;
  expenses: number;
  profit: number;
}

/** Month-by-month income / expenses / profit across the period. */
export function monthlyTrend(data: BooksData, period: Period, basis: Basis = 'accrual'): TrendPoint[] {
  const events = pnlEvents(data, basis);
  return monthsIn(period).map((month) => {
    const from = `${month}-01`;
    const to = `${month}-31`;
    const p: Period = {
      start: from < period.start ? period.start : from,
      end: to > period.end ? period.end : to,
    };
    const r = foldEvents(events, p, basis);
    return {
      month,
      label: monthLabel(month),
      income: r.income,
      expenses: r.totalExpenses,
      profit: r.netProfit,
    };
  });
}

/* ════════════════════════════════════════════════════════════════
   GST summary & Balance sheet
   ════════════════════════════════════════════════════════════════ */

export interface GstSummary {
  outputCgst: number;
  outputSgst: number;
  outputIgst: number;
  /** Output GST on sales less GST on credit notes. */
  outputTotal: number;
  /** ITC on eligible purchases. */
  itc: number;
  /** GST on purchases that is NOT creditable (already in costs). */
  blockedGst: number;
  /** output − ITC; negative means a refundable / carry-forward credit. */
  netPayable: number;
}

export function gstSummary(data: BooksData, period: Period): GstSummary {
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  for (const inv of data.invoices) {
    const sale = isSale(inv);
    if (!sale && !isCreditNote(inv)) continue;
    if (!inPeriod(toIsoDate(inv.issue_date), period)) continue;
    const a = invoiceAmounts(inv);
    const sign = sale ? 1 : -1;
    // SINGLE-mode legacy rows only carry tax_amount; treat the remainder as IGST.
    const rest = Math.max(round2(a.tax - a.cgst - a.sgst - a.igst), 0);
    cgst = round2(cgst + sign * a.cgst);
    sgst = round2(sgst + sign * a.sgst);
    igst = round2(igst + sign * (a.igst + rest));
  }
  let itc = 0;
  let blocked = 0;
  for (const raw of data.purchases) {
    const p = normalizePurchase(raw, data.vendors);
    if (!p || !inPeriod(p.date, period)) continue;
    itc = round2(itc + purchaseItc(p));
    blocked = round2(blocked + (p.itcEligible ? 0 : p.gst));
  }
  const outputTotal = round2(cgst + sgst + igst);
  return {
    outputCgst: cgst,
    outputSgst: sgst,
    outputIgst: igst,
    outputTotal,
    itc,
    blockedGst: blocked,
    netPayable: round2(outputTotal - itc),
  };
}

export interface BalanceSheet {
  asOf: string;
  /** Always true — a reminder for UIs that this is not a statutory statement. */
  indicative: true;
  assets: {
    cash: number;
    bank: number;
    receivables: number;
    /** Net ITC credit when ITC exceeds output GST. */
    itcReceivable: number;
    vendorAdvances: number;
    total: number;
  };
  liabilities: {
    payables: number;
    gstPayable: number;
    customerAdvances: number;
    total: number;
  };
  equity: {
    /** Cumulative accrual profit up to the date. */
    retainedEarnings: number;
    /** Balancing figure: capital introduced, drawings, GST already remitted, opening positions. */
    capitalAndOther: number;
    total: number;
  };
}

export function balanceSheet(data: BooksData, asOf: string): BalanceSheet {
  const upTo = (d: string) => !!d && d <= asOf;

  let salesTotal = 0;
  let cnTotal = 0;
  let outputGst = 0;
  for (const inv of data.invoices) {
    const date = toIsoDate(inv.issue_date);
    if (!upTo(date)) continue;
    const a = invoiceAmounts(inv);
    if (isSale(inv)) {
      salesTotal += a.total;
      outputGst += a.tax;
    } else if (isCreditNote(inv)) {
      cnTotal += a.total;
      outputGst -= a.tax;
    }
  }
  const invById = new Map(data.invoices.map((i) => [i.id, i]));
  let receipts = 0;
  for (const t of data.transactions) {
    if (!upTo(toIsoDate(t.date))) continue;
    const inv = invById.get(t.invoice_id);
    if (inv && !isSale(inv)) continue;
    receipts += Math.abs(num(t.amount));
  }

  const purchases = data.purchases
    .map((p) => normalizePurchase(p, data.vendors))
    .filter((p): p is NormPurchase => p !== null && upTo(p.date));
  let purchTotal = 0;
  let itc = 0;
  for (const p of purchases) {
    purchTotal += p.total;
    itc += purchaseItc(p);
  }
  const purchIds = new Set(purchases.map((p) => p.id));
  let paid = 0;
  for (const pp of data.purchasePayments) {
    if (!upTo(toIsoDate(pp.date))) continue;
    if (pp.purchase_id && !purchIds.has(str(pp.purchase_id))) continue;
    paid += Math.abs(num(pp.amount));
  }

  const vouchers = buildVouchers(data);
  const cash = accountBalanceAt(vouchers, data.openings, 'cash', asOf);
  const bank = accountBalanceAt(vouchers, data.openings, 'bank', asOf);

  const ar = round2(salesTotal - cnTotal - receipts);
  const ap = round2(purchTotal - paid);
  const gstNet = round2(outputGst - itc);

  const assets = {
    cash,
    bank,
    receivables: Math.max(ar, 0),
    itcReceivable: Math.max(-gstNet, 0),
    vendorAdvances: Math.max(-ap, 0),
    total: 0,
  };
  assets.total = round2(
    assets.cash + assets.bank + assets.receivables + assets.itcReceivable + assets.vendorAdvances,
  );
  const liabilities = {
    payables: Math.max(ap, 0),
    gstPayable: Math.max(gstNet, 0),
    customerAdvances: Math.max(-ar, 0),
    total: 0,
  };
  liabilities.total = round2(liabilities.payables + liabilities.gstPayable + liabilities.customerAdvances);

  const everything: Period = { start: '0000-01-01', end: asOf };
  const retainedEarnings = profitAndLoss(data, everything, 'accrual').netProfit;
  const equityTotal = round2(assets.total - liabilities.total);
  return {
    asOf,
    indicative: true,
    assets,
    liabilities,
    equity: {
      retainedEarnings,
      capitalAndOther: round2(equityTotal - retainedEarnings),
      total: equityTotal,
    },
  };
}

/* ════════════════════════════════════════════════════════════════
   Persistence & dashboard hook
   ════════════════════════════════════════════════════════════════ */

export function loadOpenings(): OpeningBalance[] {
  return getTable<OpeningBalance>(OPENING_TABLE).filter(
    (o) => (o.account === 'cash' || o.account === 'bank') && !!o.as_of,
  );
}

/** Replace the opening balance for an account (one row per account kept). */
export function saveOpening(account: CashAccount, amount: number, asOf: string): OpeningBalance[] {
  const rows = getTable<OpeningBalance>(OPENING_TABLE).filter((o) => o.account !== account);
  rows.push({ id: generateId(), account, amount: round2(num(amount)), as_of: toIsoDate(asOf) });
  setTable(OPENING_TABLE, rows);
  return rows;
}

export function loadBooksData(): BooksData {
  return {
    invoices: getTable<InvoiceRecord>('invoices'),
    transactions: getTable<Payment>('transactions'),
    purchases: getTable<RawPurchase>('purchases'),
    vendors: getTable<BooksData['vendors'][number]>('vendors'),
    purchasePayments: getTable<BooksData['purchasePayments'][number]>('purchase_payments'),
    openings: loadOpenings(),
  };
}

export interface ProfitSnapshot {
  period: Period;
  basis: Basis;
  income: number;
  expenses: number;
  netProfit: number;
  margin: number;
}

/**
 * For the dashboard: profit for a period (a Period or a preset name) read
 * straight from storage. Never throws — empty storage yields zeros.
 */
export function getProfitSnapshot(
  period: Period | PeriodPreset = 'this_fy',
  basis: Basis = 'accrual',
  data: BooksData = loadBooksData(),
): ProfitSnapshot {
  const p = typeof period === 'string' ? periodForPreset(period) : period;
  const r = profitAndLoss(data, p, basis);
  return {
    period: p,
    basis,
    income: r.income,
    expenses: r.totalExpenses,
    netProfit: r.netProfit,
    margin: r.margin,
  };
}

/* ════════════════════════════════════════════════════════════════
   CSV
   ════════════════════════════════════════════════════════════════ */

function csvCell(v: string | number): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = v;
  // Neutralise spreadsheet formula injection from user-entered text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function dayBookCsv(vouchers: Voucher[]): string {
  return toCsv([
    ['Date', 'Voucher type', 'Vch no.', 'Particulars', 'Narration', 'Debit', 'Credit'],
    ...vouchers.map((v) => [v.date, v.type, v.number, v.party, v.narration, v.debit, v.credit]),
  ]);
}

export function cashBookCsv(book: CashBook): string {
  return toCsv([
    ['Date', 'Voucher type', 'Vch no.', 'Particulars', 'Method', 'Receipt', 'Payment', 'Balance'],
    ['', 'Opening balance', '', '', '', '', '', book.opening],
    ...book.rows.map((r) => [
      r.date,
      r.voucher.type,
      r.voucher.number,
      r.voucher.party,
      r.voucher.method ?? '',
      r.receipt,
      r.payment,
      r.balance,
    ]),
    ['', 'Closing balance', '', '', '', book.totalReceipts, book.totalPayments, book.closing],
  ]);
}

export function profitLossCsv(r: ProfitLoss): string {
  return toCsv([
    ['Profit & Loss', `${r.period.start} to ${r.period.end}`, r.basis === 'cash' ? 'Cash basis' : 'Accrual basis'],
    ['Particulars', 'Amount'],
    ['Sales (excl. GST)', r.sales],
    ['Less: credit notes', r.creditNotes],
    ['Net income', r.income],
    ...r.expenses.map((e) => [`${e.direct ? 'Direct' : 'Indirect'}: ${e.category}`, e.amount]),
    ['Total expenses', r.totalExpenses],
    ['Gross profit', r.grossProfit],
    ['Net profit', r.netProfit],
    ['Margin %', r.margin],
  ]);
}

export function balanceSheetCsv(b: BalanceSheet): string {
  return toCsv([
    ['Balance sheet (indicative)', `As of ${b.asOf}`],
    ['Particulars', 'Amount'],
    ['Cash in hand', b.assets.cash],
    ['Bank', b.assets.bank],
    ['Receivables', b.assets.receivables],
    ['ITC receivable', b.assets.itcReceivable],
    ['Vendor advances', b.assets.vendorAdvances],
    ['Total assets', b.assets.total],
    ['Payables', b.liabilities.payables],
    ['GST payable', b.liabilities.gstPayable],
    ['Customer advances', b.liabilities.customerAdvances],
    ['Total liabilities', b.liabilities.total],
    ['Retained earnings', b.equity.retainedEarnings],
    ['Capital & other (balancing)', b.equity.capitalAndOther],
    ['Total equity', b.equity.total],
  ]);
}
