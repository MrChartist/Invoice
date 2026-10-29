import { useMemo, useState } from 'react';
import { loadStockQuery, type RateRow } from '../../lib/stock-query';
import type { StockItem } from '../../lib/inventory';
import { formatDate, formatMoney } from '../../lib/utils';
import { useT } from '../../i18n';
import { imT } from '../../i18n/areas/inventory-masters';
import controls from '../../styles/controls.module.css';
import styles from './masters.module.css';
import inv from './inventory.module.css';

/** Stock Query (WP-8): one item — stock by godown / batch, last purchase / sale rates, pending orders, prices. */
export function StockQueryTab({ items, version, today, initialId }: { items: StockItem[]; version: number; today: string; initialId?: string }) {
  useT(); // re-render on a language switch (5.4)
  const tracked = useMemo(() => items.filter((i) => i.track_stock).sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const [id, setId] = useState(() => (initialId && tracked.some((i) => i.id === initialId) ? initialId : ''));
  // `version` re-reads after any stock change on the page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const q = useMemo(() => (id ? loadStockQuery(id, today) : null), [id, today, version]);
  const unit = q?.item.unit ?? '';

  const rates = (title: string, rows: RateRow[]) => (
    <div className={styles.card}>
      <p className={styles.cardTitle}>{title}</p>
      {rows.length === 0 ? <p className={styles.muted}>{imT('nothing')}</p> : (
        <table className={styles.mini}>
          <thead><tr><th>{imT('date')}</th><th>{imT('party')}</th><th className={styles.num}>{imT('qty')}</th><th className={styles.num}>{imT('ratePer', { unit })}</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}><td>{formatDate(r.date)}<div className={styles.muted}>{r.ref}</div></td><td>{r.party || '-'}</td><td className={styles.num}>{r.qty}</td><td className={styles.num}>{formatMoney(r.rate)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div>
      <div className={styles.toolbar}>
        <div className={controls.field} style={{ minWidth: 260 }}>
          <label className={controls.label} htmlFor="sq-item">{imT('queryItem')}</label>
          <select id="sq-item" className={controls.select} value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">{imT('chooseItem')}</option>
            {tracked.map((i) => <option key={i.id} value={i.id}>{i.name}{i.sku ? ` (${i.sku})` : ''}</option>)}
          </select>
        </div>
      </div>
      {q && (
        <>
          <div className={inv.summaryStrip}>
            <div className={inv.summaryCell}><span className={inv.summaryLabel}>{imT('closing')}</span><span className={inv.summaryValue}>{q.qty} {unit}</span>{q.compound && <span className={styles.muted}>{q.compound}</span>}</div>
            <div className={inv.summaryCell}><span className={inv.summaryLabel}>{imT('value')}</span><span className={inv.summaryValue}>₹ {formatMoney(q.value)}</span></div>
            <div className={inv.summaryCell}><span className={inv.summaryLabel}>{imT('avgCost')}</span><span className={inv.summaryValue}>₹ {formatMoney(q.avgCost)}</span></div>
            <div className={inv.summaryCell}><span className={inv.summaryLabel}>{imT('standardCost')}</span><span className={inv.summaryValue}>{q.standardCost !== undefined ? `₹ ${formatMoney(q.standardCost)}` : imT('notSet')}</span></div>
            <div className={inv.summaryCell}><span className={inv.summaryLabel}>{imT('sellingPrice')}</span><span className={inv.summaryValue}>{q.sellingPrice !== undefined ? `₹ ${formatMoney(q.sellingPrice)}` : imT('notSet')}</span></div>
            <div className={inv.summaryCell}><span className={inv.summaryLabel}>{imT('pendingSo')}</span><span className={inv.summaryValue}>{q.pendingSo} {unit}</span></div>
            <div className={inv.summaryCell}><span className={inv.summaryLabel}>{imT('pendingPo')}</span><span className={inv.summaryValue}>{q.pendingPo} {unit}</span></div>
          </div>
          <p className={styles.muted} style={{ marginTop: '0.5rem' }}>{imT('queryHint', { unit })}</p>
          <div className={styles.cards}>
            {q.byGodown.length > 0 && (
              <div className={styles.card}>
                <p className={styles.cardTitle}>{imT('byGodown')}</p>
                <table className={styles.mini}><tbody>{q.byGodown.map((g) => <tr key={g.id}><td>{g.name}</td><td className={styles.num}>{g.qty} {unit}</td></tr>)}</tbody></table>
              </div>
            )}
            {q.batches.length > 0 && (
              <div className={styles.card}>
                <p className={styles.cardTitle}>{imT('batches')}</p>
                <table className={styles.mini}>
                  <thead><tr><th>{imT('batches')}</th><th>{imT('expiry')}</th><th className={styles.num}>{imT('qty')}</th></tr></thead>
                  <tbody>{q.batches.map((b) => <tr key={b.batch}><td>{b.batch}</td><td>{b.expiry ? formatDate(b.expiry) : '-'}</td><td className={styles.num}>{b.qty}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            {rates(imT('lastPurchases'), q.lastPurchases)}
            {rates(imT('lastSales'), q.lastSales)}
            {q.soLines.length > 0 && (
              <div className={styles.card}>
                <p className={styles.cardTitle}>{imT('pendingSo')}</p>
                <table className={styles.mini}>
                  <thead><tr><th>{imT('thOrder')}</th><th>{imT('thParty')}</th><th className={styles.num}>{imT('thToDeliver')}</th></tr></thead>
                  <tbody>{q.soLines.map((r) => <tr key={r.lineId}><td>{r.number}<div className={styles.muted}>{r.due ? formatDate(r.due) : ''}</div></td><td>{r.party}</td><td className={styles.num}>{r.pendingDelivery} {r.unit}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
