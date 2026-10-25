/**
 * Purchase returns, supplier debit notes and supplier credit notes received (WP-3, P0-5 — Tally's
 * "Debit Note" voucher on the purchase side). Table `purchase_returns` (`PurchaseReturn`,
 * src/types/purchases.ts).
 *
 *  - DEBIT_NOTE   our debit note against a supplier bill (`DN/FY<yy-yy>/<seq>`): goods returned
 *                 (quantity limited to what was billed less earlier returns) or a value-only claim.
 *  - SUPPLIER_CN  the supplier's credit note received: their number and date, value only or with
 *                 goods. Numbered in the same DN series (it is a Debit Note voucher in our books).
 *
 * Effects (all derived on read, nothing stored twice):
 *  - Bill balance: the note is an Agst Ref against the bill. Its supplier amount (total less
 *    self-assessed GST) up to the bill's balance raises the bill's `amount_paid` (stored as
 *    `adjusted_amount`, exactly like an advance adjustment in billwise.ts); any excess stays on
 *    account (the supplier owes us). Deleting the note undoes it.
 *  - Ledger (postings-returns.ts): Dr Creditors | Cr Purchase returns (or the bill's expense
 *    account) + Cr Input CGST / SGST / IGST.
 *  - TDS (7O, 7.94): on a bill with TDS deducted at booking the note carries `tds_reversed`
 *    (`tdsReversalForReturn`): Dr TDS payable instead of the supplier for that part; the TDS register
 *    nets it from the bill's deduction.
 *  - Stock (events-returns.ts): goods leave on the note date.
 *  - GST (purchase-returns-gst.ts): ITC reduced in the note's period (3B), CDNR matching in 2B.
 *
 * Pure above the "Storage" divider. Working papers — verify with your CA.
 */

import type { NoteReasonCode, PurchaseLine, PurchaseNoteKind, PurchaseRecord, PurchaseReturn, PurchaseReturnLine } from '../types/purchases';
import { GST_NOTE_REASONS } from '../types/purchases';
import { requireAccess } from './access';
import { audit } from './audit';
import { isoDay } from './dates';
import { nextSeriesNumberFor, recordSeries } from './series-counters';
import { calculateInvoice, num, round2 } from './invoice-calc';
import { assertUnlocked } from './period-lock';
import { isVoidStatus, readPurchase } from './purchase-normalize';
import { noteSupplierAmount } from './purchase-returns-gst';
import { balanceOf, purchasesDb } from './purchases';
import { generateId, getTable, setTable } from './storage';
import { tdsReversalForReturn } from './tds-payables';

export const PURCHASE_RETURNS_TABLE = 'purchase_returns';
export const DN_PREFIX = 'DN';

const EPS = 1e-6;

/* ── Pure ─────────────────────────────────────────────────────── */

/**
 * Next `DN/FY<yy-yy>/<seq>` for a note dated `date`: above every existing number AND the series
 * high-water mark (`series_counters`), so deleting the latest note never frees its number.
 */
export function nextNoteNumber(existing: readonly string[], date?: string): string {
  return nextSeriesNumberFor(DN_PREFIX, date, existing);
}

/** Does this reason normally send goods back? (Purchase return yes; discount / correction no.) */
export function reasonReturnsGoods(reason: NoteReasonCode): boolean {
  return GST_NOTE_REASONS.find((r) => r.value === reason)?.goods ?? false;
}

/** Unit cost of a bill line after its discount (same rule as `readPurchaseLines`). */
function lineUnitCost(l: PurchaseLine): number {
  const disc = Math.min(Math.max(num((l as unknown as { discount_percent?: number }).discount_percent), 0), 100);
  return num(l.rate) * (1 - disc / 100);
}

export interface ReturnableLine {
  line: PurchaseLine;
  billed: number;
  /** Already returned on goods notes against this bill. */
  returned: number;
  /** Still returnable. */
  available: number;
  unitCost: number;
}

/** Notes against `billId`, optionally leaving one out (the note being edited). */
export function notesForBill(notes: readonly PurchaseReturn[], billId: string, excludeId?: string): PurchaseReturn[] {
  return notes.filter((n) => n && n.purchase_id === billId && n.id !== excludeId);
}

