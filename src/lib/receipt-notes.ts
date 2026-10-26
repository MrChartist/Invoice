/**
 * Receipt notes (GRN) and Rejections Out (WP-3, P1-8 — Tally's "Receipt Note" and "Rejections Out"),
 * plus the purchase-side pending reports (P1-12): goods received not billed and purchase orders
 * outstanding. Table `receipt_notes` (`ReceiptNote`, src/types/purchases.ts).
 *
 *  - GRN            goods come into stock before the supplier's bill (no books / GST entry). "Convert
 *                   to bill" pre-fills the bill with the quantity still unbilled; each bill line keeps
 *                   `grn_line_id`, so billed quantity is derived from the bills and the bill does not
 *                   bring the same goods in a second time (events-returns.ts).
 *  - REJECTION_OUT  goods received on a GRN sent back before billing: stock out, nothing else.
 *
 * PO → GRN → Bill: a GRN made from a PO carries `po_id` / `po_line_id`; bills made from that GRN carry
 * them too, so the PO's own "received" (from bills) keeps working, and the PO outstanding report
 * below also counts goods received on GRNs that are not billed yet.
 *
 * Pure above the "Storage" divider.
 */

import type { PurchaseLine, PurchaseOrder, PurchaseRecord, ReceiptNote, ReceiptNoteLine } from '../types/purchases';
import { requireAccess } from './access';
import { audit } from './audit';
import { daysBetween } from './compliance';
import { isoDay } from './dates';
import { nextSeriesNumberFor, recordSeries } from './series-counters';
import { num, round2 } from './invoice-calc';
import { isVoidStatus, readPurchase } from './purchase-normalize';
import type { BillSeed } from './purchase-orders';
import { DB_PREFIX, generateId, getJson, getTable, peekTable, setTable } from './storage';
import { godownsDb } from './godowns'; // R4-A4 default-godown hook

export const RECEIPT_NOTES_TABLE = 'receipt_notes';
export const GRN_PREFIX = 'GRN';
export const REJECTION_PREFIX = 'RJO';

const EPS = 1e-6;

/* ── Pure ─────────────────────────────────────────────────────── */

/** Next GRN / RJO number: above every existing number and the series high-water mark (never reused). */
export function nextReceiptNumber(existing: readonly string[], kind: ReceiptNote['kind'], date?: string): string {
  return nextSeriesNumberFor(kind === 'GRN' ? GRN_PREFIX : REJECTION_PREFIX, date, existing);
}

/** Bills that count: saved, not void / draft, not a direct expense. */
function liveBills(purchases: readonly PurchaseRecord[]): PurchaseRecord[] {
  return purchases.filter((p) => {
    const c = readPurchase(p);
    return !!c && !isVoidStatus(c.status) && !c.isExpense;
  });
}

/** Quantity billed per GRN line id (live bills only). */
export function billedByGrnLine(purchases: readonly PurchaseRecord[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of liveBills(purchases)) {
    for (const l of b.lines ?? []) {
      if (!l.grn_line_id) continue;
      out.set(l.grn_line_id, round2((out.get(l.grn_line_id) ?? 0) + Math.max(num(l.quantity), 0)));
    }
  }
  return out;
}

/** Quantity rejected out per GRN line id. */
export function rejectedByGrnLine(notes: readonly ReceiptNote[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of notes) {
    if (r?.kind !== 'REJECTION_OUT') continue;
    for (const l of r.lines ?? []) {
      if (!l.grn_line_id) continue;
      out.set(l.grn_line_id, round2((out.get(l.grn_line_id) ?? 0) + Math.max(num(l.quantity), 0)));
    }
  }
  return out;
}

export type GrnState = 'Pending' | 'Partly billed' | 'Billed' | 'Closed';
export const GRN_STATES: GrnState[] = ['Pending', 'Partly billed', 'Billed', 'Closed'];

export interface GrnLineStatus {
  line: ReceiptNoteLine;
  received: number;
  rejected: number;
  billed: number;
  /** Received − rejected − billed (never below 0). */
  pending: number;
}

