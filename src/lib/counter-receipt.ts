/**
 * Payment mode on "Amount received" (8G, A3 — Vyapar / myBillBook habit). When the user picks how the
 * money came (Cash / UPI / Bank, + UTR for UPI), the part of `amount_paid` not yet backed by a receipt
 * row becomes a real receipt (`localDb.payments.record`) with that method on save, so the cash book,
 * payment-mode report and bank matching see it. Without a mode the old behaviour stays (the amount
 * lives on the invoice only). Pure helpers; the store does the writes.
 */

import type { InvoiceRecord } from '../types/invoice';
import { round2 } from './invoice-calc';

/** Same text as `WALK_IN_NAME` in pos.ts (kept here so the editor does not load the POS module). */
export const WALK_IN_NAME = 'Walk-in customer';

export type PayMode = 'Cash' | 'UPI' | 'Bank Transfer';
export const PAY_MODES: readonly PayMode[] = ['Cash', 'UPI', 'Bank Transfer'];

const COLLECTIBLE = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'DEBIT_NOTE']);

export interface CounterSplit {
  /** The record to save: `amount_paid` lowered to what the ledger already holds. */
  record: InvoiceRecord;
  /** Receipt to record after the save (0 = none). */
  amount: number;
}

/** Split typed `amount_paid` into "already in the ledger" and "new receipt with this mode". */
export function splitCounterReceipt(record: InvoiceRecord, ledgerPaid: number, mode: PayMode | null | undefined): CounterSplit {
  if (!mode || !COLLECTIBLE.has(record.doc_type) || record.status === 'Draft' || record.status === 'Cancelled') return { record, amount: 0 };
  const typed = round2(Number(record.amount_paid) || 0);
  const diff = round2(typed - Math.max(ledgerPaid, 0));
  if (diff <= 0.004) return { record, amount: 0 };
  const paid = round2(typed - diff);
  return { record: { ...record, amount_paid: paid, balance_due: round2((Number(record.balance_due) || 0) + diff) }, amount: diff };
}

/** "Fully paid" = the total less the customer's TDS. */
export const fullyPaidAmount = (r: Pick<InvoiceRecord, 'total' | 'tds_amount'>): number => round2((Number(r.total) || 0) - (Number(r.tds_amount) || 0));

/** UTR / reference is kept only for UPI and bank receipts (trimmed, ≤ 40 chars). */
export function cleanReference(mode: PayMode | null | undefined, ref: string | undefined): string | undefined {
  if (!mode || mode === 'Cash') return undefined;
  const r = String(ref ?? '').trim().slice(0, 40);
  return r || undefined;
}
