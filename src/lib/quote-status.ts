/**
 * Quotation lifecycle. Only Accepted / Declined are stored (`quote_status`); Expired comes
 * from the "valid until" date (the quote's `due_date`) and Converted from a `converted`
 * link in `doc_links`, so older quotes get a sensible state with no migration.
 */

import type { InvoiceRecord, QuoteStatus } from '../types/invoice';
import { daysOverdue } from './utils';

export type QuoteState = 'Draft' | 'Sent' | 'Accepted' | 'Declined' | 'Expired' | 'Converted';

export interface LinkLike {
  from_id: string;
  relation: string;
}

export function quoteState(
  q: Pick<InvoiceRecord, 'id' | 'status' | 'due_date' | 'quote_status'>,
  links: readonly LinkLike[] = [],
  now: Date = new Date(),
): QuoteState {
  if (q.status === 'Cancelled') return 'Declined';
  if (q.quote_status === 'Declined') return 'Declined';
  if (links.some((l) => l.from_id === q.id && l.relation === 'converted')) return 'Converted';
  if (q.quote_status === 'Accepted') return 'Accepted';
  if (q.status === 'Draft') return 'Draft';
  return daysOverdue(q.due_date, now) > 0 ? 'Expired' : 'Sent';
}

/** Badge tone for a quote state, reusing the invoice badge palette. */
export function quoteTone(state: QuoteState): 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' {
  switch (state) {
    case 'Accepted':
    case 'Converted':
      return 'paid';
    case 'Declined':
      return 'cancelled';
    case 'Expired':
      return 'overdue';
    case 'Sent':
      return 'sent';
    default:
      return 'draft';
  }
}

export const QUOTE_OUTCOMES: QuoteStatus[] = ['Accepted', 'Declined'];
