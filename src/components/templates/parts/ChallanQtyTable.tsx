import { cn, formatQuantity } from '../../../lib/utils';
import type { InvoiceRecord } from '../../../types/invoice';
import { usePaper } from '../paper-context';
import styles from '../invoice-paper.module.css';

/**
 * Delivery challan printed without amounts (8H, "hide amounts on print"): item, HSN, quantity and
 * unit only — for goods sent to a job worker, on approval or between branches, where the receiver
 * must not see prices. The stored document keeps its values.
 */
export function ChallanQtyTable({ invoice }: { invoice: InvoiceRecord }) {
  const { t } = usePaper();
  const items = (invoice.items ?? []).filter((i) => (i.name || '').trim());
  const showHsn = items.some((i) => i.hsn);
  const total = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  return (
    <table className={styles.items} data-challan-qty-only>
      <thead>
        <tr>
          <th className={styles.center}>#</th>
          <th>{t('desc')}</th>
          {showHsn && <th className={styles.center}>{t('hsn')}</th>}
          <th className={styles.right}>{t('qty')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i, n) => (
          <tr key={i.id ?? n}>
            <td className={cn(styles.center, styles.num)}>{n + 1}</td>
            <td>
              <div className={styles.itemName}>{i.name}</div>
              {i.description && <div className={styles.itemDesc}>{i.description}</div>}
            </td>
            {showHsn && <td className={cn(styles.center, styles.num)}>{i.hsn || '-'}</td>}
            <td className={cn(styles.right, styles.num)}>
              {formatQuantity(i.quantity)}
              {i.unit ? ` ${i.unit}` : ''}
            </td>
          </tr>
        ))}
        <tr>
          <td />
          <td className={styles.itemName}>{t('qty')}</td>
          {showHsn && <td />}
          <td className={cn(styles.right, styles.num)} style={{ fontWeight: 600 }}>{formatQuantity(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
