import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { InvoiceRecord } from '../../types/invoice';
import type { PurchaseOrder, PurchaseRecord, ReceiptNote } from '../../types/purchases';
import { backorderRows, liveStockFns, type BackorderStatus } from '../../lib/back-to-back';
import { getTable } from '../../lib/storage';
import { formatDate } from '../../lib/utils';
import { StatusBadge } from '../ui/StatusBadge';
import { useT } from '../../i18n';
import { s2T } from '../../i18n/areas/sales-r2';
import styles from './sales-r2.module.css';

const TONE: Record<BackorderStatus, 'overdue' | 'sent' | 'paid'> = { awaiting_po: 'overdue', on_order: 'sent', arrived: 'paid' };

/**
 * R2-B5 (Inventory → Order outstanding → Backorders): open sales-order lines waiting on goods, with the
 * linked purchase-order lines, expected dates and what has arrived; "Fulfil" opens the order to raise
 * the delivery challan / invoice once the goods are in.
 */
export function BackordersView({ version }: { version: number }) {
  useT(); // re-render on a language switch (5.4)
  const rows = useMemo(() => {
    void version;
    const { free } = liveStockFns();
    return backorderRows({
      invoices: getTable<InvoiceRecord>('invoices'), links: getTable<{ from_id: string; to_id: string; relation: string }>('doc_links'),
      orders: getTable<PurchaseOrder>('purchase_orders'), purchases: getTable<PurchaseRecord>('purchases'), notes: getTable<ReceiptNote>('receipt_notes'), free,
    });
  }, [version]);

  return (
    <section className={styles.stack} aria-label={s2T('bo.title')} data-backorders>
      <p className={styles.muted}>{s2T('bo.intro')}</p>
      {rows.length === 0 ? <p className={styles.muted}>{s2T('bo.empty')}</p> : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{s2T('bo.order')}</th>
                <th>{s2T('item')}</th>
                <th className={styles.num}>{s2T('po.pending')}</th>
                <th className={styles.num}>{s2T('po.free')}</th>
                <th className={styles.num}>{s2T('bo.short')}</th>
                <th>{s2T('bo.po')}</th>
                <th>{s2T('status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.orderId}:${r.lineId}`}>
                  <td><Link to={`/invoice/${r.orderId}`}>{r.orderNumber}</Link><div className={styles.muted}>{r.party}{r.due ? ` · ${formatDate(r.due)}` : ''}</div></td>
                  <td>{r.item}{r.unit ? <span className={styles.muted}> {r.unit}</span> : null}</td>
                  <td className={styles.num}>{r.pendingDelivery}</td>
                  <td className={styles.num}>{r.free}</td>
                  <td className={styles.num}>{r.short}</td>
                  <td>
                    {r.pos.length === 0 ? <span className={styles.muted}>{s2T('bo.noPo')}</span> : r.pos.map((p) => (
                      <div key={`${p.poId}`}>
                        {p.number} · {p.vendor}{p.expected ? ` · ${formatDate(p.expected)}` : ''}
                        <div className={styles.muted}>{s2T('bo.received')}: {p.received} / {p.ordered}</div>
                      </div>
                    ))}
                  </td>
                  <td><StatusBadge status={s2T(`bo.st.${r.status}`)} tone={TONE[r.status]} /></td>
                  <td>
                    <Link to={`/invoice/${r.orderId}`} className={styles.linkBtn}>{r.status === 'arrived' ? s2T('bo.fulfil') : r.status === 'awaiting_po' ? s2T('bo.raisePo') : ''}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
