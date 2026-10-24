import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { cn, formatDate } from '../../lib/utils';
import { toCsv } from '../../lib/csv';
import { shiftDay } from '../../lib/dates';
import { expiringBatches, isExpired, type TrackingMap } from '../../lib/stock-tracking';
import { godownName } from '../../lib/godowns';
import type { Godown } from '../../types/stock';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './inventory.module.css';

type View = 'all' | 'expiring' | 'expired';

interface Row {
  key: string;
  item: string;
  unit: string;
  batch: string;
  mfg?: string;
  expiry?: string;
  mrp?: number;
  qty: number;
  byGodown: Record<string, number>;
}

/** Stock by batch with MFG / expiry, and the expiring-soon / expired views (6.6). */
export function BatchesTab({ tracking, today, days, godowns, onDownload }: {
  tracking: TrackingMap;
  today: string;
  /** Expiry alert window in days. */
  days: number;
  godowns: Godown[];
  onDownload: (filename: string, csv: string) => void;
}) {
  const [view, setView] = useState<View>('all');
  const multi = godowns.length > 1;

  const rows = useMemo<Row[]>(() => {
    if (view !== 'all') {
      return expiringBatches(tracking, today, days)
        .filter((r) => (view === 'expired' ? r.daysLeft < 0 : true))
        .map((r) => ({ key: `${r.item.id}|${r.batch}`, item: r.item.name, unit: r.item.unit, batch: r.batch, expiry: r.expiry, qty: r.qty, byGodown: r.byGodown }));
    }
    const out: Row[] = [];
    for (const t of tracking.values()) {
      if (!t.item.track_batches) continue;
      for (const b of t.batches) {
        if (Math.abs(b.qty) < 1e-9) continue;
        out.push({
          key: `${t.item.id}|${b.batch}`, item: t.item.name, unit: t.item.unit, batch: b.batch || '(no batch)',
          mfg: b.mfg, expiry: b.expiry, mrp: b.mrp, qty: b.qty, byGodown: b.byGodown,
        });
      }
    }
    return out.sort((a, b) => a.item.localeCompare(b.item) || (a.expiry ?? '9999').localeCompare(b.expiry ?? '9999'));
  }, [tracking, today, days, view]);

  const status = (r: Row) => {
    if (!r.expiry) return <span className={styles.muted}>No expiry</span>;
    if (isExpired(r.expiry, today)) return <span className={styles.expired}>Expired</span>;
    if (r.expiry <= shiftDay(today, days)) return <span className={styles.soon}>Expiring soon</span>;
    return <span className={styles.in}>OK</span>;
  };

  const csv = () => {
    const head = ['Item', 'Batch', 'MFG', 'Expiry', 'MRP', 'Quantity', 'Unit', ...(multi ? godowns.map((g) => g.name) : [])];
    const body = rows.map((r) => [r.item, r.batch, r.mfg ?? '', r.expiry ?? '', r.mrp ?? '', r.qty, r.unit, ...(multi ? godowns.map((g) => r.byGodown[g.id] ?? 0) : [])]);
    onDownload(`stock-by-batch-${today}.csv`, toCsv([head, ...body]));
  };

  return (
    <>
      <div className={styles.lookupHead} style={{ padding: '0 0 0.75rem' }}>
        <div className={controls.segment} role="group" aria-label="Batch view">
          {([['all', 'Stock by batch'], ['expiring', `Expiring in ${days} days`], ['expired', 'Expired']] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={view === k} className={view === k ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setView(k)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={csv} disabled={rows.length === 0}>
          <Download size={14} aria-hidden="true" /> CSV
        </button>
      </div>
      <table className={surface.table}>
        <thead>
          <tr>
            <th>Item</th><th>Batch</th><th>MFG</th><th>Expiry</th><th className={surface.numeric}>Qty</th>
            {multi && <th>By godown</th>}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.item}</td>
              <td className={styles.mono}>{r.batch}{r.mrp ? <span className={styles.muted}> · MRP {r.mrp}</span> : null}</td>
              <td>{r.mfg ? formatDate(r.mfg) : '—'}</td>
              <td>{r.expiry ? formatDate(r.expiry) : '—'}</td>
              <td className={cn(surface.numeric, r.qty < 0 && styles.negative)}>{r.qty} {r.unit}</td>
              {multi && (
                <td className={styles.muted}>
                  {godowns.filter((g) => r.byGodown[g.id]).map((g) => `${godownName(godowns, g.id)} ${r.byGodown[g.id]}`).join(' · ') || '—'}
                </td>
              )}
              <td>{status(r)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={multi ? 7 : 6} className={styles.muted}>
              {view === 'all' ? 'No batch stock yet — record a purchase bill with batch numbers.' : 'Nothing here. Well stocked!'}
            </td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}

