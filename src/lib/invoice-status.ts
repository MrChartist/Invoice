/**
 * Status derivation. `Overdue` is never stored — it is a fact about today's
 * date, so it is computed on read. That keeps a stored status from going stale
 * and from silently overwriting what the user chose.
 */

import type { InvoiceRecord, InvoiceStatus } from '../types/invoice';
import { daysOverdue } from './utils';
import { receivableBalance, type RcmFields } from './rcm';

export const STATUS_OPTIONS: InvoiceStatus[] = [
  'Draft',
  'Sent',
  'Partially Paid',
  'Paid',
  'Cancelled',
];

export type StatusTone = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'cancelled';

export function statusTone(status: InvoiceStatus): StatusTone {
  switch (status) {
    case 'Paid':
      return 'paid';
    case 'Partially Paid':
      return 'partial';
    case 'Overdue':
      return 'overdue';
    case 'Cancelled':
      return 'cancelled';
    case 'Sent':
      return 'sent';
    default:
      return 'draft';
  }
}

/** The status to show: an unpaid, already-sent document past its due date is Overdue. */
export function effectiveStatus(
  invoice: Pick<InvoiceRecord, 'status' | 'due_date' | 'balance_due' | 'total' | 'amount_paid'> & RcmFields,
  now: Date = new Date(),
): InvoiceStatus {
  const stored = invoice.status;
  if (stored === 'Paid' || stored === 'Cancelled' || stored === 'Draft') return stored;

  // Reverse charge: the GST is the recipient's to pay, never outstanding (src/lib/rcm.ts).
  const outstanding = receivableBalance(invoice);

  if (outstanding <= 0) return 'Paid';
  return daysOverdue(invoice.due_date, now) > 0 ? 'Overdue' : stored;
}

/** Aging bucket for the receivables report. */
export function agingBucket(dueDate: string | undefined, now: Date = new Date()): string {
  const days = daysOverdue(dueDate, now);
  if (days === 0) return 'Not due';
  if (days <= 30) return '1–30 days';
  if (days <= 60) return '31–60 days';
  if (days <= 90) return '61–90 days';
  return '90+ days';
}
