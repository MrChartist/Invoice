import { useInvoiceStore } from '../../store/useInvoiceStore';
import type { InvoiceItem } from '../../types/invoice';
import styles from './ItemsTable.module.css';

/** Per-line cess editor. Render inside a line row (e.g. under the tax-rate field). */
export function CessFields({ item }: { item: InvoiceItem }) {
  const updateItem = useInvoiceStore((s) => s.updateItem);
  return (
    <div className={styles.cessRow}>
      <span>Cess %</span>
      <input className={styles.cessInput} type="number" min={0} step="0.01"
        value={item.cess_rate ?? 0} onChange={(e) => updateItem(item.id, 'cess_rate', Number(e.target.value))} />
      <span>per unit</span>
      <input className={styles.cessInput} type="number" min={0} step="0.01"
        value={item.cess_per_unit ?? 0} onChange={(e) => updateItem(item.id, 'cess_per_unit', Number(e.target.value))} />
    </div>
  );
}
