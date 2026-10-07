import { useId, useState } from 'react';
import { Modal } from '../ui/Modal';
import { toIsoDate, type CashAccount, type OpeningBalance } from '../../lib/books';
import controls from '../../styles/controls.module.css';
import styles from './books.module.css';

export interface OpeningBalanceModalProps {
  open: boolean;
  onClose: () => void;
  openings: OpeningBalance[];
  /** Called with the validated values for both accounts. */
  onSave: (values: Record<CashAccount, { amount: number; as_of: string }>) => void;
  /** Suggested as-of date for accounts that have no opening yet. */
  defaultAsOf: string;
}

function latest(openings: OpeningBalance[], account: CashAccount) {
  return openings
    .filter((o) => o.account === account)
    .sort((a, b) => b.as_of.localeCompare(a.as_of))[0];
}

/** Editor shell — remounted on open so the form always starts from stored values. */
export function OpeningBalanceModal(props: OpeningBalanceModalProps) {
  if (!props.open) return null;
  return <OpeningBalanceForm {...props} />;
}

function OpeningBalanceForm({ onClose, openings, onSave, defaultAsOf }: OpeningBalanceModalProps) {
  const uid = useId();
  const init = (a: CashAccount) => {
    const o = latest(openings, a);
    return { amount: o ? String(o.amount) : '', as_of: o?.as_of ?? defaultAsOf };
  };
  const [form, setForm] = useState({ cash: init('cash'), bank: init('bank') });
  const [error, setError] = useState('');

  const set = (a: CashAccount, patch: Partial<{ amount: string; as_of: string }>) =>
    setForm((f) => ({ ...f, [a]: { ...f[a], ...patch } }));

  const submit = () => {
    const out = {} as Record<CashAccount, { amount: number; as_of: string }>;
    for (const a of ['cash', 'bank'] as CashAccount[]) {
      const amount = form[a].amount.trim() === '' ? 0 : Number(form[a].amount);
      const asOf = toIsoDate(form[a].as_of);
      if (!Number.isFinite(amount)) {
        setError(`Enter a valid amount for ${a === 'cash' ? 'Cash in hand' : 'Bank'}.`);
        return;
      }
      if (!asOf) {
        setError(`Choose an "as of" date for ${a === 'cash' ? 'Cash in hand' : 'Bank'}.`);
        return;
      }
      out[a] = { amount, as_of: asOf };
    }
    onSave(out);
  };

  const block = (a: CashAccount, title: string) => (
    <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend className={controls.label} style={{ marginBottom: '0.5rem' }}>{title}</legend>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-${a}-amt`}>Opening amount (₹)</label>
          <input
            id={`${uid}-${a}-amt`}
            className={`${controls.input} ${styles.numInput}`}
            inputMode="decimal"
            type="number"
            step="0.01"
            placeholder="0.00"
            value={form[a].amount}
            onChange={(e) => set(a, { amount: e.target.value })}
          />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-${a}-date`}>As of</label>
          <input
            id={`${uid}-${a}-date`}
            className={controls.input}
            type="date"
            value={form[a].as_of}
            onChange={(e) => set(a, { as_of: e.target.value })}
          />
        </div>
      </div>
    </fieldset>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Opening balances"
      subtitle="Balance on the date you start recording in this app. Transactions dated earlier are left out of the books."
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
          <button type="button" className={controls.btnPrimary} onClick={submit}>Save balances</button>
        </>
      }
    >
      <div className={styles.stack}>
        {block('cash', 'Cash in hand')}
        {block('bank', 'Bank (UPI, transfer, cheque, card)')}
        {error && (
          <div className={controls.error} role="alert">{error}</div>
        )}
      </div>
    </Modal>
  );
}
