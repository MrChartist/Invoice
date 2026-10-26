import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, FileClock, IndianRupee, Lock, Pencil, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { receivableBalance } from '../../lib/rcm';
import { can, currentRole } from '../../lib/access';
import { StatusBadge } from '../ui/StatusBadge';
import { quoteState, quoteTone } from '../../lib/quote-status';
import { getTable } from '../../lib/storage';
import { ConvertMenu } from '../documents/ConvertMenu';
import { CreditNoteModal } from '../documents/CreditNoteModal';
import { DebitNoteModal } from '../documents/DebitNoteModal';
import { CancelDialog } from '../documents/CancelDialog';
import { DocumentTimeline } from '../documents/DocumentTimeline';
import { ShareMenu } from '../share';
import { EInvoiceButton } from '../einvoice';
import { RecurringButton } from '../recurring';
import { OverdueInterest } from '../interest';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { localDb } from '../../lib/localDb';
import { isLocked } from '../../lib/period-lock';
import { canAmend } from '../../lib/amendments';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { edT } from '../../i18n/areas/editor';
import { uxT } from '../../i18n/areas/invoicing-ux';
import { stateLabel } from '../../i18n/areas/sales';
import styles from './DocumentActions.module.css';
import { PackingListButton } from '../dispatch/PackingListButton'; // R2-C4
import { d3T } from '../../i18n/areas/docs-r3'; // R3-C2

