import { useMemo, useState } from 'react';
import { AlertTriangle, FileClock } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { startAmendment } from '../../lib/documents';
import { amendmentCheck } from '../../lib/amendments';
import { loadFiled } from '../../lib/compliance';
import { getLockUntil, isPeriodLockedError } from '../../lib/period-lock';
import { DOCUMENT_LABELS, type InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import styles from './documents.module.css';

export interface AmendDialogProps {
  invoice: InvoiceRecord;
  open: boolean;
  onClose: () => void;
  /** Receives the record now marked as an amendment (the editor reloads it). */
  onDone: (record: InvoiceRecord) => void;
}

const fmtPeriod = (p: string) => (p.length === 6 ? `${p.slice(0, 2)}/${p.slice(2)}` : p);

/** "Amend (reported in a filed return)": freezes the document as filed, then the user edits and saves. */
export function AmendDialog(props: AmendDialogProps) {
  if (!props.open) return null;
  return <AmendForm {...props} />;
}

function AmendForm({ invoice, onClose, onDone }: AmendDialogProps) {
  const [reason, setReason] = useState(invoice.amends?.reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const check = useMemo(() => amendmentCheck(invoice, { filed: loadFiled(), lockUntil: getLockUntil() }), [invoice]);
  const label = DOCUMENT_LABELS[invoice.doc_type];
  const isNote = invoice.doc_type === 'CREDIT_NOTE' || invoice.doc_type === 'DEBIT_NOTE';

  const submit = () => {
    try {
      onDone(startAmendment(invoice, reason));
      onClose();
    } catch (err) {
      setError(
        isPeriodLockedError(err)
          ? `${(err as Error).message} Unlock this document with your PIN (banner at the top of the editor), then amend it.`
          : err instanceof Error
            ? err.message
            : 'Something went wrong.',
      );
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Amend ${label.toLowerCase()}`}
      subtitle={invoice.invoice_number}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            Close
          </button>
          <button type="button" className={controls.btnPrimary} onClick={submit}>
            <FileClock size={16} aria-hidden="true" /> {invoice.amends ? 'Amend again' : 'Start amendment'}
          </button>
        </>
      }
    >
      <div className={styles.stack}>
        <p className={controls.hint}>
          A copy of this {label.toLowerCase()} exactly as reported is kept for its own return (period{' '}
          {fmtPeriod(invoice.amends?.period || check.period)}), which never changes. Edit and save the document as usual: the changes are
          reported in the GSTR-1 of the month you make them in ({isNote ? 'CDNRA / CDNURA' : 'B2BA / B2CLA / B2CSA'}) with the original number and
          date, and that month&apos;s GSTR-3B takes the difference. Working paper — verify with your CA.
        </p>
        {!check.needed && !invoice.amends && (
          <div className={styles.warn} role="note">
            <AlertTriangle size={16} color="var(--warning)" aria-hidden="true" />
            <div>
              Its return is not marked filed in the Compliance tab and its date is not locked. If the GSTR-1 has not been filed yet, just edit
              the document — no amendment is needed.
            </div>
          </div>
        )}
        {invoice.amends && (
          <p className={controls.hint}>
            Already amended on {invoice.amends.amended_on}. Amending again keeps the first original and moves the amendment to this month.
          </p>
        )}
        <div className={controls.field}>
          <label className={controls.label} htmlFor="amend-reason">
            Reason (optional)
          </label>
          <input
            id="amend-reason"
            className={controls.input}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Wrong GSTIN, wrong place of supply, rate correction"
          />
        </div>
        {error && (
          <p className={styles.errors} role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
