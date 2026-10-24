import { useEffect, useRef } from 'react';
import { AlertTriangle, Split } from 'lucide-react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import type { InvoiceItem } from '../../types/invoice';
import { num } from '../../lib/invoice-calc';
import { generateId } from '../../lib/storage';
import { formatDate } from '../../lib/utils';
import {
  batchOptions, fefoBatch, isExpired, serialKey, serialsInStock, serialsSold, splitLineByFefo, withBatch,
  type EditorStockContext,
} from '../../lib/stock-tracking';
import { SerialPicker } from '../inventory/SerialPicker';
import controls from '../../styles/controls.module.css';
import styles from './ItemsTable.module.css';

/**
 * Batch (FEFO), serial / IMEI and godown pickers for one editor line (6.6 / 6.10 / 6.11).
 * Renders nothing unless the line is a stock item that opted into tracking, or several godowns exist.
 */
export function LineTracking({ item, index, ctx }: { item: InvoiceItem; index: number; ctx: EditorStockContext }) {
  const stock = item.name.trim() ? ctx.find(item.name, item.hsn) : undefined;
  const { patchItem, replaceItem } = useInvoiceStore.getState();
  const autoFilled = useRef(false);
  const t = stock ? ctx.tracking.get(stock.id) : undefined;
  const godown = item.godown_id || ctx.defaultGodown;
  const where = ctx.multi ? godown : undefined;
  const options = stock?.track_batches && ctx.outgoing ? batchOptions(t, ctx.day, where) : [];
  const fefo = stock?.track_batches && ctx.outgoing ? fefoBatch(t, ctx.day, where) : undefined;

  // New outgoing line of a batch item: pre-select the batch that expires first (FEFO), once.
  useEffect(() => {
    if (autoFilled.current || !fefo || item.batch_no || num(item.quantity) <= 0) return;
    autoFilled.current = true;
    patchItem(item.id, withBatch(item, fefo));
  }, [fefo, item, patchItem]);

  if (!stock || (!stock.track_batches && !stock.track_serials && !ctx.multi)) return null;
  const n = index + 1;
  const current = options.find((o) => o.batch.toUpperCase() === (item.batch_no ?? '').toUpperCase());
  const expiry = current?.expiry ?? item.batch_expiry;
  const expired = !!item.batch_no && isExpired(expiry, ctx.day);
  const short = !!current && num(item.quantity) > current.qty;

  const serialOptions = (() => {
    if (!stock.track_serials) return [];
    const base = ctx.outgoing ? serialsInStock(t, where) : serialsSold(t);
    const have = new Set(base.map(serialKey));
    return [...base, ...(item.serials ?? []).filter((s) => !have.has(serialKey(s)))];
  })();

  return (
    <div className={styles.trackRow}>
      {ctx.multi && (
        <label className={styles.trackField}>
          <span>{ctx.outgoing ? 'From godown' : 'Return to'}</span>
          <select
            className={controls.ghost}
            value={godown}
            aria-label={`Item ${n} godown`}
            onChange={(e) => {
              // Batch and serials belong to a godown: re-pick after moving the line.
              patchItem(item.id, { godown_id: e.target.value, ...(ctx.outgoing ? { serials: undefined, batch_no: undefined, batch_expiry: undefined, batch_mfg: undefined } : {}) });
              autoFilled.current = false;
            }}
          >
            {ctx.godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      )}

      {stock.track_batches && ctx.outgoing && (
        <label className={styles.trackField}>
          <span>Batch</span>
          <select
            className={controls.ghost}
            value={item.batch_no ?? ''}
            aria-label={`Item ${n} batch`}
            onChange={(e) => {
              const pick = options.find((o) => o.batch === e.target.value);
              patchItem(item.id, withBatch(item, pick ?? (e.target.value ? { batch: e.target.value } : undefined)));
            }}
          >
            <option value="">{options.length ? 'Choose batch…' : 'No batch in stock'}</option>
            {item.batch_no && !current && <option value={item.batch_no}>{item.batch_no} (not in stock)</option>}
            {options.map((o) => (
              <option key={o.batch} value={o.batch}>
                {o.batch}{o.expiry ? ` · exp ${formatDate(o.expiry)}` : ''} · {o.qty} left{o.expired ? ' · EXPIRED' : o.batch === fefo?.batch ? ' · FEFO' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {stock.track_batches && ctx.incoming && (
        <label className={styles.trackField}>
          <span>Batch</span>
          <input
            className={controls.ghost}
            value={item.batch_no ?? ''}
            aria-label={`Item ${n} batch`}
            onChange={(e) => patchItem(item.id, { batch_no: e.target.value || undefined })}
          />
        </label>
      )}

      {stock.track_serials && (
        <div className={styles.trackWide}>
          <SerialPicker
            label={ctx.outgoing ? `Serial / IMEI for item ${n}` : `Serials returned on item ${n}`}
            options={serialOptions}
            value={item.serials ?? []}
            want={num(item.quantity)}
            onChange={(next) =>
              patchItem(item.id, {
                serials: next.length ? next : undefined,
                // The quantity follows the serials picked.
                ...(next.length ? { quantity: next.length } : {}),
                ...(ctx.outgoing && num(stock.warranty_months) > 0 ? { warranty_months: num(stock.warranty_months) } : {}),
              })
            }
          />
        </div>
      )}

      {expired && (
        <p className={styles.trackAlert} role="alert">
          <AlertTriangle size={14} aria-hidden="true" /> Batch {item.batch_no} expired on {formatDate(expiry as string)} — saving will ask you to confirm.
        </p>
      )}
      {short && (
        <p className={styles.trackNote}>
          Only {current.qty} left in batch {current.batch}.
          <button
            type="button"
            className={`${controls.btnGhost} ${controls.btnSm}`}
            onClick={() => replaceItem(item.id, splitLineByFefo({ ...withBatch(item, undefined), ...(ctx.multi ? { godown_id: godown } : {}) }, t, ctx.day, generateId))}
          >
            <Split size={14} aria-hidden="true" /> Split across batches (FEFO)
          </button>
        </p>
      )}
    </div>
  );
}
