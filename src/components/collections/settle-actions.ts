/**
 * R2-A2: the receipt dialogs' settlement actions, loaded on demand (dynamic import) so the payment dialog's
 * own chunk does not carry the settlement engine or the collections strings.
 */
import { createFinancialNote, recordReceiptAndSettle, settlementNotesFor, cancelFinancialNote, type ReceiptSettlementInput } from '../../lib/settlement';
import { withTablesRollback } from '../../lib/table-txn';
import { formatCurrency } from '../../lib/utils';
import { colT } from '../../i18n/areas/collections';
import type { Payment } from '../../types/invoice';

/** Record the receipt and settle the rest; returns the payment and a message about the note (if any). */
export function receiveAndSettle(input: ReceiptSettlementInput, currency: string): { payment: Payment; message: string } {
  const r = recordReceiptAndSettle(input);
  if (!r.note) return { payment: r.payment, message: '' };
  return {
    payment: r.payment,
    message: r.note.pending
      ? colT('settledPending', { number: r.note.note.invoice_number })
      : colT('settled', { amount: formatCurrency(Number(r.note.note.total) || 0, currency), number: r.note.note.invoice_number }),
  };
}

/**
 * Khata ₹ Received (R2-A2): save the party receipt (`run`), then settle the rest of one bill with a financial
 * credit note — both or neither.
 */
export function settleAfter<T>(run: () => T, settle: { invoiceId: string; reason: 'settlement_discount' | 'short_payment'; amount: number; date: string; gst?: boolean }): { result: T; message: string } {
  return withTablesRollback(['transactions', 'invoices', 'vouchers', 'doc_links', 'series_counters'], () => {
    const result = run();
    const r = createFinancialNote(settle.invoiceId, { amount: settle.amount, reason: settle.reason, date: settle.date, gst: settle.gst });
    const message = r.pending
      ? colT('settledPending', { number: r.note.invoice_number })
      : colT('settled', { amount: formatCurrency(Number(r.note.total) || 0, 'INR'), number: r.note.invoice_number });
    return { result, message };
  });
}

/** After a receipt is removed: offer to cancel the settlement notes raised on the bill (never automatic). */
export function offerCancelSettlement(invoiceId: string, confirm: (text: string) => boolean = (t) => window.confirm(t)): string[] {
  const done: string[] = [];
  for (const note of settlementNotesFor(invoiceId)) {
    if (!confirm(colT('settleUndo', { number: note.invoice_number }))) continue;
    cancelFinancialNote(note.id);
    done.push(colT('settleNoteCancelled', { number: note.invoice_number }));
  }
  return done;
}
