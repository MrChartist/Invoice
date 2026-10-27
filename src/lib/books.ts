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

import { FINANCIAL_REASON_LABELS, isFinancialNote } from './financial-note';
import { DEFAULT_BANK_ID, accountIdOf, type BankAccount } from './bank-accounts';
import { round2, num, untaxedCharges } from './invoice-calc';
import { inrRecord, inrValue } from './fx';
import { supplierView } from './rcm';
import { receiptInr } from './fx-gain';
import { getTable, peekTable, setTable, generateId } from './storage';
import { isoDay } from './dates';
import { toCsv } from './csv';
import { isVoidStatus, readPurchase, selfAssessedCessOf, selfAssessedTaxOf, splitLumpTax, supplierPayableOf } from './purchase-normalize';
import type { InvoiceRecord, Payment } from '../types/invoice';
import type { AdvanceRecord } from '../types/advances';
import type { PurchaseReturn, VendorPayment } from '../types/purchases';
import { booksReturnEffects } from './purchase-returns-gst';
import { ADVANCES_TABLE, advanceMovements, isAdvanceAdjustment, movedNoCash } from './advance-tax'; // movedNoCash: no-cash.ts
import { payrollBooksVouchers, payrollPnlEvents } from './payroll/books-link';

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
  /** Bank sub-account (`bank-accounts.ts`) when `account` is 'bank'; missing = the main account. */
  bank_account_id?: string;
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
    bank_account_id?: string;
    /** Additive (Tally parity): TDS deducted on this payment — settles the bill with `amount`, owed to the government. */
    tds_amount?: number;
  }>;
  openings: OpeningBalance[];
  /** Additive (Tally parity): supplier advances / on-account payments (`vendor_payments`). Optional for older callers. */
  vendorPayments?: VendorPayment[];
  /** Advance receipts (5.3, `advances` table). Optional so older callers / fixtures stay valid. */
  advances?: AdvanceRecord[];
  /** Additive (WP-3): purchase returns / supplier credit notes (`purchase_returns`). Optional. */
  purchaseReturns?: PurchaseReturn[];
  /** Additive (7P): raw `payroll_runs` / `payroll_payments` — payments in the cash / bank book, salary cost in the P&L. */
  payrollRunRows?: unknown[];
  payrollPaymentRows?: unknown[];
  /** Additive (QA6-1 F5): raw `vouchers` rows — their cash / bank lines are in the cash / bank book. Optional. */
  manualVouchers?: readonly ManualVoucherRow[];
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
  // Bare days keep their written day; real instants (…Z) become the LOCAL day.
  return isoDay(value);
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
  /** 8.107: month / FY quarter / FY to date (start of the period → today). */
  | 'mtd'
  | 'qtd'
  | 'ytd'
  | 'custom';

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  this_fy: 'This FY',
  last_fy: 'Last FY',
  mtd: 'Month to date',
  qtd: 'Quarter to date',
  ytd: 'Year to date',
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
    case 'mtd':
      return { start: isoOf(y, m, 1), end: todayIso };
    case 'qtd':
      return { start: periodForPreset('this_quarter', today).start, end: todayIso };
    case 'ytd':
      return { start: fyPeriod(fyStartYearOf(todayIso)).start, end: todayIso };
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

const SALES_TYPES = new Set(['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY']);

function isLive(inv: InvoiceRecord): boolean {
  return inv.status !== 'Draft' && inv.status !== 'Cancelled';
}

/** Sales-side document that posts (invoice / tax invoice / debit note, not Draft or Cancelled). Shared with the ledger. */
export function isSale(inv: InvoiceRecord): boolean {
  return isLive(inv) && SALES_TYPES.has(inv.doc_type ?? 'INVOICE');
}

export function isCreditNote(inv: InvoiceRecord): boolean {
  return isLive(inv) && inv.doc_type === 'CREDIT_NOTE';
}

