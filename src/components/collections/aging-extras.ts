/**
 * R2-A7: the Receivables screen's payment scores, loaded after the screen renders (dynamic import) so the route
 * chunk does not pull the scoring / follow-up modules in statically.
 */
import type { Client, InvoiceRecord, Payment } from '../../types/invoice';
import type { CreditLinkRow } from '../../lib/amount-due';
import { paymentScores, type PaymentScore } from '../../lib/payment-score';
import { loadCollectionNotes, receiptsByParty } from '../../lib/collections';

export { PaymentScoreBadge } from './PaymentScoreBadge';

export function computeScores(data: { invoices: InvoiceRecord[]; payments: Payment[]; links: CreditLinkRow[]; clients: Client[] }, today: string): Map<string, PaymentScore> {
  const notes = loadCollectionNotes();
  return paymentScores(
    { invoices: data.invoices, payments: data.payments, links: data.links, clients: data.clients, notes, receipts: notes.length ? receiptsByParty(data.invoices, data.payments, data.clients) : [] },
    today,
  );
}
