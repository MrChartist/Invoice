/**
 * Purchase returns / supplier notes (WP-3, P0-5) as the GST, 2B-matching and Books readers see them.
 *
 * Pure: no storage, no browser APIs. Every function takes `purchase_returns` rows
 * (`PurchaseReturn`, src/types/purchases.ts) and returns figures in the shape the caller already
 * understands, so the shared report modules need only a one-line call:
 *  - `itcAdjustmentsFromNotes` — negative `NormalizedPurchase` rows for GSTR-3B: a note dated in the
 *    period reduces ITC in the table its bill claimed it in (4A(5) for ordinary bills; 4A(3) and
 *    3.1(d) together for reverse charge; 4A(1) / 4A(2) for imports), and 4D(2) when the bill's
 *    ITC was not claimed. Net ITC (4C) therefore falls by the input tax on the notes.
 *  - `notesAsBookBills` — the books side of GSTR-2B CDNR matching (sign −1).
 *  - `booksReturnEffects` — what a note changes in the indicative Books P&L / balance sheet.
 *
 * Working papers — verify with your CA. In particular: the month in which ITC is reduced (we use
 * the note's date) and the treatment of a note that turns a head negative (7O: the 3B tab shows a
 * negative 4C as it is and the set-off uses ITC carried forward first; the portal may ask for it in 4B(2)).
 */

import type { PurchaseReturn } from '../types/purchases';
import type { NormalizedPurchase } from './gst-reports';
import type { BookBill } from './gstr2b';
import { num, round2 } from './invoice-calc';
import { isoDay } from './dates';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A note is usable when it has a date and a value. */
export function isLiveNote(n: PurchaseReturn | null | undefined): n is PurchaseReturn {
  return !!n && typeof n === 'object' && !!isoDay(n.date) && num(n.total) > 0;
}

/** GST on the note (always >= 0; cess excluded — see `noteCess`). */
export const noteTax = (n: Pick<PurchaseReturn, 'cgst' | 'sgst' | 'igst'>): number => round2(Math.max(num(n.cgst), 0) + Math.max(num(n.sgst), 0) + Math.max(num(n.igst), 0));

/** Compensation cess reversed with the note (7R, 7.123; always >= 0, 0 on notes recorded before 7R). */
export const noteCess = (n: Pick<PurchaseReturn, 'cess_amount'>): number => round2(Math.max(num(n.cess_amount), 0));

/**
 * Cess to reverse on a note against `bill`: the bill's cess × note taxable ÷ bill taxable (2 decimals), never more
 * than what earlier notes left (`earlier`). 0 when the bill carries no cess. Working paper — verify with your CA.
 */
export function noteCessFor(bill: { cess_amount?: unknown; taxable?: unknown } | undefined | null, noteTaxable: number, earlier = 0): number {
  const cess = round2(Math.max(num(bill?.cess_amount), 0));
  const base = Math.max(num(bill?.taxable), 0);
  if (!(cess > 0) || !(base > 0) || !(noteTaxable > 0)) return 0;
  return Math.max(Math.min(round2((cess * Math.min(noteTaxable / base, 1))), round2(cess - Math.max(earlier, 0))), 0);
}

/** GST (+ cess, 7R) on the note that we pay to the government ourselves (reverse charge / imports), not the supplier. */
export function noteSelfTax(n: Pick<PurchaseReturn, 'reverse_charge' | 'import_type' | 'cgst' | 'sgst' | 'igst' | 'cess_amount'>): number {
  return n.reverse_charge || n.import_type ? round2(noteTax(n) + noteCess(n)) : 0;
}

/** TDS the note takes back from the TDS payable (7O, 7.94; the bill had TDS deducted at booking), >= 0. */
export function noteTdsReversed(n: Pick<PurchaseReturn, 'tds_reversed'>): number {
  return round2(Math.max(num(n.tds_reversed), 0));
}

/** What the note takes off the supplier's account: its total less self-assessed GST, less TDS reversed (7O). */
export function noteSupplierAmount(n: PurchaseReturn): number {
  return round2(Math.max(num(n.total) - noteSelfTax(n) - noteTdsReversed(n), 0));
}

/** The note's ITC (input tax it reverses): its GST (+ cess, 7R — `total` includes it) when the bill claimed ITC, else 0. */
export function noteItc(n: PurchaseReturn): { igst: number; cgst: number; sgst: number; cess: number; total: number } {
  if (!n.itc_eligible) return { igst: 0, cgst: 0, sgst: 0, cess: 0, total: 0 };
  const igst = round2(Math.max(num(n.igst), 0));
  const cgst = round2(Math.max(num(n.cgst), 0));
  const sgst = round2(Math.max(num(n.sgst), 0));
  const cess = noteCess(n);
  return { igst, cgst, sgst, cess, total: round2(igst + cgst + sgst + cess) };
}

/**
 * GSTR-3B: negative purchase rows for the notes dated inside the period (`inPeriod(date)`), to be
 * appended to the purchases `buildGstr3b` reads. Same classification as the bill the note is
 * against (snapshot fields on the note), so the reduction lands in the same table.
 */
