/**
 * Settlement discount and short payment on a receipt (Round 2, R2-A2 — BUSY / Marg "kasar / vatav",
 * Odoo early-payment discount, Refrens EarlyPay).
 *
 * When a customer pays less than the due, the rest can be settled in the same step as a FINANCIAL credit
 * note (`note_kind: 'financial'`, series `FCN/FY25-26/0001`, `src/lib/financial-note.ts`): no GST by
 * default, linked to the bill through `doc_links` (relation `credit_note`), so `amountDue` closes the bill
 * with no change to the receivables maths. Ledger: Dr Discount allowed (or the configured short-payment
 * account) / Cr party. The optional GST variant (company setting, settlement discounts only) carries GST
 * pro rata from the invoice and is reported in GSTR-1 CDNR / CDNUR like any discount credit note —
 * "use only when the discount was agreed before or at the time of supply and the buyer reverses ITC
 * (Sec 15(3)) — verify with your CA".
 *
 * A clerk may settle up to the company cap (default ₹100 or 2% of the bill, whichever is lower); above it
 * the note is saved as a draft waiting for the owner in the existing approval queue (`approvals.ts`).
 *
 * Pure builders first (tested in Node), then the storage-backed calls (all-or-nothing, period lock,
 * series counter, roles).
 */
import type { FinancialReason, InvoiceItem, InvoiceRecord, Payment } from '../types/invoice';
import { allocateProportionally, calcInputFromRecord, calculateInvoice, num, round2 } from './invoice-calc';
import { DB_PREFIX, generateId, getJson, getTable, peekTable, setJson, setTable } from './storage';
import { can, currentActor, requireAccess } from './access';
import { amountDue, linkedCredits, type CreditLinkRow } from './amount-due';
import { localDb, resettleCreditedInvoices } from './localDb';
import { assertUnlocked } from './period-lock';
import { nextSeriesNumberFor, recordSeries } from './series-counters';
import { withTablesRollback } from './table-txn';
import { localDayOf } from './dates';
import { FCN_PREFIX, FINANCIAL_ACCOUNT_DEFAULTS, FINANCIAL_REASON_LABELS, isFinancialNote } from './financial-note';
import { rupeeValue } from './approval-gate';
import { audit } from './audit';

export const COLLECTION_SETTINGS_KEY = `${DB_PREFIX}collection_settings`;

/** Company setting `collection_settings` (object key, backed up and synced). */
export interface CollectionSettings {
  /** Offer the GST variant (Sec 15(3)) for settlement discounts. Off by default. */
  gst_variant: boolean;
  /** Clerk cap: the lower of this rupee amount and `clerk_cap_pct` % of the bill. */
  clerk_cap_abs: number;
  clerk_cap_pct: number;
  /** Ledger account a short payment (kasar) is debited to (e.g. `discount_allowed`, `round_off`). */
  short_pay_account: string;
}

export const DEFAULT_COLLECTION_SETTINGS: CollectionSettings = {
  gst_variant: false,
  clerk_cap_abs: 100,
  clerk_cap_pct: 2,
  short_pay_account: 'discount_allowed',
};

/** Accounts a short payment may go to (ids in `ledger/accounts.ts`). */
export const SHORT_PAY_ACCOUNTS = ['discount_allowed', 'round_off', 'other_exp'] as const;

export function normalizeCollectionSettings(raw: unknown): CollectionSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  const acc = typeof o.short_pay_account === 'string' && o.short_pay_account.trim() ? o.short_pay_account.trim() : DEFAULT_COLLECTION_SETTINGS.short_pay_account;
  return {
    gst_variant: o.gst_variant === true,
    clerk_cap_abs: n(o.clerk_cap_abs, DEFAULT_COLLECTION_SETTINGS.clerk_cap_abs),
    clerk_cap_pct: Math.min(n(o.clerk_cap_pct, DEFAULT_COLLECTION_SETTINGS.clerk_cap_pct), 100),
    short_pay_account: acc,
  };
}

