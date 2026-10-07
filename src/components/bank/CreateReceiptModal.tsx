import { useMemo, useState } from 'react';
import { inferMode, openBalance, referenceFor, suggestInvoices, type BankLine } from '../../lib/bank-recon';
import { round2 } from '../../lib/invoice-calc';
import { localDb } from '../../lib/localDb';
import { formatDate, formatMoney } from '../../lib/utils';
import type { Payment } from '../../types/invoice';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { recordReceiptFromLine } from './actions';
import controls from '../../styles/controls.module.css';
import styles from './reconcile.module.css';

export interface CreateReceiptModalProps {
  line: BankLine | null;
  onClose: () => void;
  /** Called after EVERY receipt is written, so the screen can refresh the books. */
  onChanged: () => void;
  /** The credit is fully covered: these receipts settle it. */
  onSettled: (line: BankLine, payments: Payment[]) => void;
}

/**
 * Record the credit as a payment received against a chosen invoice (same effect as the Payment dialog:
 * invoice status and balance update). A credit that pays several invoices is recorded one invoice at a
 * time until nothing is left.
 */
export function CreateReceiptModal({ line, onClose, onChanged, onSettled }: CreateReceiptModalProps) {
  return (
    <Modal
      open={!!line}
      onClose={onClose}
      size="lg"
      title="Create receipt from this credit"
      subtitle="Records a payment received on the bank date, with the UTR / reference found in the narration."
    >
      {line && <Body key={line.id} line={line} onClose={onClose} onChanged={onChanged} onSettled={onSettled} />}
    </Modal>
  );
}

function Body({ line, onClose, onChanged, onSettled }: Omit<CreateReceiptModalProps, 'line'> & { line: BankLine }) {
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState(0);
  const [created, setCreated] = useState<Payment[]>([]);
  const [error, setError] = useState('');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => localDb.invoices.getAll(), [version]);
  const ranked = useMemo(() => suggestInvoices(line, invoices, 6), [line, invoices]);
  const paid = round2(created.reduce((t, p) => t + p.amount, 0));
  const remaining = round2(line.credit - paid);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ranked.map((r) => r.invoice);
    return invoices
      .filter((i) => openBalance(i) > 0 && `${i.invoice_number} ${i.client?.company ?? ''} ${i.client?.name ?? ''}`.toLowerCase().includes(q))
      .slice(0, 30);
  }, [invoices, ranked, query]);

  const selected = invoices.find((i) => i.id === invoiceId);
  const balance = selected ? openBalance(selected) : 0;
  const reasons = ranked.find((r) => r.invoice.id === invoiceId)?.reasons ?? [];

  const choose = (id: string) => {
    const inv = invoices.find((i) => i.id === id);
    setInvoiceId(id);
    setError('');
    if (inv) setAmount(Math.min(remaining, openBalance(inv)));
  };

  const submit = () => {
    setError('');
    try {
      const p = recordReceiptFromLine(line, invoiceId, amount);
      const all = [...created, p];
      setCreated(all);
      setVersion((v) => v + 1);
      setInvoiceId('');
      onChanged();
      const left = round2(line.credit - all.reduce((t, x) => t + x.amount, 0));
      if (left <= 0.01) {
        onSettled(line, all);
        onClose();
      } else {
        setAmount(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the receipt.');
    }
  };

  return (
    <div className={styles.stack}>
      <div className={styles.lineBrief}>
        <strong className={styles.amt}>+₹{formatMoney(line.credit)} · {formatDate(line.date)} · {inferMode(line.narration)}</strong>
        <span className={styles.muted}>{line.narration}</span>
        <span className={styles.muted}>Reference to record: <strong>{referenceFor(line) || '—'}</strong></span>
      </div>

      {created.length > 0 && (
        <div className={styles.notice} role="status">
          Recorded {created.length} receipt{created.length === 1 ? '' : 's'} (₹{formatMoney(paid)}). <strong>₹{formatMoney(remaining)} of this credit is still unallocated</strong> — pick the next invoice.
        </div>
      )}

      <div className={controls.field}>
        <label className={controls.label} htmlFor="rc-q">{query ? 'Search results' : 'Likely invoices'} — or search all open invoices</label>
        <input id="rc-q" className={controls.input} placeholder="Invoice no. or customer…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {candidates.length === 0 ? (
        <p className={styles.muted}>No open invoice looks like this credit. Search by invoice number or customer name.</p>
      ) : (
        <ul className={styles.pickList} aria-label="Open invoices">
          {candidates.map((inv) => (
            <li key={inv.id}>
              <label className={styles.pickItem}>
                <input type="radio" name="rc-invoice" checked={invoiceId === inv.id} onChange={() => choose(inv.id)} />
                <span className={styles.pickBody}>
                  <span className={styles.pickTitle}>{inv.invoice_number} · {inv.client?.company || inv.client?.name}</span>
                  <br />
                  <span className={styles.pickSub}>Issued {formatDate(inv.issue_date)} · total ₹{formatMoney(inv.total)}</span>
                </span>
                <span className={styles.amt}>₹{formatMoney(openBalance(inv))} due</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className={controls.field} style={{ maxWidth: 260 }}>
          <label className={controls.label} htmlFor="rc-amt">Amount to record</label>
          <NumberInput id="rc-amt" className={`${controls.input} ${controls.inputNumeric}`} value={amount} onChange={setAmount} />
          <span className={controls.hint}>
            Balance ₹{formatMoney(balance)}. {reasons.length ? reasons.join(' · ') : ''}
          </span>
        </div>
      )}

      {error && <div className={controls.error} role="alert">{error}</div>}

      <div className={styles.toolbarGroup} style={{ justifyContent: 'flex-end' }}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{created.length ? 'Done for now' : 'Cancel'}</button>
        <button type="button" className={controls.btnPrimary} disabled={!selected || !(amount > 0)} onClick={submit}>
          Record receipt
        </button>
      </div>
    </div>
  );
}
