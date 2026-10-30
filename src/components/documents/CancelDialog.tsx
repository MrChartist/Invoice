import { lazy, Suspense, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { formatCurrency } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { DocumentError, cancelDocument, reinstateDocument } from '../../lib/documents';
import { isStockDependencyError } from '../../lib/stock-timeline';
import { DOCUMENT_LABELS, type InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { salesT } from '../../i18n/areas/sales';
import { docLabel } from '../../i18n/labels';
import { areaNodes } from '../../i18n/areas/nodes';
import controls from '../../styles/controls.module.css';
import styles from './documents.module.css';
import { getTable } from '../../lib/storage';
import { poFulfilment, posForSalesOrder } from '../../lib/purchase-orders';
import type { PurchaseOrder, PurchaseRecord } from '../../types/purchases';
import { s2T } from '../../i18n/areas/sales-r2';

// 8D (8.64): IRN / e-Way Bill cancel requests and the 24-hour deadline — loaded only for documents that have them.
const EinvCancelPanel = lazy(() => import('../einvoice/EinvCancelPanel'));

export interface CancelDialogProps {
  invoice: InvoiceRecord;
  open: boolean;
  onClose: () => void;
  /** Receives the updated (cancelled or reinstated) record. */
  onDone: (record: InvoiceRecord) => void;
}

export function CancelDialog(props: CancelDialogProps) {
  if (!props.open) return null;
  return <CancelForm {...props} />;
}

function CancelForm({ invoice, onClose, onDone }: CancelDialogProps) {
  useT(); // re-render on a language switch (5.4)
  const isCancelled = invoice.status === 'Cancelled';
  const paid = num(invoice.amount_paid);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 8D: with an IRN / e-Way Bill the dialog stays open after cancelling, on the portal-cancel step.
  const [portalStep, setPortalStep] = useState(false);
  const label = docLabel(invoice.doc_type in DOCUMENT_LABELS ? invoice.doc_type : 'INVOICE');
  const onPortal = useMemo(
    () => getTable<{ invoice_id?: string; irn?: string; eway_no?: string }>('einvoice_meta').some((m) => m?.invoice_id === invoice.id && (m.irn || m.eway_no)),
    [invoice.id],
  );
  // R2-B5: cancelling a sales order warns about its open back-to-back purchase orders.
  const openPos = useMemo(() => {
    if (invoice.doc_type !== 'SALES_ORDER' || isCancelled) return [];
    const purchases = getTable<PurchaseRecord>('purchases');
    return posForSalesOrder(invoice.id, getTable<PurchaseOrder>('purchase_orders')).filter((po) => {
      const st = poFulfilment(po, purchases).state;
      return st === 'Open' || st === 'Partly received';
    });
  }, [invoice.id, invoice.doc_type, isCancelled]);

  const submit = (acknowledgeStock = false): void => {
    try {
      const rec = isCancelled
        ? reinstateDocument(invoice)
        : cancelDocument(invoice, reason, { acknowledgePayments: ack, acknowledgeStock });
      onDone(rec);
      if (!isCancelled && onPortal) setPortalStep(true);
      else onClose();
    } catch (err) {
      // A credit note whose returned goods were partly used since: confirm before taking them out again.
      if (isStockDependencyError(err) && err.confirmable && window.confirm(`${err.message}\n\n${salesT('cn.cancelDoc')}?`)) return submit(true);
      setError(err instanceof DocumentError || err instanceof Error ? err.message : salesT('somethingWrong'));
    }
  };

  const disabled = !isCancelled && (!reason.trim() || (paid > 0 && !ack));

  return (
    <Modal
      open
      onClose={onClose}
      size={onPortal ? 'md' : 'sm'}
      title={isCancelled ? salesT('cn.reinstateTitle', { doc: label }) : salesT('cn.cancelTitle', { doc: label })}
      subtitle={invoice.invoice_number}
      footer={portalStep ? (
        <button type="button" className={controls.btnOutline} onClick={onClose}>{salesT('close')}</button>
      ) : (
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            {isCancelled ? salesT('close') : salesT('cn.keep')}
          </button>
          <button
            type="button"
            className={isCancelled ? controls.btnPrimary : controls.btnDestructive}
            onClick={() => submit()}
            disabled={disabled}
          >
            {isCancelled ? salesT('cn.reinstate') : salesT('cn.cancelDoc')}
          </button>
        </>
      )}
    >
      <div className={styles.stack}>
        {portalStep ? null : isCancelled ? (
          <p className={controls.hint}>
            {salesT('cn.reinstateHint')}
          </p>
        ) : (
          <>
            <p className={controls.hint}>
              {salesT('cn.cancelHint')}
            </p>
            {openPos.length > 0 && (
              <p className={styles.warn} role="alert" data-so-po-warning>
                <AlertTriangle size={14} aria-hidden="true" /> {s2T('po.cancelWarn', { numbers: openPos.map((p) => p.po_number).join(', ') })}
              </p>
            )}
            <div className={controls.field}>
              <label className={controls.label} htmlFor="cancel-reason">
                {salesT('reason')}
              </label>
              <textarea
                id="cancel-reason"
                className={controls.textarea}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={salesT('cn.reasonPh')}
              />
            </div>
            {paid > 0 && (
              <div className={styles.warn} role="alert">
                <AlertTriangle size={16} color="var(--sys-orange-ink)" aria-hidden="true" />
                <div>
                  {areaNodes(salesT('cn.paidWarn'), { amount: <strong>{formatCurrency(paid, invoice.currency || 'INR')}</strong> })}
                  <label className={styles.check}>
                    <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                    <span>{salesT('cn.ack')}</span>
                  </label>
                </div>
              </div>
            )}
          </>
        )}
        {onPortal && (
          <Suspense fallback={null}>
            <EinvCancelPanel invoice={invoice} afterCancel={portalStep} />
          </Suspense>
        )}
        {error && (
          <p className={styles.errors} role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
