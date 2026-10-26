import { useMemo } from 'react';
import type { Client, InvoiceRecord, Payment } from '../../types/invoice';
import { peekTable } from '../../lib/storage';
import { paymentScore } from '../../lib/payment-score';
import { loadCollectionNotes } from '../../lib/collections';
import { todayInput } from '../../lib/utils';
import { PaymentScoreBadge } from './PaymentScoreBadge';
import { useT } from '../../i18n';
import { colT } from '../../i18n/areas/collections';

export interface CreditScoreLineProps {
  master: Client;
  /** This client's documents (already filtered by the credit warning). */
  invoices: readonly InvoiceRecord[];
  links: readonly { from_id: string; to_id: string; relation: string }[];
  /** Without credit warnings, only a slow payer (grade C / D) is worth a notice; then the line brings its own box. */
  slowOnly?: boolean;
  wrapClass: string;
  lineClass: string;
  ariaLabel: string;
}

/** R2-A7 in the editor's credit warning: how this customer usually pays (loaded on demand with the scoring code). */
export function CreditScoreLine({ master, invoices, links, slowOnly, wrapClass, lineClass, ariaLabel }: CreditScoreLineProps) {
  useT();
  const score = useMemo(() => {
    if (!master.id) return null;
    const mine = new Set(invoices.map((i) => i.id));
    return paymentScore(master.id, {
      invoices, links, clients: [master],
      payments: peekTable<Payment>('transactions').filter((p) => mine.has(p.invoice_id)),
      notes: loadCollectionNotes().filter((n) => n.party_key === master.id), receipts: [],
    }, todayInput());
  }, [master, invoices, links]);
  if (!score) return null;
  const line = <p className={lineClass}><PaymentScoreBadge score={score} /> {colT('scTitle', { name: master.name })}: {score.reasons.join(' · ')}</p>;
  if (!slowOnly) return line;
  if (score.grade !== 'C' && score.grade !== 'D') return null;
  return <div className={wrapClass} role="status" aria-label={ariaLabel} data-payment-score-note>{line}</div>;
}

export default CreditScoreLine;
