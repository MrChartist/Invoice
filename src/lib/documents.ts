/**
 * Sales-document workflow: Quotation → Proforma → Tax Invoice → Delivery
 * Challan, credit / debit notes and cancellation.
 *
 * Layout: pure builders/validators first (no storage, unit-tested), then thin
 * storage-backed wrappers that persist through `localDb.invoices.save` (so the
 * client / catalogue sync keeps working) and the `doc_links` table.
 *
 * Sales orders convert partially (pending quantities only) — see `sales-orders.ts`.
 *
 * Debit notes are their own DEBIT_NOTE type (DBN series), tied to the original
 * by a `debit_note` doc_link. Sales orders convert partially: only the quantity
 * still pending goes onto the new challan / invoice (see `sales-orders.ts`).
 */

import { calcInputFromRecord, calculateInvoice, num, round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { receivableTotal } from './rcm';
import { reasonReturnsGoods } from './credit-restock';
import { localDb } from './localDb';
import { getLockUntil, isPeriodLockedError } from './period-lock';
import { amendmentCheck, buildAmendment, canAmend } from './amendments';
import { loadFiled } from './compliance';
import { orderConversionBlocked, orderFulfilment, pendingQuantities } from './sales-orders';
import { liveDocTrackingIssues } from './stock-tracking';
import { liveRemovalIssues, assertRemovable } from './stock-timeline';
import { ADVANCES_TABLE, advanceBalance } from './advance-tax';
import { doubleBilledRows, liveInvoiceIds, mileageDb, timeDb } from './timesheets';
import { purchasesDb } from './purchases';
import type { AdvanceRecord } from '../types/advances';
import {
  DOCUMENT_LABELS,
  type DocumentType,
  type InvoiceItem,
  type InvoiceRecord,
  type InvoiceStatus,
} from '../types/invoice';

/* ── Types ─────────────────────────────────────────────────────── */

export type DocRelation = 'converted' | 'credit_note' | 'debit_note' | 'cancelled';

export interface DocLink {
  id: string;
  /** Source / original document. For `cancelled`, from_id === to_id. */
  from_id: string;
  /** Derived document (converted copy, credit note, debit note). */
  to_id: string;
  relation: DocRelation;
  reason?: string;
  /** `cancelled` only: status to restore on reinstate. */
  prev_status?: InvoiceStatus;
  /** `cancelled` only: user acknowledged recorded payments. */
  payments_acknowledged?: boolean;
  created_at: string;
}

export const DOC_LINKS_TABLE = 'doc_links';

export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentError';
  }
}

export const CREDIT_REASONS = [
  'Sales return',
  'Discount',
  'Rate difference',
  'GST correction',
  'Cancellation of service',
] as const;

/* ── Transition matrix ─────────────────────────────────────────── */

const SALES_INVOICE_TARGETS: DocumentType[] = ['TAX_INVOICE', 'INVOICE', 'BILL_OF_SUPPLY'];

const TRANSITIONS: Record<DocumentType, DocumentType[]> = {
  QUOTATION: ['SALES_ORDER', 'PROFORMA', ...SALES_INVOICE_TARGETS, 'DELIVERY_CHALLAN'],
  // Sales orders convert PARTIALLY: only the quantity still pending (see sales-orders.ts).
  SALES_ORDER: ['DELIVERY_CHALLAN', ...SALES_INVOICE_TARGETS],
  PROFORMA: [...SALES_INVOICE_TARGETS, 'DELIVERY_CHALLAN'],
  INVOICE: ['DELIVERY_CHALLAN'],
  TAX_INVOICE: ['DELIVERY_CHALLAN'],
  BILL_OF_SUPPLY: ['DELIVERY_CHALLAN'],
  DELIVERY_CHALLAN: [...SALES_INVOICE_TARGETS],
  // Credit notes are only ever raised from an invoice via createCreditNote.
  CREDIT_NOTE: [],
  DEBIT_NOTE: [],
};

export interface ConversionOption {
  target: DocumentType;
  label: string;
}

/** A sales bill: invoice, tax invoice or Bill of Supply (credit / debit notes and receivables treat them alike). */
export function isInvoiceType(t: DocumentType): boolean {
  return t === 'INVOICE' || t === 'TAX_INVOICE' || t === 'BILL_OF_SUPPLY';
}

