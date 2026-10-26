/**
 * Financial credit notes (Round 2, R2-A2 / R2-A3) — the tiny, dependency-free half every reader needs.
 *
 * A financial note is a `CREDIT_NOTE` row with `note_kind: 'financial'` (series `FCN/FY…`). It settles
 * what is left of a bill — an early-payment discount, a short payment (kasar / vatav) or a bad debt —
 * through the usual `doc_links` credit-note link, so `amountDue`, receivables, statements, the Day Book and
 * the party ledger treat it like any credit. Without GST it is NOT a GST document: GSTR-1 / 3B / 9, e-Invoice
 * and e-Way builders leave it out. The optional GST variant of a settlement discount (Sec 15(3)) carries tax
 * and is reported like any discount credit note. Working papers — verify with your CA.
 *
 * Pure, no imports beyond types: GST, e-invoice and the early-loading stats chunk import it.
 */
import type { FinancialReason, InvoiceRecord } from '../types/invoice';

export const FCN_PREFIX = 'FCN';

type NoteLike = Pick<InvoiceRecord, 'doc_type'> & Partial<Pick<InvoiceRecord, 'note_kind' | 'tax_amount' | 'cgst_amount' | 'sgst_amount' | 'igst_amount' | 'cess_amount'>>;

/** A financial credit note (with or without GST). */
export function isFinancialNote(rec: NoteLike | null | undefined): boolean {
  return !!rec && rec.doc_type === 'CREDIT_NOTE' && rec.note_kind === 'financial';
}

/** GST charged on the note (the Sec 15(3) settlement-discount variant). */
export function financialNoteTax(rec: NoteLike): number {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.abs(Number(v)) : 0);
  return n(rec.tax_amount) + n(rec.cess_amount) || n(rec.cgst_amount) + n(rec.sgst_amount) + n(rec.igst_amount);
}

/** A financial note without GST: outside GSTR-1 / 3B / 9, e-Invoice and e-Way (R2-A2 acceptance 4). */
export function isNonGstFinancialNote(rec: NoteLike | null | undefined): boolean {
  return !!rec && isFinancialNote(rec) && financialNoteTax(rec) < 0.005;
}

/** Ledger account a financial note is debited to by default (ids from `src/lib/ledger/accounts.ts`). */
export const FINANCIAL_ACCOUNT_DEFAULTS: Readonly<Record<FinancialReason, string>> = {
  settlement_discount: 'discount_allowed',
  short_payment: 'discount_allowed',
  bad_debt: 'bad_debts',
};

/** The account to debit for `rec` (its snapshot, else the reason's default). */
export function financialAccountOf(rec: Pick<InvoiceRecord, 'financial_reason' | 'financial_account'>): string {
  return rec.financial_account || FINANCIAL_ACCOUNT_DEFAULTS[rec.financial_reason ?? 'settlement_discount'] || 'discount_allowed';
}

export const FINANCIAL_REASON_LABELS: Readonly<Record<FinancialReason, string>> = {
  settlement_discount: 'Settlement discount',
  short_payment: 'Short payment (kasar)',
  bad_debt: 'Bad debt written off',
};