/** Per bill line: billed quantity less what earlier goods notes returned. */
export function returnableLines(bill: PurchaseRecord, notes: readonly PurchaseReturn[], excludeId?: string): ReturnableLine[] {
  const returned = new Map<string, number>();
  for (const n of notesForBill(notes, bill.id, excludeId)) {
    if (!n.goods_returned) continue;
    for (const l of n.lines ?? []) {
      if (!l.bill_line_id) continue;
      returned.set(l.bill_line_id, round2((returned.get(l.bill_line_id) ?? 0) + Math.max(num(l.quantity), 0)));
    }
  }
  return (bill.lines ?? [])
    .filter((l) => num(l.quantity) > 0)
    .map((line) => {
      const billed = num(line.quantity);
      const back = returned.get(line.id) ?? 0;
      return { line, billed, returned: back, available: Math.max(round2(billed - back), 0), unitCost: lineUnitCost(line) };
    });
}

/** Value already taken off the bill by earlier notes (their totals). */
export function notedValue(bill: PurchaseRecord, notes: readonly PurchaseReturn[], excludeId?: string): number {
  return round2(notesForBill(notes, bill.id, excludeId).reduce((s, n) => s + num(n.total), 0));
}

export interface NoteTotals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

/** GST mode of the note follows its bill: IGST when the bill charged IGST, CGST+SGST when it charged those, none for a tax-free bill. */
export function noteGstMode(bill: Pick<PurchaseRecord, 'cgst' | 'sgst' | 'igst'>): 'IGST' | 'CGST_SGST' | 'NONE' {
  if (num(bill.igst) > 0) return 'IGST';
  if (num(bill.cgst) + num(bill.sgst) > 0) return 'CGST_SGST';
  return 'NONE';
}

/** Totals of note lines (same rounding as an invoice / bill: per line, then summed). */
export function noteTotals(lines: readonly PurchaseReturnLine[], mode: 'IGST' | 'CGST_SGST' | 'NONE'): NoteTotals {
  const calc = calculateInvoice({
    items: lines.map((l) => ({
      id: l.id, name: l.name, type: 'item', hsn: l.hsn, unit: l.unit,
      quantity: num(l.quantity), rate: num(l.rate), tax_rate: mode === 'NONE' ? 0 : num(l.tax_rate),
      amount: round2(num(l.quantity) * num(l.rate)),
    })),
    gst_mode: mode,
    discount_type: 'AMOUNT',
    discount_rate: 0,
    tax_rate: 0,
    shipping: 0,
    other_charges: 0,
    round_off_enabled: false,
    amount_paid: 0,
  });
  return { taxable: calc.taxable_value, cgst: calc.cgst_amount, sgst: calc.sgst_amount, igst: calc.igst_amount, total: calc.total };
}

/** One returnable bill line as a note line (quantity to return, at the bill's unit cost). */
export function noteLineFrom(r: ReturnableLine, quantity: number): PurchaseReturnLine {
  const l = r.line;
  return {
    id: generateId(),
    bill_line_id: l.id,
    name: l.name,
    ...(l.hsn ? { hsn: l.hsn } : {}),
    ...(l.unit ? { unit: l.unit } : {}),
    quantity: round2(Math.max(num(quantity), 0)),
    rate: round2(r.unitCost),
    tax_rate: num(l.tax_rate),
    ...(l.godown_id ? { godown_id: l.godown_id } : {}),
    ...(l.batch_no ? { batch_no: l.batch_no } : {}),
  };
}

export interface NoteDraft {
  kind: PurchaseNoteKind;
  date: string;
  /** Required for DEBIT_NOTE; optional for SUPPLIER_CN (absent = on account). */
  purchaseId?: string;
  vendorId?: string;
  vendorName?: string;
  vendorGstin?: string;
  supplierNoteNumber?: string;
  supplierNoteDate?: string;
  reason: NoteReasonCode;
  goodsReturned: boolean;
  lines: PurchaseReturnLine[];
  notes?: string;
  /** For a note without a bill: GST mode and ITC claim (default IGST-less CGST+SGST, ITC claimed). */
  mode?: 'IGST' | 'CGST_SGST' | 'NONE';
  itcEligible?: boolean;
}