export function partyOfInvoice(inv: InvoiceRecord): string {
  return str(inv.client?.company) || str(inv.client?.name) || 'Cash sale';
}

/**
 * Taxable / GST / total of an invoice-like row, tolerant of legacy rows. In rupees: a foreign-currency
 * document is booked at its exchange rate (`src/lib/fx.ts`); one without a rate stays at face value.
 */
function invoiceAmounts(source: InvoiceRecord) {
  // Outward reverse charge: the GST is the recipient's to pay — no output tax, and only the
  // taxable value is receivable, also on older records whose stored total includes it (src/lib/rcm.ts).
  const inv = supplierView(inrRecord(source));
  const total = Math.abs(num(inv.total));
  const tax = Math.abs(num(inv.tax_amount));
  const hasTaxable = Number.isFinite(num(inv.taxable_value, NaN));
  let taxable = Math.abs(num(inv.taxable_value, NaN));
  if (!hasTaxable) taxable = Math.max(total - tax, 0);
  // Revenue of the document = what it earns EXCLUDING the taxes it collects for the
  // government (GST, cess, TCS). Freight / other charges and the round-off are the
  // seller's income too, so they belong in the P&L — otherwise Receivables (which
  // bills the full total) and the Books disagree by exactly those amounts.
  const cess = Math.abs(num(inv.cess_amount));
  const tcs = Math.abs(num(inv.tcs_amount));
  // Taxed charges (`charges_taxable`) already sit inside taxable_value.
  const charges = untaxedCharges(inv);
  // Legacy rows with no taxable_value: whatever is left after the taxes is the income.
  const income = hasTaxable
    ? round2(taxable + charges + num(inv.round_off))
    : round2(Math.max(total - tax - cess - tcs, 0));
  return {
    total: round2(total),
    taxable: round2(taxable),
    income,
    tax: round2(tax),
    cess: round2(cess),
    tcs: round2(tcs),
    tds: round2(Math.abs(num(inv.tds_amount))),
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
  /**
   * GST we pay to the government ourselves (reverse charge, import of services, customs IGST on
   * imported goods) when it sits inside `total`. Owed to the government, never to the supplier.
   */
  selfTax: number;
  /** What the supplier is owed: total − selfTax − TDS deducted on booking (`supplierPayable`). */
  payable: number;
  /** Additive: TDS deducted when the bill was booked (owed to the government). */
  tds: number;
  /**
   * Additive (7O, 7.90): compensation cess on the bill (outside `gst`) and the part of it we pay
   * ourselves (reverse charge / imports — never owed to the supplier). Optional for older callers.
   */
  cess?: number;
  selfCess?: number;
  itcEligible: boolean;
  /** Paid amount recorded on the row itself (fallback when no payment rows). */
  paidOnRow: number;
}

export function normalizePurchase(
  raw: RawPurchase,
  vendors: BooksData['vendors'] = [],
): NormPurchase | null {
  // One shared reader for the purchases table (see purchase-normalize.ts).
  const c = readPurchase(raw, vendors);
  if (!c || isVoidStatus(c.status)) return null;
  // Same split as GST reports / exports for legacy rows that carry only a lump tax or a rate.
  const heads = splitLumpTax(c, raw, c.placeOfSupply);
  return {
    id: c.id || `${c.date}-${c.total}`,
    number: c.number,
    date: c.date,
    party: c.partyName || 'Unknown vendor',
    category: c.category,
    isExpense: c.isExpense,
    taxable: heads.taxable,
    gst: heads.tax,
    cgst: heads.cgst,
    sgst: heads.sgst,
    igst: heads.igst,
    total: c.total,
    selfTax: selfAssessedTaxOf(c),
    payable: supplierPayableOf(c),
    tds: c.tdsOnBill,
    ...(c.cess > 0 ? { cess: c.cess, selfCess: selfAssessedCessOf(c) } : {}),
    itcEligible: c.itcEligible,
    paidOnRow: c.paid,
  };
}

/** Customs IGST on imported goods (paid with the Bill of Entry, not through GSTR-3B). */
function isCustomsIgst(raw: RawPurchase): boolean {
  return String((raw as { import_type?: unknown })?.import_type ?? '').toUpperCase() === 'GOODS';
}

/** Cost part of a purchase: taxable + GST (and cess, 7O) that cannot be claimed as ITC. */
export function purchaseCost(p: NormPurchase): number {
  return round2(p.taxable + (p.itcEligible ? 0 : p.gst + (p.cess ?? 0)));
}

/** GST input credit of a bill (CGST + SGST + IGST; cess is `purchaseItcCess` — it offsets output cess only). */
export function purchaseItc(p: NormPurchase): number {
  return p.itcEligible ? p.gst : 0;
}

/** 7O (7.90): cess input credit of a bill (Sec 11(2) Compensation Cess Act: pays cess only). */
export function purchaseItcCess(p: NormPurchase): number {
  return p.itcEligible ? round2(p.cess ?? 0) : 0;
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
    // No money moved (QA6-1 F4, `no-cash.ts`): an advance adjustment, a bad-debt write-off, a gift-voucher redemption,
    // a deposit adjustment or an RA deduction row.
    if (movedNoCash(t)) continue;
    const date = toIsoDate(t.date);
    const inv = invById.get(t.invoice_id);
    // A receipt against a foreign-currency invoice is booked at the rupees actually realised
    // (its `realised_rate`), else at the invoice's rate — the same figure the ledger's bank gets.
    const amount = round2(receiptInr(t, inv));
    if (!date || amount === 0) continue;
    out.push({
      id: `rcpt:${t.id}`,
      date,
      type: 'Receipt',
      number: str(t.reference) || inv?.invoice_number || '',
      // An on-account receipt (no invoice, 8.2 / bill-wise RV) names its party on the row itself.
      party: inv ? partyOfInvoice(inv) : str((t as { client_name?: unknown }).client_name) || 'Unknown customer',
      narration: inv || !(t as { client_name?: unknown }).client_name
        ? `Against ${inv?.invoice_number || 'invoice'}${t.note ? ` — ${t.note}` : ''}`
        : `On account${t.note && t.note !== 'On account' ? ` — ${t.note}` : ''}`,
      debit: 0,
      credit: amount,
      method: str(t.method) || 'Bank transfer',
      account: accountForMethod(t.method),
      bank_account_id: accountForMethod(t.method) === 'bank' && t.bank_account_id ? t.bank_account_id : undefined,
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
      narration: `${categoryOf(p)}${p.gst ? ` (GST ${p.gst.toFixed(2)}${p.itcEligible ? ' ITC' : ' no ITC'}${p.selfTax ? ', paid by us (reverse charge / import)' : ''})` : ''}`,
      debit: 0,
      // The supplier is credited with what it is owed; self-assessed GST is owed to the government.
      credit: p.payable,
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
      bank_account_id: accountForMethod(pp.method) === 'bank' && pp.bank_account_id ? str(pp.bank_account_id) : undefined,
    });
  }

  // Supplier advances / on-account payments (bill-wise payables): cash out on the day paid.
  for (const vp of data.vendorPayments ?? []) {
    const date = toIsoDate(vp.date);
    const amount = round2(Math.abs(num(vp.amount)));
    if (!date || amount === 0) continue;
    out.push({
      id: `vpay:${vp.id}`,
      date,
      type: 'Payment',
      number: str(vp.reference) || str(vp.ref_name),
      party: str(vp.vendor_name) || 'Unknown vendor',
      narration: vp.kind === 'ADVANCE' ? 'Advance to supplier' : vp.kind === 'NEW_REF' ? `New ref ${str(vp.ref_name)}`.trim() : 'On account',
      debit: amount,
      credit: 0,
      method: str(vp.method) || 'Bank transfer',
      account: accountForMethod(vp.method),
      bank_account_id: accountForMethod(vp.method) === 'bank' && vp.bank_account_id ? str(vp.bank_account_id) : undefined,
    });
  }

  // Advance receipts (5.3) are cash in on the day received; refunds of an advance are cash out.
  for (const m of advanceMovements(data.advances ?? [], data.transactions, data.invoices)) {
    if (m.kind === 'adjusted') continue;
    const received = m.kind === 'received';
    out.push({
      id: `${received ? 'adv' : 'advrf'}:${m.sourceId}`,
      date: m.date,
      type: received ? 'Receipt' : 'Payment',
      number: received ? m.number : m.ref || m.number,
      party: m.party,
      narration: received ? `Advance received${m.taxed ? ` (incl. GST ${round2(m.igst + m.cgst + m.sgst).toFixed(2)})` : ''}` : `Refund of advance ${m.number}`,
      debit: received ? 0 : m.gross,
      credit: received ? m.gross : 0,
      method: str(m.method) || 'Bank transfer',
      account: accountForMethod(m.method),
      bank_account_id: accountForMethod(m.method) === 'bank' && m.bank_account_id ? m.bank_account_id : undefined,
      link: '/receivables?tab=advances',
    });
  }

  // Payroll payments (7P): salary, PF / ESI / PT / TDS 192, loans to employees — cash out on the day paid.
  out.push(...payrollBooksVouchers(data.payrollPaymentRows));

  // QA6-1 F5: the cash / bank lines of manual vouchers (gift-voucher sales, donations, deposits, payouts, contras …).
  out.push(...manualCashVouchers(data.manualVouchers ?? [], data.transactions));

  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      a.number.localeCompare(b.number) ||
      a.id.localeCompare(b.id),
  );
}

