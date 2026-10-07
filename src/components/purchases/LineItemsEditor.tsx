import { Plus, Trash2 } from 'lucide-react';
import type { PurchaseLine } from '../../types/purchases';
import { GST_SLABS } from '../../types/invoice';
import { blankPurchaseLine as blankLine } from '../../lib/purchases';
import { round2 } from '../../lib/invoice-calc';
import { formatCurrency } from '../../lib/utils';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './purchases.module.css';

export interface LineItemsEditorProps {
  lines: PurchaseLine[];
  onChange: (lines: PurchaseLine[]) => void;
}

/** Editable bill lines: item, HSN/SAC, qty, rate, GST%. */
export function LineItemsEditor({ lines, onChange }: LineItemsEditorProps) {
  const patch = (id: string, change: Partial<PurchaseLine>) =>
    onChange(lines.map((l) => (l.id === id ? { ...l, ...change } : l)));

  return (
    <div>
      <div className={styles.linesWrap}>
        <table className={styles.lines}>
          <thead>
            <tr>
              <th className={styles.colName}>Item</th>
              <th className={styles.colHsn}>HSN / SAC</th>
              <th className={styles.colQty}>Qty</th>
              <th className={styles.colRate}>Rate</th>
              <th className={styles.colTax}>GST %</th>
              <th className={styles.colAmt}>Amount</th>
              <th className={styles.colAct}><span className={surface.srOnly}>Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id}>
                <td data-label="Item">
                  <input
                    className={controls.ghost}
                    value={l.name}
                    placeholder="Item or service"
                    aria-label={`Line ${i + 1} item`}
                    onChange={(e) => patch(l.id, { name: e.target.value })}
                  />
                </td>
                <td data-label="HSN / SAC">
                  <input
                    className={controls.ghost}
                    value={l.hsn ?? ''}
                    inputMode="numeric"
                    placeholder="HSN"
                    aria-label={`Line ${i + 1} HSN or SAC`}
                    onChange={(e) => patch(l.id, { hsn: e.target.value.replace(/[^0-9]/g, '').slice(0, 8) })}
                  />
                </td>
                <td data-label="Qty">
                  <NumberInput
                    className={controls.ghostNumeric}
                    value={l.quantity}
                    blankZero={false}
                    aria-label={`Line ${i + 1} quantity`}
                    onChange={(quantity) => patch(l.id, { quantity })}
                  />
                </td>
                <td data-label="Rate">
                  <NumberInput
                    className={controls.ghostNumeric}
                    value={l.rate}
                    placeholder="0.00"
                    aria-label={`Line ${i + 1} rate`}
                    onChange={(rate) => patch(l.id, { rate })}
                  />
                </td>
                <td data-label="GST %">
                  <select
                    className={controls.ghost}
                    value={l.tax_rate}
                    aria-label={`Line ${i + 1} GST rate`}
                    onChange={(e) => patch(l.id, { tax_rate: Number(e.target.value) })}
                  >
                    {GST_SLABS.map((s) => (
                      <option key={s} value={s}>{s}%</option>
                    ))}
                  </select>
                </td>
                <td className={styles.lineAmount} data-label="Amount">{formatCurrency(round2(l.quantity * l.rate))}</td>
                <td>
                  <button
                    type="button"
                    className={controls.btnDanger}
                    aria-label={`Remove line ${i + 1}`}
                    disabled={lines.length === 1}
                    onClick={() => onChange(lines.filter((x) => x.id !== l.id))}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className={`${controls.btnGhost} ${controls.btnSm}`}
        style={{ marginTop: '0.5rem' }}
        onClick={() => onChange([...lines, blankLine(lines[lines.length - 1]?.tax_rate ?? 18)])}
      >
        <Plus size={15} /> Add line
      </button>
    </div>
  );
}
