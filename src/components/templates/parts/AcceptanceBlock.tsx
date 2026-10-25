import type { InvoiceRecord } from '../../../types/invoice';
import { instalmentAmounts } from '../../../lib/payment-schedule';
import { usePaper } from '../paper-context';
import { cn } from '../../../lib/utils';
import styles from './acceptance.module.css';

/**
 * 8G (8.100 / 8.101): the document's payment schedule and, on a quotation, the client's acceptance —
 * both read only from the document itself (its own `payment_schedule` / `acceptance` snapshot), so a
 * reprint never changes (Critical Rule 3). Legacy documents print nothing. Accent variable only; the
 * printed wording stays English like the other paper labels.
 */
export function AcceptanceBlock({ invoice, compact }: { invoice: InvoiceRecord; compact?: boolean }) {
  const { currency, date } = usePaper();
  const sched = invoice.payment_schedule ?? [];
  const acc = invoice.doc_type === 'QUOTATION' ? invoice.acceptance : undefined;
  if (!sched.length && !acc) return null;
  const amounts = sched.length ? instalmentAmounts(sched, Number(invoice.total) - Number(invoice.tds_amount || 0)) : [];
  const cur = invoice.currency;
  return (
    <>
      {sched.length > 0 && (
        <section className={cn(styles.box, compact && styles.compact)} aria-label="Payment schedule" data-payment-schedule-print>
          <p className={styles.head}>Payment schedule</p>
          {sched.map((s, i) => (
            <div key={s.id} className={styles.row}>
              <span>{s.label || `Instalment ${i + 1}`}{s.percent ? ` (${s.percent}%)` : ''} · due {date(s.due_date)}</span>
              <span>{currency(amounts[i] ?? 0, cur)}</span>
            </div>
          ))}
        </section>
      )}
      {acc && (
        <section className={cn(styles.box, compact && styles.compact)} aria-label="Acceptance" data-acceptance>
          <p className={styles.head}>Accepted</p>
          <div className={styles.row}><span>By {acc.signer}</span><span>{new Date(acc.signed_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
          <div className={styles.row}><span>{acc.method === 'counter' ? 'Signed in person' : 'Accepted by message'}</span><span>{currency(acc.amount, cur)}</span></div>
          {acc.signature && <img className={styles.sig} src={acc.signature} alt={`Signature of ${acc.signer}`} />}
        </section>
      )}
    </>
  );
}