/** Conversions allowed for a document. Cancelled documents cannot be converted. */
export function allowedConversions(
  source: Pick<InvoiceRecord, 'doc_type' | 'status'> & Partial<Pick<InvoiceRecord, 'order_closed_on'>>,
): ConversionOption[] {
  if (source.status === 'Cancelled') return [];
  // A closed sales order takes no more challans / invoices until it is reopened.
  if (source.doc_type === 'SALES_ORDER' && source.order_closed_on) return [];
  const pending = source.doc_type === 'SALES_ORDER' ? ' (pending qty)' : '';
  return (TRANSITIONS[source.doc_type] ?? []).map((target) => ({
    target,
    label: `Convert to ${DOCUMENT_LABELS[target]}${pending}`,
  }));
}

export function canConvert(
  source: Pick<InvoiceRecord, 'doc_type' | 'status'> & Partial<Pick<InvoiceRecord, 'order_closed_on'>>,
  target: DocumentType,
): boolean {
  return allowedConversions(source).some((o) => o.target === target);
}

/** Credit / debit notes only make sense against issued sales invoices. */
export function canRaiseNote(invoice: Pick<InvoiceRecord, 'doc_type' | 'status'>): boolean {
  return isInvoiceType(invoice.doc_type) && invoice.status !== 'Cancelled' && invoice.status !== 'Draft';
}

/* ── Small helpers ─────────────────────────────────────────────── */

function localIsoDate(d = new Date()): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + Math.max(0, Math.round(days)));
  return localIsoDate(dt);
}

function recompute(input: InvoiceRecord): InvoiceRecord {
  // A NEW document (conversion, credit / debit note) on reverse charge is calculated the current way:
  // the tax is payable by the recipient and stays out of its total (src/lib/rcm.ts).
  const rec: InvoiceRecord = input.reverse_charge && input.doc_type !== 'BILL_OF_SUPPLY'
    ? { ...input, rcm_tax_excluded: true }
    : { ...input, rcm_tax_excluded: undefined };
  // The FULL record goes in (supply type, tax-inclusive pricing, cess, TCS/TDS,
  // round mode): a credit note against an export/LUT invoice must stay zero-rated.
  const t = calculateInvoice(calcInputFromRecord(rec));
  return {
    ...rec,
    subtotal: t.subtotal,
    discount_amount: t.discount_amount,
    taxable_value: t.taxable_value,
    cgst_amount: t.cgst_amount,
    sgst_amount: t.sgst_amount,
    igst_amount: t.igst_amount,
    tax_amount: t.tax_amount,
    round_off: t.round_off,
    total: t.total,
    balance_due: t.balance_due,
    cess_amount: t.cess_amount,
    tcs_amount: t.tcs_amount,
    tds_amount: t.tds_amount,
  };
}

function cloneItems(items: InvoiceItem[]): InvoiceItem[] {
  return (items ?? []).map((i) => ({ ...i, id: generateId() }));
}

export function readLinks(): DocLink[] {
  return getTable<DocLink>(DOC_LINKS_TABLE);
}

function addLink(link: Omit<DocLink, 'id' | 'created_at'>): DocLink {
  const row: DocLink = { ...link, id: generateId(), created_at: new Date().toISOString() };
  setTable(DOC_LINKS_TABLE, [...readLinks(), row]);
  return row;
}

/* ── Conversion ────────────────────────────────────────────────── */

export interface ConvertContext {
  id: string;
  invoice_number: string;
  today: string;
  dueDays: number;
  /**
   * Sales order source only: quantity still pending per order line id. Lines that are absent
   * (or zero) are left off the new document.
   */
  pending?: Record<string, number>;
  /** Sales order source only: carry shipping / other charges (false once an earlier document of this kind took them). */
  carryCharges?: boolean;
}

/** The invoice-level discount re-expressed as a percent of the net line value, so a part-document gets its share. */
function equivalentDiscountPct(invoice: InvoiceRecord): number {
  const calc = calculateInvoice(
    calcInputFromRecord(invoice, {
      shipping: 0,
      other_charges: 0,
      round_off_enabled: false,
      round_mode: 'none',
      amount_paid: 0,
    }),
  );
  const netBase = round2(calc.subtotal - calc.line_discount_total);
  return netBase > 0 ? (calc.invoice_discount_amount / netBase) * 100 : 0;
}

/** Sales order → challan / invoice: only the pending quantity, each line stamped with the order line it fulfils. */
function orderPart(source: InvoiceRecord, ctx: ConvertContext): Partial<InvoiceRecord> {
  const pending = ctx.pending ?? {};
  const items: InvoiceItem[] = [];
  let partial = false;
  for (const line of source.items ?? []) {
    const q = round2(num(pending[line.id]));
    if (q <= 0) {
      if (num(line.quantity) > 0) partial = true;
      continue;
    }
    if (q < num(line.quantity)) partial = true;
    items.push({ ...line, id: generateId(), quantity: q, amount: round2(q * num(line.rate)), order_line_id: line.id });
  }
  if (items.length === 0) throw new DocumentError('Nothing is pending on this sales order.');
  const carry = ctx.carryCharges !== false;
  return {
    items,
    sales_order_id: source.id,
    order_closed_on: undefined,
    ...(partial && source.discount_type === 'AMOUNT' && num(source.discount_rate) > 0
      ? { discount_type: 'PERCENT' as const, discount_rate: equivalentDiscountPct(source) }
      : {}),
    ...(carry ? {} : { shipping: 0, other_charges: 0 }),
  };
}

