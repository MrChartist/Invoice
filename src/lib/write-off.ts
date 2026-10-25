/**
 * Bulk bad-debt write-off (8G, 8.106). Writing off an invoice's open balance records a payment row
 * flagged `write_off` (method "Written off") through `localDb.payments.record`, so the period lock,
 * approvals, the invoice's paid / status and the audit log behave exactly like a receipt. It is not
 * money: cash books, payment-mode reports and receipt numbers skip it, and the double-entry ledger
 * posts Dr Other expenses (bad debts) / Cr Sundry debtors. GST already paid is not reversed here —
 * a working paper; verify any GST relief with your CA.
 */

import type { InvoiceRecord, Payment } from '../types/invoice';
import { audit } from './audit';
import { requireAccess } from './access';
import { round2 } from './invoice-calc';
import { localDb } from './localDb';
import { receivableBalance } from './rcm';

export const WRITE_OFF_METHOD = 'Written off';

export const isWriteOff = (p: Pick<Payment, 'write_off' | 'method'> | null | undefined): boolean => !!p?.write_off;

const WRITABLE = new Set(['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY']);

/** Why an invoice cannot be written off ('' = it can). */
export function writeOffBlock(inv: Pick<InvoiceRecord, 'doc_type' | 'status'> & Partial<InvoiceRecord>): '' | 'type' | 'status' | 'nothing' {
  if (!WRITABLE.has(inv.doc_type)) return 'type';
  if (inv.status === 'Draft' || inv.status === 'Cancelled' || inv.status === 'Paid') return inv.status === 'Paid' ? 'nothing' : 'status';
  if (!(receivableBalance(inv as InvoiceRecord) > 0.004)) return 'nothing';
  return '';
}

export interface WriteOffResult {
  done: { id: string; number: string; amount: number }[];
  skipped: { id: string; number: string; reason: string }[];
  total: number;
}

/** Writes off the open balance of each invoice (one payment row each), then one summary audit row. */
export function bulkWriteOff(ids: readonly string[], opts: { date: string; reason: string }): WriteOffResult {
  requireAccess('payment.record');
  const out: WriteOffResult = { done: [], skipped: [], total: 0 };
  for (const id of ids) {
    const inv = localDb.invoices.getById(id);
    if (!inv) continue;
    const block = writeOffBlock(inv);
    if (block) {
      out.skipped.push({ id, number: inv.invoice_number, reason: block });
      continue;
    }
    const amount = round2(receivableBalance(inv));
    try {
      localDb.payments.record({ invoiceId: id, amount, method: WRITE_OFF_METHOD, date: opts.date, note: opts.reason || 'Bad debt written off', writeOff: true });
      out.done.push({ id, number: inv.invoice_number, amount });
      out.total = round2(out.total + amount);
    } catch (err) {
      out.skipped.push({ id, number: inv.invoice_number, reason: (err as Error).message });
    }
  }
  if (out.done.length) {
    try {
      audit.record({
        entity: 'payment',
        entity_id: out.done.map((d) => d.id).join(','),
        action: 'create',
        doc_number: out.done.map((d) => d.number).join(', ').slice(0, 200),
        summary: `Bulk write-off of ${out.done.length} invoice(s), ₹${out.total.toFixed(2)}${opts.reason ? ` — ${opts.reason}` : ''}`,
      });
    } catch {
      /* logging never breaks a write-off */
    }
  }
  return out;
}
