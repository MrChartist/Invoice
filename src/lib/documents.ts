/**
 * Sales-document workflow: Quotation → Proforma → Tax Invoice → Delivery
 * Challan, credit / debit notes and cancellation.
 *
 * Layout: pure builders/validators first (no storage, unit-tested), then thin
 * storage-backed wrappers that persist through `localDb.invoices.save` (so the
 * client / catalogue sync keeps working) and the `doc_links` table.
 *
 * Debit notes: `DocumentType` has no DEBIT_NOTE (shared type file is frozen),
 * so a debit note is an INVOICE whose `po_number` holds the original invoice
 * number, whose notes say "Debit note against …", and which is tied to the
 * original by a `debit_note` doc_link.
 */

import { calculateInvoice, num, round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { localDb } from './localDb';
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

const SALES_INVOICE_TARGETS: DocumentType[] = ['TAX_INVOICE', 'INVOICE'];

const TRANSITIONS: Record<DocumentType, DocumentType[]> = {
  QUOTATION: ['PROFORMA', ...SALES_INVOICE_TARGETS, 'DELIVERY_CHALLAN'],
  PROFORMA: [...SALES_INVOICE_TARGETS, 'DELIVERY_CHALLAN'],
  INVOICE: ['DELIVERY_CHALLAN'],
  TAX_INVOICE: ['DELIVERY_CHALLAN'],
  DELIVERY_CHALLAN: [...SALES_INVOICE_TARGETS],
  // Credit notes are only ever raised from an invoice via createCreditNote.
  CREDIT_NOTE: [],
};

export interface ConversionOption {
  target: DocumentType;
  label: string;
}

export function isInvoiceType(t: DocumentType): boolean {
  return t === 'INVOICE' || t === 'TAX_INVOICE';
}

/** Conversions allowed for a document. Cancelled documents cannot be converted. */
export function allowedConversions(
  source: Pick<InvoiceRecord, 'doc_type' | 'status'>,
): ConversionOption[] {
  if (source.status === 'Cancelled') return [];
  return (TRANSITIONS[source.doc_type] ?? []).map((target) => ({
    target,
    label: `Convert to ${DOCUMENT_LABELS[target]}`,
  }));
}

export function canConvert(
  source: Pick<InvoiceRecord, 'doc_type' | 'status'>,
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

function recompute(rec: InvoiceRecord): InvoiceRecord {
  const t = calculateInvoice({
    items: rec.items,
    gst_mode: rec.gst_mode,
    discount_type: rec.discount_type,
    discount_rate: rec.discount_rate,
    tax_rate: rec.tax_rate,
    shipping: rec.shipping,
    other_charges: rec.other_charges,
    round_off_enabled: rec.round_off_enabled,
    amount_paid: rec.amount_paid,
  });
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
    created_at: undefined,
    updated_at: undefined,
  };
  return recompute(draft);
}

/** Status the source takes once converted (quotes/proformas still in Draft count as issued). */
export function statusAfterConversion(
  source: Pick<InvoiceRecord, 'doc_type' | 'status'>,
): InvoiceStatus {
  if ((source.doc_type === 'QUOTATION' || source.doc_type === 'PROFORMA') && source.status === 'Draft') {
    return 'Sent';
  }
  return source.status;
}

/** Creates, saves and links a new draft. Returns the saved record. */
export function convertDocument(source: InvoiceRecord, target: DocumentType): InvoiceRecord {
  const today = localIsoDate();
  const settings = localDb.settings.get();
  const draft = buildConvertedDraft(source, target, {
    id: generateId(),
    invoice_number: localDb.invoices.nextNumber(today, target),
    today,
    dueDays: num(settings.defaultDueDays, 14),
  });
  const saved = localDb.invoices.save(draft);
  addLink({ from_id: source.id, to_id: saved.id, relation: 'converted' });

  const nextStatus = statusAfterConversion(source);
  if (nextStatus !== source.status) localDb.invoices.setStatus(source.id, nextStatus);
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
  return round2(creditNotesFor(invoiceId, links, allInvoices).reduce((s, c) => s + num(c.total), 0));
}

export interface CreditInput {
  lines: CreditLineRequest[];
  reason: string;
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
  if (!input.reason?.trim()) errors.push('Choose a reason for the credit note.');

  const status = creditableLines(invoice, links, allInvoices);
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
    picked.push({ ...line.item, quantity: qty, amount: round2(qty * num(line.item.rate)) });
  }
  if (picked.length === 0 && errors.length === 0) {
    errors.push('Enter a quantity to credit on at least one line.');
  }
  if (errors.length) return { record: null, errors };

  // Re-express the original invoice-level discount as an equivalent percent so
  // a partial credit gets a proportional share of it.
  const origCalc = calculateInvoice({
    items: invoice.items,
    gst_mode: invoice.gst_mode,
    discount_type: invoice.discount_type,
    discount_rate: invoice.discount_rate,
    tax_rate: invoice.tax_rate,
    shipping: 0,
    other_charges: 0,
    round_off_enabled: false,
    amount_paid: 0,
  });
  const netBase = round2(origCalc.subtotal - origCalc.line_discount_total);
  const discountPct = netBase > 0 ? (origCalc.invoice_discount_amount / netBase) * 100 : 0;

  const base: InvoiceRecord = {
    ...invoice,
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
    created_at: undefined,
    updated_at: undefined,
  };
  const rec = recompute(base);
  // A credit note is not receivable; it reduces the original's balance.
  rec.balance_due = 0;

  const already = totalCredited(invoice.id, links, allInvoices);
  if (round2(already + rec.total) > round2(num(invoice.total)) + TOTAL_TOLERANCE) {
    return {
      record: null,
      errors: [
        `Total credit (${round2(already + rec.total)}) would exceed the invoice total (${round2(num(invoice.total))}).`,
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
  const saved = localDb.invoices.save(record);
  addLink({ from_id: invoice.id, to_id: saved.id, relation: 'credit_note', reason: input.reason.trim() });
  return saved;
}

/* ── Debit notes (modelled as INVOICE) ─────────────────────────── */

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
    id: ctx.id,
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
    created_at: undefined,
    updated_at: undefined,
  });
}