/**
 * Check a draft against its bill and the notes already recorded. Returns '' or a message.
 * Goods notes: every line must point at a bill line and stay within its returnable quantity.
 * Any note: its total may not exceed the bill total less earlier notes.
 */
export function validateNote(draft: NoteDraft, bill: PurchaseRecord | undefined, notes: readonly PurchaseReturn[], excludeId?: string): string {
  const day = isoDay(draft.date);
  if (!day) return 'Choose the note date.';
  if (draft.kind === 'DEBIT_NOTE' && !bill) return 'Choose the bill this debit note is against.';
  if (draft.kind === 'SUPPLIER_CN' && !draft.supplierNoteNumber?.trim()) return "Enter the supplier's credit note number.";
  if (draft.supplierNoteDate && !isoDay(draft.supplierNoteDate)) return "The supplier's credit note date is not a valid date.";
  if (!bill && !draft.vendorName?.trim()) return 'Choose the supplier.';
  if (bill) {
    const c = readPurchase(bill);
    if (!c || isVoidStatus(c.status)) return 'This bill is a draft or cancelled; a note cannot be raised against it.';
    if (day < bill.date) return 'A note cannot be dated before its bill.';
  }
  const lines = draft.lines.filter((l) => num(l.quantity) > EPS && num(l.rate) > EPS);
  if (!lines.length) return draft.goodsReturned ? 'Enter the quantity returned on at least one line.' : 'Enter the value of the note.';
  if (lines.some((l) => !l.name.trim())) return 'Every line needs a description.';
  if (bill && draft.goodsReturned) {
    const avail = new Map(returnableLines(bill, notes, excludeId).map((r) => [r.line.id, r]));
    for (const l of lines) {
      const r = l.bill_line_id ? avail.get(l.bill_line_id) : undefined;
      if (!r) return `${l.name}: goods returned must be a line of the bill.`;
      if (num(l.quantity) > r.available + EPS) return `${l.name}: only ${r.available} can be returned (billed ${r.billed}, returned earlier ${r.returned}).`;
    }
  }
  if (bill) {
    const totals = noteTotals(lines, draft.mode ?? noteGstMode(bill));
    const room = round2(num(bill.total) - notedValue(bill, notes, excludeId));
    if (totals.total > room + 0.004) return `The note (${totals.total.toFixed(2)}) exceeds what is left of the bill after earlier notes (${Math.max(room, 0).toFixed(2)}).`;
  }
  return '';
}

/** Build the record a draft stands for (pure; numbering and adjustment are filled in by the caller). */
export function noteRecordFrom(draft: NoteDraft, bill: PurchaseRecord | undefined, number: string, adjusted: number): PurchaseReturn {
  const lines = draft.lines.filter((l) => num(l.quantity) > EPS && num(l.rate) > EPS).map((l) => ({ ...l, quantity: round2(num(l.quantity)), rate: round2(num(l.rate)) }));
  const mode = bill ? noteGstMode(bill) : draft.mode ?? 'CGST_SGST';
  const t = noteTotals(lines, mode);
  const itc = bill ? !!bill.itc_eligible : draft.itcEligible ?? true;
  return {
    id: generateId(),
    kind: draft.kind,
    note_number: number,
    date: isoDay(draft.date),
    ...(bill ? { purchase_id: bill.id, bill_number: bill.bill_number, bill_date: bill.date } : {}),
    ...((bill?.vendor_id ?? draft.vendorId) ? { vendor_id: bill?.vendor_id ?? draft.vendorId } : {}),
    vendor_name: (bill?.vendor_name ?? draft.vendorName ?? '').trim(),
    ...((bill?.vendor_gstin ?? draft.vendorGstin) ? { vendor_gstin: (bill?.vendor_gstin ?? draft.vendorGstin ?? '').trim().toUpperCase() } : {}),
    ...(bill?.place_of_supply ? { place_of_supply: bill.place_of_supply } : {}),
    ...(draft.supplierNoteNumber?.trim() ? { supplier_note_number: draft.supplierNoteNumber.trim() } : {}),
    ...(isoDay(draft.supplierNoteDate) ? { supplier_note_date: isoDay(draft.supplierNoteDate) } : {}),
    reason: draft.reason,
    goods_returned: !!draft.goodsReturned,
    lines,
    taxable: t.taxable,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    total: t.total,
    itc_eligible: itc && t.cgst + t.sgst + t.igst > 0,
    ...(bill?.reverse_charge ? { reverse_charge: true } : {}),
    ...(bill?.import_type ? { import_type: bill.import_type } : {}),
    bill_kind: bill?.kind ?? 'PURCHASE',
    category: bill?.category ?? 'Purchases',
    adjusted_amount: round2(Math.max(adjusted, 0)),
    ...(bill?.cost_centre_id ? { cost_centre_id: bill.cost_centre_id } : {}),
    ...(draft.notes?.trim() ? { notes: draft.notes.trim() } : {}),
    created_at: new Date().toISOString(),
  };
}

