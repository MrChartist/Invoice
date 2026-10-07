import { useMemo, useState } from 'react';
import { guessCounterparty, inferMode, nameOverlap, referenceFor, documentNumberHit, type BankLine } from '../../lib/bank-recon';
import { round2 } from '../../lib/invoice-calc';
import { balanceOf, purchasesDb } from '../../lib/purchases';
import { formatDate, formatMoney } from '../../lib/utils';
import { readPurchase } from '../../lib/purchase-normalize';
import { PURCHASE_CATEGORIES, type PurchaseRecord } from '../../types/purchases';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { recordBillPaymentFromLine, recordExpenseFromLine } from './actions';
import controls from '../../styles/controls.module.css';
import styles from './reconcile.module.css';

export interface CreateExpenseModalProps {
  line: BankLine | null;
  onClose: () => void;
  onChanged: () => void;
  /** The debit is now explained by this payment id (from a new expense or an existing bill). */
  onSettled: (line: BankLine, paymentId: string) => void;
}

const GST_RATES = [0, 5, 12, 18, 28];

export function CreateExpenseModal({ line, onClose, onChanged, onSettled }: CreateExpenseModalProps) {
  return (
    <Modal
      open={!!line}
      onClose={onClose}
      size="lg"
      title="Record this debit"
      subtitle="Create the expense, or pay a supplier bill — either one is booked on the bank date."
    >
      {line && <Body key={line.id} line={line} onClose={onClose} onChanged={onChanged} onSettled={onSettled} />}
    </Modal>
  );
}

function Body({ line, onClose, onChanged, onSettled }: Omit<CreateExpenseModalProps, 'line'> & { line: BankLine }) {
  const [mode, setMode] = useState<'expense' | 'bill'>('expense');
  const [error, setError] = useState('');
  const brief = (
    <div className={styles.lineBrief}>
      <strong className={styles.amt}>−₹{formatMoney(line.debit)} · {formatDate(line.date)} · {inferMode(line.narration)}</strong>
      <span className={styles.muted}>{line.narration}</span>
    </div>
  );

  return (
    <div className={styles.stack}>
      {brief}
      <div className={styles.tabs2} role="tablist" aria-label="How to record this debit">
        {(['expense', 'bill'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? styles.tabBtnActive : styles.tabBtn}
            onClick={() => {
              setMode(m);
              setError('');
            }}
          >
            {m === 'expense' ? 'New expense' : 'Pay a supplier bill'}
          </button>
        ))}
      </div>
      {mode === 'expense' ? (
        <NewExpense line={line} onError={setError} onChanged={onChanged} onSettled={onSettled} onClose={onClose} />
      ) : (
        <PayBill line={line} onError={setError} onChanged={onChanged} onSettled={onSettled} onClose={onClose} />
      )}
      {error && <div className={controls.error} role="alert">{error}</div>}
    </div>
  );
}

type PartProps = Pick<CreateExpenseModalProps, 'onChanged' | 'onSettled' | 'onClose'> & { line: BankLine; onError: (m: string) => void };