/** The fields of a stored manual voucher (`vouchers` table, `ledger/vouchers.ts`) the cash / bank book reads. */
export interface ManualVoucherRow {
  id?: unknown;
  type?: unknown;
  number?: unknown;
  date?: unknown;
  narration?: unknown;
  lines?: unknown;
  variant?: unknown;
  post_dated?: unknown;
  reverse_on?: unknown;
  voucher_class?: unknown;
}

/** Ledger id → simple book: 'cash' (3500) or a bank ledger ('bank' = main, 'bank:<id>', `bank-ledgers.ts`). */
function cashSideOf(accountId: string): { account: CashAccount; bank?: string } | null {
  if (accountId === 'cash') return { account: 'cash' };
  if (accountId === 'bank') return { account: 'bank' };
  return accountId.startsWith('bank:') && accountId.length > 5 ? { account: 'bank', bank: accountId.slice(5) } : null;
}

/**
 * QA6-1 F5: one Receipt / Payment entry per cash or bank ledger a manual voucher moves money in (net per ledger, rupees),
 * as the ledger posts it (`inBooks` / `reversalOf`, `ledger/voucher-variants.ts`): optional and memorandum vouchers and
 * post-dated ones not yet due stay out; a reversing journal is reversed on its day. Never counted twice:
 *  - a voucher whose receipt rows are in `transactions` (bill-wise RV, P0-11) is carried by those rows;
 *  - an RA deduction journal (class "RA deduction") or a finance transfer (R9 RT-D2) pairs a no-cash row on the clearing
 *    account, so both stay out.
 */