export function loadCollectionSettings(): CollectionSettings {
  return normalizeCollectionSettings(getJson<unknown>(COLLECTION_SETTINGS_KEY, null));
}

export function saveCollectionSettings(next: CollectionSettings): CollectionSettings {
  requireAccess('settings.manage');
  const clean = normalizeCollectionSettings(next);
  setJson(COLLECTION_SETTINGS_KEY, clean);
  try {
    audit.record({ entity: 'settings', entity_id: 'collection_settings', action: 'update', summary: `Collection settings changed: GST variant ${clean.gst_variant ? 'on' : 'off'}, clerk cap ₹${clean.clerk_cap_abs} / ${clean.clerk_cap_pct}%, short payments to ${clean.short_pay_account}` });
  } catch {
    /* logging never blocks */
  }
  return clean;
}

/* ── Pure helpers ──────────────────────────────────────────────── */

export type SettleChoice = 'leave' | 'settlement_discount' | 'short_payment';

export interface SettlementOptions {
  /** What would stay open after this receipt. */
  rest: number;
  /** The invoice's early-payment offer, when the receipt date is on or before its `until` date. */
  early?: { amount: number; until: string; percent: number };
  /** Suggested choice ('leave' unless the early offer applies). */
  suggested: SettleChoice;
}

/** What "Settle the rest" offers for a receipt of `amount` on `date` against `due`. */
export function settlementOptions(invoice: Pick<InvoiceRecord, 'payment_terms'>, due: number, amount: number, date: string): SettlementOptions {
  const rest = round2(Math.max(num(due) - num(amount), 0));
  const offer = invoice.payment_terms?.early_discount;
  if (rest > 0.004 && offer && offer.until && date && date <= offer.until) {
    return { rest, early: { amount: round2(Math.min(offer.amount, rest)), until: offer.until, percent: offer.percent }, suggested: 'settlement_discount' };
  }
  return { rest, suggested: 'leave' };
}

/** `amount` in the bill's currency, in rupees (the bill's exchange rate; INR or no rate = as is). */
export function rupeeAmount(invoice: Pick<InvoiceRecord, 'currency' | 'exchange_rate'>, amount: number): number {
  return round2(rupeeValue({ total: amount, currency: invoice.currency, exchange_rate: invoice.exchange_rate }));
}

/** The clerk's cap for a bill: the lower of the rupee cap and the percent of the bill. */
export function clerkCap(billTotal: number, s: CollectionSettings): number {
  return round2(Math.min(s.clerk_cap_abs, (Math.abs(num(billTotal)) * s.clerk_cap_pct) / 100));
}

export interface FinancialNoteInput {
  amount: number;
  reason: FinancialReason;
  /** Local day (YYYY-MM-DD). */
  date: string;
  /** GST variant (settlement discount only). */
  gst?: boolean;
  /** Ledger account snapshot; absent = the reason's default. */
  account?: string;
  note?: string;
}

/**
 * Pure: the financial credit-note record for `invoice` (no persistence). Without GST it is one line at
 * 0% (`gst_mode: 'NONE'`, nothing reported); the GST variant splits the amount over the invoice's tax
 * rates in proportion to their line totals and backs the GST out (`price_includes_tax`), so the note's
 * total is exactly the settled amount.
 */
