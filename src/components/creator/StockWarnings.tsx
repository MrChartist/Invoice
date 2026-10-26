import { useDeferredValue, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { describeShortfall, stockWarningForInvoice } from '../../lib/inventory';
import { liveHeldStock } from '../../lib/stock-tracking';
import styles from './StockWarnings.module.css';

/** "Only 3 NOS in stock" notices for tracked items — only for invoices, never quotes. */
export function StockWarnings() {
  const items = useInvoiceStore((s) => s.items);
  const docType = useInvoiceStore((s) => s.doc_type);
  const id = useInvoiceStore((s) => s.id);
  // Deferred: typing stays responsive; the lib caches positions, so this is cheap anyway.
  const deferredItems = useDeferredValue(items);
  const shortfalls = useMemo(() => stockWarningForInvoice({ doc_type: docType, items: deferredItems, id }, liveHeldStock(id || undefined)), [docType, deferredItems, id]);
  if (shortfalls.length === 0) return null;

  return (
    <div className={styles.wrap} role="status">
      {shortfalls.map((s) => (
        <p key={s.itemId} className={styles.line}>
          <AlertTriangle size={14} /> {describeShortfall(s)}
        </p>
      ))}
    </div>
  );
}