export interface GrnStatus {
  lines: GrnLineStatus[];
  state: GrnState;
  pendingValue: number;
}

export function grnStatus(grn: ReceiptNote, purchases: readonly PurchaseRecord[], notes: readonly ReceiptNote[]): GrnStatus {
  const billed = billedByGrnLine(purchases);
  const rejected = rejectedByGrnLine(notes);
  const lines = (grn.lines ?? [])
    .filter((l) => num(l.quantity) > 0)
    .map((line) => {
      const received = num(line.quantity);
      const rj = rejected.get(line.id) ?? 0;
      const bl = billed.get(line.id) ?? 0;
      return { line, received, rejected: rj, billed: bl, pending: Math.max(round2(received - rj - bl), 0) };
    });
  const done = lines.every((l) => l.pending <= EPS);
  const started = lines.some((l) => l.billed > EPS);
  const state: GrnState = done ? 'Billed' : grn.closed_on ? 'Closed' : started ? 'Partly billed' : 'Pending';
  const pendingValue = state === 'Closed' ? 0 : round2(lines.reduce((s, l) => s + l.pending * num(l.line.rate), 0));
  return { lines, state, pendingValue };
}

/** Bill fields "Convert to bill" pre-fills from a GRN: only the quantity still unbilled. */
export function billSeedFromGrn(grn: ReceiptNote, purchases: readonly PurchaseRecord[], notes: readonly ReceiptNote[]): BillSeed {
  const st = grnStatus(grn, purchases, notes);
  if (st.state === 'Closed') throw new Error('This receipt note is closed. Reopen it to bill it.');
  if (st.state === 'Billed') throw new Error('Everything on this receipt note has been billed or rejected.');
  const lines: PurchaseLine[] = st.lines
    .filter((l) => l.pending > EPS)
    .map((l) => ({
      id: generateId(),
      name: l.line.name,
      ...(l.line.hsn ? { hsn: l.line.hsn } : {}),
      ...(l.line.unit ? { unit: l.line.unit } : {}),
      quantity: l.pending,
      rate: num(l.line.rate),
      tax_rate: num(l.line.tax_rate),
      grn_line_id: l.line.id,
      ...(l.line.po_line_id ? { po_line_id: l.line.po_line_id } : {}),
      ...(l.line.item_id ? { item_id: l.line.item_id } : {}),
      ...(l.line.unit_factor ? { unit_factor: l.line.unit_factor } : {}),
      ...(l.line.godown_id ? { godown_id: l.line.godown_id } : {}),
      ...(l.line.batch_no ? { batch_no: l.line.batch_no } : {}),
      ...(l.line.mfg_date ? { mfg_date: l.line.mfg_date } : {}),
      ...(l.line.expiry_date ? { expiry_date: l.line.expiry_date } : {}),
    }));
  return {
    po_id: grn.po_id,
    vendor_id: grn.vendor_id,
    vendor_name: grn.vendor_name,
    vendor_gstin: grn.vendor_gstin,
    place_of_supply: grn.place_of_supply,
    lines,
    notes: `Against receipt note ${grn.number}${grn.challan_no ? ` (supplier challan ${grn.challan_no})` : ''}`,
  };
}

/** Rejection Out lines pre-filled with what is still rejectable on a GRN (received − rejected − billed). */
export function rejectionLinesFromGrn(grn: ReceiptNote, purchases: readonly PurchaseRecord[], notes: readonly ReceiptNote[]): ReceiptNoteLine[] {
  return grnStatus(grn, purchases, notes)
    .lines.filter((l) => l.pending > EPS)
    .map((l) => ({
      id: generateId(),
      name: l.line.name,
      ...(l.line.hsn ? { hsn: l.line.hsn } : {}),
      ...(l.line.unit ? { unit: l.line.unit } : {}),
      quantity: l.pending,
      rate: num(l.line.rate),
      tax_rate: num(l.line.tax_rate),
      grn_line_id: l.line.id,
      ...(l.line.godown_id ? { godown_id: l.line.godown_id } : {}),
      ...(l.line.batch_no ? { batch_no: l.line.batch_no } : {}),
      ...(l.line.item_id ? { item_id: l.line.item_id } : {}),
      ...(l.line.unit_factor ? { unit_factor: l.line.unit_factor } : {}),
    }));
}

