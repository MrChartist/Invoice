/**
 * Purchases & expenses — pure maths plus thin CRUD over `localStorage` tables.
 *
 * Tables: `purchases` (PurchaseRecord) and `purchase_payments` (PurchasePayment).
 * Everything above the "Storage" divider is pure and unit-tested; money goes
 * through `round2` so totals always re-sum to the paisa.
 */

import type { PurchaseLine, PurchaseRecord } from '../types/purchases';
import type { GstMode, InvoiceItem } from '../types/invoice';
import { calculateInvoice, num, round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';

export const PURCHASES_TABLE = 'purchases';
export const PAYMENTS_TABLE = 'purchase_payments';

export const PAYMENT_METHODS = ['UPI', 'Bank transfer', 'Cash', 'Cheque', 'Card', 'Other'] as const;

export interface PurchasePayment {
  id: string;
  purchase_id: string;
  amount: number;
  /** yyyy-mm-dd */
  date: string;
  method: string;
  reference?: string;
  created_at?: string;
}

export type PurchaseStatus = 'Unpaid' | 'Partially paid' | 'Paid' | 'Overdue';
export const PURCHASE_STATUSES: PurchaseStatus[] = ['Unpaid', 'Partially paid', 'Overdue', 'Paid'];

// ── Pure: totals ─────────────────────────────────────────────────

export interface PurchaseTotals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
}

/** CGST+SGST when the supply is inside the business's state, IGST otherwise. */
export function gstModeFor(placeOfSupply?: string, businessState?: string, gstApplies = true): GstMode {
  if (!gstApplies) return 'NONE';
  const from = (businessState ?? '').trim();
  const to = (placeOfSupply ?? '').trim();
  if (!from || !to) return 'CGST_SGST';
  return from === to ? 'CGST_SGST' : 'IGST';
}

function toItem(l: PurchaseLine): InvoiceItem {
  return {
    id: l.id,
    name: l.name,
    type: 'item',
    hsn: l.hsn,
    unit: l.unit,
    quantity: num(l.quantity),
    rate: num(l.rate),
    tax_rate: num(l.tax_rate),
    amount: round2(num(l.quantity) * num(l.rate)),
  };
}

export function computePurchaseTotals(
  lines: PurchaseLine[],
  opts: { placeOfSupply?: string; businessState?: string; gstApplies?: boolean } = {},
): PurchaseTotals {
  const mode = gstModeFor(opts.placeOfSupply, opts.businessState, opts.gstApplies ?? true);
  const calc = calculateInvoice({
    items: lines.map(toItem),
    gst_mode: mode,
    discount_type: 'AMOUNT',
    discount_rate: 0,
    tax_rate: 0,
    shipping: 0,
    other_charges: 0,
    round_off_enabled: false,
    amount_paid: 0,
  });
  return {
    taxable: calc.taxable_value,
    cgst: calc.cgst_amount,
    sgst: calc.sgst_amount,
    igst: calc.igst_amount,
    tax: calc.tax_amount,
    total: calc.total,
  };
}

/**
 * Quick expense: the user types what they paid. When `amountIncludesTax` the
 * amount is the gross figure and tax is backed out of it.
 */
export function expenseLine(
  category: string,
  amount: number,
  taxRate: number,
  amountIncludesTax: boolean,
): PurchaseLine {
  const gross = Math.max(num(amount), 0);
  const rate = Math.max(num(taxRate), 0);
  const base = amountIncludesTax ? gross / (1 + rate / 100) : gross;
  return { id: generateId(), name: category || 'Expense', quantity: 1, rate: round2(base), tax_rate: rate };
}

export const blankPurchaseLine = (taxRate = 18): PurchaseLine => ({
  id: generateId(),
  name: '',
  hsn: '',
  quantity: 1,
  rate: 0,
  tax_rate: taxRate,
});

// ── Pure: status & aggregates ────────────────────────────────────

export function balanceOf(p: Pick<PurchaseRecord, 'total' | 'amount_paid'>): number {
  return Math.max(round2(num(p.total) - num(p.amount_paid)), 0);
}

