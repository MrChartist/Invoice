import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { STATUS_LABELS, transitionCheque, validateTransition, type TransitionResult } from '../../lib/cheques';
import { localDb } from '../../lib/localDb';
import { purchasesDb } from '../../lib/purchases';
import { isPeriodLockedError } from '../../lib/period-lock';
import { formatMoney, todayInput } from '../../lib/utils';
import type { Cheque, ChequeStatus } from '../../types/cheques';
import controls from '../../styles/controls.module.css';

const BOUNCE_REASONS = ['Funds insufficient', 'Signature differs', 'Payment stopped by drawer', 'Account closed', 'Exceeds arrangement', 'Alterations / overwriting', 'Other'];

const VERB: Partial<Record<ChequeStatus, string>> = {
  deposited: 'Deposit',
  presented: 'Mark presented',
  cleared: 'Mark cleared',
  bounced: 'Mark bounced',
  cancelled: 'Cancel cheque',
};

export interface ChequeActionModalProps {
  cheque: Cheque | null;
  to: ChequeStatus | null;
  onClose: () => void;
  onDone: (r: TransitionResult) => void;
}

/** Date (and options) for moving a cheque along its lifecycle. */
export function ChequeActionModal({ cheque, to, onClose, onDone }: ChequeActionModalProps) {
  const [date, setDate] = useState(todayInput());
  const [record, setRecord] = useState(true);
  const [reason, setReason] = useState(BOUNCE_REASONS[0]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!cheque || !to) return;
    const today = todayInput();
    setDate(cheque.cheque_date > today ? cheque.cheque_date : today);
    setRecord(true);
    setReason(BOUNCE_REASONS[0]);
    setError('');
  }, [cheque, to]);

  if (!cheque || !to) return null;
  const linkedInvoice = cheque.direction === 'received' && cheque.invoice_id && !cheque.payment_id ? localDb.invoices.getById(cheque.invoice_id) : undefined;
  const linkedBill = cheque.direction === 'issued' && cheque.purchase_id && !cheque.purchase_payment_id ? purchasesDb.get(cheque.purchase_id) : undefined;
  const willRecord = to === 'cleared' && (linkedInvoice || linkedBill);
  const problems = validateTransition(cheque, to, date);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (problems.length) return setError(problems[0]);
    try {
      const r = transitionCheque(cheque.id, to, { date, recordPayment: record, reason: to === 'bounced' || to === 'cancelled' ? reason : undefined });
      onDone(r);
      onClose();
    } catch (err) {
      setError(isPeriodLockedError(err) ? `${(err as Error).message} Nothing was changed.` : (err as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`${VERB[to] ?? STATUS_LABELS[to]} · cheque ${cheque.number}`}
      subtitle={`${cheque.party_name} · ₹${formatMoney(cheque.amount)} · ${cheque.bank}`}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>Back</button>
          <button type="submit" form="cheque-action" className={to === 'bounced' || to === 'cancelled' ? controls.btnDanger : controls.btnPrimary}>
            {VERB[to] ?? 'Save'}
          </button>
        </>
      }
    >
      <form id="cheque-action" onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        <label className={controls.field}>
          <span className={controls.label}>Date</span>
          <input className={controls.input} type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} aria-invalid={problems.length > 0 || undefined} />
        </label>
        {willRecord && (
          <label className={controls.check}>
            <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} />
            {linkedInvoice
              ? `Record the payment of ₹${formatMoney(cheque.amount)} against ${linkedInvoice.invoice_number}`
              : `Record the supplier payment against bill ${linkedBill?.bill_number ?? ''}`}
          </label>
        )}
        {(to === 'bounced' || to === 'cancelled') && (
          <label className={controls.field}>
            <span className={controls.label}>Reason</span>
            <select className={controls.select} value={reason} onChange={(e) => setReason(e.target.value)}>
              {(to === 'bounced' ? BOUNCE_REASONS : ['Stop payment', 'Leaf spoiled / torn', 'Paid another way', 'Other']).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        )}
        {to === 'bounced' && (
          <p className={controls.hint}>
            {cheque.payment_id ? 'The payment recorded from this cheque will be reversed and the invoice reopened. ' : ''}
            The customer is flagged: the editor mentions bounced cheques when you bill them. A bounced cheque can be deposited again.
          </p>
        )}
        {to === 'cancelled' && cheque.purchase_payment_id && <p className={controls.hint}>The supplier payment recorded from this cheque will be reversed.</p>}
        {(error || problems.length > 0) && <p className={controls.error} role="alert">{error || problems[0]}</p>}
      </form>
    </Modal>
  );
}
