import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { round2 } from '../../lib/invoice-calc';
import { localDb } from '../../lib/localDb';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import type { InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import styles from './PaymentModal.module.css';

const METHODS = ['UPI', 'Bank transfer', 'Cash', 'Cheque', 'Card', 'Other'];

export interface PaymentModalProps {
  invoice: InvoiceRecord | null;
  onClose: () => void;
  /** Called after any change so the caller can refresh its list. */
  onChanged: (message?: string) => void;
}

export function PaymentModal({ invoice, onClose, onChanged }: PaymentModalProps) {
  const [version, setVersion] = useState(0);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(METHODS[0]);
  const [date, setDate] = useState(todayInput());
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');

  // Always read the live row — a payment changes the balance under us.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const live = useMemo(() => (invoice ? localDb.invoices.getById(invoice.id) ?? invoice : null), [invoice, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const payments = useMemo(() => (invoice ? localDb.payments.listFor(invoice.id) : []), [invoice, version]);
  const balance = live ? Math.max(live.balance_due ?? live.total - (live.amount_paid ?? 0), 0) : 0;

  useEffect(() => {
    if (!invoice) return;
    setAmount(balance > 0 ? String(round2(balance)) : '');
    setMethod(METHODS[0]);
    setDate(todayInput());
    setReference('');
    setError('');
    // Reset the form only when a different document is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  if (!invoice || !live) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return setError('Enter an amount above zero.');
    if (value > balance + 0.005) return setError(`This is more than the balance of ${formatCurrency(balance, live.currency)}.`);
    try {
      localDb.payments.record({ invoiceId: live.id, amount: value, method, reference: reference.trim() || undefined, date });
      setVersion((v) => v + 1);
      setError('');
      const settled = value >= balance - 0.005;
      onChanged(settled ? `${live.invoice_number} marked as paid` : `Recorded ${formatCurrency(value, live.currency)}`);
      if (settled) onClose();
      else setAmount(String(Math.max(round2(balance - value), 0)));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removePayment = (id: string) => {
    localDb.payments.remove(id);
    setVersion((v) => v + 1);
    onChanged('Payment removed');
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Record payment"
      subtitle={`${live.invoice_number} · ${live.client?.name ?? ''}`}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            Close
          </button>
          <button type="submit" form="payment-form" className={controls.btnPrimary} disabled={balance <= 0}>
            Record payment
          </button>
        </>
      }
    >
      <dl className={styles.summary}>
        <div>
          <dt>Total</dt>
          <dd>{formatCurrency(live.total, live.currency)}</dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd className={styles.good}>{formatCurrency(live.amount_paid ?? 0, live.currency)}</dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd className={balance > 0 ? styles.due : styles.good}>{formatCurrency(balance, live.currency)}</dd>
        </div>
      </dl>

      {balance > 0 ? (
        <form id="payment-form" onSubmit={submit} className={styles.form} noValidate>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>Amount</span>
              <input
                className={controls.inputNumeric + ' ' + controls.input}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={Boolean(error) || undefined}
                autoFocus
              />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>Date received</span>
              <input className={controls.input} type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>Method</span>
              <select className={controls.select} value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>Reference (optional)</span>
              <input className={controls.input} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
            </label>
          </div>
          {error && <p className={controls.error} role="alert">{error}</p>}
        </form>
      ) : (
        <p className={controls.ok}>Fully paid. Nothing is outstanding.</p>
      )}

      {payments.length > 0 && (
        <div>
          <div className={styles.historyLabel}>Payment history</div>
          <ul className={styles.history}>
            {payments.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{formatCurrency(p.amount, live.currency)}</strong>
                  <span>
                    {p.method} · {formatDate(p.date)}
                    {p.reference ? ` · ${p.reference}` : ''}
                  </span>
                </div>
                <button type="button" className={controls.btnDanger} onClick={() => removePayment(p.id)} aria-label={`Remove payment of ${formatCurrency(p.amount, live.currency)}`}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
