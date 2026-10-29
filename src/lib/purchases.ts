/**
 * Purchases & expenses — pure maths plus thin CRUD over `localStorage` tables.
 *
 * Tables: `purchases` (PurchaseRecord) and `purchase_payments` (PurchasePayment).
 * Everything above the "Storage" divider is pure and unit-tested; money goes
 * through `round2` so totals always re-sum to the paisa.
 */

import { requireAccess } from './access';
import type { PurchaseLine, PurchaseRecord } from '../types/purchases';
import type { GstMode, InvoiceItem } from '../types/invoice';
import { calculateInvoice, num, round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { assertUnlocked, type LockAction } from './period-lock';
import { releaseAttachments, releaseDropped } from './attachments';
import { supplierPayable } from './purchase-normalize';
import { assertRemovable, liveRemovalIssues } from './stock-timeline';
import { assertBillApproval } from './purchase-approval-gate';
import { applyQcHold } from './receipt-notes'; // R6-C1: QC hold on bill-only receipts

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
  /** Additive (multi-account BRS): the bank account it was paid from; missing = the main account. */
  bank_account_id?: string;
  /**
   * Additive (Tally parity): TDS deducted on this payment (bills with `tds_on: 'PAYMENT'`). `amount`
   * stays the cash paid; the bill's `amount_paid` rises by `amount + tds_amount`.
   */
  tds_amount?: number;
  /** Additive: rows of one multi-bill payment share this id (`vendor_payments.group_id` for any remainder). */
  group_id?: string;
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
    // R9 (RT-A4): the line discount typed on the bill reduces the taxable value; free units (`free_qty`) add none.
    ...(num(l.discount_percent) > 0 ? { discount_percent: Math.min(num(l.discount_percent), 100) } : {}),
    amount: round2(num(l.quantity) * num(l.rate) * (1 - Math.min(Math.max(num(l.discount_percent), 0), 100) / 100)),
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
 * What a bill form holds that the user typed (QA-3 F12): the vendor, bill no., notes and every line with a name or
 * amount. Blank lines are ignored, so an untouched "add bill" form equals its starting snapshot.
 */
export function billFormSnapshot(f: { vendorId: string; billNumber: string; lines: readonly Pick<PurchaseLine, 'name' | 'quantity' | 'rate' | 'tax_rate' | 'hsn'>[]; notes: string }): string {
  const lines = f.lines
    .filter((l) => String(l.name ?? '').trim() || Number(l.rate) > 0)
    .map((l) => [String(l.name ?? '').trim(), Number(l.quantity) || 0, Number(l.rate) || 0, Number(l.tax_rate) || 0, String(l.hsn ?? '').trim()]);
  return JSON.stringify([f.vendorId || '', f.billNumber.trim(), f.notes.trim(), lines]);
}

/** Label key for the quick-expense amount (QA-3 F11): it says whether the typed amount includes GST. */
export function expenseAmountLabel(taxRate: number, inclusive: boolean): 'amountRs' | 'amountInclGst' | 'amountExGst' {
  if (!(taxRate > 0)) return 'amountRs';
  return inclusive ? 'amountInclGst' : 'amountExGst';
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

// ── Pure: billable costs (6.14) ──────────────────────────────────

export type BillableValue = Pick<PurchaseRecord, 'billable_to_client_id' | 'markup_percent' | 'pure_agent'>;

/** Persisted billable fields from a form value: all cleared when not billable; no markup on a pure-agent cost. */
export function billablePatch(v: BillableValue): BillableValue {
  if (!v.billable_to_client_id) return { billable_to_client_id: undefined, markup_percent: undefined, pure_agent: undefined };
  return {
    billable_to_client_id: v.billable_to_client_id,
    markup_percent: !v.pure_agent && num(v.markup_percent) > 0 ? num(v.markup_percent) : undefined,
    pure_agent: v.pure_agent || undefined,
  };
}

// ── Pure: status & aggregates ────────────────────────────────────

/**
 * Still owed to the supplier. Reverse-charge and import bills store `total` = taxable + the GST we
 * pay to the government ourselves; that tax is never the supplier's (`supplierPayable`).
 */
export function balanceOf(p: Pick<PurchaseRecord, 'total' | 'amount_paid'> & Partial<PurchaseRecord>): number {
  return Math.max(round2(supplierPayable(p) - num(p.amount_paid)), 0);
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
  /** Additive (7O, 7.90): compensation cess credit on eligible bills (`cess_amount`) — offsets output cess only. */
  cess: number;
  /** CGST + SGST + IGST + cess credit (what GSTR-3B 4A / 4C add up). */
  total: number;
  /** GST (and cess) paid on bills not claimed as ITC. */
  ineligible: number;
}

/** Input tax credit from bills (optionally only one yyyy-mm month). */
export function itcTotals(purchases: PurchaseRecord[], month?: string): ItcTotals {
  const out: ItcTotals = { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0, ineligible: 0 };
  for (const p of purchases) {
    if (month && monthKey(p.date) !== month) continue;
    if (p.itc_eligible) {
      out.cgst = round2(out.cgst + num(p.cgst));
      out.sgst = round2(out.sgst + num(p.sgst));
      out.igst = round2(out.igst + num(p.igst));
      out.cess = round2(out.cess + Math.max(num(p.cess_amount), 0));
    } else {
      out.ineligible = round2(out.ineligible + sumTax(p) + Math.max(num(p.cess_amount), 0));
    }
  }
  out.total = round2(out.cgst + out.sgst + out.igst + out.cess);
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

/** Validate a payment (plus any TDS deducted on it) against a bill; returns an error message or ''. */
export function validatePayment(purchase: PurchaseRecord, amount: number, date: string, tds = 0): string {
  if (!(amount > 0)) return 'Enter an amount greater than zero.';
  if (!date) return 'Choose the payment date.';
  if (!(tds >= 0)) return 'TDS cannot be negative.';
  if (round2(amount + tds) > balanceOf(purchase) + 0.004) {
    return `Amount exceeds the balance of ${balanceOf(purchase).toFixed(2)}.`;
  }
  return '';
}

// ── Storage ──────────────────────────────────────────────────────

const now = () => new Date().toISOString();

/**
 * Period lock for bills: a bill dated inside the locked period (a filed GST month)
 * cannot be created, edited or deleted, because that would change ITC already
 * claimed. Throws `PeriodLockedError`.
 */
function assertBillUnlocked(bill: Pick<PurchaseRecord, 'id' | 'date' | 'bill_number'>, action: LockAction) {
  assertUnlocked({ id: bill.id, issue_date: bill.date, invoice_number: bill.bill_number || undefined }, action);
}

/** Supplier payments are locked by their own date (paying an old bill in an open month is fine). */
function assertPaymentUnlocked(date: string, action: LockAction) {
  assertUnlocked({ issue_date: date }, action);
}

/** Write a bill without the lock check (payment roll-ups only touch `amount_paid`). */
function writeBill(input: Omit<PurchaseRecord, 'id'> & { id?: string }): PurchaseRecord {
  const rows = purchasesDb.all();
  const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
  const record: PurchaseRecord = {
    ...existing,
    ...input,
    id: existing?.id ?? input.id ?? generateId(),
    // QA10 R15: a bill settled in full by a journal (a financier's withheld fee) is never shown as due.
    amount_paid: input.settled_by_voucher ? Math.max(round2(num(input.amount_paid)), supplierPayable(input)) : round2(num(input.amount_paid)),
    created_at: existing?.created_at ?? now(),
    updated_at: now(),
  };
  setTable(PURCHASES_TABLE, existing ? rows.map((r) => (r.id === record.id ? record : r)) : [...rows, record]);
  // Receipts this bill no longer lists (6.12) are deleted unless another record uses them.
  if (existing) releaseDropped(existing.attachments, record.attachments);
  return record;
}

/**
 * R6-C1: a goods bill booked without a GRN receives its stock itself, so its new stock lines follow the GRN rule
 * (`applyQcHold`: a `qc_on_receipt` item with no godown goes to the QC hold godown). Lines that bill a GRN line
 * (goods came in on the GRN) and lines already on the bill before this edit are left alone, so an edit never moves
 * goods that were held or released.
 */
export function withBillQcHold<B extends { kind?: string; lines?: PurchaseLine[] }>(bill: B, existing?: { lines?: PurchaseLine[] }): B {
  if (bill.kind === 'EXPENSE' || !bill.lines?.length) return bill;
  const before = new Set((existing?.lines ?? []).map((l) => l.id).filter(Boolean));
  const fresh = bill.lines.filter((l) => !l.grn_line_id && !before.has(l.id));
  if (!fresh.length) return bill;
  const held = new Map(applyQcHold(fresh).map((l, i) => [fresh[i], l]));
  return { ...bill, lines: bill.lines.map((l) => held.get(l) ?? l) };
}

/* ── R6-C1: QC reject → pre-filled debit note ───────────────────── */

/** `/expenses?tab=returns&new=dn&bill=<id>&lines=<lineId>:<qty>,…` — a debit note on the bill with the rejected lines. */
export function debitNotePrefillHref(billId: string, lines: readonly { id: string; quantity: number }[]): string {
  const spec = lines.filter((l) => l.id && num(l.quantity) > 0).map((l) => `${l.id}:${round2(num(l.quantity))}`).join(',');
  return `/expenses?tab=returns&new=dn&bill=${encodeURIComponent(billId)}${spec ? `&lines=${encodeURIComponent(spec)}` : ''}`;
}

/** Reads `bill` / `lines` back (unknown or malformed parts are dropped; quantities must be positive). */
export function parseDebitNotePrefill(params: { get(name: string): string | null }): { billId?: string; qty: Record<string, number> } {
  const billId = (params.get('bill') ?? '').trim() || undefined;
  const qty: Record<string, number> = {};
  for (const part of (params.get('lines') ?? '').split(',')) {
    const at = part.lastIndexOf(':');
    if (at <= 0) continue;
    const id = part.slice(0, at).trim();
    const q = Number(part.slice(at + 1));
    if (id && Number.isFinite(q) && q > 0) qty[id] = round2(q);
  }
  return { billId, qty };
}

/**
 * PENDING 38: an edited bill may not fall below what goods notes already returned against it — every returned bill
 * line must still exist with at least the returned units (paid + free). Returns an error message or ''.
 */
export function returnedQtyIssue(bill: { id?: string; lines?: readonly PurchaseLine[] }, notes: readonly { purchase_id?: string; bill_refs?: readonly { purchase_id: string }[]; goods_returned?: boolean; lines?: readonly { bill_line_id?: string; quantity?: number }[] }[]): string {
  if (!bill.id) return '';
  const back = new Map<string, number>();
  for (const n of notes) {
    // 8.88: a note spanning several bills names each bill on its lines (bill line ids are unique).
    if (!n || (n.purchase_id !== bill.id && !n.bill_refs?.some((b) => b.purchase_id === bill.id)) || !n.goods_returned) continue;
    for (const l of n.lines ?? []) if (l?.bill_line_id) back.set(l.bill_line_id, round2((back.get(l.bill_line_id) ?? 0) + Math.max(num(l.quantity), 0)));
  }
  for (const [lineId, qty] of back) {
    if (qty <= 0) continue;
    const line = (bill.lines ?? []).find((l) => l.id === lineId);
    const has = line ? round2(num(line.quantity) + Math.max(num(line.free_qty), 0)) : 0;
    if (has + 1e-6 < qty) return `${line?.name || 'A returned line'}: ${qty} already returned on a debit note, so the bill cannot show ${has}. Delete the note first.`;
  }
  return '';
}

export const purchasesDb = {
  all: (): PurchaseRecord[] => getTable<PurchaseRecord>(PURCHASES_TABLE),
  get: (id: string): PurchaseRecord | undefined => purchasesDb.all().find((p) => p.id === id),

  /** Insert or update (matched by id). Totals must already be computed. Respects the period lock. */
  save(input: Omit<PurchaseRecord, 'id'> & { id?: string }): PurchaseRecord {
    requireAccess('books.edit');
    const existing = input.id ? purchasesDb.get(input.id) : undefined;
    if (existing) assertBillUnlocked(existing, 'edit');
    assertBillUnlocked({ id: input.id ?? '', date: input.date, bill_number: input.bill_number }, existing ? 'edit' : 'create');
    if (existing) {
      const issue = returnedQtyIssue({ ...input, id: existing.id }, getTable('purchase_returns'));
      if (issue) throw new Error(issue);
    }
    assertBillApproval(input, existing); // 8.44: a clerk's bill above the threshold waits in purchase_drafts
    // A posted draft (8C) never carries its draft envelope into the books.
    const { draft: _draft, ...rest } = input as typeof input & { draft?: unknown };
    void _draft;
    const bill = { ...rest };
    if ((bill as { status?: unknown }).status === 'draft') delete bill.status; // other legacy statuses (cancelled) are kept
    return writeBill(withBillQcHold(bill, existing));
  },

  /**
   * Stamp (or clear) the invoice a billable cost was re-billed on. Only this link field changes —
   * no amount or ITC figure — so, like a payment roll-up, it is allowed inside a locked period.
   */
  setRebilled(ids: readonly string[], invoiceId: string | undefined): void {
    const wanted = new Set(ids);
    if (!wanted.size) return;
    setTable(
      PURCHASES_TABLE,
      purchasesDb.all().map((p) => (wanted.has(p.id) ? { ...p, rebilled_in: invoiceId } : p)),
    );
  },

  /**
   * Remove a bill together with its payment history. Refused when a later document sold / moved serials
   * it brought in; when later documents used its quantities, `confirmStock` must be set
   * (`StockDependencyError`, stock-timeline.ts).
   */
  remove(id: string, opts: { confirmStock?: boolean } = {}): void {
    requireAccess('books.edit');
    const bill = purchasesDb.get(id);
    if (bill) assertBillUnlocked(bill, 'delete');
    // WP-3: a debit note / supplier credit note is adjusted against this bill — delete the note first.
    if (getTable<{ purchase_id?: string; bill_refs?: { purchase_id: string }[] }>('purchase_returns').some((n) => n?.purchase_id === id || !!n?.bill_refs?.some((b) => b.purchase_id === id))) throw new Error('A debit note or supplier credit note is recorded against this bill. Delete the note first.');
    // QA11 C5: a measured sub-contractor bill goes with its measurement (and deductions journal), from its own screen.
    if (getTable<{ purchase_id?: string; status?: string }>('sub_measurements').some((m) => m?.purchase_id === id && m.status !== 'cancelled')) throw new Error('This sub-contractor bill was made from a measurement. Cancel it in Time → Works → Sub-contracts (its deductions journal goes with it).');
    if (bill) assertRemovable(liveRemovalIssues({ refType: 'purchase', refId: id }), opts.confirmStock);
    setTable(PURCHASES_TABLE, purchasesDb.all().filter((p) => p.id !== id));
    setTable(PAYMENTS_TABLE, paymentsDb.all().filter((p) => p.purchase_id !== id));
    if (bill?.attachments?.length) releaseAttachments(bill.attachments.map((a) => a.id));
  },
};

export const paymentsDb = {
  all: (): PurchasePayment[] => getTable<PurchasePayment>(PAYMENTS_TABLE),
  forPurchase: (id: string): PurchasePayment[] =>
    paymentsDb.all().filter((p) => p.purchase_id === id).sort((a, b) => a.date.localeCompare(b.date)),

  /** Append a payment and roll it into the bill's `amount_paid`. Throws on invalid input. */
  record(
    purchaseId: string,
    p: { amount: number; date: string; method: string; reference?: string; bankAccountId?: string; tdsAmount?: number; groupId?: string },
  ): PurchasePayment {
    requireAccess('books.edit');
    const bill = purchasesDb.get(purchaseId);
    if (!bill) throw new Error('Bill not found.');
    const amount = round2(num(p.amount));
    const tds = round2(Math.max(num(p.tdsAmount), 0));
    const problem = validatePayment(bill, amount, p.date, tds);
    if (problem) throw new Error(problem);
    assertPaymentUnlocked(p.date, 'pay');
    const payment: PurchasePayment = {
      id: generateId(), purchase_id: purchaseId, amount, date: p.date,
      method: p.method, reference: p.reference?.trim() || undefined, created_at: now(),
      bank_account_id: p.bankAccountId && p.method.toLowerCase() !== 'cash' ? p.bankAccountId : undefined,
      ...(tds > 0 ? { tds_amount: tds } : {}),
      ...(p.groupId ? { group_id: p.groupId } : {}),
    };
    setTable(PAYMENTS_TABLE, [...paymentsDb.all(), payment]);
    writeBill({ ...bill, amount_paid: round2(num(bill.amount_paid) + amount + tds) });
    return payment;
  },

  remove(paymentId: string): void {
    const all = paymentsDb.all();
    const target = all.find((p) => p.id === paymentId);
    if (!target) return;
    requireAccess('books.edit');
    assertPaymentUnlocked(target.date, 'unpay');
    setTable(PAYMENTS_TABLE, all.filter((p) => p.id !== paymentId));
    const bill = purchasesDb.get(target.purchase_id);
    if (bill) writeBill({ ...bill, amount_paid: Math.max(round2(num(bill.amount_paid) - target.amount - Math.max(num(target.tds_amount), 0)), 0) });
  },
};
