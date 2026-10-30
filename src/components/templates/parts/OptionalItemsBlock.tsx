import type { InvoiceRecord } from '../../../types/invoice';
import { optionalBlock } from '../../../lib/proposal-sections';
import { formatQuantity } from '../../../lib/utils';
import { usePaper } from '../paper-context';
import styles from './sales-r2-paper.module.css';

/**
 * R2-B3: "Optional items" on a quotation — add-ons and alternatives the client has not selected, with
 * their own subtotal (before GST). They are outside the quotation total (`isExcludedLine`); a selected
 * one prints in the main items table instead. Accent variable only; wording stays English on paper.
 */
export function OptionalItemsBlock({ invoice }: { invoice: InvoiceRecord }) {
  const { money, currency } = usePaper();
  const { rows, subtotal } = optionalBlock(invoice);
  if (!rows.length) return null;
  return (
    <section className={styles.optional} aria-label="Optional items" data-optional-items>
      <div className={styles.optHead}>Optional items</div>
      <table className={styles.optTable}>
        <thead>
          <tr>
            <th>Description</th>
            <th className={styles.num}>Qty</th>
            <th className={styles.num}>Rate</th>
            <th className={styles.num}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item.id}>
              <td>
                {r.option && <span className={styles.optTag}>{r.option}</span>}
                {r.item.name || '-'}
                {r.item.description && <div className={styles.optNote}>{r.item.description}</div>}
              </td>
              <td className={styles.num}>{formatQuantity(Number(r.item.quantity) || 0)}{r.item.unit ? ` ${r.item.unit}` : ''}</td>
              <td className={styles.num}>{money(Number(r.item.rate) || 0, invoice.currency)}</td>
              <td className={styles.num}>{money(r.amount, invoice.currency)}</td>
            </tr>
          ))}
          <tr className={styles.optFoot}>
            <td colSpan={3}>Optional items subtotal (before GST)</td>
            <td className={styles.num}>{currency(subtotal, invoice.currency)}</td>
          </tr>
        </tbody>
      </table>
      <div className={styles.optNote}>Not included in the total above. Tell us which ones to add; GST applies at the line rate.</div>
    </section>
  );
}