export function manualCashVouchers(rows: readonly ManualVoucherRow[], transactions: readonly Payment[] = [], today: string = toIsoDate(new Date())): Voucher[] {
  const carried = new Set(transactions.map((t) => str((t as { voucher_id?: unknown }).voucher_id)).filter(Boolean));
  const out: Voucher[] = [];
  const push = (v: ManualVoucherRow, id: string, date: string, number: string, narration: string, sign: 1 | -1) => {
    const net = new Map<string, number>();
    for (const l of Array.isArray(v.lines) ? (v.lines as { account_id?: unknown; dr?: unknown; cr?: unknown }[]) : []) {
      const side = l && cashSideOf(str(l.account_id));
      if (side) net.set(str(l.account_id), (net.get(str(l.account_id)) ?? 0) + sign * (num(l.dr) - num(l.cr)));
    }
    for (const [acc, paise] of net) {
      const side = cashSideOf(acc)!;
      const amount = round2(Math.abs(paise) / 100);
      if (!amount) continue;
      const inflow = paise > 0;
      out.push({
        id: `mv:${id}:${acc}`,
        date,
        type: inflow ? 'Receipt' : 'Payment',
        number,
        party: str(v.voucher_class) || 'Voucher',
        narration,
        debit: inflow ? 0 : amount,
        credit: inflow ? amount : 0,
        method: side.account === 'cash' ? 'Cash' : 'Bank transfer',
        account: side.account,
        bank_account_id: side.bank,
        link: '/books?tab=vch',
      });
    }
  };
  for (const v of rows) {
    const id = str(v?.id);
    const date = toIsoDate(v?.date);
    if (!id || !date || carried.has(id) || v.variant === 'OPTIONAL' || v.variant === 'MEMO' || (v.post_dated === true && date > today)) continue;
    if (str(v.voucher_class) === 'RA deduction' || str(v.voucher_class) === 'Finance transfer') continue; // R9 (RT-D2): paired with its no-cash row
    push(v, id, date, str(v.number), str(v.narration), 1);
    const rev = toIsoDate(v.reverse_on);
    if (v.type === 'JOURNAL' && rev && rev > date) push(v, `${id}~rev`, rev, `${str(v.number)}-R`, `Reversal of ${str(v.number)}`, -1);
  }
  return out;
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

/**
 * Book balance of one bank account at the end of `date`: its own opening plus the bank vouchers
 * tagged to it. Until the main account has its own opening it uses the Books bank opening, so a
 * single-account user sees exactly the old figure.
 */
export function bankAccountBalanceAt(
  vouchers: readonly Voucher[],
  openings: OpeningBalance[],
  account: BankAccount,
  date: string,
): { balance: number; openingMissing: boolean } {
  let amount = 0;
  let from = '';
  let missing = false;
  if (account.opening !== undefined && account.opening_as_of && account.opening_as_of <= date) {
    amount = account.opening;
    from = account.opening_as_of;
  } else if (account.id === DEFAULT_BANK_ID) {
    const o = openingFor(openings, 'bank', date);
    amount = num(o?.amount);
    from = o?.as_of ?? '';
    missing = !o;
  } else missing = true;
  let bal = round2(amount);
  for (const v of vouchers) {
    if (v.account !== 'bank' || v.date > date || v.date < from || accountIdOf(v) !== account.id) continue;
    bal = round2(bal + (v.type === 'Receipt' ? v.credit : v.type === 'Payment' ? -v.debit : 0));
  }
  return { balance: bal, openingMissing: missing };
}

/**
 * Bank book of ONE bank account (WP-5): the vouchers tagged to it, opened with its own opening, or —
 * for the main account without one — the Books bank opening. Same rule as `bankAccountBalanceAt` and
 * the ledger's per-bank openings (`ledger/postings-bank.ts`).
 */
export function bankAccountBook(vouchers: readonly Voucher[], openings: OpeningBalance[], account: BankAccount, period: Period): CashBook {
  const tagged = vouchers.filter((v) => v.account === 'bank' && accountIdOf(v) === account.id);
  const own: OpeningBalance[] =
    account.opening !== undefined && account.opening_as_of ? [{ id: `own:${account.id}`, account: 'bank', amount: account.opening, as_of: account.opening_as_of }] : [];
  const ops = own.length ? own : account.id === DEFAULT_BANK_ID ? openings.filter((o) => o.account === 'bank') : [];
  return cashBook(tagged, ops, 'bank', period);
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
    if (isFinancialNote(inv)) {
      // R2-A2: a financial credit note (settlement discount / kasar / bad debt) is an indirect expense on
      // accrual; on cash basis the discounted part was never received, so it was never income either.
      if (inv.status !== 'Draft' && inv.status !== 'Cancelled' && basis === 'accrual') {
        events.push({ date, kind: 'expense', amount: invoiceAmounts(inv).income, category: FINANCIAL_REASON_LABELS[inv.financial_reason ?? 'settlement_discount'], direct: false, ref: inv.id });
      }
      continue;
    }
    if (isCreditNote(inv)) {
      events.push({
        date,
        kind: 'credit_note',
        amount: invoiceAmounts(inv).income,
        category: 'Credit notes',
        direct: false,
        ref: inv.id,
      });
    } else if (isSale(inv) && basis === 'accrual') {
      events.push({
        date,
        kind: 'sales',
        amount: invoiceAmounts(inv).income,
        category: 'Sales',
        direct: false,
        ref: inv.id,
      });
    }
  }

  // 8.106: a bad-debt write-off is an (indirect) expense on its date — accrual only; on cash basis the
  // income was never recognised, so there is nothing to write off.
  if (basis === 'accrual') {
    for (const t of data.transactions) {
      if (!t.write_off) continue;
      const date = toIsoDate(t.date);
      const amount = round2(Math.abs(inrValue(num(t.amount), invById.get(t.invoice_id))));
      if (date && amount) events.push({ date, kind: 'expense', amount, category: 'Bad debts written off', direct: false, ref: t.id });
    }
  }

  if (basis === 'cash') {
    for (const t of data.transactions) {
      if (t.write_off) continue;
      const date = toIsoDate(t.date);
      const inv = invById.get(t.invoice_id);
      const paid = round2(Math.abs(inrValue(num(t.amount), inv)));
      if (!date || paid === 0) continue;
      let amount = paid;
      if (inv) {
        if (!isSale(inv)) continue; // receipts only count against sales invoices
        const a = invoiceAmounts(inv);
        // Income is recognised in proportion to what the customer owes in cash: TDS they
        // withhold is part of the price, so a fully-paid-net-of-TDS invoice books ALL its income.
        const payable = a.total - a.tds;
        amount = payable > 0 ? round2((paid * a.income) / payable) : paid;
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
    // WP-3: purchase returns / supplier credit notes take the cost back on the note date.
    for (const r of booksReturnEffects(data.purchaseReturns)) {
      events.push({ date: r.date, kind: 'expense', amount: -r.cost, category: r.category, direct: !r.isExpense, ref: r.ref });
    }
  } else {
    const byId = new Map(purchases.map((p) => [p.id, p]));
    const paidRows = new Map<string, number>();
    for (const pp of data.purchasePayments) {
      const p = byId.get(str(pp.purchase_id));
      const date = toIsoDate(pp.date);
      // TDS deducted on the payment settles the bill as much as the cash does.
      const paid = round2(Math.abs(num(pp.amount)) + Math.max(num(pp.tds_amount), 0));
      if (!p || !date || paid === 0) continue;
      paidRows.set(p.id, round2((paidRows.get(p.id) ?? 0) + paid));
      const cost = p.payable > 0 ? round2((paid * purchaseCost(p)) / p.payable) : paid;
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
      const cost = p.payable > 0 ? round2((p.paidOnRow * purchaseCost(p)) / p.payable) : p.paidOnRow;
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
  // Payroll (7P): salary cost on the run's voucher date (accrual) or when paid (cash).
  events.push(...payrollPnlEvents(data.payrollRunRows, data.payrollPaymentRows, basis));
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
  /**
   * Additive: GST payable by us under reverse charge on purchases (reverse-charge bills and imports of
   * services — GSTR-3B 3.1(d)). Paid in cash; its ITC (if eligible) is inside `itc`. Customs IGST on
   * imported goods is paid with the Bill of Entry, not through the return, so it is not in here.
   */
  rcmPayable?: number;
  /** output + reverse-charge tax − ITC; negative means a refundable / carry-forward credit. */
  netPayable: number;
  /** Additive: cess on sales less cess on credit notes. Payable in cash — ITC cannot offset it. */
  outputCess?: number;
  /**
   * Additive (7O, 7.90): cess credit on eligible purchase bills (GSTR-3B 4A cess), reverse-charge cess
   * we pay ourselves (3.1(d) cess) and output cess + reverse-charge cess − cess credit. Cess credit
   * offsets cess only, so it is kept out of `itc` / `netPayable`. Working paper — verify with your CA.
   */
  itcCess?: number;
  rcmCess?: number;
  netCessPayable?: number;
}

/** ITC including cess credit — the figure GSTR-3B 4C / GSTR-9 Table 6 / 9C Table 12 compare with. */
export function itcWithCess(g: Pick<GstSummary, 'itc' | 'itcCess'>): number {
  return round2(g.itc + (g.itcCess ?? 0));
}

export function gstSummary(data: BooksData, period: Period): GstSummary {
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let cess = 0;
  for (const inv of data.invoices) {
    const sale = isSale(inv);
    if (!sale && !isCreditNote(inv)) continue;
    if (!inPeriod(toIsoDate(inv.issue_date), period)) continue;
    const a = invoiceAmounts(inv);
    const sign = sale ? 1 : -1;
    cess = round2(cess + sign * a.cess);
    // SINGLE-mode legacy rows only carry tax_amount; treat the remainder as IGST.
    const rest = Math.max(round2(a.tax - a.cgst - a.sgst - a.igst), 0);
    cgst = round2(cgst + sign * a.cgst);
    sgst = round2(sgst + sign * a.sgst);
    igst = round2(igst + sign * (a.igst + rest));
  }
  let itc = 0;
  let blocked = 0;
  let rcm = 0;
  let itcCess = 0;
  let rcmCess = 0;
  for (const raw of data.purchases) {
    const p = normalizePurchase(raw, data.vendors);
    if (!p || !inPeriod(p.date, period)) continue;
    itc = round2(itc + purchaseItc(p));
    itcCess = round2(itcCess + purchaseItcCess(p));
    blocked = round2(blocked + (p.itcEligible ? 0 : p.gst));
    if (p.selfTax && !isCustomsIgst(raw)) rcm = round2(rcm + p.selfTax);
    if (p.selfCess && !isCustomsIgst(raw)) rcmCess = round2(rcmCess + p.selfCess);
  }
  const outputTotal = round2(cgst + sgst + igst);
  return {
    outputCgst: cgst,
    outputSgst: sgst,
    outputIgst: igst,
    outputTotal,
    itc,
    blockedGst: blocked,
    rcmPayable: rcm,
    netPayable: round2(outputTotal + rcm - itc),
    outputCess: cess,
    itcCess,
    rcmCess,
    netCessPayable: round2(cess + rcmCess - itcCess),
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
  // GST + cess collected are owed to the government; so is TCS. None of it is income.
  let outputGst = 0;
  let tcsCollected = 0;
  for (const inv of data.invoices) {
    const date = toIsoDate(inv.issue_date);
    if (!upTo(date)) continue;
    const a = invoiceAmounts(inv);
    if (isSale(inv)) {
      salesTotal += a.total;
      outputGst += a.tax + a.cess;
      tcsCollected += a.tcs;
    } else if (isCreditNote(inv)) {
      cnTotal += a.total;
      outputGst -= a.tax + a.cess;
      tcsCollected -= a.tcs;
    }
  }
  // Every receipt is cash that is really in the bank (the cash book counts it), so it
  // must also reduce receivables — even one recorded against a document that was later
  // cancelled. That money then shows up as a customer advance instead of vanishing
  // into the balancing figure.
  let receipts = 0;
  const invById = new Map(data.invoices.map((i) => [i.id, i]));
  for (const t of data.transactions) {
    if (isAdvanceAdjustment(t) || !upTo(toIsoDate(t.date))) continue;
    receipts += Math.abs(inrValue(num(t.amount), invById.get(t.invoice_id)));
  }
  // Advances (5.3): the cash received (less refunds) is a credit to customers. GST paid on an
  // advance is left out here: the liability and the matching "GST paid on advances" asset cancel
  // (the double-entry ledger shows both).
  for (const m of advanceMovements(data.advances ?? [], data.transactions, data.invoices)) {
    if (!upTo(m.date) || m.kind === 'adjusted') continue;
    receipts += m.kind === 'received' ? m.gross : -m.gross;
  }

  const purchases = data.purchases
    .map((p) => normalizePurchase(p, data.vendors))
    .filter((p): p is NormPurchase => p !== null && upTo(p.date));
  let purchTotal = 0;
  let itc = 0;
  // GST we owe the government on reverse-charge / import bills (not the supplier).
  let selfTax = 0;
  for (const p of purchases) {
    purchTotal += p.payable;
    selfTax += p.selfTax + (p.selfCess ?? 0);
    itc += purchaseItc(p) + purchaseItcCess(p);
  }
  // WP-3: purchase returns / supplier notes reduce what we owe, the ITC and any self-assessed GST
  // (7O: and the TDS payable when the bill had TDS at booking).
  let tdsReturned = 0;
  for (const r of booksReturnEffects(data.purchaseReturns)) {
    if (!upTo(r.date)) continue;
    purchTotal -= r.payable;
    selfTax -= r.selfTax;
    itc -= r.itc;
    tdsReturned += r.tds ?? 0;
  }
  // Same rule on the payables side: cash that left the bank always reduces payables.
  let paid = 0;
  // TDS we deducted (on bills and on payments) is owed to the government, not the supplier.
  let tdsDeducted = -tdsReturned;
  for (const p of purchases) tdsDeducted += p.tds;
  for (const pp of data.purchasePayments) {
    if (!upTo(toIsoDate(pp.date))) continue;
    const tds = Math.max(num(pp.tds_amount), 0);
    paid += Math.abs(num(pp.amount)) + tds;
    tdsDeducted += tds;
  }
  for (const vp of data.vendorPayments ?? []) if (upTo(toIsoDate(vp.date))) paid += Math.abs(num(vp.amount));

  const vouchers = buildVouchers(data);
  const cash = accountBalanceAt(vouchers, data.openings, 'cash', asOf);
  const bank = accountBalanceAt(vouchers, data.openings, 'bank', asOf);

  const ar = round2(salesTotal - cnTotal - receipts);
  const ap = round2(purchTotal - paid);
  const gstNet = round2(outputGst + selfTax - itc);

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
    // GST / cess payable (net of ITC) plus TCS collected and not yet deposited.
    // TDS deducted from suppliers is added too (deposits are not tracked here; the ledger has them).
    gstPayable: round2(Math.max(gstNet, 0) + Math.max(round2(tcsCollected), 0) + round2(tdsDeducted)),
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
    advances: getTable<AdvanceRecord>(ADVANCES_TABLE),
    vendorPayments: getTable<VendorPayment>('vendor_payments'),
    purchaseReturns: getTable<PurchaseReturn>('purchase_returns'),
    payrollRunRows: getTable<unknown>('payroll_runs'),
    payrollPaymentRows: getTable<unknown>('payroll_payments'),
    manualVouchers: peekTable<ManualVoucherRow>('vouchers'),
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

export { toCsv };

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