function NewExpense({ line, onError, onChanged, onSettled, onClose }: PartProps) {
  const [category, setCategory] = useState<string>('Other');
  const [vendor, setVendor] = useState(() => guessCounterparty(line.narration));
  const [rate, setRate] = useState(0);
  const [itc, setItc] = useState(false);

  const submit = () => {
    onError('');
    try {
      const { payment } = recordExpenseFromLine(line, { category, vendorName: vendor, taxRate: rate, itcEligible: itc });
      onChanged();
      onSettled(line, payment.id);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not record the expense.');
    }
  };

  return (
    <div className={styles.stack}>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="ex-cat">Category</label>
          <select id="ex-cat" className={controls.select} value={category} onChange={(e) => setCategory(e.target.value)}>
            {PURCHASE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="ex-vendor">Paid to</label>
          <input id="ex-vendor" className={controls.input} value={vendor} placeholder="Vendor name" onChange={(e) => setVendor(e.target.value)} />
        </div>
      </div>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="ex-gst">GST included in ₹{formatMoney(line.debit)}</label>
          <select id="ex-gst" className={controls.select} value={rate} onChange={(e) => setRate(+e.target.value)}>
            {GST_RATES.map((r) => <option key={r} value={r}>{r === 0 ? 'No GST' : `${r}%`}</option>)}
          </select>
        </div>
        <label className={controls.check} style={{ alignSelf: 'end', minHeight: 40 }}>
          <input type="checkbox" checked={itc} disabled={rate === 0} onChange={(e) => setItc(e.target.checked)} />
          <span>Claim GST as input tax credit</span>
        </label>
      </div>
      <div className={styles.toolbarGroup} style={{ justifyContent: 'flex-end' }}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
        <button type="button" className={controls.btnPrimary} onClick={submit}>Create expense &amp; match</button>
      </div>
    </div>
  );
}

function PayBill({ line, onError, onChanged, onSettled, onClose }: PartProps) {
  const [query, setQuery] = useState('');
  const [billId, setBillId] = useState('');
  const [amount, setAmount] = useState(0);

  const bills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return purchasesDb
      .all()
      .map((p) => ({ p, core: readPurchase(p, []), owing: balanceOf(p) }))
      .filter((x) => x.core && x.owing > 0)
      .map((x) => {
        const name = x.p.vendor_name || x.core?.partyName || '';
        let score = 0;
        if (Math.abs(x.owing - line.debit) <= 0.01) score += 45;
        else if (line.debit < x.owing) score += 8;
        score += Math.round(30 * nameOverlap(name, line.narration));
        if (x.p.bill_number && documentNumberHit(x.p.bill_number, line.narration)) score += 40;
        return { ...x, name, score };
      })
      .filter((x) => !q || `${x.name} ${x.p.bill_number}`.toLowerCase().includes(q))
      .sort((a, b) => b.score - a.score || a.p.date.localeCompare(b.p.date))
      .slice(0, 30);
  }, [query, line.debit, line.narration]);

  const choose = (p: PurchaseRecord) => {
    setBillId(p.id);
    setAmount(Math.min(line.debit, balanceOf(p)));
    onError('');
  };

  const submit = () => {
    onError('');
    try {
      const pay = recordBillPaymentFromLine(line, billId, amount);
      onChanged();
      if (round2(amount) >= round2(line.debit) - 0.01) onSettled(line, pay.id);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not record the payment.');
    }
  };

  return (
    <div className={styles.stack}>
      <p className={styles.muted}>Reference recorded: <strong>{referenceFor(line) || '—'}</strong>. Bills that look like this debit are listed first.</p>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="pb-q">Search bills</label>
        <input id="pb-q" className={controls.input} placeholder="Vendor or bill no.…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {bills.length === 0 ? (
        <p className={styles.muted}>No unpaid supplier bills. Use “New expense” instead.</p>
      ) : (
        <ul className={styles.pickList} aria-label="Unpaid supplier bills">
          {bills.map(({ p, name, owing }) => (
            <li key={p.id}>
              <label className={styles.pickItem}>
                <input type="radio" name="pb-bill" checked={billId === p.id} onChange={() => choose(p)} />
                <span className={styles.pickBody}>
                  <span className={styles.pickTitle}>{name || 'Vendor'} {p.bill_number ? `· ${p.bill_number}` : ''}</span>
                  <br />
                  <span className={styles.pickSub}>{formatDate(p.date)} · total ₹{formatMoney(p.total)}</span>
                </span>
                <span className={styles.amt}>₹{formatMoney(owing)} due</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {billId && (
        <div className={controls.field} style={{ maxWidth: 260 }}>
          <label className={controls.label} htmlFor="pb-amt">Amount to record</label>
          <NumberInput id="pb-amt" className={`${controls.input} ${controls.inputNumeric}`} value={amount} onChange={setAmount} />
        </div>
      )}
      <div className={styles.toolbarGroup} style={{ justifyContent: 'flex-end' }}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
        <button type="button" className={controls.btnPrimary} disabled={!billId || !(amount > 0)} onClick={submit}>Record payment</button>
      </div>
    </div>
  );
}
