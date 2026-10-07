import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { PurchaseRecord } from '../../types/purchases';
import { PAYMENT_METHODS, balanceOf, paymentsDb, purchasesDb, validatePayment } from '../../lib/purchases';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';
import styles from './purchases.module.css';

export interface PurchasePaymentModalProps {
  /** Id of the bill; the latest copy is read from storage on every change. */
  purchaseId: string | null;
  onClose: () => void;
  onChanged: (message?: string) => void;
}

/** Record a payment against a bill and review/remove earlier payments. */
export function PurchasePaymentModal({ purchaseId, onClose, onChanged }: PurchasePaymentModalProps) {
  return (
    <Modal open={!!purchaseId} onClose={onClose} size="md" title="Record payment">
      {purchaseId && <PaymentBody key={purchaseId} purchaseId={purchaseId} onClose={onClose} onChanged={onChanged} />}
    </Modal>
  );
}

function PaymentBody({ purchaseId, onClose, onChanged }: PurchasePaymentModalProps & { purchaseId: string }) {
  const [version, setVersion] = useState(0);
  const bill: PurchaseRecord | undefined = purchasesDb.get(purchaseId);
  const history = paymentsDb.forPurchase(purchaseId);
  const balance = bill ? balanceOf(bill) : 0;

  const [amount, setAmount] = useState(balance);
  const [date, setDate] = useState(todayInput());
  const [method, setMethod] = useState('UPI');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');

  if (!bill) return <p className={styles.note}>This bill no longer exists.</p>;
  void version;

  const submit = () => {
    const problem = validatePayment(bill, amount, date);
    if (problem) return setError(problem);
    try {
      paymentsDb.record(purchaseId, { amount, date, method, reference });
      setError('');
      setVersion((v) => v + 1);
      const left = balanceOf(purchasesDb.get(purchaseId)!);
      setAmount(left);
      setReference('');
      onChanged(`Payment of ${formatCurrency(amount)} recorded`);
      if (left <= 0) onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removePayment = (id: string) => {
    paymentsDb.remove(id);
    const updated = purchasesDb.get(purchaseId);
    setAmount(updated ? balanceOf(updated) : 0);
    setVersion((v) => v + 1);
    onChanged('Payment removed');
  };

  return (
    <div className={styles.form}>
      <div className={styles.balanceBox}>
        <div>
          <div className={styles.sectionTitle}>{bill.vendor_name}</div>
          <div className={styles.note}>
            {bill.bill_number ? `Bill ${bill.bill_number} · ` : ''}Total {formatCurrency(bill.total)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={styles.sectionTitle}>Balance</div>
          <div className={styles.balanceValue}>{formatCurrency(balance)}</div>
        </div>
      </div>

      {balance > 0 && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="pp-amt">Amount (₹)</label>
              <NumberInput id="pp-amt" className={controls.inputNumeric} value={amount} onChange={setAmount} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="pp-date">Date</label>
              <input id="pp-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="pp-method">Method</label>
              <select id="pp-method" className={controls.select} value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="pp-ref">Reference</label>
              <input id="pp-ref" className={controls.input} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
            </div>
          </div>
          {error && <p className={styles.formError} role="alert">{error}</p>}
          <div className={styles.inlineActions}>
            <button type="button" className={controls.btnOutline} onClick={onClose}>Close</button>
            <button type="submit" className={controls.btnPrimary}>Record payment</button>
          </div>
        </form>
      )}

      <h3 className={styles.sectionTitle}>Payment history</h3>
      {history.length === 0 ? (
        <p className={styles.note}>No payments recorded yet.</p>
      ) : (
        <ul className={styles.history}>
          {history.map((p) => (
            <li key={p.id} className={styles.historyItem}>
              <div>
                <div>{formatDate(p.date)} · {p.method}</div>
                {p.reference && <div className={styles.historyMeta}>Ref {p.reference}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span className={styles.historyAmount}>{formatCurrency(p.amount)}</span>
                <button
                  type="button"
                  className={controls.btnDanger}
                  aria-label={`Remove payment of ${formatCurrency(p.amount)}`}
                  onClick={() => removePayment(p.id)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {balance <= 0 && (
        <div className={styles.inlineActions}>
          <button type="button" className={controls.btnOutline} onClick={onClose}>Close</button>
        </div>
      )}
    </div>
  );
}
