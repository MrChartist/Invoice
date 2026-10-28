import { useState } from 'react';
import type { PurchaseLine } from '../../types/purchases';
import { godownsDb } from '../../lib/godowns';
import { useCreateOnTheFly } from '../masters/useCreateOnTheFly';
import { isAltC } from '../masters/useMasterKeys';
import { s7mT } from '../../i18n/areas/inventory-7s-mini';
import type { StockItem } from '../../lib/inventory';
import type { Godown } from '../../types/stock';
import { parseSerials } from '../../lib/stock-tracking';
import { num } from '../../lib/invoice-calc';
import { purT } from '../../i18n/areas/purchases';
import controls from '../../styles/controls.module.css';
import styles from './purchases.module.css';

/**
 * R9 (RT-D1): the IMEI check digit (Luhn) — a warning only (MEIDs and odd stickers exist). Same rule as `rt-imei.ts`
 * `luhnOk` (kept inline so the bill chunk does not load the devices engine; `tests/rt-imei.test.ts` compares them).
 */
const luhn = (d: string) => [...d].reverse().reduce((s, c, i) => s + (i % 2 ? [0, 2, 4, 6, 8, 1, 3, 5, 7, 9][+c] : +c), 0) % 10 === 0;

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
  // 7S (7.84): Alt+C on the godown select creates a godown on the fly (Tally parity).
  const fly = useCreateOnTheFly();
  const [added, setAdded] = useState<Godown[]>([]);
  const item = ctx.find(line.name, line.hsn);
  if (!item) return null;
  const godowns = [...ctx.godowns, ...added.filter((g) => !ctx.godowns.some((x) => x.id === g.id))];
  const n = index + 1;
  const serials = line.serials ?? [];
  const want = num(line.quantity);
  return (
    <div className={styles.trackGrid}>
      {fly.node}
      {godowns.length > 1 && (
        <label className={controls.field}>
          <span className={controls.label}>{purT('godown')}</span>
          <select
            className={controls.select}
            value={line.godown_id || ctx.defaultGodown}
            aria-label={purT('lineGodown', { n })}
            onChange={(e) => onPatch({ godown_id: e.target.value })}
            aria-keyshortcuts="Alt+C"
            title={s7mT('godownAltC')}
            onKeyDown={(e) => {
              if (!isAltC(e.nativeEvent)) return;
              e.preventDefault();
              void fly.open({ kind: 'godown' }).then((g) => {
                const row = g && godownsDb.list().find((x) => x.id === g.id);
                if (!row) return;
                setAdded((a) => [...a, row]);
                onPatch({ godown_id: row.id });
              });
            }}
          >
            {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
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
            <span className={controls.label}>{line.unit?.trim() ? purT('mrpPer', { unit: line.unit.trim() }) : purT('mrp')}</span>
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
            {(item.serial_kind ?? (String(item.hsn ?? '').startsWith('8517') ? 'imei' : '')) === 'imei' && serials.some((s) => /^\d{15}$/.test(s) && !luhn(s)) && <span className={controls.error} data-imei-luhn> · {purT('imeiLuhn')}</span>}
          </span>
          <textarea
            className={controls.textarea}
            rows={Math.min(Math.max(want, 2), 6)}
            defaultValue={serials.map((s) => (line.serial_pairs?.[s] ? `${s} / ${line.serial_pairs[s]}` : s)).join('\n')}
            aria-label={purT('lineSerials', { n })}
            placeholder={purT('serialsPh')}
            onChange={(e) => {
              // R9 (RT-D1): "IMEI1 / IMEI2" rows pair a dual-IMEI device (the stock engine tracks IMEI 1).
              const pairs: Record<string, string> = {};
              const list = parseSerials(e.target.value).map((r) => {
                const m = /^(\d{14,16})\s*\/\s*(\d{14,16})$/.exec(r);
                if (m) pairs[m[1]] = m[2];
                return m ? m[1] : r;
              });
              onPatch({ serials: list.length ? list : undefined, serial_pairs: Object.keys(pairs).length ? pairs : undefined });
            }}
          />
        </label>
      )}
    </div>
  );
}
