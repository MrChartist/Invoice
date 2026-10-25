/**
 * Invoice list helpers: date-range / type filters, sorting and bulk "mark paid".
 * Pure except `bulkMarkPaid`, which writes through localDb (period lock and audit apply).
 */

import type { DocumentType, InvoiceRecord } from '../types/invoice';
import { localDb } from './localDb';
import { isLocked } from './period-lock';
import { isRevenueDoc } from './stats';
import { round2 } from './invoice-calc';
import { receivableBalance } from './rcm';
import { getTable } from './storage';
import { amountDue, linkedCredits, type CreditLinkRow, type CreditMap } from './amount-due';

export type SortKey = 'date' | 'due' | 'number' | 'client' | 'total' | 'balance';
export type SortDir = 'asc' | 'desc';

export interface ListFilter {
  docType?: DocumentType | '';
  /** Inclusive local days, `YYYY-MM-DD` (compared as strings, never parsed). */
  from?: string;
  to?: string;
}

export function matchesListFilter(inv: InvoiceRecord, f: ListFilter): boolean {
  if (f.docType && inv.doc_type !== f.docType) return false;
  const day = String(inv.issue_date ?? '').slice(0, 10);
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;
  return true;
}

const balanceOf = (i: InvoiceRecord) => (isRevenueDoc(i) ? Number(receivableBalance(i)) || 0 : 0);

export function sortInvoices(rows: readonly InvoiceRecord[], key: SortKey, dir: SortDir): InvoiceRecord[] {
  const sign = dir === 'asc' ? 1 : -1;
  const val = (i: InvoiceRecord): string | number => {
    switch (key) {
      case 'date': return String(i.issue_date ?? '');
      case 'due': return String(i.due_date ?? '');
      case 'number': return String(i.invoice_number ?? '');
      case 'client': return (i.client?.name ?? '').toLowerCase();
      case 'total': return Number(i.total) || 0;
      case 'balance': return balanceOf(i);
    }
  };
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true });
    // Stable tie-break: newest first, so equal keys keep a predictable order.
    return c * sign || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  });
}

/** Live credit notes per invoice, read from `doc_links` (src/lib/amount-due.ts). */
export function loadCredits(invoices: readonly InvoiceRecord[] = localDb.invoices.getAll()): Map<string, number> {
  return linkedCredits(getTable<CreditLinkRow>('doc_links'), invoices);
}

/** What "mark paid" records for `inv`: the amount due after receipts and linked credit notes. */
export function markPaidAmount(inv: InvoiceRecord, credits?: CreditMap): number {
  return isRevenueDoc(inv) ? amountDue(inv, credits?.get(inv.id)) : 0;
}

/**
 * Can this document take a "mark paid" (open revenue document with something still due, not locked)?
 * Without `credits` linked credit notes are not looked at (the amount is checked again when paying).
 */
export function canMarkPaid(inv: InvoiceRecord, credits?: CreditMap): boolean {
  return isRevenueDoc(inv) && balanceOf(inv) > 0 && markPaidAmount(inv, credits) > 0 && !isLocked(inv);
}

/** Σ what "mark paid" would record for the documents that can take it (the bulk dialog's subtitle). */
export function bulkPaidTotal(rows: readonly InvoiceRecord[], credits?: CreditMap): number {
  return round2(rows.reduce((s, i) => s + (canMarkPaid(i, credits) ? markPaidAmount(i, credits) : 0), 0));
}

export interface BulkPaidResult {
  paid: string[];
  skipped: { number: string; reason: string }[];
  total: number;
}

/** Record the balance of each document (net of credit notes) as received on `date`. One failure never stops the rest. */
export function bulkMarkPaid(ids: readonly string[], opts: { method: string; date: string; reference?: string }): BulkPaidResult {
  const out: BulkPaidResult = { paid: [], skipped: [], total: 0 };
  const credits = loadCredits();
  for (const id of ids) {
    const inv = localDb.invoices.getById(id);
    if (!inv) continue;
    // What the customer still owes: credit notes raised against the invoice are not collected in cash
    // (the same balance the Record payment dialog offers).
    const amount = canMarkPaid(inv, credits) ? markPaidAmount(inv, credits) : 0;
    if (amount <= 0) {
      out.skipped.push({ number: inv.invoice_number, reason: isLocked(inv) ? 'locked period' : 'nothing to collect' });
      continue;
    }
    try {
      localDb.payments.record({ invoiceId: id, amount, method: opts.method, date: opts.date, reference: opts.reference, note: 'Marked paid from the invoice list' });
      out.paid.push(inv.invoice_number);
      out.total = round2(out.total + amount);
    } catch (err) {
      out.skipped.push({ number: inv.invoice_number, reason: (err as Error).message });
    }
  }
  return out;
}
