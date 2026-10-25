/**
 * Outward reverse charge (Sec 9(3) / 9(4) CGST Act, Sec 5(3) / 5(4) IGST Act): on a supply the
 * RECIPIENT pays the GST. The supplier's invoice still shows the tax (Rule 46(p): "the amount of tax
 * payable on reverse charge basis") but neither collects nor owes it.
 *
 * Two generations of stored invoices exist:
 *  - from this version on, the editor calculates a reverse-charge document with `rcm_tax_excluded:
 *    true`: `total` / `balance_due` already leave the tax out (it is printed as "Tax payable by the
 *    recipient under reverse charge");
 *  - older reverse-charge invoices stored a `total` that INCLUDES the tax. They are never rewritten
 *    (Critical Rule 3) — every supplier-side reader goes through the helpers below instead, which take
 *    the tax back out of what the customer owes.
 *
 * GST returns read the tax itself (`tax_amount`, line tax) — GSTR-1 reports it with `rchrg: 'Y'`,
 * GSTR-3B leaves it out of the supplier's liability. Books / ledger / Tally / receivables / dashboard
 * use `receivableTotal` / `receivableBalance` and post no output tax for these invoices.
 * Working papers: verify with your CA.
 */

import type { InvoiceRecord } from '../types/invoice';
import { num, round2 } from './invoice-calc';

export type RcmFields = Partial<
  Pick<
    InvoiceRecord,
    | 'reverse_charge' | 'rcm_tax_excluded' | 'doc_type' | 'tax_amount' | 'cess_amount' | 'total' | 'balance_due' | 'amount_paid'
    | 'tds_amount' | 'cgst_amount' | 'sgst_amount' | 'igst_amount'
  >
>;

/** A sales document (or note) on which the recipient pays the GST. A Bill of Supply never charges GST. */
export function isOutwardRcm(rec: RcmFields | null | undefined): boolean {
  return !!rec?.reverse_charge && rec.doc_type !== 'BILL_OF_SUPPLY';
}

/** The GST (+ cess) shown on the document as payable by the recipient; 0 for forward-charge documents. */
export function rcmTaxOf(rec: RcmFields | null | undefined): number {
  if (!rec || !isOutwardRcm(rec)) return 0;
  return round2(num(rec.tax_amount) + num(rec.cess_amount));
}

/** The part of the stored `total` that is reverse-charge tax (only on invoices saved before `rcm_tax_excluded`). */
export function rcmTaxInTotal(rec: RcmFields | null | undefined): number {
  if (!rec || rec.rcm_tax_excluded) return 0;
  return rcmTaxOf(rec);
}

/** What the customer owes on the document before payments and TDS: the stored total minus any reverse-charge tax in it. */
export function receivableTotal(rec: RcmFields): number {
  return round2(num(rec.total) - rcmTaxInTotal(rec));
}

/**
 * What is still due. Forward-charge documents keep their stored `balance_due` exactly as before; a
 * reverse-charge document is derived from `receivableTotal` (its stored balance may include the tax).
 */
export function receivableBalance(rec: RcmFields): number {
  if (!isOutwardRcm(rec) || rec.rcm_tax_excluded) {
    return typeof rec.balance_due === 'number' ? rec.balance_due : round2(num(rec.total) - num(rec.amount_paid));
  }
  return round2(receivableTotal(rec) - num(rec.tds_amount) - num(rec.amount_paid));
}

/**
 * The record as the SUPPLIER's books see it: for an outward reverse-charge document the GST heads,
 * tax and cess are zero (nothing collected, nothing owed) and `total` / `balance_due` are what the
 * customer owes. Any other record is returned unchanged (same object).
 */
export function supplierView<T extends RcmFields>(rec: T): T {
  if (!isOutwardRcm(rec)) return rec;
  return {
    ...rec,
    total: receivableTotal(rec),
    balance_due: receivableBalance(rec),
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: 0,
    tax_amount: 0,
    cess_amount: 0,
  };
}