/** Pure: the new draft produced by converting `source` to `target`. */
export function buildConvertedDraft(
  source: InvoiceRecord,
  target: DocumentType,
  ctx: ConvertContext,
): InvoiceRecord {
  if (!canConvert(source, target)) {
    throw new DocumentError(
      `${DOCUMENT_LABELS[source.doc_type]} cannot be converted to ${DOCUMENT_LABELS[target]}.`,
    );
  }
  const draft: InvoiceRecord = {
    ...source,
    id: ctx.id,
    invoice_number: ctx.invoice_number,
    doc_type: target,
    issue_date: ctx.today,
    // Challans carry no payment terms; everything else gets a fresh due date.
    due_date: target === 'DELIVERY_CHALLAN' ? ctx.today : addDays(ctx.today, ctx.dueDays),
    status: 'Draft',
    items: cloneItems(source.items),
    client: { ...source.client },
    sender: source.sender ? { ...source.sender } : null,
    amount_paid: 0,
    // A derived document is not itself the recurring occurrence it was copied from.
    recurring_id: undefined,
    recurring_date: undefined,
    late_fee_for: undefined,
    // Attachments belong to the source document (its signed copy, its receipts), not the new one.
    attachments: undefined,
    created_at: undefined,
    updated_at: undefined,
    order_closed_on: undefined,
    // An amendment marker belongs to the one document that was amended — never to a copy.
    amends: undefined,
    pos: undefined,
    // A challan's Rule 55 purpose (GSTR-1 Table 13) means nothing on the invoice it becomes.
    challan_purpose: target === 'DELIVERY_CHALLAN' ? source.challan_purpose : undefined,
    approval: undefined, // WP-9: never copied
    loyalty_redeem: undefined,
    branch_transfer_id: undefined,
    ...(target === 'BILL_OF_SUPPLY' ? { gst_mode: 'NONE' as const, reverse_charge: false } : {}),
    ...(source.doc_type === 'SALES_ORDER' ? orderPart(source, ctx) : {}),
  };
  return recompute(draft);
}

/** Status the source takes once converted (quotes/proformas still in Draft count as issued). */
export function statusAfterConversion(
  source: Pick<InvoiceRecord, 'doc_type' | 'status'>,
): InvoiceStatus {
  if ((source.doc_type === 'QUOTATION' || source.doc_type === 'PROFORMA' || source.doc_type === 'SALES_ORDER') && source.status === 'Draft') {
    return 'Sent';
  }
  return source.status;
}

/** Creates, saves and links a new draft. Returns the saved record. */
export function convertDocument(source: InvoiceRecord, target: DocumentType): InvoiceRecord {
  const today = localIsoDate();
  const settings = localDb.settings.get();
  let order: Pick<ConvertContext, 'pending' | 'carryCharges'> = {};
  if (source.doc_type === 'SALES_ORDER' && canConvert(source, target)) {
    const all = localDb.invoices.getAll();
    const links = readLinks();
    const fresh = all.find((i) => i.id === source.id) ?? source;
    const f = orderFulfilment(fresh, all, links);
    const kind = target === 'DELIVERY_CHALLAN' ? 'deliver' : 'invoice';
    const blocked = orderConversionBlocked(f, kind);
    if (blocked) throw new DocumentError(blocked);
    const sameKind = (t: DocumentType) => (kind === 'deliver' ? t === 'DELIVERY_CHALLAN' : isInvoiceType(t));
    order = {
      pending: pendingQuantities(f, kind),
      carryCharges: !all.some((d) => f.documentIds.includes(d.id) && sameKind(d.doc_type)),
    };
  }
  const draft = buildConvertedDraft(source, target, {
    id: generateId(),
    invoice_number: localDb.invoices.nextNumber(today, target, source.sender?.invoicePrefix || undefined),
    today,
    dueDays: num(settings.defaultDueDays, 14),
    ...order,
  });
  const saved = localDb.invoices.save(draft);
  addLink({ from_id: source.id, to_id: saved.id, relation: 'converted' });

  const nextStatus = statusAfterConversion(source);
  // Converting a quotation means the client said yes.
  try {
    if (nextStatus !== source.status) localDb.invoices.setStatus(source.id, nextStatus);
    if (source.doc_type === 'QUOTATION' && !source.quote_status) localDb.invoices.setQuoteStatus(source.id, 'Accepted');
  } catch (err) {
    // A source document inside a locked period keeps its status; the conversion itself still stands.
    if (!isPeriodLockedError(err)) throw err;
  }
  return saved;
}