export function buildFinancialNote(invoice: InvoiceRecord, input: FinancialNoteInput, ctx: { id: string; number: string }): InvoiceRecord {
  const amount = round2(num(input.amount));
  const gst = !!input.gst && input.reason === 'settlement_discount' && invoice.gst_mode !== 'NONE' && Number(invoice.tax_amount) > 0;
  const label = FINANCIAL_REASON_LABELS[input.reason];
  let items: InvoiceItem[];
  if (gst) {
    const calc = calculateInvoice(calcInputFromRecord(invoice));
    const byRate = new Map<number, { total: number; hsn: string }>();
    for (const l of calc.lines) {
      const r = byRate.get(l.tax_rate) ?? { total: 0, hsn: l.hsn };
      r.total = round2(r.total + Math.max(l.total, 0));
      byRate.set(l.tax_rate, r);
    }
    const rates = [...byRate.entries()].filter(([, r]) => r.total > 0);
    const shares = allocateProportionally(rates.map(([, r]) => r.total), amount);
    items = rates.map(([rate, r], i) => ({
      id: generateId(), name: `${label} against ${invoice.invoice_number} (${rate}% GST)`, type: 'service', hsn: r.hsn, unit: 'NOS',
      quantity: 1, rate: shares[i], tax_rate: rate, amount: shares[i],
    }));
  } else {
    items = [{ id: generateId(), name: `${label} against ${invoice.invoice_number}`, type: 'service', hsn: '', unit: 'NOS', quantity: 1, rate: amount, tax_rate: 0, amount }];
  }
  const base: InvoiceRecord = {
    id: ctx.id,
    invoice_number: ctx.number,
    doc_type: 'CREDIT_NOTE',
    issue_date: input.date,
    due_date: input.date,
    status: 'Sent',
    currency: invoice.currency || 'INR',
    ...(invoice.exchange_rate ? { exchange_rate: invoice.exchange_rate } : {}),
    template_id: invoice.template_id,
    client: { ...invoice.client },
    sender: invoice.sender ? { ...invoice.sender } : null,
    items,
    gst_mode: gst ? invoice.gst_mode : 'NONE',
    place_of_supply: invoice.place_of_supply,
    reverse_charge: false,
    ...(gst && invoice.supply_type ? { supply_type: invoice.supply_type } : {}),
    price_includes_tax: gst,
    discount_type: 'AMOUNT',
    discount_rate: 0,
    tax_rate: 0,
    shipping: 0,
    other_charges: 0,
    round_off_enabled: false,
    round_mode: 'none',
    amount_paid: 0,
    notes: `${label} against ${invoice.invoice_number} dated ${invoice.issue_date}.${input.note?.trim() ? ` ${input.note.trim()}` : ''}${gst ? '' : ' Financial credit note: no GST is adjusted.'}`,
    terms: '',
    po_number: invoice.invoice_number,
    ...(invoice.branch_id ? { branch_id: invoice.branch_id } : {}),
    ...(invoice.cost_centre_id ? { cost_centre_id: invoice.cost_centre_id } : {}),
    note_kind: 'financial',
    financial_reason: input.reason,
    financial_account: input.account || FINANCIAL_ACCOUNT_DEFAULTS[input.reason],
    subtotal: 0, discount_amount: 0, taxable_value: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0,
    tax_amount: 0, round_off: 0, total: 0, balance_due: 0,
  };
  const t = calculateInvoice(calcInputFromRecord(base));
  return {
    ...base,
    subtotal: t.subtotal,
    discount_amount: t.discount_amount,
    taxable_value: t.taxable_value,
    cgst_amount: t.cgst_amount,
    sgst_amount: t.sgst_amount,
    igst_amount: t.igst_amount,
    tax_amount: t.tax_amount,
    cess_amount: t.cess_amount,
    round_off: t.round_off,
    total: t.total,
    // A credit note is not receivable; it reduces the bill's due.
    balance_due: 0,
  };
}

/* ── Storage-backed ────────────────────────────────────────────── */

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementError';
  }
}

const SETTLEABLE = new Set(['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY']);

/** Live credit notes already linked to the bill. */
function creditedOn(invoiceId: string): number {
  const links = peekTable<CreditLinkRow>('doc_links').filter((l) => l.from_id === invoiceId);
  return linkedCredits(links, peekTable<InvoiceRecord>('invoices')).get(invoiceId) ?? 0;
}

/** What is still owed on the bill (receipts and live credit notes applied). */
export function dueOn(invoiceId: string): number {
  const inv = peekTable<InvoiceRecord>('invoices').find((i) => i.id === invoiceId);
  return inv ? amountDue(inv, creditedOn(invoiceId)) : 0;
}

/**
 * QA5 F1: settlement notes held for the owner's approval (pending drafts) linked to the bill. They are not live yet,
 * so `amountDue` ignores them, but they reserve that much of the due: a further note cannot settle it twice.
 */
