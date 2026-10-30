import { useMemo, useState } from 'react';
import { AlertTriangle, FileClock } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { startAmendment } from '../../lib/documents';
import { amendmentCheck } from '../../lib/amendments';
import { loadFiled } from '../../lib/compliance';
import { getLockUntil, isPeriodLockedError } from '../../lib/period-lock';
import { DOCUMENT_LABELS, type InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { salesT } from '../../i18n/areas/sales';
import { docLabel } from '../../i18n/labels';
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
  useT(); // re-render on a language switch (5.4)
  const [reason, setReason] = useState(invoice.amends?.reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const check = useMemo(() => amendmentCheck(invoice, { filed: loadFiled(), lockUntil: getLockUntil() }), [invoice]);
  const label = docLabel(invoice.doc_type in DOCUMENT_LABELS ? invoice.doc_type : 'INVOICE');
  const isNote = invoice.doc_type === 'CREDIT_NOTE' || invoice.doc_type === 'DEBIT_NOTE';

  const submit = () => {
    try {
      onDone(startAmendment(invoice, reason));
      onClose();
    } catch (err) {
      setError(
        isPeriodLockedError(err)
          ? salesT('am.unlock', { message: (err as Error).message })
          : err instanceof Error
            ? err.message
            : salesT('somethingWrong'),
      );
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={salesT('am.title', { doc: label.toLowerCase() })}
      subtitle={invoice.invoice_number}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            {salesT('close')}
          </button>
          <button type="button" className={controls.btnPrimary} onClick={submit}>
            <FileClock size={16} aria-hidden="true" /> {invoice.amends ? salesT('am.again') : salesT('am.start')}
          </button>
        </>
      }
    >
      <div className={styles.stack}>
        <p className={controls.hint}>
          {salesT('am.hint', {
            doc: label.toLowerCase(),
            period: fmtPeriod(invoice.amends?.period || check.period),
            tables: isNote ? 'CDNRA / CDNURA' : 'B2BA / B2CLA / B2CSA',
          })}
        </p>
        {!check.needed && !invoice.amends && (
          <div className={styles.warn} role="note">
            <AlertTriangle size={16} color="var(--sys-orange-ink)" aria-hidden="true" />
            <div>
              {salesT('am.notNeeded')}
            </div>
          </div>
        )}
        {invoice.amends && (
          <p className={controls.hint}>
            {salesT('am.already', { date: invoice.amends.amended_on })}
          </p>
        )}
        <div className={controls.field}>
          <label className={controls.label} htmlFor="amend-reason">
            {salesT('reasonOptional')}
          </label>
          <input
            id="amend-reason"
            className={controls.input}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={salesT('am.reasonPh')}
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
