import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, Lock, RotateCcw } from 'lucide-react';
import { ConvertMenu } from '../documents/ConvertMenu';
import { CreditNoteModal } from '../documents/CreditNoteModal';
import { CancelDialog } from '../documents/CancelDialog';
import { DocumentTimeline } from '../documents/DocumentTimeline';
import { ShareMenu } from '../share';
import { EInvoiceButton } from '../einvoice';
import { RecurringButton } from '../recurring';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { localDb } from '../../lib/localDb';
import { isLocked } from '../../lib/period-lock';
import type { InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import styles from './DocumentActions.module.css';

const ActivityTimeline = lazy(() => import('../audit/ActivityTimeline').then((m) => ({ default: m.ActivityTimeline })));

/** Everything you can do with an already-saved document, in one place. */
export function DocumentActions({
  invoiceId,
  refreshKey,
  onChanged,
}: {
  invoiceId: string;
  refreshKey: number;
  /** Called after an action changed the stored document (cancel / reinstate). */
  onChanged?: () => void;
}) {
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const [creditOpen, setCreditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [saved, setSaved] = useState<InvoiceRecord | undefined>(() => localDb.invoices.getById(invoiceId));

  // Re-read the stored row whenever the editor saves or an action changes it.
  useEffect(() => {
    setSaved(localDb.invoices.getById(invoiceId));
  }, [invoiceId, refreshKey, tick]);

  if (!saved) return null;

  const reloadEditor = () => {
    useInvoiceStore.getState().loadInvoice(invoiceId);
    setTick((t) => t + 1);
    onChanged?.();
  };

  const cancelled = saved.status === 'Cancelled';
  const canCredit = saved.doc_type === 'INVOICE' || saved.doc_type === 'TAX_INVOICE';
  const locked = isLocked(saved);

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        <span data-share-anchor>
          <ShareMenu invoice={saved} hideReminder={saved.doc_type === 'QUOTATION' || saved.status === 'Paid'} />
        </span>
        <ConvertMenu invoice={saved} onRequestCreditNote={canCredit ? () => setCreditOpen(true) : undefined} />
        <RecurringButton invoice={saved} onCreated={() => navigate('/recurring')} />
        <EInvoiceButton invoice={saved} />
        <button
          type="button"
          className={`${controls.btnOutline} ${controls.btnSm}`}
          onClick={() => setCancelOpen(true)}
          disabled={locked}
          title={locked ? 'This document is in a locked period — unlock it with your PIN first' : undefined}
        >
          {locked ? <Lock size={16} /> : cancelled ? <RotateCcw size={16} /> : <Ban size={16} />} {cancelled ? 'Reinstate' : 'Cancel document'}
        </button>
      </div>

      <DocumentTimeline invoiceId={invoiceId} refreshKey={tick + refreshKey} />

      <section aria-label="Activity" className={styles.activity}>
        <h3 className={styles.activityHead}>Activity</h3>
        <Suspense fallback={null}>
          <ActivityTimeline invoiceId={invoiceId} refreshKey={tick + refreshKey} />
        </Suspense>
      </section>

      <CreditNoteModal
        invoice={saved}
        open={creditOpen}
        onClose={() => setCreditOpen(false)}
        onCreated={(rec) => {
          setCreditOpen(false);
          navigate(`/invoice/${rec.id}`);
        }}
      />
      <CancelDialog invoice={saved} open={cancelOpen} onClose={() => setCancelOpen(false)} onDone={reloadEditor} />
    </div>
  );
}
