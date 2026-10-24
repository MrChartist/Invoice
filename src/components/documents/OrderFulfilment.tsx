import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Lock, RotateCcw, XCircle } from 'lucide-react';
import { StatusBadge } from '../ui/StatusBadge';
import { localDb } from '../../lib/localDb';
import { readLinks } from '../../lib/documents';
import { canCloseOrder, orderFulfilment, orderTone } from '../../lib/sales-orders';
import { localDayOf } from '../../lib/dates';
import { DOCUMENT_LABELS, type InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
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
  const { f, docs } = useMemo(() => {
    const all = localDb.invoices.getAll();
    const fulfil = orderFulfilment(order, all, readLinks());
    const ids = new Set(fulfil.documentIds);
    return { f: fulfil, docs: all.filter((d) => ids.has(d.id)).sort((a, b) => a.issue_date.localeCompare(b.issue_date)) };
  }, [order, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setClosed = (closed: boolean) => {
    try {
      localDb.invoices.setOrderClosed(order.id, closed ? localDayOf(new Date()) : undefined);
      onChanged();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  return (
    <section aria-label="Order fulfilment" className={styles.stack}>
      <div className={controls.row}>
        <span>Sales order:</span> <StatusBadge status={f.state} tone={orderTone(f.state)} />
        {order.order_closed_on && f.state === 'Closed' && <span className={styles.itemMeta}>closed {order.order_closed_on}</span>}
        {canCloseOrder(f) && (
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={locked} onClick={() => setClosed(true)}
            title="Stop expecting the pending quantity — no more challans or invoices against this order">
            {locked ? <Lock size={15} /> : <XCircle size={15} />} Close order
          </button>
        )}
        {f.state === 'Closed' && (
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={locked} onClick={() => setClosed(false)}>
            <RotateCcw size={15} /> Reopen
          </button>
        )}
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Item</th>
              <th className={styles.num}>Ordered</th>
              <th className={styles.num}>Delivered</th>
              <th className={styles.num}>Invoiced</th>
              <th className={styles.num}>To deliver</th>
              <th className={styles.num}>To invoice</th>
            </tr>
          </thead>
          <tbody>
            {f.lines.map((l) => (
              <tr key={l.item.id}>
                <td>
                  <div className={styles.itemName}>{l.item.name || 'Item'}</div>
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
          Raised against this order:{' '}
          {docs.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <Link to={`/invoice/${d.id}`}>{DOCUMENT_LABELS[d.doc_type]} {d.invoice_number}</Link>
              {d.status === 'Draft' ? ' (draft)' : ''}
            </span>
          ))}
        </p>
      )}
      <p className={styles.itemMeta}>
        Convert creates a challan or invoice for the pending quantity only. A sales order is not a tax document: it never
        counts as revenue, GST, stock or a receivable.
      </p>
    </section>
  );
}
