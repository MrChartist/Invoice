import { AlertTriangle } from 'lucide-react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { describeShortfall, stockWarningForInvoice } from '../../lib/inventory';
import styles from './StockWarnings.module.css';

/** "Only 3 NOS in stock" notices for tracked items — only for invoices, never quotes. */
export function StockWarnings() {
  const items = useInvoiceStore((s) => s.items);
  const docType = useInvoiceStore((s) => s.doc_type);
  const id = useInvoiceStore((s) => s.id);
  const shortfalls = stockWarningForInvoice({ doc_type: docType, items, id });
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
