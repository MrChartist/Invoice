import { useMemo, useState } from 'react';
import { dayDiff, isCredit, type BankLine, type Candidate } from '../../lib/bank-recon';
import { round2 } from '../../lib/invoice-calc';
import { formatDate, formatMoney } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { useT } from '../../i18n';
import { bankT } from '../../i18n/areas/bank';
import controls from '../../styles/controls.module.css';
import styles from './reconcile.module.css';

export interface MatchPickerProps {
  line: BankLine | null;
  /** Entries still free to match (already filtered to nothing taken). */
  candidates: readonly Candidate[];
  onClose: () => void;
  onApply: (line: BankLine, type: 'payment' | 'purchase_payment', ids: string[]) => void;
}

/** Pick the receipt(s) / payment(s) in the books that this bank line settles. */
export function MatchPicker({ line, candidates, onClose, onApply }: MatchPickerProps) {
  useT(); // re-render on a language switch (5.4)
  return (
    <Modal
      open={!!line}
      onClose={onClose}
      size="lg"
      title={line && isCredit(line) ? bankT('matchReceipt') : bankT('matchPayment')}
      subtitle={bankT('matchSub')}
    >
      {line && <Body key={line.id} line={line} candidates={candidates} onClose={onClose} onApply={onApply} />}
    </Modal>
  );
}

function Body({ line, candidates, onClose, onApply }: Omit<MatchPickerProps, 'line'> & { line: BankLine }) {
  const credit = isCredit(line);
  const target = credit ? line.credit : line.debit;
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [accept, setAccept] = useState(false);

  const type = credit ? 'payment' : 'purchase_payment';
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter((c) => c.kind === type)
      .filter((c) => !q || `${c.party} ${c.docNumber} ${c.reference} ${c.method} ${c.amount}`.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Math.abs(a.amount - target) - Math.abs(b.amount - target) ||
          Math.abs(dayDiff(line.date, a.date)) - Math.abs(dayDiff(line.date, b.date)),
      )
      .slice(0, 80);
  }, [candidates, query, target, line.date, type]);

  const chosen = candidates.filter((c) => picked.includes(c.id));
  const sum = round2(chosen.reduce((t, c) => t + c.amount, 0));
  const diff = round2(target - sum);
  const exact = Math.abs(diff) <= 0.01;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className={styles.stack}>
      <div className={styles.lineBrief}>
        <strong className={styles.amt}>
          {credit ? '+' : '−'}₹{formatMoney(target)} · {formatDate(line.date)}
        </strong>
        <span className={styles.muted}>{line.narration}</span>
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="pick-q">{bankT('searchEntries')}</label>
        <input id="pick-q" className={controls.input} placeholder={bankT('searchEntriesPh')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {list.length === 0 ? (
        <p className={styles.muted}>{credit ? bankT('noReceipts') : bankT('noPayments')}</p>
      ) : (
        <ul className={styles.pickList} aria-label={bankT('entriesAria')}>
          {list.map((c) => {
            const days = dayDiff(line.date, c.date);
            return (
              <li key={c.id}>
                <label className={styles.pickItem}>
                  <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span className={styles.pickBody}>
                    <span className={styles.pickTitle}>
                      {[c.docNumber, c.party].filter(Boolean).join(' · ') || (credit ? bankT('receipt') : bankT('payment'))}
                    </span>
                    <br />
                    <span className={styles.pickSub}>
                      {formatDate(c.date)} ({days === 0 ? bankT('sameDay') : bankT(days > 0 ? 'daysLater' : 'daysEarlier', { n: Math.abs(days) })}) · {c.method || '-'}
                      {c.reference ? ` · ${c.reference}` : ''}
                    </span>
                  </span>
                  <span className={`${styles.amt} ${Math.abs(c.amount - target) <= 0.01 ? styles.pos : ''}`}>₹{formatMoney(c.amount)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.sumBar} aria-live="polite">
        <span>{bankT('selected')} <strong className={styles.amt}>₹{formatMoney(sum)}</strong> {bankT('ofTarget', { amount: `₹${formatMoney(target)}` })}</span>
        <span className={exact ? styles.pos : styles.neg}>{picked.length === 0 ? '' : exact ? bankT('agree') : bankT('differenceN', { amount: `₹${formatMoney(diff)}` })}</span>
      </div>
      {picked.length > 0 && !exact && (
        <label className={controls.check}>
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>{bankT('matchAnyway')}</span>
        </label>
      )}
      <div className={styles.toolbarGroup} style={{ justifyContent: 'flex-end' }}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{bankT('cancel')}</button>
        <button
          type="button"
          className={controls.btnPrimary}
          disabled={picked.length === 0 || (!exact && !accept)}
          onClick={() => {
            onApply(line, type, picked);
            onClose();
          }}
        >
          {picked.length > 1 ? bankT('matchEntries', { n: picked.length }) : bankT('matchEntry')}
        </button>
      </div>
    </div>
  );
}
