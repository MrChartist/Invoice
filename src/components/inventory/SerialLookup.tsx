import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { cn, formatDate } from '../../lib/utils';
import { godownName } from '../../lib/godowns';
import { lookupSerial, type SerialRef, type TrackingMap } from '../../lib/stock-tracking';
import type { Godown } from '../../types/stock';
import controls from '../../styles/controls.module.css';
import styles from './inventory.module.css';

function docLink(ref: SerialRef | undefined) {
  if (!ref) return '—';
  const label = `${ref.refNumber || 'Document'} · ${formatDate(ref.date)}`;
  if (ref.refType === 'invoice' && ref.refId) return <Link to={`/invoice/${ref.refId}`}>{label}</Link>;
  if (ref.refType === 'purchase') return <Link to="/expenses">{label}</Link>;
  if (ref.kind === 'opening') return 'Opening stock';
  if (ref.kind === 'adjustment') return `Stock adjustment · ${formatDate(ref.date)}`;
  return label;
}

/** Search a serial / IMEI → purchase bill, vendor, sale invoice, client and warranty status (6.11). */
export function SerialLookup({ tracking, today, godowns, initialQuery = '' }: {
  tracking: TrackingMap;
  today: string;
  godowns: Godown[];
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const results = useMemo(() => lookupSerial(tracking, query, today), [tracking, query, today]);
  const multi = godowns.length > 1;

  return (
    <div className={styles.lookupList}>
      <div className={controls.field} style={{ maxWidth: 420 }}>
        <label className={controls.label} htmlFor="serial-q">Serial / IMEI number</label>
        <div style={{ position: 'relative' }}>
          <input
            id="serial-q"
            type="search"
            className={cn(controls.input, styles.mono)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Scan or type a serial or IMEI"
            autoComplete="off"
            autoFocus
          />
        </div>
      </div>
      {query.trim() && results.length === 0 && (
        <p className={styles.muted}><Search size={14} aria-hidden="true" /> No serial matches “{query.trim()}”.</p>
      )}
      {query.trim() && results.map((r) => (
        <article key={`${r.item.id}|${r.serial}`} className={styles.lookupCard} aria-label={`Serial ${r.serial}`}>
          <div className={styles.lookupHead}>
            <span className={styles.mono}>{r.serial}</span>
            <span className={styles.muted}>{r.item.name}</span>
            <span className={r.inStock ? styles.in : styles.muted}>
              {r.inStock ? `In stock${multi ? ` · ${godownName(godowns, r.godown)}` : ''}` : 'Sold'}
            </span>
          </div>
          <div>
            <div className={styles.summaryLabel}>Purchased</div>
            <div>{docLink(r.received)}</div>
            {r.received?.party && <div className={styles.muted}>Vendor: {r.received.party}</div>}
          </div>
          <div>
            <div className={styles.summaryLabel}>Sold</div>
            <div>{docLink(r.sale)}</div>
            {r.sale?.party && <div className={styles.muted}>Client: {r.sale.party}</div>}
            {r.returned && <div className={styles.muted}>Returned: {r.returned.refNumber} · {formatDate(r.returned.date)}</div>}
          </div>
          <div>
            <div className={styles.summaryLabel}>Warranty</div>
            {r.warranty === 'none' ? (
              <div className={styles.muted}>{r.sale ? 'No warranty recorded' : '—'}</div>
            ) : (
              <div className={r.warranty === 'active' ? styles.in : styles.expired}>
                {r.warranty === 'active' ? 'Active' : 'Expired'} · until {formatDate(r.warrantyUntil)} ({r.warrantyMonths} months)
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
