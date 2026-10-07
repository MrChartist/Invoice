import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { formatCurrency } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { DocumentError, cancelDocument, reinstateDocument } from '../../lib/documents';
import { DOCUMENT_LABELS, type InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import styles from './documents.module.css';

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
  const isCancelled = invoice.status === 'Cancelled';
  const paid = num(invoice.amount_paid);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = DOCUMENT_LABELS[invoice.doc_type];

  const submit = () => {
    try {
      const rec = isCancelled
        ? reinstateDocument(invoice)
        : cancelDocument(invoice, reason, { acknowledgePayments: ack });
      onDone(rec);
      onClose();
    } catch (err) {
      setError(err instanceof DocumentError || err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  const disabled = !isCancelled && (!reason.trim() || (paid > 0 && !ack));

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={isCancelled ? `Reinstate ${label}` : `Cancel ${label}`}
      subtitle={invoice.invoice_number}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            {isCancelled ? 'Close' : 'Keep document'}
          </button>
          <button
            type="button"
            className={controls.btnPrimary}
            style={isCancelled ? undefined : { backgroundColor: 'var(--destructive)' }}
            onClick={submit}
            disabled={disabled}
          >
            {isCancelled ? 'Reinstate' : 'Cancel document'}
          </button>
        </>
      }
    >
      <div className={styles.stack}>
        {isCancelled ? (
          <p className={controls.hint}>
            This restores the document to its previous status. Nothing was deleted when it was cancelled.
          </p>
        ) : (
          <>
            <p className={controls.hint}>
              The document stays on record with a Cancelled status and is excluded from outstanding
              balances. The number is not reused.
            </p>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="cancel-reason">
                Reason
              </label>
              <textarea
                id="cancel-reason"
                className={controls.textarea}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Issued in error, order withdrawn"
              />
            </div>
            {paid > 0 && (
              <div className={styles.warn} role="alert">
                <AlertTriangle size={16} color="var(--warning)" aria-hidden="true" />
                <div>
                  <strong>{formatCurrency(paid, invoice.currency || 'INR')}</strong> has already been
                  recorded as received. Cancelling does not refund or delete those payments.
                  <label className={styles.check}>
                    <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                    <span>I understand; cancel anyway.</span>
                  </label>
                </div>
              </div>
            )}
          </>
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
