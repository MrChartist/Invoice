import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { BankAccountSelect } from '../bank/BankAccountSelect';
import type { PurchaseRecord } from '../../types/purchases';
import { PAYMENT_METHODS, balanceOf, paymentsDb, purchasesDb, validatePayment } from '../../lib/purchases';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { useT } from '../../i18n';
import { methodLabel } from '../../i18n/labels';
import { purT } from '../../i18n/areas/purchases';
import { num, round2 } from '../../lib/invoice-calc';
import { tdsT } from '../../i18n/areas/tds';
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
  useT(); // re-render on a language switch (5.4)
  return (
    <Modal open={!!purchaseId} onClose={onClose} size="md" title={purT('recordPayment')}>
      {purchaseId && <PaymentBody key={purchaseId} purchaseId={purchaseId} onClose={onClose} onChanged={onChanged} />}
    </Modal>
  );
}

function PaymentBody({ purchaseId, onClose, onChanged }: PurchasePaymentModalProps & { purchaseId: string }) {
  const [version, setVersion] = useState(0);
  const bill: PurchaseRecord | undefined = purchasesDb.get(purchaseId);
  const history = paymentsDb.forPurchase(purchaseId);
  const balance = bill ? balanceOf(bill) : 0;
  useT();
  // TDS deducted on payment (bills with tds_on 'PAYMENT'): what is still to deduct on this bill.
  const tdsLeft = bill && bill.tds_on === 'PAYMENT' ? Math.max(round2(num(bill.tds_amount) - history.reduce((s, p) => s + num(p.tds_amount), 0)), 0) : 0;
  const [tds, setTds] = useState(Math.min(tdsLeft, balance));

  const [amount, setAmount] = useState(round2(balance - Math.min(tdsLeft, balance)));
  const [date, setDate] = useState(todayInput());
  const [method, setMethod] = useState('UPI');
  const [bankAccountId, setBankAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');

  if (!bill) return <p className={styles.note}>{purT('billGone')}</p>;
  void version;

  const submit = () => {
    const problem = validatePayment(bill, amount, date, tds);
    if (problem) return setError(problem);
    try {
      paymentsDb.record(purchaseId, { amount, date, method, reference, bankAccountId: bankAccountId || undefined, tdsAmount: tds });
      setTds(0);
      setError('');
      setVersion((v) => v + 1);
      const left = balanceOf(purchasesDb.get(purchaseId)!);
      setAmount(left);
      setReference('');
      onChanged(purT('paymentRecorded', { amount: formatCurrency(amount) }));
      if (left <= 0) onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removePayment = (id: string) => {
    try {
      paymentsDb.remove(id);
    } catch (err) {
      return setError((err as Error).message);
    }
    const updated = purchasesDb.get(purchaseId);
    setAmount(updated ? balanceOf(updated) : 0);
    setVersion((v) => v + 1);
    onChanged(purT('paymentRemoved'));
  };

  return (
    <div className={styles.form}>
      <div className={styles.balanceBox}>
        <div>
          <div className={styles.sectionTitle}>{bill.vendor_name}</div>
          <div className={styles.note}>
            {bill.bill_number ? purT('billRef', { number: bill.bill_number }) : ''}{purT('totalAmount', { amount: formatCurrency(bill.total) })}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={styles.sectionTitle}>{purT('balance')}</div>
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
              <label className={controls.label} htmlFor="pp-amt">{purT('amountRs')}</label>
              <NumberInput id="pp-amt" className={controls.inputNumeric} value={amount} onChange={setAmount} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="pp-date">{purT('date')}</label>
              <input id="pp-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="pp-method">{purT('method')}</label>
              <select id="pp-method" className={controls.select} value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{methodLabel(m)}</option>
                ))}
              </select>
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="pp-ref">{purT('reference')}</label>
              <input id="pp-ref" className={controls.input} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={purT('referencePh')} />
            </div>
          </div>
          {tdsLeft > 0 && (
            <div className={controls.field}>
              <label className={controls.label} htmlFor="pp-tds">{tdsT('tdsNow')}</label>
              <NumberInput id="pp-tds" className={controls.inputNumeric} value={tds} onChange={setTds} />
              <span className={controls.hint}>{tdsT('tdsNowHint', { left: tdsLeft.toFixed(2) })}</span>
            </div>
          )}
          <BankAccountSelect id="pp-bank-account" label={purT('paidFrom')} method={method} value={bankAccountId} onChange={setBankAccountId} />
          {error && <p className={styles.formError} role="alert">{error}</p>}
          <div className={styles.inlineActions}>
            <button type="button" className={controls.btnOutline} onClick={onClose}>{purT('close')}</button>
            <button type="submit" className={controls.btnPrimary}>{purT('recordPayment')}</button>
          </div>
        </form>
      )}

      <h3 className={styles.sectionTitle}>{purT('paymentHistory')}</h3>
      {history.length === 0 ? (
        <p className={styles.note}>{purT('noPayments')}</p>
      ) : (
        <ul className={styles.history}>
          {history.map((p) => (
            <li key={p.id} className={styles.historyItem}>
              <div>
                <div>{formatDate(p.date)} · {methodLabel(p.method)}</div>
                {p.reference && <div className={styles.historyMeta}>{purT('ref', { ref: p.reference })}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span className={styles.historyAmount}>{formatCurrency(p.amount)}</span>
                <button
                  type="button"
                  className={controls.btnDanger}
                  aria-label={purT('removePayment', { amount: formatCurrency(p.amount) })}
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
          <button type="button" className={controls.btnOutline} onClick={onClose}>{purT('close')}</button>
        </div>
      )}
    </div>
  );
}