export function itcAdjustmentsFromNotes(notes: readonly PurchaseReturn[], inPeriod: (date: string) => boolean): NormalizedPurchase[] {
  const out: NormalizedPurchase[] = [];
  for (const n of notes ?? []) {
    if (!isLiveNote(n) || !inPeriod(n.date)) continue;
    const tax = round2(noteTax(n) + noteCess(n));
    // A note with no GST (exempt / unregistered supplier) would be read as a Table 5 value: leave it out.
    if (!(tax > 0)) continue;
    out.push({
      id: `note:${n.id}`,
      number: str(n.supplier_note_number) || n.note_number,
      date: n.date,
      supplierName: n.vendor_name,
      supplierGstin: str(n.vendor_gstin).toUpperCase(),
      supplierState: str(n.vendor_gstin).slice(0, 2),
      reverseCharge: !!n.reverse_charge,
      itcEligible: !!n.itc_eligible,
      taxable: -round2(Math.max(num(n.taxable), 0)),
      igst: -round2(Math.max(num(n.igst), 0)),
      cgst: -round2(Math.max(num(n.cgst), 0)),
      sgst: -round2(Math.max(num(n.sgst), 0)),
      // 7R (7.123): cess on the note comes off 4A cess (and 3.1(d) cess for reverse charge) like the GST.
      ...(noteCess(n) > 0 ? { cess: -noteCess(n) } : {}),
      itcReversed: 0,
      itcReversalReason: '',
      importType: n.import_type === 'GOODS' || n.import_type === 'SERVICES' ? n.import_type : '',
    });
  }
  return out;
}

/** Totals of the ITC reduction for a period (the 3B tab's "Supplier notes" line). */
export function itcNoteSummary(notes: readonly PurchaseReturn[], inPeriod: (date: string) => boolean): { count: number; igst: number; cgst: number; sgst: number; cess: number; total: number } {
  const s = { count: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, total: 0 };
  for (const n of notes ?? []) {
    if (!isLiveNote(n) || !inPeriod(n.date)) continue;
    const itc = noteItc(n);
    if (!(itc.total > 0)) continue;
    s.count++;
    s.igst = round2(s.igst + itc.igst);
    s.cgst = round2(s.cgst + itc.cgst);
    s.sgst = round2(s.sgst + itc.sgst);
    s.cess = round2(s.cess + itc.cess);
  }
  s.total = round2(s.igst + s.cgst + s.sgst + s.cess);
  return s;
}

/**
 * GSTR-2B: the books side of CDNR lines. A supplier credit note matches on the supplier's note
 * number; a debit note without the supplier's number yet can only match on value (same GSTIN,
 * tax and date within tolerance). Imports never have CDNR lines.
 */
export function notesAsBookBills(notes: readonly PurchaseReturn[]): BookBill[] {
  const out: BookBill[] = [];
  for (const n of notes ?? []) {
    if (!isLiveNote(n) || n.import_type) continue;
    const tax = noteTax(n);
    out.push({
      id: `note:${n.id}`,
      number: str(n.supplier_note_number) || n.note_number,
      date: isoDay(n.supplier_note_date) || n.date,
      partyName: n.vendor_name,
      gstin: str(n.vendor_gstin).toUpperCase(),
      taxable: round2(Math.max(num(n.taxable), 0)),
      igst: round2(Math.max(num(n.igst), 0)),
      cgst: round2(Math.max(num(n.cgst), 0)),
      sgst: round2(Math.max(num(n.sgst), 0)),
      tax,
      itcEligible: !!n.itc_eligible,
      reverseCharge: !!n.reverse_charge,
      importType: '',
      boeNumber: '',
      in4a5: !n.reverse_charge && tax > 0 && !!n.itc_eligible,
      sign: -1,
    });
  }
  return out;
}

export interface BooksReturnEffect {
  date: string;
  /** Taken off the supplier's account (Books payables). */
  payable: number;
  /** ITC given back (Books GST receivable falls). */
  itc: number;
  /** Self-assessed GST reversed (reverse charge / imports). */
  selfTax: number;
  /** Additive (7O): TDS payable reversed with the note (bill with TDS at booking). */
  tds: number;
  /** Cost credited back: taxable + GST that was not claimed as ITC. */
  cost: number;
  isExpense: boolean;
  category: string;
  ref: string;
}

/** What each note changes in the indicative Books (accrual P&L, balance sheet). */
export function booksReturnEffects(notes: readonly PurchaseReturn[] | undefined): BooksReturnEffect[] {
  const out: BooksReturnEffect[] = [];
  for (const n of notes ?? []) {
    if (!isLiveNote(n)) continue;
    const tax = round2(noteTax(n) + noteCess(n));
    const itc = noteItc(n).total;
    out.push({
      date: n.date,
      payable: noteSupplierAmount(n),
      itc,
      selfTax: noteSelfTax(n),
      tds: noteTdsReversed(n),
      cost: round2(Math.max(num(n.taxable), 0) + (n.itc_eligible ? 0 : tax)),
      isExpense: n.bill_kind === 'EXPENSE',
      category: str(n.category) || (n.bill_kind === 'EXPENSE' ? 'Other expenses' : 'Purchases'),
      ref: n.id,
    });
  }
  return out;
}