/* ── Credit notes ──────────────────────────────────────────────── */

export interface CreditLineRequest {
  /** Original item id. */
  itemId: string;
  quantity: number;
}

export interface CreditLineStatus {
  item: InvoiceItem;
  originalQty: number;
  creditedQty: number;
  remainingQty: number;
}

/** Credit notes (non-cancelled) raised against an invoice. */
export function creditNotesFor(
  invoiceId: string,
  links: DocLink[],
  allInvoices: InvoiceRecord[],
): InvoiceRecord[] {
  const ids = new Set(
    links.filter((l) => l.relation === 'credit_note' && l.from_id === invoiceId).map((l) => l.to_id),
  );
  return allInvoices.filter(
    (i) => ids.has(i.id) && i.doc_type === 'CREDIT_NOTE' && i.status !== 'Cancelled',
  );
}

export function creditedQuantities(
  invoiceId: string,
  links: DocLink[],
  allInvoices: InvoiceRecord[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cn of creditNotesFor(invoiceId, links, allInvoices)) {
    for (const it of cn.items ?? []) out[it.id] = round2((out[it.id] ?? 0) + num(it.quantity));
  }
  return out;
}

export function creditableLines(
  invoice: InvoiceRecord,
  links: DocLink[],
  allInvoices: InvoiceRecord[],
): CreditLineStatus[] {
  const credited = creditedQuantities(invoice.id, links, allInvoices);
  return (invoice.items ?? []).map((item) => {
    const originalQty = num(item.quantity);
    const creditedQty = credited[item.id] ?? 0;
    return {
      item,
      originalQty,
      creditedQty,
      remainingQty: Math.max(0, round2(originalQty - creditedQty)),
    };
  });
}

export function totalCredited(
  invoiceId: string,
  links: DocLink[],
  allInvoices: InvoiceRecord[],
): number {
  return round2(creditNotesFor(invoiceId, links, allInvoices).reduce((s, c) => s + receivableTotal(c), 0));
}

export interface CreditInput {
  lines: CreditLineRequest[];
  reason: string;
  /**
   * Goods come back into stock (the form's "Goods returned to stock" box). Defaults to the reason:
   * on for a sales return, off for a discount / rate difference / GST correction / cancelled service.
   */
  goodsReturned?: boolean;
}

export interface CreditDraftResult {
  record: InvoiceRecord | null;
  errors: string[];
}

const TOTAL_TOLERANCE = 0.02;

/**
 * Pure: validate a credit request and compute the credit-note record (no
 * persistence). `record` is null when there are errors.
 */