export function deriveStatus(p: PurchaseRecord, today: string): PurchaseStatus {
  const balance = balanceOf(p);
  if (balance <= 0.004) return 'Paid';
  if (p.due_date && p.due_date < today) return 'Overdue';
  return num(p.amount_paid) > 0 ? 'Partially paid' : 'Unpaid';
}

export function monthKey(date: string): string {
  return (date ?? '').slice(0, 7);
}

export const sumTax = (p: Pick<PurchaseRecord, 'cgst' | 'sgst' | 'igst'>): number =>
  round2(num(p.cgst) + num(p.sgst) + num(p.igst));

/** Total still owed to suppliers across all bills. */
export function payablesOutstanding(purchases: PurchaseRecord[]): number {
  return round2(purchases.reduce((s, p) => s + balanceOf(p), 0));
}

/** Sum of payments dated inside the given yyyy-mm month. */
export function paidInMonth(payments: PurchasePayment[], month: string): number {
  return round2(payments.filter((p) => monthKey(p.date) === month).reduce((s, p) => s + num(p.amount), 0));
}

export interface ItcTotals {
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  /** GST paid on bills not claimed as ITC. */
  ineligible: number;
}

/** Input tax credit from bills (optionally only one yyyy-mm month). */
export function itcTotals(purchases: PurchaseRecord[], month?: string): ItcTotals {
  const out: ItcTotals = { cgst: 0, sgst: 0, igst: 0, total: 0, ineligible: 0 };
  for (const p of purchases) {
    if (month && monthKey(p.date) !== month) continue;
    if (p.itc_eligible) {
      out.cgst = round2(out.cgst + num(p.cgst));
      out.sgst = round2(out.sgst + num(p.sgst));
      out.igst = round2(out.igst + num(p.igst));
    } else {
      out.ineligible = round2(out.ineligible + sumTax(p));
    }
  }
  out.total = round2(out.cgst + out.sgst + out.igst);
  return out;
}

export interface CategoryRow {
  category: string;
  /** Taxable value (the real cost when GST is claimed back). */
  taxable: number;
  total: number;
  count: number;
}

