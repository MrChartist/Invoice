import { useMemo, useState } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import { recordRecovery, recoverable } from '../../lib/write-off';
import { formatCurrency, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { colT } from '../../i18n/areas/collections';
import { methodLabel } from '../../i18n/labels';
import controls from '../../styles/controls.module.css';
import styles from './collections.module.css';

const METHODS = ['Bank transfer', 'UPI', 'Cash', 'Cheque'];

/** The recovery form (R2-A3): shared by the payment dialog's offer and the write-off register. */
export function RecoveryForm({ invoice, max, onDone, onCancel }: { invoice: Pick<InvoiceRecord, 'id' | 'invoice_number'>; max: number; onDone: (message: string) => void; onCancel?: () => void }) {
  useT();
  const [amount, setAmount] = useState(String(max));
  const [date, setDate] = useState(todayInput());
  const [method, setMethod] = useState(METHODS[0]);
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const save = () => {
    try {
      const rec = recordRecovery({ invoiceId: invoice.id, amount: Number(amount), date, method, reference: reference.trim() || undefined });
      onDone(colT('recDone', { amount: formatCurrency(rec.amount, 'INR') }));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div className={styles.stack} data-recovery-form>
      <p className={styles.note}>{colT('recIntro')}</p>
      <div className={styles.grid2}>
        <label className={controls.field}>
          <span className={controls.label}>{colT('recAmount')}</span>
          <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="0" step="0.01" max={max} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{colT('recDate')}</span>
          <input className={controls.input} type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{colT('recMethod')}</span>
          <select className={controls.select} value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
          </select>
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{colT('recRef')}</span>
          <input className={controls.input} value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
      </div>
      {error && <p className={controls.error} role="alert">{error}</p>}
      <div className={styles.inlineActions}>
        {onCancel && <button type="button" className={controls.btnOutline} onClick={onCancel}>{colT('cancel')}</button>}
        <button type="button" className={controls.btnPrimary} onClick={save} disabled={!(Number(amount) > 0)}>{colT('recSave')}</button>
      </div>
    </div>
  );
}

/** Payment dialog: a fully settled bill that was written off offers "Record as bad debt recovered". */
export function RecoveryOffer({ invoice, onDone }: { invoice: InvoiceRecord; onDone: (message: string) => void }) {
  useT();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const max = useMemo(() => recoverable(invoice.id), [invoice.id, invoice.updated_at]);
  const [open, setOpen] = useState(false);
  if (!(max > 0.004)) return null;
  return (
    <div className={styles.box} data-recovery-offer>
      <p className={styles.note}>{colT('recOffer', { amount: formatCurrency(max, 'INR') })}</p>
      {open ? (
        <RecoveryForm invoice={invoice} max={max} onCancel={() => setOpen(false)} onDone={(m) => { setOpen(false); onDone(m); }} />
      ) : (
        <div><button type="button" className={controls.btnOutline} onClick={() => setOpen(true)}>{colT('regRecover')}</button></div>
      )}
    </div>
  );
}

export default RecoveryOffer;