export function buildCreditNote(
  invoice: InvoiceRecord,
  input: CreditInput,
  links: DocLink[],
  allInvoices: InvoiceRecord[],
  ctx: { id: string; invoice_number: string; today: string },
): CreditDraftResult {
  const errors: string[] = [];
  if (!isInvoiceType(invoice.doc_type)) errors.push('Credit notes can only be raised against invoices.');
  if (invoice.status === 'Cancelled') errors.push('This invoice is cancelled.');
  if (invoice.status === 'Draft') errors.push('Issue the invoice before raising a credit note against it.');
  if (!input.reason?.trim()) errors.push('Choose a reason for the credit note.');

  const status = creditableLines(invoice, links, allInvoices);
  // Serials already taken back by earlier live credit notes against this invoice (per line).
  const returnedSerials = new Map<string, Set<string>>();
  for (const cn of creditNotesFor(invoice.id, links, allInvoices)) {
    for (const it of cn.items ?? []) {
      const set = returnedSerials.get(it.id) ?? new Set<string>();
      for (const s of it.serials ?? []) set.add(s.trim().toUpperCase());
      returnedSerials.set(it.id, set);
    }
  }
  const picked: InvoiceItem[] = [];
  for (const req of input.lines) {
    const qty = round2(num(req.quantity));
    if (qty <= 0) continue;
    const line = status.find((s) => s.item.id === req.itemId);
    if (!line) {
      errors.push('A selected line does not exist on the original invoice.');
      continue;
    }
    if (qty > line.remainingQty + 1e-9) {
      errors.push(
        `"${line.item.name || 'Item'}": cannot credit ${qty}; only ${line.remainingQty} of ${line.originalQty} remain creditable.`,
      );
      continue;
    }
    // Same id as the original line: that is how cumulative credit is tracked.
    picked.push({
      ...line.item,
      quantity: qty,
      amount: round2(qty * num(line.item.rate)),
      // A partial credit returns only as many serials as units: the first ones NOT already returned on an
      // earlier credit note against this line (edit the note to choose others).
      ...(line.item.serials?.length
        ? { serials: line.item.serials.filter((s) => !returnedSerials.get(line.item.id)?.has(s.trim().toUpperCase())).slice(0, Math.floor(qty)) }
        : {}),
    });
  }
  if (picked.length === 0 && errors.length === 0) {
    errors.push('Enter a quantity to credit on at least one line.');
  }
  if (errors.length) return { record: null, errors };
  const goodsReturned = input.goodsReturned ?? reasonReturnsGoods(input.reason);
  // No goods come back: no serials are returned either (stock tracking follows the same flag).
  if (!goodsReturned) {
    for (const p of picked) delete p.serials;
  }

  // Re-express the original invoice-level discount as an equivalent percent so
  // a partial credit gets a proportional share of it.
  const discountPct = equivalentDiscountPct(invoice);

  const base: InvoiceRecord = {
    ...invoice,
    attachments: undefined, // never copied from the original (6.12)
    id: ctx.id,
    invoice_number: ctx.invoice_number,
    doc_type: 'CREDIT_NOTE',
    issue_date: ctx.today,
    due_date: ctx.today,
    status: 'Sent',
    items: picked,
    client: { ...invoice.client },
    sender: invoice.sender ? { ...invoice.sender } : null,
    discount_type: 'PERCENT',
    discount_rate: discountPct,
    shipping: 0,
    other_charges: 0,
    amount_paid: 0,
    po_number: invoice.invoice_number,
    notes: `Credit note against ${DOCUMENT_LABELS[invoice.doc_type]} ${invoice.invoice_number} dated ${invoice.issue_date}. Reason: ${input.reason.trim()}.`,
    recurring_id: undefined,
    recurring_date: undefined,
    late_fee_for: undefined,
    created_at: undefined,
    updated_at: undefined,
    amends: undefined,
    pos: undefined,
    transport: undefined, // the original's dispatch details (P1-24)
    approval: undefined, // WP-9: never copied
    loyalty_redeem: undefined,
    branch_transfer_id: undefined,
    goods_returned: goodsReturned,
  };
  const rec = recompute(base);
  // A credit note is not receivable; it reduces the original's balance.
  rec.balance_due = 0;

  // Compare BEFORE whole-rupee round-off: every credit note is rounded on its own,
  // so two part-credits that together cover the invoice can each round up and sum
  // to a rupee more than the (also rounded) invoice — which must not block them.
  // Reverse charge: compare what the customer owes (an older invoice's stored total includes the tax).
  const preRound = (r: InvoiceRecord) => receivableTotal(r) - num(r.round_off);
  const already = round2(
    creditNotesFor(invoice.id, links, allInvoices).reduce((s, c) => s + preRound(c), 0),
  );
  const cap = round2(preRound(invoice));
  if (round2(already + preRound(rec)) > cap + TOTAL_TOLERANCE) {
    return {
      record: null,
      errors: [
        `Total credit (${round2(already + preRound(rec))}) would exceed the invoice total (${cap}).`,
      ],
    };
  }
  return { record: rec, errors: [] };
}

export function createCreditNote(invoice: InvoiceRecord, input: CreditInput): InvoiceRecord {
  const links = readLinks();
  const all = localDb.invoices.getAll();
  const today = localIsoDate();
  const { record, errors } = buildCreditNote(invoice, input, links, all, {
    id: generateId(),
    invoice_number: localDb.invoices.nextNumber(today, 'CREDIT_NOTE'),
    today,
  });
  if (!record) throw new DocumentError(errors.join(' '));
  // Same serial / batch checks as issuing from the editor (the note is saved as Sent straight away).
  const stock = liveDocTrackingIssues(record);
  if (stock.errors.length) throw new DocumentError(stock.errors.join(' '));
  const saved = localDb.invoices.save(record);
  addLink({ from_id: invoice.id, to_id: saved.id, relation: 'credit_note', reason: input.reason.trim() });
  return saved;
}

/* ── Debit notes (own DEBIT_NOTE type and DBN series, linked to the invoice) ─── */

export interface DebitLine {
  name: string;
  quantity: number;
  rate: number;
  hsn?: string;
  unit?: string;
  tax_rate?: number;
}

