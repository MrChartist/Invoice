import type { PurchaseLine } from '../../types/purchases';
import type { StockItem } from '../../lib/inventory';
import type { Godown } from '../../types/stock';
import { parseSerials } from '../../lib/stock-tracking';
import { num } from '../../lib/invoice-calc';
import { purT } from '../../i18n/areas/purchases';
import controls from '../../styles/controls.module.css';
import styles from './purchases.module.css';

/** What the bill form knows about stock tracking (6.6 / 6.10 / 6.11). */
export interface BillStockContext {
  /** Tracked stock item a line's name + HSN matches, if any. */
  find: (name: string, hsn?: string) => StockItem | undefined;
  /** Godowns, Main first; the picker shows only when there is more than one. */
  godowns: Godown[];
  defaultGodown: string;
}

/** Batch + MFG / expiry / MRP, serials (one per line) and godown for a bill line of a tracked item. */
export function BillLineTracking({ line, index, ctx, onPatch }: {
  line: PurchaseLine;
  index: number;
  ctx: BillStockContext;
  onPatch: (change: Partial<PurchaseLine>) => void;
}) {
  const item = ctx.find(line.name, line.hsn);
  if (!item) return null;
  const n = index + 1;
  const serials = line.serials ?? [];
  const want = num(line.quantity);
  return (
    <div className={styles.trackGrid}>
      {ctx.godowns.length > 1 && (
        <label className={controls.field}>
          <span className={controls.label}>{purT('godown')}</span>
          <select
            className={controls.select}
            value={line.godown_id || ctx.defaultGodown}
            aria-label={purT('lineGodown', { n })}
            onChange={(e) => onPatch({ godown_id: e.target.value })}
          >
            {ctx.godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      )}
      {item.track_batches && (
        <>
          <label className={controls.field}>
            <span className={controls.label}>{purT('batchNo')}</span>
            <input className={controls.input} value={line.batch_no ?? ''} aria-label={purT('lineBatch', { n })} onChange={(e) => onPatch({ batch_no: e.target.value || undefined })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{purT('mfgDate')}</span>
            <input type="date" className={controls.input} value={line.mfg_date ?? ''} aria-label={purT('lineMfg', { n })} onChange={(e) => onPatch({ mfg_date: e.target.value || undefined })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{purT('expiryDate')}</span>
            <input type="date" className={controls.input} value={line.expiry_date ?? ''} aria-label={purT('lineExpiry', { n })} onChange={(e) => onPatch({ expiry_date: e.target.value || undefined })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{purT('mrp')}</span>
            <input
              className={`${controls.input} ${controls.inputNumeric}`}
              inputMode="decimal"
              value={line.mrp ?? ''}
              aria-label={purT('lineMrp', { n })}
              onChange={(e) => onPatch({ mrp: num(e.target.value) > 0 ? num(e.target.value) : undefined })}
            />
          </label>
        </>
      )}
      {item.track_serials && (
        <label className={`${controls.field} ${styles.trackWide}`}>
          <span className={controls.label}>
            {purT('serialsLabel', { have: serials.length, want })}
          </span>
          <textarea
            className={controls.textarea}
            rows={Math.min(Math.max(want, 2), 6)}
            defaultValue={serials.join('\n')}
            aria-label={purT('lineSerials', { n })}
            placeholder={purT('serialsPh')}
            onChange={(e) => {
              const list = parseSerials(e.target.value);
              onPatch({ serials: list.length ? list : undefined });
            }}
          />
        </label>
      )}
    </div>
  );
}