export function createDebitNote(
  invoice: InvoiceRecord,
  input: { lines: DebitLine[]; reason: string },
): InvoiceRecord {
  const today = localIsoDate();
  const rec = buildDebitNote(invoice, input, {
    id: generateId(),
    invoice_number: localDb.invoices.nextNumber(today, invoice.doc_type),
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
  if (!isInvoiceType(invoice.doc_type)) return 0;
  const credit = totalCredited(invoice.id, links, allInvoices);
  return Math.max(0, round2(num(invoice.total) - num(invoice.amount_paid) - credit));
}

/* ── Cancellation ──────────────────────────────────────────────── */

export function activeCancellation(id: string, links: DocLink[]): DocLink | undefined {
  return [...links].reverse().find((l) => l.relation === 'cancelled' && l.from_id === id);
}

export interface CancelOptions {
  /** Required to cancel a document that already has payments recorded. */
  acknowledgePayments?: boolean;
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
  inv: Pick<InvoiceRecord, 'amount_paid' | 'total'>,
  prev?: InvoiceStatus,
): InvoiceStatus {
  if (prev && prev !== 'Cancelled') return prev;
  const paid = num(inv.amount_paid);
  if (paid > 0) return paid >= num(inv.total) ? 'Paid' : 'Partially Paid';
  return 'Sent';
}

/** Undo a cancellation: restores the pre-cancel status and retires the link. */
export function reinstateDocument(invoice: InvoiceRecord): InvoiceRecord {
  const fresh = localDb.invoices.getById(invoice.id) ?? invoice;
  if (fresh.status !== 'Cancelled') throw new DocumentError('This document is not cancelled.');
  const links = readLinks();
  const link = activeCancellation(fresh.id, links);
  const saved = localDb.invoices.save({ ...fresh, status: restoredStatus(fresh, link?.prev_status) });
  if (link) setTable(DOC_LINKS_TABLE, links.filter((l) => l.id !== link.id));
  return saved;
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
