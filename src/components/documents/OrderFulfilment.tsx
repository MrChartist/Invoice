import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Lock, RotateCcw, XCircle } from 'lucide-react';
import { StatusBadge } from '../ui/StatusBadge';
import { localDb } from '../../lib/localDb';
import { readLinks } from '../../lib/documents';
import { canCloseOrder, orderFulfilment, orderTone } from '../../lib/sales-orders';
import { localDayOf } from '../../lib/dates';
import { DOCUMENT_LABELS, type InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { salesT, stateLabel } from '../../i18n/areas/sales';
import { docLabel } from '../../i18n/labels';
import controls from '../../styles/controls.module.css';
import { posForSalesOrder } from '../../lib/purchase-orders';
import { getTable } from '../../lib/storage';
import type { PurchaseOrder } from '../../types/purchases';
import { s2T } from '../../i18n/areas/sales-r2';
import styles from './documents.module.css';

const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-IN');

/** Sales order: ordered vs delivered vs invoiced per line, the documents raised, and Close / Reopen. */
export function OrderFulfilment({
  order,
  locked,
  refreshKey,
  onChanged,
}: {
  order: InvoiceRecord;
  locked: boolean;
  refreshKey: number;
  onChanged: () => void;
}) {
  useT(); // re-render on a language switch (5.4)
  const { f, docs } = useMemo(() => {
    const all = localDb.invoices.getAll();
    const fulfil = orderFulfilment(order, all, readLinks());
    const ids = new Set(fulfil.documentIds);
    return { f: fulfil, docs: all.filter((d) => ids.has(d.id)).sort((a, b) => a.issue_date.localeCompare(b.issue_date)) };
  }, [order, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // R2-B5: back-to-back purchase orders raised from this order.
  const pos = useMemo(() => posForSalesOrder(order.id, getTable<PurchaseOrder>('purchase_orders')), [order, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setClosed = (closed: boolean) => {
    try {
      localDb.invoices.setOrderClosed(order.id, closed ? localDayOf(new Date()) : undefined);
      onChanged();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  return (
    <section aria-label={salesT('of.aria')} className={styles.stack}>
      <div className={controls.row}>
        <span>{salesT('of.salesOrder')}</span> <StatusBadge status={stateLabel(f.state)} tone={orderTone(f.state)} />
        {order.order_closed_on && f.state === 'Closed' && <span className={styles.itemMeta}>{salesT('of.closedOn', { date: order.order_closed_on })}</span>}
        {canCloseOrder(f) && (
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={locked} onClick={() => setClosed(true)}
            title={salesT('of.closeTitle')}>
            {locked ? <Lock size={15} /> : <XCircle size={15} />} {salesT('of.close')}
          </button>
        )}
        {f.state === 'Closed' && (
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={locked} onClick={() => setClosed(false)}>
            <RotateCcw size={15} /> {salesT('of.reopen')}
          </button>
        )}
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{salesT('item')}</th>
              <th className={styles.num}>{salesT('of.ordered')}</th>
              <th className={styles.num}>{salesT('of.delivered')}</th>
              <th className={styles.num}>{salesT('of.invoiced')}</th>
              <th className={styles.num}>{salesT('of.toDeliver')}</th>
              <th className={styles.num}>{salesT('of.toInvoice')}</th>
            </tr>
          </thead>
          <tbody>
            {f.lines.map((l) => (
              <tr key={l.item.id}>
                <td>
                  <div className={styles.itemName}>{l.item.name || salesT('item')}</div>
                  {l.item.unit && <div className={styles.itemMeta}>{l.item.unit}</div>}
                </td>
                <td className={styles.num}>{qty(l.ordered)}</td>
                <td className={styles.num}>{qty(l.delivered)}</td>
                <td className={styles.num}>{qty(l.invoiced)}</td>
                <td className={styles.num}>{qty(l.pendingDelivery)}</td>
                <td className={styles.num}>{qty(l.pendingInvoice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {docs.length > 0 && (
        <p className={styles.itemMeta}>
          {salesT('of.raised')}{' '}
          {docs.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <Link to={`/invoice/${d.id}`}>{d.doc_type in DOCUMENT_LABELS ? docLabel(d.doc_type) : d.doc_type} {d.invoice_number}</Link>
              {d.status === 'Draft' ? salesT('of.draft') : ''}
            </span>
          ))}
        </p>
      )}
      {pos.length > 0 && (
        <p className={styles.itemMeta} data-linked-pos>
          {s2T('po.linked')}{' '}
          {pos.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ', '}
              <Link to="/expenses?tab=orders">{p.po_number}</Link> ({p.vendor_name}{p.drop_ship ? ', drop-ship' : ''})
            </span>
          ))}
        </p>
      )}
      <p className={styles.itemMeta}>
        {salesT('of.note')}
      </p>
    </section>
  );
}
