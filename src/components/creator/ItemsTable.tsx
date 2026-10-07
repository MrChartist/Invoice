import { ArrowDown, ArrowUp, Copy, Library, Plus, Trash2 } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { UNITS, GST_SLABS } from '../../types/invoice';
import { cn, formatCurrency } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import styles from './ItemsTable.module.css';

export function ItemsTable({ onPickCatalog }: { onPickCatalog: (itemId: string) => void }) {
  const items = useInvoiceStore((s) => s.items);
  const totals = useInvoiceStore((s) => s.totals);
  const gstMode = useInvoiceStore((s) => s.gst_mode);
  const currency = useInvoiceStore((s) => s.currency);
  const docType = useInvoiceStore((s) => s.doc_type);
  const { addItem, updateItem, duplicateItem, moveItem, removeItem } = useInvoiceStore.getState();
  const showTax = gstMode !== 'NONE';
  const priced = docType !== 'DELIVERY_CHALLAN';

  return (
    <div className={styles.wrap}>
      <div className={cn(styles.row, styles.head)} aria-hidden="true">
        <span>Item / service</span>
        <span>HSN / SAC</span>
        <span className={styles.r}>Qty</span>
        <span>Unit</span>
        {priced && <span className={styles.r}>Rate</span>}
        {priced && <span className={styles.r}>Disc %</span>}
        {priced && showTax && <span className={styles.r}>GST</span>}
        {priced && <span className={styles.r}>Amount</span>}
        <span />
      </div>

      {items.map((item, index) => {
        const line = totals.lines.find((l) => l.id === item.id);
        const amount = line ? line.gross - line.line_discount : 0;
        return (
          <div key={item.id} className={cn(styles.row, styles.body)}>
            <div className={cn(styles.cell, styles.cName)} data-label="Item / service">
              <div className={styles.nameWrap}>
                <input
                  className={controls.ghost}
                  value={item.name}
                  onChange={(e) => updateItem(item.id, 'name', e.target.value)}
                  placeholder={`Item ${index + 1}`}
                  aria-label={`Item ${index + 1} name`}
                />
                <button type="button" className={styles.catalogBtn} onClick={() => onPickCatalog(item.id)} title="Pick from catalogue" aria-label="Pick from catalogue">
                  <Library size={15} />
                </button>
              </div>
              <input
                className={cn(controls.ghost, styles.desc)}
                value={item.description ?? ''}
                onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                placeholder="Description (optional)"
                aria-label={`Item ${index + 1} description`}
              />
            </div>

            <div className={styles.cell} data-label="HSN / SAC">
              <input
                className={cn(controls.ghost, styles.mono)}
                value={item.hsn ?? ''}
                inputMode="numeric"
                maxLength={8}
                onChange={(e) => updateItem(item.id, 'hsn', e.target.value.replace(/\D/g, ''))}
                placeholder="—"
                aria-label={`Item ${index + 1} HSN or SAC`}
              />
            </div>

            <div className={styles.cell} data-label="Qty">
              <NumberInput className={controls.ghostNumeric} value={item.quantity} blankZero={false} onChange={(n) => updateItem(item.id, 'quantity', n)} aria-label={`Item ${index + 1} quantity`} />
            </div>

            <div className={styles.cell} data-label="Unit">
              <select className={cn(controls.ghost, styles.unit)} value={item.unit || 'NOS'} onChange={(e) => updateItem(item.id, 'unit', e.target.value)} aria-label={`Item ${index + 1} unit`}>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>

            {priced && (
              <div className={styles.cell} data-label="Rate">
                <NumberInput className={controls.ghostNumeric} value={item.rate} onChange={(n) => updateItem(item.id, 'rate', n)} placeholder="0.00" aria-label={`Item ${index + 1} rate`} />
              </div>
            )}

            {priced && (
              <div className={styles.cell} data-label="Disc %">
                <NumberInput className={controls.ghostNumeric} value={item.discount_percent ?? 0} onChange={(n) => updateItem(item.id, 'discount_percent', Math.min(n, 100))} placeholder="0" aria-label={`Item ${index + 1} discount percent`} />
              </div>
            )}

            {priced && showTax && (
              <div className={styles.cell} data-label="GST">
                <select
                  className={cn(controls.ghost, styles.rate)}
                  value={item.tax_rate ?? 0}
                  onChange={(e) => updateItem(item.id, 'tax_rate', Number(e.target.value))}
                  aria-label={`Item ${index + 1} GST rate`}
                >
                  {GST_SLABS.map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </select>
              </div>
            )}

            {priced && (
              <div className={cn(styles.cell, styles.amount)} data-label="Amount">
                {formatCurrency(amount, currency)}
              </div>
            )}

            <div className={cn(styles.cell, styles.actions)}>
              <button type="button" className={controls.btnIcon} onClick={() => moveItem(item.id, -1)} disabled={index === 0} aria-label="Move up">
                <ArrowUp size={14} />
              </button>
              <button type="button" className={controls.btnIcon} onClick={() => moveItem(item.id, 1)} disabled={index === items.length - 1} aria-label="Move down">
                <ArrowDown size={14} />
              </button>
              <button type="button" className={controls.btnIcon} onClick={() => duplicateItem(item.id)} aria-label="Duplicate line">
                <Copy size={14} />
              </button>
              <button type="button" className={controls.btnDanger} onClick={() => removeItem(item.id)} aria-label="Remove line">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}

      <div className={styles.footer}>
        <button type="button" className={controls.btnOutline} onClick={addItem}>
          <Plus size={16} /> Add line
        </button>
      </div>
    </div>
  );
}