export function buildDebitNote(
  invoice: InvoiceRecord,
  input: { lines: DebitLine[]; reason: string },
  ctx: { id: string; invoice_number: string; today: string; dueDays: number },
): InvoiceRecord {
  if (!isInvoiceType(invoice.doc_type)) {
    throw new DocumentError('Debit notes can only be raised against invoices.');
  }
  const lines = input.lines.filter((l) => num(l.quantity) > 0 && num(l.rate) > 0);
  if (lines.length === 0) throw new DocumentError('Add at least one line with a quantity and rate.');
  if (!input.reason?.trim()) throw new DocumentError('Enter a reason for the debit note.');
  const items: InvoiceItem[] = lines.map((l) => ({
    id: generateId(),
    name: l.name || 'Additional charge',
    type: 'service',
    hsn: l.hsn,
    unit: l.unit,
    quantity: num(l.quantity),
    rate: num(l.rate),
    tax_rate: l.tax_rate ?? invoice.items?.[0]?.tax_rate ?? invoice.tax_rate,
    amount: round2(num(l.quantity) * num(l.rate)),
  }));
  return recompute({
    ...invoice,
    attachments: undefined, // never copied from the original (6.12)
    id: ctx.id,
    doc_type: 'DEBIT_NOTE',
    invoice_number: ctx.invoice_number,
    issue_date: ctx.today,
    due_date: addDays(ctx.today, ctx.dueDays),
    status: 'Draft',
    items,
    client: { ...invoice.client },
    sender: invoice.sender ? { ...invoice.sender } : null,
    discount_type: 'PERCENT',
    discount_rate: 0,
    shipping: 0,
    other_charges: 0,
    amount_paid: 0,
    po_number: invoice.invoice_number,
    notes: `Debit note against ${DOCUMENT_LABELS[invoice.doc_type]} ${invoice.invoice_number} dated ${invoice.issue_date}. Reason: ${input.reason.trim()}.`,
    recurring_id: undefined,
    recurring_date: undefined,
    late_fee_for: undefined,
    created_at: undefined,
    updated_at: undefined,
    amends: undefined,
    pos: undefined,
    transport: undefined,
    approval: undefined, // WP-9: never copied
    loyalty_redeem: undefined,
    branch_transfer_id: undefined,
  });
}

export function createDebitNote(
  invoice: InvoiceRecord,
  input: { lines: DebitLine[]; reason: string },
): InvoiceRecord {
  const today = localIsoDate();
  const rec = buildDebitNote(invoice, input, {
    id: generateId(),
    invoice_number: localDb.invoices.nextNumber(today, 'DEBIT_NOTE'),
    today,
    dueDays: num(localDb.settings.get().defaultDueDays, 14),
  });
  const saved = localDb.invoices.save(rec);
  addLink({ from_id: invoice.id, to_id: saved.id, relation: 'debit_note', reason: input.reason.trim() });
  return saved;
}

/* ── Outstanding after credit ──────────────────────────────────── */

/**
 * Balance still collectable on an invoice once credit notes are applied:
 * total - amount_paid - credits, never below zero. Cancelled and non-billing
 * documents (quotes, proformas, challans, credit notes) owe nothing.
 * Pure, so receivables / stats can call it with data they already hold.
 */
export function effectiveOutstanding(
  invoice: InvoiceRecord,
  links: DocLink[],
  allInvoices: InvoiceRecord[],
): number {
  if (invoice.status === 'Cancelled') return 0;
  if (!isInvoiceType(invoice.doc_type) && invoice.doc_type !== 'DEBIT_NOTE') return 0;
  const credit = totalCredited(invoice.id, links, allInvoices);
  // TDS the customer withholds is never collectable from them (it is settled with the tax office).
  return Math.max(
    0,
    round2(receivableTotal(invoice) - num(invoice.tds_amount) - num(invoice.amount_paid) - credit),
  );
}

/* ── Cancellation ──────────────────────────────────────────────── */

export function activeCancellation(id: string, links: DocLink[]): DocLink | undefined {
  return [...links].reverse().find((l) => l.relation === 'cancelled' && l.from_id === id);
}

export interface CancelOptions {
  /** Required to cancel a document that already has payments recorded. */
  acknowledgePayments?: boolean;
  /**
   * Cancelling a goods-returning credit note takes its goods out of stock again. When later documents
   * already used those quantities (not serials — those always refuse), the user must confirm.
   */
  acknowledgeStock?: boolean;
}

export function cancelBlockedReason(invoice: InvoiceRecord, opts: CancelOptions = {}): string | null {
  if (invoice.status === 'Cancelled') return 'This document is already cancelled.';
  if (num(invoice.amount_paid) > 0 && !opts.acknowledgePayments) {
    return `Payments of ${round2(num(invoice.amount_paid))} are recorded against this document. Confirm that you understand before cancelling.`;
  }
  return null;
}