export function pendingSettlementOn(invoiceId: string, exceptNoteId?: string): number {
  const ids = new Set(peekTable<CreditLinkRow>('doc_links').filter((l) => l.relation === 'credit_note' && l.from_id === invoiceId && l.to_id !== exceptNoteId).map((l) => l.to_id));
  if (!ids.size) return 0;
  let held = 0;
  for (const n of peekTable<InvoiceRecord>('invoices')) {
    if (ids.has(n.id) && isFinancialNote(n) && n.status === 'Draft' && n.approval?.state === 'pending') held += num(n.total);
  }
  return round2(held);
}

/** What a new settlement note may still settle: the due less the notes waiting for approval. */
export function settleableOn(invoiceId: string): number {
  return round2(Math.max(dueOn(invoiceId) - pendingSettlementOn(invoiceId), 0));
}

/**
 * QA5 F1: on the owner's approval of a pending settlement note, the bill must still owe at least the note
 * (receipts or other notes may have settled it since the request). Throws when it does not; the owner rejects
 * the note (or the clerk raises a smaller one).
 */
export function assertNoteStillSettles(note: InvoiceRecord): void {
  if (!isFinancialNote(note)) return;
  const billId = peekTable<CreditLinkRow>('doc_links').find((l) => l.relation === 'credit_note' && l.to_id === note.id)?.from_id;
  if (!billId) return;
  const due = dueOn(billId);
  const amount = round2(num(note.total));
  if (amount > due + 0.005) {
    const bill = peekTable<InvoiceRecord>('invoices').find((i) => i.id === billId);
    throw new SettlementError(
      due > 0.004
        ? `Only ${due.toFixed(2)} is still due on ${bill?.invoice_number ?? 'the bill'}, less than this ${amount.toFixed(2)} settlement. Reject it and raise a new note for ${due.toFixed(2)}.`
        : `${bill?.invoice_number ?? 'The bill'} is already settled, so this ${amount.toFixed(2)} settlement would leave the party in credit. Reject it.`,
    );
  }
}

export interface FinancialNoteResult {
  note: InvoiceRecord;
  /** True when the note waits for the owner's approval (a clerk over the cap). */
  pending: boolean;
}

/**
 * Raise a financial credit note against `invoiceId` for `input.amount` (≤ what is still due). Numbered in
 * the FCN series of its own FY, linked to the bill, period-lock checked on its date; all-or-nothing.
 */