/** Validate a GRN / rejection draft; '' when fine. */
export function validateReceiptNote(
  draft: Pick<ReceiptNote, 'kind' | 'vendor_name' | 'date' | 'lines' | 'grn_id'>,
  ctx: { purchases: readonly PurchaseRecord[]; notes: readonly ReceiptNote[]; excludeId?: string },
): string {
  if (!draft.vendor_name?.trim()) return 'Choose or create a vendor.';
  if (!isoDay(draft.date)) return 'Choose the date.';
  const lines = (draft.lines ?? []).filter((l) => l.name.trim() || num(l.quantity) > 0);
  if (!lines.length) return 'Add at least one line.';
  if (lines.some((l) => !l.name.trim())) return 'Every line needs an item name.';
  if (lines.some((l) => !(num(l.quantity) > 0))) return 'Every line needs a quantity above zero.';
  if (draft.kind === 'REJECTION_OUT') {
    const grn = ctx.notes.find((n) => n.id === draft.grn_id && n.kind === 'GRN');
    if (!grn) return 'Choose the receipt note the goods came in on.';
    if (draft.date < grn.date) return 'A rejection cannot be dated before its receipt note.';
    const others = ctx.notes.filter((n) => n.id !== ctx.excludeId);
    const st = new Map(grnStatus(grn, ctx.purchases, others).lines.map((l) => [l.line.id, l]));
    for (const l of lines) {
      const s = l.grn_line_id ? st.get(l.grn_line_id) : undefined;
      if (!s) return `${l.name}: not a line of receipt note ${grn.number}.`;
      if (num(l.quantity) > s.pending + EPS) return `${l.name}: only ${s.pending} can be rejected (received ${s.received}, billed ${s.billed}, rejected ${s.rejected}).`;
    }
  }
  return '';
}

/* ── Reports ──────────────────────────────────────────────────── */

export interface GrniRow {
  grnId: string;
  number: string;
  date: string;
  vendor: string;
  item: string;
  unit: string;
  pending: number;
  rate: number;
  value: number;
  ageDays: number;
}

