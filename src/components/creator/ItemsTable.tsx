import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Copy, Library, Plus, Trash2 } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { UNITS, GST_SLABS } from '../../types/invoice';
import { cn, formatCurrency } from '../../lib/utils';
import { lineKeyAction } from './line-keys';
import controls from '../../styles/controls.module.css';
import styles from './ItemsTable.module.css';

export function ItemsTable({ onPickCatalog }: { onPickCatalog: (itemId: string) => void }) {
  const items = useInvoiceStore((s) => s.items);
  const totals = useInvoiceStore((s) => s.totals);
  const gstMode = useInvoiceStore((s) => s.gst_mode);
  const currency = useInvoiceStore((s) => s.currency);
  const docType = useInvoiceStore((s) => s.doc_type);
  const { addItem, updateItem, duplicateItem, moveItem, removeItem } = useInvoiceStore.getState();
  const [cessOpen, setCessOpen] = useState<Record<string, boolean>>({});
  const showTax = gstMode !== 'NONE';
  const priced = docType !== 'DELIVERY_CHALLAN';
  const wrapRef = useRef<HTMLDivElement>(null);
  // Where focus should land after the next render (a new line, or a line that just moved).
  const focusReq = useRef<{ id?: string; index?: number; field: string } | null>(null);

  useEffect(() => {
    const req = focusReq.current;
    if (!req) return;
    focusReq.current = null;
    const rows = Array.from(wrapRef.current?.querySelectorAll<HTMLElement>('[data-line]') ?? []);
    const row = req.id ? rows.find((r) => r.dataset.line === req.id) : rows[req.index ?? rows.length - 1];
    row?.querySelector<HTMLElement>(`[data-field="${req.field}"]`)?.focus();
  }, [items]);

  const onRowKeyDown = (e: KeyboardEvent<HTMLDivElement>, id: string, index: number) => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const fields = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input, select')).filter(
      (el) => !(el as HTMLInputElement).disabled,
    );
    const action = lineKeyAction(e, { isLastCell: fields[fields.length - 1] === target, isLastLine: index === items.length - 1 });
    if (!action) return;
    e.preventDefault();
    if (action.type === 'move') {
      focusReq.current = { id, field: target.dataset.field ?? 'name' };
      moveItem(id, action.direction);
    } else if (action.type === 'add-line') {
      focusReq.current = { field: 'name' };
      addItem();
    } else {
      const rows = wrapRef.current?.querySelectorAll<HTMLElement>('[data-line]');
      rows?.[index + 1]?.querySelector<HTMLElement>('[data-field="name"]')?.focus();
    }
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
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
          <div key={item.id} data-line={item.id} className={cn(styles.row, styles.body)} onKeyDown={(e) => onRowKeyDown(e, item.id, index)}>
            <div className={cn(styles.cell, styles.cName)} data-label="Item / service">
              <div className={styles.nameWrap}>
                <input
                  className={controls.ghost}
                  data-field="name"
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
                data-field="description"
                value={item.description ?? ''}
                onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                placeholder="Description (optional)"
                aria-label={`Item ${index + 1} description`}
              />
              {showTax && priced && !(item.cess_rate || item.cess_per_unit || cessOpen[item.id]) && (
                <button type="button" className={styles.cessToggle} onClick={() => setCessOpen((o) => ({ ...o, [item.id]: true }))}>
                  + Add cess
                </button>
              )}
              {showTax && priced && (item.cess_rate || item.cess_per_unit || cessOpen[item.id]) ? (
                <div className={styles.cessRow}>
                  <span>Cess %</span>
                  <NumberInput className={styles.cessInput} value={item.cess_rate ?? 0} onChange={(n) => updateItem(item.id, 'cess_rate', n)} placeholder="0" aria-label={`Item ${index + 1} cess percent`} />
                  <span>+ per unit</span>
                  <NumberInput className={styles.cessInput} value={item.cess_per_unit ?? 0} onChange={(n) => updateItem(item.id, 'cess_per_unit', n)} placeholder="0" aria-label={`Item ${index + 1} cess per unit`} />
                </div>
              ) : null}
            </div>

            <div className={styles.cell} data-label="HSN / SAC">
              <input
                className={cn(controls.ghost, styles.mono)}
                data-field="hsn"
                value={item.hsn ?? ''}
                inputMode="numeric"
                maxLength={8}
                onChange={(e) => updateItem(item.id, 'hsn', e.target.value.replace(/\D/g, ''))}
                placeholder="—"
                aria-label={`Item ${index + 1} HSN or SAC`}
              />
            </div>

            <div className={styles.cell} data-label="Qty">
              <NumberInput className={controls.ghostNumeric} data-field="quantity" value={item.quantity} blankZero={false} onChange={(n) => updateItem(item.id, 'quantity', n)} aria-label={`Item ${index + 1} quantity`} />
            </div>

            <div className={styles.cell} data-label="Unit">
              <select className={cn(controls.ghost, styles.unit)} data-field="unit" value={item.unit || 'NOS'} onChange={(e) => updateItem(item.id, 'unit', e.target.value)} aria-label={`Item ${index + 1} unit`}>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>

            {priced && (
              <div className={styles.cell} data-label="Rate">
                <NumberInput className={controls.ghostNumeric} data-field="rate" value={item.rate} onChange={(n) => updateItem(item.id, 'rate', n)} placeholder="0.00" aria-label={`Item ${index + 1} rate`} />
              </div>
            )}

            {priced && (
              <div className={styles.cell} data-label="Disc %">
                <NumberInput className={controls.ghostNumeric} data-field="discount" value={item.discount_percent ?? 0} onChange={(n) => updateItem(item.id, 'discount_percent', Math.min(n, 100))} placeholder="0" aria-label={`Item ${index + 1} discount percent`} />
              </div>
            )}

            {priced && showTax && (
              <div className={styles.cell} data-label="GST">
                <select
                  className={cn(controls.ghost, styles.rate)}
                  data-field="gst"
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
        <span className={styles.keyHint}>
          <kbd>Enter</kbd> on the last field adds a line · <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> moves a line · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves
        </span>
      </div>
    </div>
  );
}
