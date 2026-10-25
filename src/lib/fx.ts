/**
 * Foreign-currency documents in rupees — the ONE place money crosses currencies.
 *
 * A document is written in its own `currency`; `exchange_rate` (additive) is the rupee
 * value of one unit of it (Rule 34 CGST Rules: the rate notified by CBIC under s.14 of
 * the Customs Act for goods, i.e. the shipping-bill rate; RBI reference rate otherwise).
 * GST returns, the e-Invoice, Books, Tally, accounting exports and rupee dashboards all
 * convert through here so they agree to the paisa.
 *
 * Conversion rule: every figure is converted on its own (`round2(amount × rate)`, exact
 * decimal maths), EXCEPT the document total, which is `round2(total × rate)` and absorbs
 * the paise drift between the converted parts in its round-off. So the parts always
 * re-sum to the converted total, and the converted total is the same everywhere.
 *
 * A foreign document WITHOUT a rate has no rupee value: `fxRate` returns null, rupee
 * dashboards leave it out, GST reports flag it, and the ledgers (which must book
 * something) fall back to face value exactly as before. Working papers — verify the rate
 * with your CA.
 */

import type { InvoiceRecord } from '../types/invoice';
import { buildHsnRows, buildSlabs, chargesAreTaxed, mulRound2, num, round2, type CalcLine, type CalcTotals } from './invoice-calc';

type FxRecord = Partial<Pick<InvoiceRecord, 'currency' | 'exchange_rate'>> | null | undefined;

/** Upper-case currency code of a document (INR when unset). */
export function docCurrency(rec: FxRecord): string {
  return (rec?.currency || 'INR').trim().toUpperCase() || 'INR';
}

export function isForeignCurrency(rec: FxRecord): boolean {
  return docCurrency(rec) !== 'INR';
}

/** Rupees per unit of the document currency: 1 for INR, the stored rate, or null when a foreign document has none. */
export function fxRate(rec: FxRecord): number | null {
  if (!isForeignCurrency(rec)) return 1;
  const r = num(rec?.exchange_rate);
  return r > 0 ? r : null;
}

/** True when the document has a rupee value (INR, or foreign with a rate). */
export function hasInrValue(rec: FxRecord): boolean {
  return fxRate(rec) !== null;
}

/** A foreign-currency document that cannot be converted (no exchange rate). */
export function missingFxRate(rec: FxRecord): boolean {
  return fxRate(rec) === null;
}

/** INR value of `amount` on this document. A foreign document without a rate keeps its face value (legacy behaviour). */
export function inrValue(amount: number, rec: FxRecord): number {
  const r = fxRate(rec);
  const n = num(amount);
  return r === null || r === 1 ? n : mulRound2(n, r);
}

const MONEY_FIELDS = [
  'subtotal', 'discount_amount', 'taxable_value', 'cgst_amount', 'sgst_amount', 'igst_amount', 'tax_amount',
  'shipping', 'other_charges', 'amount_paid', 'cess_amount', 'tcs_amount', 'tds_amount',
] as const satisfies readonly (keyof InvoiceRecord)[];

/**
 * The stored figures of a record in rupees (for modules that read stored totals: Books,
 * exports, dashboards). Items are left untouched; `currency` becomes INR. INR records and
 * foreign records without a rate are returned as they are.
 */
export function inrRecord<T extends Partial<InvoiceRecord>>(rec: T): T {
  const r = fxRate(rec);
  if (r === null || r === 1) return rec;
  const out: Record<string, unknown> = { ...rec, currency: 'INR' };
  for (const k of MONEY_FIELDS) {
    if (typeof rec[k] === 'number') out[k] = mulRound2(rec[k] as number, r);
  }
  const total = mulRound2(num(rec.total), r);
  out.total = total;
  // Round-off absorbs the conversion drift so the parts still add up to the converted total.
  // A reverse-charge document calculated without its tax in the total (src/lib/rcm.ts) keeps it out here too.
  const rcmExcluded = !!rec.reverse_charge && !!rec.rcm_tax_excluded;
  const parts =
    num(out.taxable_value) + (rcmExcluded ? 0 : num(out.tax_amount) + num(out.cess_amount)) + num(out.tcs_amount) +
    (chargesAreTaxed(rec) ? 0 : num(out.shipping) + num(out.other_charges));
  out.round_off = typeof rec.taxable_value === 'number' ? round2(total - parts) : mulRound2(num(rec.round_off), r);
  if (typeof rec.balance_due === 'number') {
    out.balance_due = round2(total - num(out.tds_amount) - num(out.amount_paid));
  }
  return out as T;
}