/** Rows for the notes register CSV (header first). */
export function notesToCsvRows(notes: readonly PurchaseReturn[]): (string | number)[][] {
  return [
    ['Note no', 'Type', 'Date', 'Supplier', 'GSTIN', 'Supplier note no', 'Supplier note date', 'Against bill', 'Bill date', 'Reason', 'Goods returned', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'ITC reversed', 'Adjusted against bill', 'On account'],
    ...[...notes]
      .sort((a, b) => a.date.localeCompare(b.date) || a.note_number.localeCompare(b.note_number))
      .map((n) => [
        n.note_number, n.kind === 'DEBIT_NOTE' ? 'Debit note' : 'Supplier credit note', n.date, n.vendor_name, n.vendor_gstin ?? '',
        n.supplier_note_number ?? '', n.supplier_note_date ?? '', n.bill_number ?? '', n.bill_date ?? '',
        GST_NOTE_REASONS.find((r) => r.value === n.reason)?.label ?? n.reason, n.goods_returned ? 'Yes' : 'No',
        n.taxable, n.cgst, n.sgst, n.igst, n.total, n.itc_eligible ? round2(n.cgst + n.sgst + n.igst) : 0,
        num(n.adjusted_amount), round2(Math.max(noteSupplierAmount(n) - num(n.adjusted_amount), 0)),
      ]),
  ];
}

/* ── Storage ──────────────────────────────────────────────────── */

export class PurchaseReturnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseReturnError';
  }
}

const now = () => new Date().toISOString();