export function createFinancialNote(invoiceId: string, input: FinancialNoteInput): FinancialNoteResult {
  requireAccess(input.reason === 'bad_debt' ? 'doc.deleteIssued' : 'payment.record');
  const invoice = localDb.invoices.getById(invoiceId);
  if (!invoice) throw new SettlementError('The bill no longer exists.');
  if (!SETTLEABLE.has(invoice.doc_type) || invoice.status === 'Draft' || invoice.status === 'Cancelled') {
    throw new SettlementError('Only an issued invoice can be settled with a financial credit note.');
  }
  const amount = round2(num(input.amount));
  if (!(amount > 0)) throw new SettlementError('Enter an amount above zero to settle.');
  const due = dueOn(invoiceId);
  // QA5 F1: notes still waiting for the owner reserve their part of the due.
  const held = pendingSettlementOn(invoiceId);
  const free = round2(Math.max(due - held, 0));
  if (amount > free + 0.005) {
    throw new SettlementError(held > 0.004
      ? `Only ${free.toFixed(2)} is still due on ${invoice.invoice_number} once the ${held.toFixed(2)} of settlement waiting for approval is counted.`
      : `Only ${due.toFixed(2)} is still due on ${invoice.invoice_number}.`);
  }
  const date = input.date || localDayOf(new Date());
  assertUnlocked({ id: invoice.id, issue_date: date, invoice_number: invoice.invoice_number }, 'create');
  const settings = loadCollectionSettings();
  const account = input.account ?? (input.reason === 'short_payment' ? settings.short_pay_account : undefined);
  return withTablesRollback(['invoices', 'doc_links', 'series_counters'], () => {
    const number = nextSeriesNumberFor(FCN_PREFIX, date, peekTable<InvoiceRecord>('invoices').map((i) => i.invoice_number));
    const record = buildFinancialNote(invoice, { ...input, amount, date, gst: input.gst && settings.gst_variant, account }, { id: generateId(), number });
    // R2-A2 (7): a clerk over the cap asks the owner through the approval queue (saved as a pending draft).
    // QA5 F18: the cap is in rupees, so a foreign-currency amount is converted at the bill's rate first.
    const capped = input.reason !== 'bad_debt' && !can('doc.approve') && rupeeAmount(invoice, amount) > clerkCap(rupeeValue(invoice), settings) + 0.004;
    if (capped) {
      record.status = 'Draft';
      record.approval = {
        state: 'pending', doc_id: record.id, requested_status: 'Sent',
        requested_by: currentActor()?.name ?? '', requested_at: new Date().toISOString(),
        note: `Settlement of ${amount.toFixed(2)} on ${invoice.invoice_number} is above the clerk's cap.`,
      };
    }
    // `save` learns catalogue items from real lines; a settlement line is not an item to sell.
    const catalogue = peekTable<unknown>('items_catalog');
    const saved = localDb.invoices.save(record);
    if (peekTable<unknown>('items_catalog').length !== catalogue.length) setTable('items_catalog', catalogue as unknown[]);
    setTable('doc_links', [
      ...getTable<CreditLinkRow & { id: string; created_at: string; reason?: string }>('doc_links'),
      { id: generateId(), from_id: invoice.id, to_id: saved.id, relation: 'credit_note', reason: FINANCIAL_REASON_LABELS[input.reason], created_at: new Date().toISOString() },
    ]);
    recordSeries(saved.invoice_number);
    // The note may settle the rest of the bill (status Paid) — src/lib/amount-due.ts.
    resettleCreditedInvoices(saved.id);
    return { note: saved, pending: saved.status === 'Draft' };
  });
}

export interface ReceiptSettlementInput {
  invoiceId: string;
  amount: number;
  method: string;
  date: string;
  reference?: string;
  bankAccountId?: string;
  realisedRate?: number;
  /** Settle what the receipt leaves open. */
  settle?: { reason: Exclude<FinancialReason, 'bad_debt'>; amount: number; gst?: boolean };
}

/** Record a receipt and, in the same step, settle the rest with a financial credit note (all or nothing). */
export function recordReceiptAndSettle(input: ReceiptSettlementInput): { payment: Payment; note?: FinancialNoteResult } {
  return withTablesRollback(['transactions', 'invoices', 'doc_links', 'series_counters'], () => {
    const payment = localDb.payments.record({
      invoiceId: input.invoiceId, amount: input.amount, method: input.method, reference: input.reference, date: input.date,
      bankAccountId: input.bankAccountId, realisedRate: input.realisedRate,
    });
    const note = input.settle && input.settle.amount > 0.004
      ? createFinancialNote(input.invoiceId, { amount: input.settle.amount, reason: input.settle.reason, date: input.date, gst: input.settle.gst })
      : undefined;
    return { payment, note };
  });
}

/** Live (or pending) settlement notes raised against a bill — offered for cancelling when a receipt is undone. */
export function settlementNotesFor(invoiceId: string): InvoiceRecord[] {
  const ids = new Set(peekTable<CreditLinkRow>('doc_links').filter((l) => l.relation === 'credit_note' && l.from_id === invoiceId).map((l) => l.to_id));
  return peekTable<InvoiceRecord>('invoices').filter(
    (i) => ids.has(i.id) && isFinancialNote(i) && i.financial_reason !== 'bad_debt' && i.status !== 'Cancelled',
  );
}

/** Cancel a settlement note (the receipt's undo). Period lock and roles as any status change. */
export function cancelFinancialNote(noteId: string): void {
  const note = localDb.invoices.getById(noteId);
  if (!note || !isFinancialNote(note)) throw new SettlementError('That is not a financial credit note.');
  localDb.invoices.setStatus(noteId, 'Cancelled');
}
