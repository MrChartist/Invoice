import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListTree, Search } from 'lucide-react';
import { cn, formatDate } from '../../lib/utils';
import { godownName } from '../../lib/godowns';
import { lookupSerial, type SerialRef, type TrackingMap } from '../../lib/stock-tracking';
import type { Godown } from '../../types/stock';
import { useT } from '../../i18n';
import { invT } from '../../i18n/areas/inventory';
import { pLinkT } from '../../i18n/areas/production-r4-links'; // R4-A3
import controls from '../../styles/controls.module.css';
import styles from './inventory.module.css';

function docLink(ref: SerialRef | undefined) {
  if (!ref) return '—';
  const label = `${ref.refNumber || invT('document')} · ${formatDate(ref.date)}`;
  if (ref.refType === 'invoice' && ref.refId) return <Link to={`/invoice/${ref.refId}`}>{label}</Link>;
  if (ref.refType === 'purchase') return <Link to="/expenses">{label}</Link>;
  if (ref.kind === 'opening') return invT('openingStock');
  if (ref.kind === 'adjustment') return invT('stockAdjustmentOn', { date: formatDate(ref.date) });
  return label;
}

/** Search a serial / IMEI → purchase bill, vendor, sale invoice, client and warranty status (6.11). */
export function SerialLookup({ tracking, today, godowns, initialQuery = '' }: {
  tracking: TrackingMap;
  today: string;
  godowns: Godown[];
  initialQuery?: string;
}) {
  useT(); // re-render on a language switch (5.4)
  const [query, setQuery] = useState(initialQuery);
  const results = useMemo(() => lookupSerial(tracking, query, today), [tracking, query, today]);
  const multi = godowns.length > 1;

  return (
    <div className={styles.lookupList}>
      <div className={controls.field} style={{ maxWidth: 420 }}>
        <label className={controls.label} htmlFor="serial-q">{invT('serialLabel')}</label>
        <div style={{ position: 'relative' }}>
          <input
            id="serial-q"
            type="search"
            className={cn(controls.input, styles.mono)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={invT('serialPh')}
            autoComplete="off"
            autoFocus
          />
        </div>
      </div>
      {query.trim() && results.length === 0 && (
        <p className={styles.muted}><Search size={14} aria-hidden="true" /> {invT('noSerial', { q: query.trim() })}</p>
      )}
      {query.trim() && results.map((r) => (
        <article key={`${r.item.id}|${r.serial}`} className={styles.lookupCard} aria-label={invT('serialAria', { serial: r.serial })}>
          <div className={styles.lookupHead}>
            <span className={styles.mono}>{r.serial}</span>
            <span className={styles.muted}>{r.item.name}</span>
            <span className={r.inStock ? styles.in : styles.muted}>
              {r.inStock ? (multi ? invT('inStockAt', { godown: godownName(godowns, r.godown) }) : invT('inStock')) : invT('sold')}
            </span>
            <Link className={cn(controls.btnGhost, controls.btnSm)} to={`/manufacturing?tab=trace&dir=back&item=${encodeURIComponent(r.item.id)}&serial=${encodeURIComponent(r.serial)}`} aria-label={pLinkT('traceSerial', { serial: r.serial })}><ListTree size={14} aria-hidden="true" /> {pLinkT('trace')}</Link>
          </div>
          <div>
            <div className={styles.summaryLabel}>{invT('purchased')}</div>
            <div>{docLink(r.received)}</div>
            {r.received?.party && <div className={styles.muted}>{invT('vendorN', { name: r.received.party })}</div>}
          </div>
          <div>
            <div className={styles.summaryLabel}>{invT('sold')}</div>
            <div>{docLink(r.sale)}</div>
            {r.sale?.party && <div className={styles.muted}>{invT('clientN', { name: r.sale.party })}</div>}
            {r.returned && <div className={styles.muted}>{invT('returnedN', { number: r.returned.refNumber ?? '', date: formatDate(r.returned.date) })}</div>}
          </div>
          <div>
            <div className={styles.summaryLabel}>{invT('warrantyHead')}</div>
            {r.warranty === 'none' ? (
              <div className={styles.muted}>{r.sale ? invT('noWarranty') : '—'}</div>
            ) : (
              <div className={r.warranty === 'active' ? styles.in : styles.expired}>
                {invT(r.warranty === 'active' ? 'warrantyActive' : 'warrantyExpired', { date: formatDate(r.warrantyUntil), n: r.warrantyMonths })}
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