export function categorySummary(purchases: PurchaseRecord[]): CategoryRow[] {
  const map = new Map<string, CategoryRow>();
  for (const p of purchases) {
    const key = p.category || 'Other';
    const row = map.get(key) ?? { category: key, taxable: 0, total: 0, count: 0 };
    row.taxable = round2(row.taxable + num(p.taxable));
    row.total = round2(row.total + num(p.total));
    row.count += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}

export interface MonthBucket {
  month: string;
  count: number;
  taxable: number;
  tax: number;
  total: number;
}

export function monthBuckets(purchases: PurchaseRecord[]): MonthBucket[] {
  const map = new Map<string, MonthBucket>();
  for (const p of purchases) {
    const key = monthKey(p.date);
    if (!key) continue;
    const row = map.get(key) ?? { month: key, count: 0, taxable: 0, tax: 0, total: 0 };
    row.count += 1;
    row.taxable = round2(row.taxable + num(p.taxable));
    row.tax = round2(row.tax + sumTax(p));
    row.total = round2(row.total + num(p.total));
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface PurchaseFilter {
  kind?: 'ALL' | 'PURCHASE' | 'EXPENSE';
  status?: PurchaseStatus | 'ALL';
  category?: string;
  from?: string;
  to?: string;
  query?: string;
  vendorId?: string;
}

export function filterPurchases(rows: PurchaseRecord[], f: PurchaseFilter, today: string): PurchaseRecord[] {
  const q = (f.query ?? '').trim().toLowerCase();
  return rows
    .filter((p) => !f.kind || f.kind === 'ALL' || p.kind === f.kind)
    .filter((p) => !f.status || f.status === 'ALL' || deriveStatus(p, today) === f.status)
    .filter((p) => !f.category || f.category === 'ALL' || p.category === f.category)
    .filter((p) => !f.from || p.date >= f.from)
    .filter((p) => !f.to || p.date <= f.to)
    .filter((p) => !f.vendorId || p.vendor_id === f.vendorId)
    .filter(
      (p) =>
        !q ||
        [p.vendor_name, p.bill_number, p.vendor_gstin, p.category, p.notes].some((v) =>
          (v ?? '').toLowerCase().includes(q),
        ),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
}

/** CSV rows (header first) for the given purchases. */
export function purchasesToCsvRows(rows: PurchaseRecord[], today: string): (string | number)[][] {
  const header = ['Date', 'Type', 'Bill no', 'Vendor', 'GSTIN', 'Category', 'Taxable', 'CGST', 'SGST', 'IGST', 'ITC', 'Total', 'Paid', 'Balance', 'Due date', 'Status'];
  return [
    header,
    ...rows.map((p) => [
      p.date, p.kind === 'EXPENSE' ? 'Expense' : 'Purchase', p.bill_number, p.vendor_name,
      p.vendor_gstin ?? '', p.category, p.taxable, p.cgst, p.sgst, p.igst,
      p.itc_eligible ? 'Eligible' : 'Not claimed', p.total, p.amount_paid, balanceOf(p),
      p.due_date ?? '', deriveStatus(p, today),
    ]),
  ];
}

/** Validate a payment against a bill; returns an error message or ''. */
export function validatePayment(purchase: PurchaseRecord, amount: number, date: string): string {
  if (!(amount > 0)) return 'Enter an amount greater than zero.';
  if (!date) return 'Choose the payment date.';
  if (round2(amount) > balanceOf(purchase) + 0.004) {
    return `Amount exceeds the balance of ${balanceOf(purchase).toFixed(2)}.`;
  }
  return '';
}

// ── Storage ──────────────────────────────────────────────────────

const now = () => new Date().toISOString();

export const purchasesDb = {
  all: (): PurchaseRecord[] => getTable<PurchaseRecord>(PURCHASES_TABLE),
  get: (id: string): PurchaseRecord | undefined => purchasesDb.all().find((p) => p.id === id),

  /** Insert or update (matched by id). Totals must already be computed. */
  save(input: Omit<PurchaseRecord, 'id'> & { id?: string }): PurchaseRecord {
    const rows = purchasesDb.all();
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    const record: PurchaseRecord = {
      ...existing,
      ...input,
      id: existing?.id ?? input.id ?? generateId(),
      amount_paid: round2(num(input.amount_paid)),
      created_at: existing?.created_at ?? now(),
      updated_at: now(),
    };
    setTable(PURCHASES_TABLE, existing ? rows.map((r) => (r.id === record.id ? record : r)) : [...rows, record]);
    return record;
  },

  /** Remove a bill together with its payment history. */
  remove(id: string): void {
    setTable(PURCHASES_TABLE, purchasesDb.all().filter((p) => p.id !== id));
    setTable(PAYMENTS_TABLE, paymentsDb.all().filter((p) => p.purchase_id !== id));
  },
};

export const paymentsDb = {
  all: (): PurchasePayment[] => getTable<PurchasePayment>(PAYMENTS_TABLE),
  forPurchase: (id: string): PurchasePayment[] =>
    paymentsDb.all().filter((p) => p.purchase_id === id).sort((a, b) => a.date.localeCompare(b.date)),

  /** Append a payment and roll it into the bill's `amount_paid`. Throws on invalid input. */
  record(purchaseId: string, p: { amount: number; date: string; method: string; reference?: string }): PurchasePayment {
    const bill = purchasesDb.get(purchaseId);
    if (!bill) throw new Error('Bill not found.');
    const amount = round2(num(p.amount));
    const problem = validatePayment(bill, amount, p.date);
    if (problem) throw new Error(problem);
    const payment: PurchasePayment = {
      id: generateId(), purchase_id: purchaseId, amount, date: p.date,
      method: p.method, reference: p.reference?.trim() || undefined, created_at: now(),
    };
    setTable(PAYMENTS_TABLE, [...paymentsDb.all(), payment]);
    purchasesDb.save({ ...bill, amount_paid: round2(num(bill.amount_paid) + amount) });
    return payment;
  },

  remove(paymentId: string): void {
    const all = paymentsDb.all();
    const target = all.find((p) => p.id === paymentId);
    if (!target) return;
    setTable(PAYMENTS_TABLE, all.filter((p) => p.id !== paymentId));
    const bill = purchasesDb.get(target.purchase_id);
    if (bill) purchasesDb.save({ ...bill, amount_paid: Math.max(round2(num(bill.amount_paid) - target.amount), 0) });
  },
};