/** "Goods received not billed": GRN quantities received on or before `asOf`, not rejected or billed. */
export function goodsReceivedNotBilled(notes: readonly ReceiptNote[], purchases: readonly PurchaseRecord[], asOf: string): GrniRow[] {
  const rows: GrniRow[] = [];
  for (const grn of notes) {
    if (grn?.kind !== 'GRN' || grn.date > asOf || grn.closed_on) continue;
    for (const l of grnStatus(grn, purchases, notes).lines) {
      if (l.pending <= EPS) continue;
      rows.push({
        grnId: grn.id, number: grn.number, date: grn.date, vendor: grn.vendor_name, item: l.line.name, unit: l.line.unit ?? '',
        pending: l.pending, rate: num(l.line.rate), value: round2(l.pending * num(l.line.rate)), ageDays: Math.max(daysBetween(grn.date, asOf), 0),
      });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

export interface PoOutstandingRow {
  poId: string;
  /** Additive (WP-8): the PO line, so readers can reach its HSN / item / unit factor. */
  lineId: string;
  number: string;
  date: string;
  expected: string;
  vendor: string;
  item: string;
  unit: string;
  ordered: number;
  /** Received on GRNs (less rejections) or billed directly. */
  received: number;
  pending: number;
  value: number;
  /** Days past the expected date on `asOf` (0 when not yet due or no date). */
  overdueDays: number;
}

/**
 * Purchase-order outstanding (Tally "Purchase Order Outstandings"): every open PO line with quantity
 * still to come. Received = accepted on GRNs (received − rejected) + billed on lines not from a GRN.
 */
export function purchaseOrderOutstanding(orders: readonly PurchaseOrder[], purchases: readonly PurchaseRecord[], notes: readonly ReceiptNote[], asOf: string): PoOutstandingRow[] {
  const rejected = rejectedByGrnLine(notes);
  const received = new Map<string, number>();
  for (const g of notes) {
    if (g?.kind !== 'GRN' || g.date > asOf) continue;
    for (const l of g.lines ?? []) {
      if (!l.po_line_id) continue;
      received.set(l.po_line_id, round2((received.get(l.po_line_id) ?? 0) + Math.max(num(l.quantity) - (rejected.get(l.id) ?? 0), 0)));
    }
  }
  for (const b of liveBills(purchases)) {
    if (b.date > asOf) continue;
    for (const l of b.lines ?? []) {
      if (!l.po_line_id || l.grn_line_id) continue; // goods billed through a GRN were counted on the GRN
      received.set(l.po_line_id, round2((received.get(l.po_line_id) ?? 0) + Math.max(num(l.quantity), 0)));
    }
  }
  const rows: PoOutstandingRow[] = [];
  for (const po of orders) {
    if (!po || po.closed_on || po.date > asOf) continue;
    for (const l of po.lines ?? []) {
      const ordered = num(l.quantity);
      if (!(ordered > 0)) continue;
      const got = received.get(l.id) ?? 0;
      const pending = Math.max(round2(ordered - got), 0);
      if (pending <= EPS) continue;
      const expected = po.expected_date ?? '';
      rows.push({
        poId: po.id, lineId: l.id, number: po.po_number, date: po.date, expected, vendor: po.vendor_name, item: l.name, unit: l.unit ?? '',
        ordered, received: got, pending, value: round2(pending * num(l.rate)),
        overdueDays: expected && expected < asOf ? daysBetween(expected, asOf) : 0,
      });
    }
  }
  return rows.sort((a, b) => (a.expected || a.date).localeCompare(b.expected || b.date) || a.number.localeCompare(b.number));
}

/* ── Storage ──────────────────────────────────────────────────── */

/**
 * R4-A4 default-godown hook: GRN lines with no godown whose stock item is held for QC (`qc_on_receipt`, or
 * `qc_settings.hold_all`) go to the QC hold godown (kind 'qc', created on first use). A line naming a godown keeps it.
 * The QC desk itself is src/lib/production/qc.ts.
 */
export function applyQcHold<L extends { godown_id?: string; item_id?: string; name?: string }>(lines: L[]): L[] {
  const holdAll = !!getJson<{ hold_all?: boolean }>(`${DB_PREFIX}qc_settings`, {}).hold_all;
  const items = peekTable<{ id: string; name?: string; track_stock?: boolean; qc_on_receipt?: boolean }>('stock_items');
  if (!holdAll && !items.some((i) => i.qc_on_receipt)) return lines;
  const key = (s: unknown) => String(s ?? '').trim().toLowerCase();
  const byId = new Map(items.map((i) => [i.id, i]));
  const byName = new Map(items.map((i) => [key(i.name), i]));
  const held = (l: L) => {
    const it = (l.item_id ? byId.get(l.item_id) : undefined) ?? byName.get(key(l.name));
    return !l.godown_id && !!it?.track_stock && (holdAll || !!it.qc_on_receipt);
  };
  if (!lines.some(held)) return lines;
  const list = godownsDb.list();
  const qc = list.find((g) => g.kind === 'qc') ?? godownsDb.save({ name: list.some((g) => key(g.name) === 'qc hold') ? 'QC hold 2' : 'QC hold', kind: 'qc' });
  return lines.map((l) => (held(l) ? { ...l, godown_id: qc.id } : l));
}

export class ReceiptNoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptNoteError';
  }
}

const now = () => new Date().toISOString();

export const receiptNotesDb = {
  all: (): ReceiptNote[] => getTable<ReceiptNote>(RECEIPT_NOTES_TABLE).filter((n) => n && typeof n.id === 'string'),
  get: (id: string): ReceiptNote | undefined => receiptNotesDb.all().find((n) => n.id === id),

  nextNumber: (kind: ReceiptNote['kind'], date?: string): string => nextReceiptNumber(receiptNotesDb.all().map((n) => n.number), kind, date),

  /** Insert a new GRN / rejection, or update one (only a GRN with nothing billed or rejected against it). */
  save(input: Omit<ReceiptNote, 'id' | 'number'> & { id?: string; number?: string }, purchases: readonly PurchaseRecord[]): ReceiptNote {
    requireAccess('books.edit');
    const all = receiptNotesDb.all();
    const existing = input.id ? all.find((n) => n.id === input.id) : undefined;
    if (existing) receiptNotesDb.assertEditable(existing, purchases);
    const typed = (input.lines ?? []).filter((l) => l.name.trim() || num(l.quantity) > 0).map((l) => ({ ...l, id: l.id || generateId(), quantity: round2(num(l.quantity)), rate: round2(num(l.rate)) }));
    // R4-A4: default-godown hook — goods held for QC go to the QC hold godown unless the line names a godown.
    const lines = input.kind === 'GRN' && !existing ? applyQcHold(typed) : typed;
    const draft = { ...input, lines };
    const problem = validateReceiptNote(draft, { purchases, notes: all, excludeId: existing?.id });
    if (problem) throw new ReceiptNoteError(problem);
    const number = existing?.number || (input.number ?? '').trim() || receiptNotesDb.nextNumber(input.kind, input.date);
    if (all.some((n) => n.id !== existing?.id && n.number.toUpperCase() === number.toUpperCase())) throw new ReceiptNoteError(`Number ${number} is already used.`);
    const record: ReceiptNote = { ...existing, ...draft, id: existing?.id ?? generateId(), number, date: isoDay(input.date), created_at: existing?.created_at ?? now(), updated_at: now() };
    setTable(RECEIPT_NOTES_TABLE, existing ? all.map((n) => (n.id === record.id ? record : n)) : [...all, record]);
    recordSeries(record.number);
    audit.record({ entity: 'purchase', entity_id: record.id, action: existing ? 'update' : 'create', doc_number: record.number, summary: `${record.kind === 'GRN' ? 'Receipt note' : 'Rejection out'} ${record.number} — ${record.vendor_name}, ${record.lines.length} line(s), ${record.date}` });
    return record;
  },

  /** A GRN that has been billed or rejected against cannot be changed or deleted (close it instead). */
  assertEditable(n: ReceiptNote, purchases: readonly PurchaseRecord[]): void {
    if (n.kind !== 'GRN') return;
    const ids = new Set((n.lines ?? []).map((l) => l.id));
    if (liveBills(purchases).some((b) => (b.lines ?? []).some((l) => l.grn_line_id && ids.has(l.grn_line_id)))) {
      throw new ReceiptNoteError('Bills are recorded against this receipt note. Close it instead.');
    }
    if (receiptNotesDb.all().some((r) => r.kind === 'REJECTION_OUT' && r.grn_id === n.id)) {
      throw new ReceiptNoteError('Goods on this receipt note were rejected. Delete the rejection first.');
    }
  },

  remove(id: string, purchases: readonly PurchaseRecord[]): void {
    const all = receiptNotesDb.all();
    const n = all.find((x) => x.id === id);
    if (!n) return;
    requireAccess('books.edit');
    receiptNotesDb.assertEditable(n, purchases);
    setTable(RECEIPT_NOTES_TABLE, all.filter((x) => x.id !== id));
    audit.record({ entity: 'purchase', entity_id: id, action: 'delete', doc_number: n.number, summary: `Deleted ${n.kind === 'GRN' ? 'receipt note' : 'rejection out'} ${n.number} (${n.vendor_name})` });
  },

  /** Close (on `closedOn`) or reopen a GRN whose remaining quantity will never be billed. */
  setClosed(id: string, closedOn: string | undefined): void {
    requireAccess('books.edit');
    setTable(RECEIPT_NOTES_TABLE, receiptNotesDb.all().map((n) => {
      if (n.id !== id) return n;
      const next: ReceiptNote = { ...n, updated_at: now() };
      if (closedOn) next.closed_on = closedOn;
      else delete next.closed_on;
      return next;
    }));
  },
};