/** R3-C2: "Get signature" applies to issued invoices / bills of supply / challans; replacing is owner-only. */
const proofAllowed = (d: InvoiceRecord) =>
  ['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'DELIVERY_CHALLAN'].includes(d.doc_type) && d.status !== 'Draft' && d.status !== 'Cancelled'
  && (d.delivery_proof ? currentRole() === 'owner' : can('doc.edit'));

const OrderFulfilment = lazy(() => import('../documents/OrderFulfilment').then((m) => ({ default: m.OrderFulfilment })));
const AmendDialog = lazy(() => import('../documents/AmendDialog').then((m) => ({ default: m.AmendDialog })));
// 8.101: counter acceptance with an on-canvas signature.
// A2: record a payment straight from the editor.
const PaymentModal = lazy(() => import('../modals/PaymentModal').then((m) => ({ default: m.PaymentModal })));
const AcceptQuoteDialog = lazy(() => import('../invoicing-ux/AcceptQuoteDialog'));
// R3-C2: receiver signature / proof of delivery (dialog + signature pad load on click).
const DeliveryProofDialog = lazy(() => import('./DeliveryProofDialog'));
const ActivityTimeline = lazy(() => import('../audit/ActivityTimeline').then((m) => ({ default: m.ActivityTimeline })));
const AnnexureActions = lazy(() => import('./AnnexureActions')); // R3-B4

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
  useT(); // re-render on a language switch (5.4)
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const [creditOpen, setCreditOpen] = useState(false);
  const [debitOpen, setDebitOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [proofOpen, setProofOpen] = useState(false); // R3-C2
  const [saved, setSaved] = useState<InvoiceRecord | undefined>(() => localDb.invoices.getById(invoiceId));

  // Re-read the stored row whenever the editor saves or an action changes it.
  useEffect(() => {
    setSaved(localDb.invoices.getById(invoiceId));
  }, [invoiceId, refreshKey, tick]);

  if (!saved) return null;

  // Interest is informational: only an explicit click turns it into a line, and it goes on a NEW invoice.
  const addInterestLine = (item: InvoiceItem) => {
    const store = useInvoiceStore.getState();
    store.newDraft('INVOICE');
    store.setClient(saved.client);
    const blank = useInvoiceStore.getState().items[0];
    store.applyCatalogItem(blank.id, item);
    navigate('/invoice');
  };

  const reloadEditor = () => {
    useInvoiceStore.getState().loadInvoice(invoiceId);
    setTick((t) => t + 1);
    onChanged?.();
  };

  const cancelled = saved.status === 'Cancelled';
  const canCredit = saved.doc_type === 'INVOICE' || saved.doc_type === 'TAX_INVOICE' || saved.doc_type === 'BILL_OF_SUPPLY';
  const locked = isLocked(saved);
  const isOrder = saved.doc_type === 'SALES_ORDER';

  const payable = canCredit && !cancelled && saved.status !== 'Draft' && saved.status !== 'Paid' && receivableBalance(saved) > 0.004 && can('payment.record');

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        {payable && (
          <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => setPayOpen(true)} data-record-payment>
            <IndianRupee size={16} /> {uxT('raRecord')}
          </button>
        )}
        <span data-share-anchor>
          <ShareMenu invoice={saved} hideReminder={saved.doc_type === 'QUOTATION' || saved.doc_type === 'SALES_ORDER' || saved.status === 'Paid'} />
        </span>
        <ConvertMenu invoice={saved} onRequestCreditNote={canCredit ? () => setCreditOpen(true) : undefined} onRequestDebitNote={canCredit ? () => setDebitOpen(true) : undefined} />
        {!isOrder && <RecurringButton invoice={saved} onCreated={() => navigate('/recurring')} />}
        {/* A Bill of Supply is never e-invoiced; it can still need an e-Way Bill (document type BIL). */}
        {!isOrder && <EInvoiceButton invoice={saved} label={saved.doc_type === 'BILL_OF_SUPPLY' ? edT('daEway') : undefined} />}
        <button
          type="button"
          className={`${controls.btnOutline} ${controls.btnSm}`}
          onClick={() => setCancelOpen(true)}
          disabled={locked}
          title={locked ? edT('daLockedTitle') : undefined}
        >
          {locked ? <Lock size={16} /> : cancelled ? <RotateCcw size={16} /> : <Ban size={16} />} {cancelled ? edT('daReinstate') : edT('daCancel')}
        </button>
        {canAmend(saved) && (
          <button
            type="button"
            className={`${controls.btnOutline} ${controls.btnSm}`}
            onClick={() => setAmendOpen(true)}
            title={edT('daAmendTitle')}
          >
            <FileClock size={16} /> {edT('daAmend')}
          </button>
        )}
        <PackingListButton invoice={saved} />
        {/* R3-B4: download / refresh the timesheet annexure (last action, §6). */}
        {saved.annexure && <Suspense fallback={null}><AnnexureActions invoice={saved} onChanged={reloadEditor} /></Suspense>}
        {/* R3-C2: Get signature (proof of delivery) — issued invoices / delivery challans; owner may replace. */}
        {proofAllowed(saved) && (
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setProofOpen(true)} disabled={locked} data-get-signature>
            <Pencil size={16} /> {saved.delivery_proof ? d3T('pf.replaceButton') : d3T('pf.button')}
          </button>
        )}
      </div>
      {saved.delivery_proof && <p className={styles.row} data-proof-done>{d3T('pf.done', { name: saved.delivery_proof.receiver })}</p>}
      {proofOpen && (
        <Suspense fallback={null}>
          <DeliveryProofDialog invoice={saved} onClose={() => setProofOpen(false)} onDone={reloadEditor} />
        </Suspense>
      )}

      {saved.doc_type === 'QUOTATION' && (() => {
        const q = quoteState(saved, getTable<{ from_id: string; relation: string }>('doc_links'));
        const setOutcome = (outcome: 'Accepted' | 'Declined' | undefined) => {
          try {
            localDb.invoices.setQuoteStatus(saved.id, outcome);
            reloadEditor();
          } catch (err) {
            window.alert((err as Error).message);
          }
        };
        return (
          <div className={styles.row} role="group" aria-label={edT('daQuoteOutcome')}>
            <span>{edT('daQuotation')}</span> <StatusBadge status={stateLabel(q)} tone={quoteTone(q)} />
            {q !== 'Converted' && (
              <>
                <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={locked} aria-pressed={saved.quote_status === 'Accepted'}
                  onClick={() => setOutcome(saved.quote_status === 'Accepted' ? undefined : 'Accepted')}>
                  <ThumbsUp size={15} /> {edT('daAccepted')}
                </button>
                <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={locked} aria-pressed={saved.quote_status === 'Declined'}
                  onClick={() => setOutcome(saved.quote_status === 'Declined' ? undefined : 'Declined')}>
                  <ThumbsDown size={15} /> {edT('daDeclined')}
                </button>
                {!saved.acceptance && saved.status !== 'Draft' && (
                  <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={locked} onClick={() => setAcceptOpen(true)} data-sign-accept>
                    <Pencil size={15} /> {uxT('accButton')}
                  </button>
                )}
              </>
            )}
            {saved.acceptance && <span className={styles.row}>{uxT('accDone', { signer: saved.acceptance.signer })}</span>}
            {acceptOpen && (
              <Suspense fallback={null}>
                <AcceptQuoteDialog quote={saved} open={acceptOpen} onClose={() => setAcceptOpen(false)} onDone={reloadEditor} />
              </Suspense>
            )}
          </div>
        );
      })()}

      {isOrder && (
        <Suspense fallback={null}>
          <OrderFulfilment order={saved} locked={locked} refreshKey={tick + refreshKey} onChanged={reloadEditor} />
        </Suspense>
      )}

      <OverdueInterest invoice={saved} onAddLine={addInterestLine} />

      <DocumentTimeline invoiceId={invoiceId} refreshKey={tick + refreshKey} />

      <section aria-label={edT('daActivity')} className={styles.activity}>
        <h3 className={styles.activityHead}>{edT('daActivity')}</h3>
        <Suspense fallback={null}>
          <ActivityTimeline invoiceId={invoiceId} refreshKey={tick + refreshKey} />
        </Suspense>
      </section>

      {payOpen && (
        <Suspense fallback={null}>
          <PaymentModal invoice={saved} onClose={() => { setPayOpen(false); reloadEditor(); }} onChanged={() => reloadEditor()} />
        </Suspense>
      )}

      <CreditNoteModal
        invoice={saved}
        open={creditOpen}
        onClose={() => setCreditOpen(false)}
        onCreated={(rec) => {
          setCreditOpen(false);
          navigate(`/invoice/${rec.id}`);
        }}
      />
      {debitOpen && (
        <DebitNoteModal
          invoice={saved}
          open
          onClose={() => setDebitOpen(false)}
          onCreated={(rec) => {
            setDebitOpen(false);
            navigate(`/invoice/${rec.id}`);
          }}
        />
      )}
      <CancelDialog invoice={saved} open={cancelOpen} onClose={() => setCancelOpen(false)} onDone={reloadEditor} />
      {amendOpen && (
        <Suspense fallback={null}>
          <AmendDialog invoice={saved} open onClose={() => setAmendOpen(false)} onDone={reloadEditor} />
        </Suspense>
      )}
    </div>
  );
}
