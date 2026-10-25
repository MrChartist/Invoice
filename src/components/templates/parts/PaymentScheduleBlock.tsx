import type { InvoiceRecord } from '../../../types/invoice';
import { usePaper } from '../paper-context';
import { cn } from '../../../lib/utils';
import styles from './acceptance.module.css';

/**
 * R2-A1: the payment term printed on the document — its name and, when offered, the early-payment line
 * ("Pay ₹ 98,000 by 02 Nov 2026 (2% early-payment discount)"). Read only from the document's own
 * `payment_terms` snapshot, so a reprint never changes (Critical Rule 3); the instalment rows themselves are
 * printed by the 8G schedule block. The UPI QR keeps the full amount (no second QR). Accent variable only.
 */
export function PaymentScheduleBlock({ invoice, compact }: { invoice: InvoiceRecord; compact?: boolean }) {
  const { currency, date } = usePaper();
  const terms = invoice.payment_terms;
  if (!terms?.name) return null;
  if (invoice.doc_type === 'CREDIT_NOTE' || invoice.doc_type === 'DELIVERY_CHALLAN') return null;
  const e = terms.early_discount;
  const total = Number(invoice.total) - Number(invoice.tds_amount || 0);
  return (
    <section className={cn(styles.box, compact && styles.compact)} aria-label="Payment terms" data-payment-terms-print>
      <p className={styles.head}>Payment terms</p>
      <div className={styles.row}>
        <span>{terms.name}</span>
        {!invoice.payment_schedule?.length && invoice.due_date && <span>due {date(invoice.due_date)}</span>}
      </div>
      {e && e.amount > 0 && (
        <div className={styles.row} data-early-pay>
          <span>Pay {currency(Math.max(total - e.amount, 0), invoice.currency)} by {date(e.until)} ({e.percent}% early-payment discount)</span>
        </div>
      )}
    </section>
  );
}
