import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { can } from '../../lib/access';
import { listUsers } from '../../lib/auth';
import { FOLLOW_UP_KINDS, followUpIssues, saveFollowUp, type FollowUpKind } from '../../lib/collections';
import { round2 } from '../../lib/invoice-calc';
import { formatCurrency, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { colT } from '../../i18n/areas/collections';
import controls from '../../styles/controls.module.css';
import styles from './collections.module.css';

export interface FollowUpBill {
  id: string;
  number: string;
  outstanding: number;
}

export interface FollowUpDialogProps {
  partyKey: string;
  partyName: string;
  /** Open bills of the party (for "bills covered"). */
  bills?: FollowUpBill[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

/**
 * R2-A4 "Log follow-up": how (call / visit / WhatsApp / note), what happened, an optional promise to pay
 * (amount, date, bills or on account) and an optional next action with an assignee (local users, 6.21).
 */
export function FollowUpDialog({ partyKey, partyName, bills = [], onClose, onSaved }: FollowUpDialogProps) {
  useT();
  const users = useMemo(() => {
    try {
      return listUsers();
    } catch {
      return [];
    }
  }, []);
  const total = round2(bills.reduce((s, b) => s + b.outstanding, 0));
  const [kind, setKind] = useState<FollowUpKind>('call');
  const [outcome, setOutcome] = useState('');
  const [promise, setPromise] = useState(false);
  const [amount, setAmount] = useState(total > 0 ? String(total) : '');
  const [promiseDate, setPromiseDate] = useState('');
  const [covered, setCovered] = useState<Set<string>>(new Set());
  const [next, setNext] = useState(false);
  const [nextDate, setNextDate] = useState('');
  const [assignee, setAssignee] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const today = todayInput();

  const build = () => {
    const user = users.find((u) => u.id === assignee);
    return {
      party_key: partyKey,
      party_name: partyName,
      kind,
      outcome,
      date: today,
      ...(promise ? { promise: { amount: Number(amount) || 0, date: promiseDate, ...(covered.size ? { invoice_ids: [...covered] } : {}) } } : {}),
      ...(next ? { next_action: { date: nextDate, ...(user ? { user_id: user.id, user_name: user.name } : {}) } } : {}),
    };
  };

  const save = () => {
    const input = build();
    const issues = followUpIssues(input);
    if (issues.length) return setErrors(issues);
    try {
      saveFollowUp(input);
      onSaved(colT('fuSaved'));
      onClose();
    } catch (err) {
      setErrors([(err as Error).message]);
    }
  };

  const toggleBill = (id: string) => setCovered((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    const sum = round2(bills.filter((b) => n.has(b.id)).reduce((t, b) => t + b.outstanding, 0));
    setAmount(String(n.size ? sum : total));
    return n;
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={colT('fuTitle', { name: partyName })}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{colT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={save} disabled={!can('payment.record')} data-followup-save>{colT('fuSave')}</button>
        </>
      }
    >
      <div className={styles.stack} data-followup-dialog>
        {!can('payment.record') && <p className={controls.error} role="alert">{colT('noAccess')}</p>}
        <div className={controls.field}>
          <span className={controls.label}>{colT('fuKind')}</span>
          <div className={controls.segment} role="radiogroup" aria-label={colT('fuKind')}>
            {FOLLOW_UP_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setKind(k)}>
                {colT(`kind.${k}`)}
              </button>
            ))}
          </div>
        </div>
        <label className={controls.field}>
          <span className={controls.label}>{colT('fuOutcome')}</span>
          <textarea className={controls.textarea} rows={2} value={outcome} placeholder={colT('fuOutcomePh')} maxLength={500} onChange={(e) => setOutcome(e.target.value)} data-followup-outcome />
        </label>

        <label className={controls.check}>
          <input type="checkbox" checked={promise} onChange={(e) => setPromise(e.target.checked)} data-followup-promise />
          {colT('fuPromise')}
        </label>
        {promise && (
          <div className={styles.box}>
            <div className={styles.grid2}>
              <label className={controls.field}>
                <span className={controls.label}>{colT('fuPromiseAmount')}</span>
                <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-followup-amount />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{colT('fuPromiseDate')}</span>
                <input className={controls.input} type="date" min={today} value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} data-followup-date />
              </label>
            </div>
            {bills.length > 0 && (
              <fieldset className={`${styles.stack} ${styles.plain}`}>
                <legend className={controls.label}>{colT('fuBills')}</legend>
                {bills.map((b) => (
                  <label key={b.id} className={controls.check}>
                    <input type="checkbox" checked={covered.has(b.id)} onChange={() => toggleBill(b.id)} />
                    {b.number} · {formatCurrency(b.outstanding, 'INR')}
                  </label>
                ))}
                {covered.size === 0 && <span className={styles.note}>{colT('fuOnAccount')}</span>}
              </fieldset>
            )}
            <p className={styles.note}>{colT('fuPauseHint')}</p>
          </div>
        )}

        <label className={controls.check}>
          <input type="checkbox" checked={next} onChange={(e) => setNext(e.target.checked)} />
          {colT('fuNext')}
        </label>
        {next && (
          <div className={styles.grid2}>
            <label className={controls.field}>
              <span className={controls.label}>{colT('fuNextDate')}</span>
              <input className={controls.input} type="date" min={today} value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
            </label>
            {users.length > 0 && (
              <label className={controls.field}>
                <span className={controls.label}>{colT('fuAssignee')}</span>
                <select className={controls.select} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">{colT('fuMe')}</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
        {errors.length > 0 && <div className={controls.error} role="alert">{errors.map((e) => <div key={e}>{e}</div>)}</div>}
      </div>
    </Modal>
  );
}

export default FollowUpDialog;