export const purchaseReturnsDb = {
  all: (): PurchaseReturn[] => getTable<PurchaseReturn>(PURCHASE_RETURNS_TABLE).filter((n) => n && typeof n.id === 'string'),
  get: (id: string): PurchaseReturn | undefined => purchaseReturnsDb.all().find((n) => n.id === id),
  forBill: (billId: string): PurchaseReturn[] => notesForBill(purchaseReturnsDb.all(), billId),
  nextNumber: (date?: string): string => nextNoteNumber(purchaseReturnsDb.all().map((n) => n.note_number), date),

  /**
   * Record a note. Checks access, the period lock on the note date, the returnable quantities and
   * the bill's remaining value; applies the supplier amount (up to the bill's balance) to the bill.
   */
  create(draft: NoteDraft): PurchaseReturn {
    requireAccess('books.edit');
    const bill = draft.purchaseId ? purchasesDb.get(draft.purchaseId) : undefined;
    if (draft.purchaseId && !bill) throw new PurchaseReturnError('The bill no longer exists.');
    const all = purchaseReturnsDb.all();
    const problem = validateNote(draft, bill, all);
    if (problem) throw new PurchaseReturnError(problem);
    const number = purchaseReturnsDb.nextNumber(draft.date);
    assertUnlocked({ issue_date: isoDay(draft.date), invoice_number: number }, 'create');
    const draftRecord0 = noteRecordFrom(draft, bill, number, 0);
    // 7O (7.94): a return on a bill with TDS deducted at booking takes the TDS on the returned value back.
    const tdsRev = bill ? tdsReversalForReturn(bill, draftRecord0.taxable, notesForBill(all, bill.id).reduce((t, x) => t + num(x.tds_reversed), 0)) : 0;
    const draftRecord: PurchaseReturn = tdsRev > 0 ? { ...draftRecord0, tds_reversed: tdsRev, ...(bill?.tds_section ? { tds_section: bill.tds_section } : {}) } : draftRecord0;
    const adjusted = bill ? round2(Math.min(noteSupplierAmount(draftRecord), balanceOf(bill))) : 0;
    const record: PurchaseReturn = { ...draftRecord, adjusted_amount: Math.max(adjusted, 0) };
    setTable(PURCHASE_RETURNS_TABLE, [...all, record]);
    recordSeries(record.note_number);
    if (bill && record.adjusted_amount > 0) {
      // Agst Ref: roll into the bill like a payment (only `amount_paid` changes; allowed in a locked bill period).
      setTable('purchases', purchasesDb.all().map((p) => (p.id === bill.id ? { ...p, amount_paid: round2(num(p.amount_paid) + record.adjusted_amount), updated_at: now() } : p)));
    }
    audit.record({
      entity: 'purchase',
      entity_id: record.id,
      action: 'create',
      doc_number: record.note_number,
      parent_id: bill?.id,
      summary: `${record.kind === 'DEBIT_NOTE' ? 'Debit note' : `Supplier credit note ${record.supplier_note_number ?? ''}`.trim()} ${record.note_number} of ₹${record.total.toFixed(2)} to ${record.vendor_name}${bill ? ` against bill ${bill.bill_number || bill.id}` : ' (on account)'} dated ${record.date}`,
    });
    return record;
  },

  /** Delete a note and undo its adjustment on the bill. */
  remove(id: string): void {
    const all = purchaseReturnsDb.all();
    const n = all.find((x) => x.id === id);
    if (!n) return;
    requireAccess('books.edit');
    assertUnlocked({ issue_date: n.date, invoice_number: n.note_number }, 'delete');
    if (n.purchase_id && num(n.adjusted_amount) > 0) {
      setTable('purchases', purchasesDb.all().map((p) => (p.id === n.purchase_id ? { ...p, amount_paid: Math.max(round2(num(p.amount_paid) - num(n.adjusted_amount)), 0), updated_at: now() } : p)));
    }
    setTable(PURCHASE_RETURNS_TABLE, all.filter((x) => x.id !== id));
    audit.record({ entity: 'purchase', entity_id: id, action: 'delete', doc_number: n.note_number, parent_id: n.purchase_id, summary: `Deleted ${n.kind === 'DEBIT_NOTE' ? 'debit note' : 'supplier credit note'} ${n.note_number} of ₹${num(n.total).toFixed(2)} (${n.vendor_name})` });
  },

  /**
   * Record the supplier's credit note number / date on a note (e.g. once the supplier issues the
   * credit note for our debit note) — needed to match GSTR-2B CDNR by number. No amount changes.
   */
  setSupplierNote(id: string, number: string, date: string): PurchaseReturn {
    requireAccess('books.edit');
    const all = purchaseReturnsDb.all();
    const n = all.find((x) => x.id === id);
    if (!n) throw new PurchaseReturnError('Note not found.');
    if (date && !isoDay(date)) throw new PurchaseReturnError("The supplier's credit note date is not a valid date.");
    const next: PurchaseReturn = { ...n, updated_at: now() };
    if (number.trim()) next.supplier_note_number = number.trim();
    else delete next.supplier_note_number;
    if (isoDay(date)) next.supplier_note_date = isoDay(date);
    else delete next.supplier_note_date;
    setTable(PURCHASE_RETURNS_TABLE, all.map((x) => (x.id === id ? next : x)));
    audit.record({ entity: 'purchase', entity_id: id, action: 'update', doc_number: n.note_number, parent_id: n.purchase_id, summary: `${n.note_number}: supplier credit note ${next.supplier_note_number ?? '—'} ${next.supplier_note_date ?? ''}`.trim() });
    return next;
  },
};