export function cancelDocument(
  invoice: InvoiceRecord,
  reason: string,
  opts: CancelOptions = {},
): InvoiceRecord {
  if (!reason?.trim()) throw new DocumentError('Give a reason for the cancellation.');
  const fresh = localDb.invoices.getById(invoice.id) ?? invoice;
  const blocked = cancelBlockedReason(fresh, opts);
  if (blocked) throw new DocumentError(blocked);
  // A credit note's returned goods may since have been sold again (stock-timeline.ts).
  if (fresh.doc_type === 'CREDIT_NOTE') assertRemovable(liveRemovalIssues({ refType: 'invoice', refId: fresh.id }), opts.acknowledgeStock);
  const saved = localDb.invoices.save({ ...fresh, status: 'Cancelled' });
  addLink({
    from_id: fresh.id,
    to_id: fresh.id,
    relation: 'cancelled',
    reason: reason.trim(),
    prev_status: fresh.status,
    payments_acknowledged: num(fresh.amount_paid) > 0 ? true : undefined,
  });
  return saved;
}

export function restoredStatus(
  inv: Pick<InvoiceRecord, 'amount_paid' | 'total'> & Partial<InvoiceRecord>,
  prev?: InvoiceStatus,
): InvoiceStatus {
  if (prev && prev !== 'Cancelled') return prev;
  const paid = num(inv.amount_paid);
  if (paid > 0) return paid >= receivableTotal(inv) ? 'Paid' : 'Partially Paid';
  return 'Sent';
}

