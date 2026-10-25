import { Fragment } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { BillLineTracking, type BillStockContext } from './BillLineTracking';
import type { PurchaseLine } from '../../types/purchases';
import { GST_SLABS } from '../../types/invoice';
import { blankPurchaseLine as blankLine } from '../../lib/purchases';
import { round2 } from '../../lib/invoice-calc';
import { formatCurrency } from '../../lib/utils';
import { NumberInput } from '../ui/NumberInput';
import { useT } from '../../i18n';
import { purT } from '../../i18n/areas/purchases';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './purchases.module.css';

export interface LineItemsEditorProps {
  lines: PurchaseLine[];
  onChange: (lines: PurchaseLine[]) => void;
  /** Bills only: batch / serial / godown fields for tracked stock items (6.6 / 6.10 / 6.11). */
  stock?: BillStockContext;
}

/** True when a bill line is a tracked stock item and needs the extra batch / serial / godown row. */
function needsTracking(line: PurchaseLine, ctx: BillStockContext | undefined): boolean {
  if (!ctx || !line.name.trim()) return false;
  const item = ctx.find(line.name, line.hsn);
  return !!item && (!!item.track_batches || !!item.track_serials || ctx.godowns.length > 1);
}

/** Editable bill lines: item, HSN/SAC, qty, rate, GST%. */
export function LineItemsEditor({ lines, onChange, stock }: LineItemsEditorProps) {
  useT(); // re-render on a language switch (5.4)
  const patch = (id: string, change: Partial<PurchaseLine>) =>
    onChange(lines.map((l) => (l.id === id ? { ...l, ...change } : l)));

  return (
    <div>
      <div className={styles.linesWrap}>
        <table className={styles.lines}>
          <thead>
            <tr>
              <th className={styles.colName}>{purT('thItem')}</th>
              <th className={styles.colHsn}>{purT('thHsn')}</th>
              <th className={styles.colQty}>{purT('thQty')}</th>
              <th className={styles.colRate}>{purT('thRate')}</th>
              <th className={styles.colTax}>{purT('thGstPct')}</th>
              <th className={styles.colAmt}>{purT('thAmount')}</th>
              <th className={styles.colAct}><span className={surface.srOnly}>{purT('remove')}</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <Fragment key={l.id}>
              <tr>
                <td data-label={purT('thItem')}>
                  <input
                    className={controls.ghost}
                    value={l.name}
                    placeholder={purT('itemPh')}
                    aria-label={purT('lineItem', { n: i + 1 })}
                    onChange={(e) => patch(l.id, { name: e.target.value })}
                  />
                </td>
                <td data-label={purT('thHsn')}>
                  <input
                    className={controls.ghost}
                    value={l.hsn ?? ''}
                    inputMode="numeric"
                    placeholder="HSN"
                    aria-label={purT('lineHsn', { n: i + 1 })}
                    onChange={(e) => patch(l.id, { hsn: e.target.value.replace(/[^0-9]/g, '').slice(0, 8) })}
                  />
                </td>
                <td data-label={purT('thQty')}>
                  <NumberInput
                    className={controls.ghostNumeric}
                    value={l.quantity}
                    blankZero={false}
                    aria-label={purT('lineQty', { n: i + 1 })}
                    onChange={(quantity) => patch(l.id, { quantity })}
                  />
                </td>
                <td data-label={purT('thRate')}>
                  <NumberInput
                    className={controls.ghostNumeric}
                    value={l.rate}
                    placeholder="0.00"
                    aria-label={purT('lineRate', { n: i + 1 })}
                    onChange={(rate) => patch(l.id, { rate })}
                  />
                </td>
                <td data-label={purT('thGstPct')}>
                  <select
                    className={controls.ghost}
                    value={l.tax_rate}
                    aria-label={purT('lineGst', { n: i + 1 })}
                    onChange={(e) => patch(l.id, { tax_rate: Number(e.target.value) })}
                  >
                    {GST_SLABS.map((s) => (
                      <option key={s} value={s}>{s}%</option>
                    ))}
                  </select>
                </td>
                <td className={styles.lineAmount} data-label={purT('thAmount')}>{formatCurrency(round2(l.quantity * l.rate))}</td>
                <td>
                  <button
                    type="button"
                    className={controls.btnDanger}
                    aria-label={purT('removeLine', { n: i + 1 })}
                    disabled={lines.length === 1}
                    onClick={() => onChange(lines.filter((x) => x.id !== l.id))}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
              {stock && needsTracking(l, stock) && (
                <tr className={styles.trackRow}>
                  <td colSpan={7}>
                    <BillLineTracking line={l} index={i} ctx={stock} onPatch={(change) => patch(l.id, change)} />
                  </td>
                </tr>
              )}
              </Fragment>
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
        <Plus size={15} /> {purT('addLine')}
      </button>
    </div>
  );
}
