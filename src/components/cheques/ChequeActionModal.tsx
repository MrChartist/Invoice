import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { transitionCheque, validateTransition, type TransitionResult } from '../../lib/cheques';
import { localDb } from '../../lib/localDb';
import { purchasesDb } from '../../lib/purchases';
import { isPeriodLockedError } from '../../lib/period-lock';
import { formatMoney, todayInput } from '../../lib/utils';
import type { Cheque, ChequeStatus } from '../../types/cheques';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { chqT, reasonLabel } from '../../i18n/areas/cheques';

const BOUNCE_REASONS = ['Funds insufficient', 'Signature differs', 'Payment stopped by drawer', 'Account closed', 'Exceeds arrangement', 'Alterations / overwriting', 'Other'];

const verb = (s: ChequeStatus): string | undefined =>
  s === 'deposited' || s === 'presented' || s === 'cleared' || s === 'bounced' || s === 'cancelled' ? chqT(`verb.${s}`) : undefined;

export interface ChequeActionModalProps {
  cheque: Cheque | null;
  to: ChequeStatus | null;
  onClose: () => void;
  onDone: (r: TransitionResult) => void;
}

/** Date (and options) for moving a cheque along its lifecycle. */
export function ChequeActionModal({ cheque, to, onClose, onDone }: ChequeActionModalProps) {
  useT(); // re-render on a language switch (5.4)
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
      setError(isPeriodLockedError(err) ? chqT('aNothing', { message: (err as Error).message }) : (err as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={chqT('aTitle', { verb: verb(to) ?? chqT(`st.${to}`), number: cheque.number })}
      subtitle={`${cheque.party_name} · ₹${formatMoney(cheque.amount)} · ${cheque.bank}`}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{chqT('back')}</button>
          <button type="submit" form="cheque-action" className={to === 'bounced' || to === 'cancelled' ? controls.btnDanger : controls.btnPrimary}>
            {verb(to) ?? chqT('save')}
          </button>
        </>
      }
    >
      <form id="cheque-action" onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        <label className={controls.field}>
          <span className={controls.label}>{chqT('date')}</span>
          <input className={controls.input} type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} aria-invalid={problems.length > 0 || undefined} />
        </label>
        {willRecord && (
          <label className={controls.check}>
            <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} />
            {linkedInvoice
              ? chqT('aRecordInv', { amount: formatMoney(cheque.amount), number: linkedInvoice.invoice_number })
              : chqT('aRecordBill', { number: linkedBill?.bill_number ?? '' })}
          </label>
        )}
        {(to === 'bounced' || to === 'cancelled') && (
          <label className={controls.field}>
            <span className={controls.label}>{chqT('reason')}</span>
            <select className={controls.select} value={reason} onChange={(e) => setReason(e.target.value)}>
              {(to === 'bounced' ? BOUNCE_REASONS : ['Stop payment', 'Leaf spoiled / torn', 'Paid another way', 'Other']).map((r) => (
                <option key={r} value={r}>{reasonLabel(r)}</option>
              ))}
            </select>
          </label>
        )}
        {to === 'bounced' && (
          <p className={controls.hint}>
            {cheque.payment_id ? chqT('aReversed') : ''}
            {chqT('aFlagged')}
          </p>
        )}
        {to === 'cancelled' && cheque.purchase_payment_id && <p className={controls.hint}>{chqT('aSupplierReversed')}</p>}
        {(error || problems.length > 0) && <p className={controls.error} role="alert">{error || problems[0]}</p>}
      </form>
    </Modal>
  );
}