const money2 = (n: number) => `₹${round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Why a cancelled document cannot come back with `status`: while it was cancelled its effects were
 * released, and something else may have used them since —
 *  - serials resold / batches used (the issue checks, as of its date and against later documents);
 *  - an advance adjusted against it was applied elsewhere, so it would be over-adjusted;
 *  - time entries, trips or re-billed costs it billed were billed on another invoice;
 *  - its sales order was fulfilled by other documents.
 * Pure over the given data except the stock check (live).
 */
export function reinstateIssues(
  fresh: InvoiceRecord,
  status: InvoiceStatus,
  ctx: {
    links: DocLink[];
    invoices: InvoiceRecord[];
    payments: { invoice_id: string; amount: number; advance_id?: string }[];
    advances: AdvanceRecord[];
    time: Parameters<typeof doubleBilledRows>[1];
  },
): string[] {
  const errors: string[] = [];
  const restored: InvoiceRecord = { ...fresh, status };
  const all = ctx.invoices.map((i) => (i.id === fresh.id ? restored : i));

  if (status !== 'Draft') errors.push(...liveDocTrackingIssues(restored).errors);

  const advIds = new Set(ctx.payments.filter((p) => p.invoice_id === fresh.id && p.advance_id).map((p) => p.advance_id as string));
  for (const adv of ctx.advances.filter((a) => advIds.has(a.id))) {
    const bal = advanceBalance(adv, ctx.payments as never, all);
    const over = round2(bal.adjusted + bal.refunded - bal.amount);
    if (over > 0.005) {
      errors.push(`Advance ${adv.number} was used elsewhere while this document was cancelled: reinstating it would adjust ${money2(bal.adjusted + bal.refunded)} against an advance of ${money2(bal.amount)}. Remove the advance adjustment from this document (or the other one) first.`);
    }
  }

  const twice = doubleBilledRows(fresh, ctx.time, liveInvoiceIds(ctx.invoices, fresh.id));
  if (twice.length) {
    const numbers = [...new Set(twice.map((t) => ctx.invoices.find((i) => i.id === t.by)?.invoice_number || 'another invoice'))];
    const kinds = [...new Set(twice.map((t) => (t.kind === 'time' ? 'time entries' : t.kind === 'mileage' ? 'mileage trips' : 're-billed expenses')))];
    errors.push(`${twice.length} ${kinds.join(' / ')} on this document ${twice.length === 1 ? 'has' : 'have'} since been billed on ${numbers.join(', ')}. Remove ${twice.length === 1 ? 'it' : 'them'} from one of the invoices first.`);
  }

  if (fresh.sales_order_id) {
    const so = ctx.invoices.find((i) => i.id === fresh.sales_order_id);
    if (so) {
      const before = orderFulfilment(so, ctx.invoices, ctx.links);
      const after = orderFulfilment(so, all, ctx.links);
      const mine = new Set((fresh.items ?? []).map((i) => i.order_line_id).filter(Boolean));
      for (const l of after.lines) {
        if (!mine.has(l.item.id)) continue;
        const prev = before.lines.find((b) => b.item.id === l.item.id);
        const overD = l.delivered > l.ordered + 1e-6 && l.delivered > (prev?.delivered ?? 0);
        const overI = l.invoiced > l.ordered + 1e-6 && l.invoiced > (prev?.invoiced ?? 0);
        if (overD || overI) {
          errors.push(`"${l.item.name || 'Item'}" on sales order ${so.invoice_number}: ${overI ? `${l.invoiced} would be invoiced` : `${l.delivered} would be delivered`} against ${l.ordered} ordered — other documents fulfilled it meanwhile.`);
        }
      }
    }
  }
  return errors;
}

/** Undo a cancellation: restores the pre-cancel status and retires the link (refused when `reinstateIssues` finds a conflict). */
export function reinstateDocument(invoice: InvoiceRecord): InvoiceRecord {
  const fresh = localDb.invoices.getById(invoice.id) ?? invoice;
  if (fresh.status !== 'Cancelled') throw new DocumentError('This document is not cancelled.');
  const links = readLinks();
  const link = activeCancellation(fresh.id, links);
  const status = restoredStatus(fresh, link?.prev_status);
  const problems = reinstateIssues(fresh, status, {
    links,
    invoices: localDb.invoices.getAll(),
    payments: localDb.payments.getAll(),
    advances: getTable<AdvanceRecord>(ADVANCES_TABLE),
    time: { time: timeDb.all(), mileage: mileageDb.all(), expenses: purchasesDb.all() },
  });
  if (problems.length) throw new DocumentError(`Cannot reinstate ${fresh.invoice_number}: ${problems.join(' ')}`);
  const saved = localDb.invoices.save({ ...fresh, status });
  if (link) setTable(DOC_LINKS_TABLE, links.filter((l) => l.id !== link.id));
  return saved;
}

/* ── Amendments (GSTR-1 B2BA / CDNRA …, see amendments.ts) ─────────── */

/**
 * Marks a saved document as amended: freezes a copy of it as reported (so its original period's GSTR-1
 * never changes) and stamps today as the amendment date. The user then edits and saves as usual. The
 * period lock applies (a locked document must be unlocked with the PIN first).
 */
export function startAmendment(invoice: InvoiceRecord, reason = ''): InvoiceRecord {
  const fresh = localDb.invoices.getById(invoice.id) ?? invoice;
  if (!canAmend(fresh)) {
    throw new DocumentError('Only issued tax invoices and credit / debit notes of a regular GST profile can be amended in GSTR-1.');
  }
  const check = amendmentCheck(fresh, { filed: loadFiled(), lockUntil: getLockUntil() });
  const amends = buildAmendment(fresh, localIsoDate(), { period: fresh.amends?.period || check.period, reason });
  return localDb.invoices.save({ ...fresh, amends });
}

/* ── Chain ─────────────────────────────────────────────────────── */

export interface ChainNode {
  doc: InvoiceRecord;
  relation: DocRelation | 'origin';
  parentId: string | null;
  depth: number;
}

const CHAIN_RELATIONS: DocRelation[] = ['converted', 'credit_note', 'debit_note'];

/**
 * Pure: every document connected to `id` through conversion / credit / debit
 * links, ordered root-first (depth-first, siblings by creation time).
 */
export function buildDocumentChain(
  id: string,
  links: DocLink[],
  invoices: InvoiceRecord[],
): ChainNode[] {
  const edges = links.filter((l) => CHAIN_RELATIONS.includes(l.relation) && l.from_id !== l.to_id);
  const byId = new Map(invoices.map((i) => [i.id, i]));
  if (!byId.has(id)) return [];

  const parentOf = new Map<string, DocLink>();
  for (const e of edges) if (!parentOf.has(e.to_id)) parentOf.set(e.to_id, e);

  // Walk up to the root (guarded against cycles in corrupt data).
  let root = id;
  const seen = new Set<string>([root]);
  while (parentOf.has(root)) {
    const next = parentOf.get(root)!.from_id;
    if (seen.has(next) || !byId.has(next)) break;
    seen.add(next);
    root = next;
  }

  const out: ChainNode[] = [];
  const visited = new Set<string>();
  const walk = (docId: string, relation: ChainNode['relation'], parentId: string | null, depth: number) => {
    const doc = byId.get(docId);
    if (!doc || visited.has(docId)) return;
    visited.add(docId);
    out.push({ doc, relation, parentId, depth });
    edges
      .filter((e) => e.from_id === docId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .forEach((e) => walk(e.to_id, e.relation, docId, depth + 1));
  };
  walk(root, 'origin', null, 0);
  return out;
}

export function getDocumentChain(id: string): ChainNode[] {
  return buildDocumentChain(id, readLinks(), localDb.invoices.getAll());
}
