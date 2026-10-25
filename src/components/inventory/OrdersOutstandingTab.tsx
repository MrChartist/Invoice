import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { groupOutstanding, salesOrderOutstanding, type OutstandingGroupBy } from '../../lib/sales-orders';
import type { InvoiceRecord } from '../../types/invoice';
import { getTable } from '../../lib/storage';
import { cn, formatDate, formatMoney } from '../../lib/utils';
import { useT } from '../../i18n';
import { imT } from '../../i18n/areas/inventory-masters';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './masters.module.css';

const BUCKET: Record<string, () => string> = {
  overdue: () => imT('bucketOverdue'), week: () => imT('bucketWeek'), later: () => imT('bucketLater'), none: () => imT('bucketNone'),
};

/** Sales Order Outstanding (WP-8, P1-12 sales side): pending by party / item / due date, overdue flagged. */
export function OrdersOutstandingTab({ version, today }: { version: number; today: string }) {
  useT(); // re-render on a language switch (5.4)
  const [asOf, setAsOf] = useState(today);
  const [by, setBy] = useState<OutstandingGroupBy>('party');
  /* eslint-disable react-hooks/exhaustive-deps */
  const rows = useMemo(
    () => salesOrderOutstanding(getTable<InvoiceRecord>('invoices'), getTable<{ from_id: string; to_id: string; relation: string }>('doc_links'), asOf),
    [asOf, version],
  );
  /* eslint-enable react-hooks/exhaustive-deps */
  const groups = useMemo(() => groupOutstanding(rows, by, asOf), [rows, by, asOf]);
  const total = rows.reduce((s, r) => s + r.value, 0);

  return (
    <div>
      <div className={styles.toolbar}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="so-asof">{imT('asOf')}</label>
          <input id="so-asof" type="date" className={controls.input} value={asOf} onChange={(e) => setAsOf(e.target.value || today)} />
        </div>
        <div className={controls.segment} role="tablist" aria-label={imT('groupBy')}>
          {([['party', imT('byParty')], ['item', imT('byItem')], ['due', imT('byDue')]] as [OutstandingGroupBy, string][]).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={by === k} className={by === k ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setBy(k)}>{label}</button>
          ))}
        </div>
      </div>
      <p className={styles.muted}>{imT('purchaseSide')}</p>
      {rows.length === 0 ? <p className={styles.muted}>{imT('noOrders')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>{imT('thOrder')}</th><th>{by === 'party' ? imT('thItem') : imT('thParty')}</th><th>{imT('thDue')}</th>
                <th className={surface.numeric}>{imT('thOrdered')}</th><th className={surface.numeric}>{imT('thDelivered')}</th>
                <th className={surface.numeric}>{imT('thToDeliver')}</th><th className={surface.numeric}>{imT('thToInvoice')}</th><th className={surface.numeric}>{imT('thValue')}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  <tr className={styles.groupRow}>
                    <td colSpan={7}>{by === 'due' ? BUCKET[g.label]?.() ?? g.label : g.label} <span className={styles.muted}>{imT('groupTotal', { n: g.rows.length, value: formatMoney(g.value) })}</span></td>
                    <td className={surface.numeric}>{formatMoney(g.value)}</td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={`${r.orderId}:${r.lineId}`}>
                      <td><Link to={`/invoice/${r.orderId}`}>{r.number}</Link><div className={styles.muted}>{formatDate(r.date)}</div></td>
                      <td>{by === 'party' ? r.item : r.party}{by === 'due' && <div className={styles.muted}>{r.item}</div>}</td>
                      <td className={cn(r.overdueDays > 0 && styles.overdue)}>{r.due ? formatDate(r.due) : '—'}{r.overdueDays > 0 && <div>{imT('overdueDays', { n: r.overdueDays })}</div>}</td>
                      <td className={surface.numeric}>{r.ordered} {r.unit}</td>
                      <td className={surface.numeric}>{r.delivered || ''}</td>
                      <td className={surface.numeric}>{r.pendingDelivery || ''}</td>
                      <td className={surface.numeric}>{r.pendingInvoice || ''}</td>
                      <td className={surface.numeric}>{formatMoney(r.value)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className={styles.groupRow}><td colSpan={7}>{imT('total')}</td><td className={surface.numeric}>{formatMoney(total)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
