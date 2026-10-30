import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import type { InvoiceRecord } from '../../types/invoice';
import type { Vendor } from '../../types/purchases';
import { buildBackToBackPos, createBackToBackPos, liveStockFns, poLinesReceived, soToPoRows, type PoPick } from '../../lib/back-to-back';
import { orderFulfilment } from '../../lib/sales-orders';
import { localDb } from '../../lib/localDb';
import { readLinks } from '../../lib/documents';
import { getTable } from '../../lib/storage';
import { localDayOf } from '../../lib/dates';
import { senderStateCode } from '../../store/invoice-defaults';
import type { PurchaseOrder, PurchaseRecord, ReceiptNote } from '../../types/purchases';
import { useT } from '../../i18n';
import { s2T } from '../../i18n/areas/sales-r2';
import controls from '../../styles/controls.module.css';
import styles from './sales-r2.module.css';
import { DateField } from '../ui/DateField';

/**
 * R2-B5: sales order → back-to-back purchase orders. Per pending line: quantity to order (pending less
 * free stock and less what earlier POs of this order asked for), supplier (last supplier pre-filled)
 * and rate; one PO per supplier. Optional drop-ship to the customer's address.
 */
export function SoToPoDialog({ order, onClose, onDone }: { order: InvoiceRecord; onClose: () => void; onDone: (message: string) => void }) {
  useT(); // re-render on a language switch (5.4)
  const [full, setFull] = useState(false);
  const vendors = useMemo(() => getTable<Vendor>('vendors'), []);
  const fns = useMemo(() => liveStockFns(), []);
  const rows = useMemo(() => {
    const f = orderFulfilment(order, localDb.invoices.getAll(), readLinks());
    const orders = getTable<PurchaseOrder>('purchase_orders');
    // A short-closed PO counts only what it received (QA5-2 F21).
    const received = poLinesReceived(orders.filter((po) => po?.so_id === order.id && po.closed_on), getTable<PurchaseRecord>('purchases'), getTable<ReceiptNote>('receipt_notes'));
    return soToPoRows(f, order.id, orders, { ...fns, fullQty: full, received });
  }, [order, fns, full]);
  const [edits, setEdits] = useState<Record<string, { qty?: string; vendor?: string; rate?: string }>>({});
  const [dropShip, setDropShip] = useState(false);
  const [expected, setExpected] = useState('');
  const [error, setError] = useState('');
  const val = (id: string, k: 'qty' | 'vendor' | 'rate', fallback: string) => edits[id]?.[k] ?? fallback;
  const setVal = (id: string, k: 'qty' | 'vendor' | 'rate', v: string) => setEdits({ ...edits, [id]: { ...edits[id], [k]: v } });

  const submit = () => {
    setError('');
    try {
      const picks: PoPick[] = rows.map((r) => {
        const name = val(r.line.id, 'vendor', r.vendor_name).trim();
        const v = vendors.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
        return {
          soLineId: r.line.id, quantity: Number(val(r.line.id, 'qty', String(r.short))) || 0, rate: Number(val(r.line.id, 'rate', String(r.rate))) || 0,
          vendor_name: name, ...(v ? { vendor_id: v.id, vendor_gstin: v.gstin } : {}),
        };
      }).filter((p) => p.quantity > 0);
      if (!picks.length) throw new Error(s2T('po.nothing'));
      const profile = localDb.settings.activeProfile() ?? null;
      const drafts = buildBackToBackPos(order, picks, { date: localDayOf(new Date()), expected_date: expected || undefined, dropShip, businessState: senderStateCode(order.sender ?? profile) });
      const saved = createBackToBackPos(drafts);
      onDone(s2T('po.created', { n: saved.length, numbers: saved.map((p) => p.po_number).join(', ') }));
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={s2T('po.title', { number: order.invoice_number })}
      subtitle={s2T('po.subtitle')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{s2T('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={submit} data-so-po-create>{s2T('po.create')}</button>
        </>
      }
    >
      <div className={styles.stack}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <label className={controls.check}>
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> {s2T('po.full')}
        </label>
        <datalist id="so-po-vendors">
          {vendors.map((v) => <option key={v.id} value={v.name} />)}
        </datalist>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{s2T('item')}</th>
                <th className={styles.num}>{s2T('po.pending')}</th>
                <th className={styles.num}>{s2T('po.free')}</th>
                <th className={styles.num}>{s2T('po.onOrder')}</th>
                <th className={styles.num}>{s2T('po.order')}</th>
                <th>{s2T('po.supplier')}</th>
                <th className={styles.num}>{s2T('rate')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line.id}>
                  <td>{r.line.name}{r.line.unit ? <span className={styles.muted}> {r.line.unit}</span> : null}</td>
                  <td className={styles.num}>{r.pendingDelivery}</td>
                  <td className={styles.num}>{r.free}</td>
                  <td className={styles.num}>{r.onOrder}</td>
                  <td className={styles.num}>
                    <input className={`${controls.input} ${controls.inputNumeric} ${styles.cellInput}`} inputMode="decimal" value={val(r.line.id, 'qty', String(r.short))}
                      onChange={(e) => setVal(r.line.id, 'qty', e.target.value.replace(/[^0-9.]/g, ''))} aria-label={`${s2T('po.order')} ${r.line.name}`} data-po-qty />
                  </td>
                  <td>
                    <input className={controls.input} list="so-po-vendors" value={val(r.line.id, 'vendor', r.vendor_name)}
                      onChange={(e) => setVal(r.line.id, 'vendor', e.target.value)} aria-label={`${s2T('po.supplier')} ${r.line.name}`} data-po-vendor />
                  </td>
                  <td className={styles.num}>
                    <input className={`${controls.input} ${controls.inputNumeric} ${styles.cellInput}`} inputMode="decimal" value={val(r.line.id, 'rate', String(r.rate))}
                      onChange={(e) => setVal(r.line.id, 'rate', e.target.value.replace(/[^0-9.]/g, ''))} aria-label={`${s2T('rate')} ${r.line.name}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className={styles.muted}>{s2T('po.nothing')}</p>}
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{s2T('po.expected')}</span>
            <DateField className={controls.input} value={expected} onChange={(e) => setExpected(e.target.value)} />
          </label>
          <label className={controls.check}>
            <input type="checkbox" checked={dropShip} onChange={(e) => setDropShip(e.target.checked)} /> {s2T('po.dropShip')}
          </label>
        </div>
      </div>
    </Modal>
  );
}