function inrLine(l: CalcLine, r: number): CalcLine {
  const m = (x: number) => mulRound2(x, r);
  const taxable = m(l.taxable);
  const cgst = m(l.cgst);
  const sgst = m(l.sgst);
  const igst = m(l.igst);
  const cess = m(l.cess);
  return {
    ...l,
    rate: l.rate * r,
    cess_per_unit: l.cess_per_unit * r,
    gross: m(l.gross),
    line_discount: m(l.line_discount),
    invoice_discount: m(l.invoice_discount),
    taxable,
    cgst,
    sgst,
    igst,
    cess,
    tax: round2(cgst + sgst + igst),
    total: round2(taxable + cgst + sgst + igst + cess),
  };
}

/** Calculator output in rupees (see the conversion rule above). INR / rate-less documents pass through unchanged. */
export function inrTotals(calc: CalcTotals, rec: FxRecord): CalcTotals {
  const r = fxRate(rec);
  if (r === null || r === 1) return calc;
  const m = (x: number) => mulRound2(x, r);
  const lines = calc.lines.map((l) => inrLine(l, r));
  const charges_line = calc.charges_line ? inrLine(calc.charges_line, r) : null;
  const all = charges_line ? [...lines, charges_line] : lines;
  const sum = (pick: (l: CalcLine) => number) => round2(all.reduce((s, l) => s + pick(l), 0));
  const taxable_value = sum((l) => l.taxable);
  const cgst_amount = sum((l) => l.cgst);
  const sgst_amount = sum((l) => l.sgst);
  const igst_amount = sum((l) => l.igst);
  const tax_amount = round2(cgst_amount + sgst_amount + igst_amount);
  const cess_amount = sum((l) => l.cess);
  const shipping = m(calc.shipping);
  const other_charges = m(calc.other_charges);
  const tcs_amount = m(calc.tcs_amount);
  const total = m(calc.total);
  const rcm_tax = calc.rcm_tax ? round2(tax_amount + cess_amount) : 0;
  const parts = round2(taxable_value + tax_amount + cess_amount - rcm_tax + (charges_line ? 0 : shipping + other_charges) + tcs_amount);
  const tds_amount = m(calc.tds_amount);
  const amount_paid = m(calc.amount_paid);
  const payable = round2(total - tds_amount);
  const line_discount_total = sum((l) => l.line_discount);
  const invoice_discount_amount = sum((l) => l.invoice_discount);
  return {
    lines,
    charges_line,
    subtotal: round2(lines.reduce((s, l) => s + l.gross, 0)),
    line_discount_total,
    invoice_discount_amount,
    discount_amount: round2(line_discount_total + invoice_discount_amount),
    taxable_value,
    cgst_amount,
    sgst_amount,
    igst_amount,
    tax_amount,
    cess_amount,
    shipping,
    other_charges,
    tcs_amount,
    round_off: round2(total - parts),
    total,
    rcm_tax,
    tds_amount,
    payable,
    amount_paid,
    balance_due: round2(payable - amount_paid),
    slabs: buildSlabs(all),
    hsn_rows: buildHsnRows(all),
  };
}

/** "USD 1,000.00 @ ₹83.25" — narration for ledgers. Empty for INR / rate-less documents. */
export function fxNarration(amount: number, rec: FxRecord): string {
  const r = fxRate(rec);
  if (r === null || r === 1) return '';
  return `${docCurrency(rec)} ${round2(num(amount)).toFixed(2)} @ ₹${r}`;
}
