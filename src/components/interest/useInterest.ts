import { useMemo } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import { accruedInterestFor, type InterestResult } from '../../lib/interest';

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Interest for one invoice, recomputed when the things that change it change. */
export function useInterest(invoice: InvoiceRecord, asOf?: string): InterestResult {
  const day = asOf ?? localToday();
  return useMemo(
    () => accruedInterestFor(invoice, day),
    // The invoice's money fields stand in for the payments / credits behind them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoice.id, invoice.status, invoice.due_date, invoice.total, invoice.amount_paid, invoice.balance_due, invoice.updated_at, day],
  );
}
