import { useId, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import {
  GROUPS,
  MANUAL_VOUCHER_TYPES,
  VOUCHER_TYPE_LABELS,
  loadVouchers,
  nextVoucherNumber,
  rupeesToPaise,
  saveVoucher,
  validateVoucher,
  type Account,
  type ManualVoucher,
  type ManualVoucherType,
} from '../../../lib/ledger';
import { money } from './format';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';

interface Row {
  key: number;
  account_id: string;
  party: string;
  dr: string;
  cr: string;
}

interface Props {
  accounts: Account[];
  /** Existing voucher to edit, or null for a new one. */
  voucher: ManualVoucher | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: (v: ManualVoucher) => void;
}

const PARTY_GROUPS = new Set(['TRADE_RECEIVABLES', 'TRADE_PAYABLES']);
let seq = 0;
const blank = (): Row => ({ key: ++seq, account_id: '', party: '', dr: '', cr: '' });
const toText = (p: number) => (p ? (p / 100).toFixed(2) : '');

/** Mounted per open (by the caller) so the form always starts from the stored voucher. */
export function VoucherEditor({ accounts, voucher, defaultDate, onClose, onSaved }: Props) {
  const uid = useId();
  const [type, setType] = useState<ManualVoucherType>(voucher?.type ?? 'JOURNAL');
  const [date, setDate] = useState(voucher?.date ?? defaultDate);
  const [number, setNumber] = useState(voucher?.number ?? '');
  const [narration, setNarration] = useState(voucher?.narration ?? '');
  const [rows, setRows] = useState<Row[]>(() =>
    voucher
      ? voucher.lines.map((l) => ({ key: ++seq, account_id: l.account_id, party: l.party ?? '', dr: toText(l.dr), cr: toText(l.cr) }))
      : [blank(), blank()],
  );
  const [error, setError] = useState('');
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const lines = rows
    .filter((r) => r.account_id || r.dr || r.cr)
    .map((r) => ({ account_id: r.account_id, dr: rupeesToPaise(r.dr), cr: rupeesToPaise(r.cr), ...(r.party.trim() ? { party: r.party.trim() } : {}) }));
  const dr = lines.reduce((s, l) => s + l.dr, 0);
  const cr = lines.reduce((s, l) => s + l.cr, 0);
  const preview = useMemo(() => (voucher && voucher.type === type ? voucher.number : nextVoucherNumber(loadVouchers(), type, date || defaultDate)), [voucher, type, date, defaultDate]);

  const patch = (key: number, p: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const save = () => {
    const input = { id: voucher?.id, type, date, number: number.trim() || undefined, narration, lines };
    const errors = validateVoucher(input, accounts);
    if (errors.length) return setError(errors[0]);
    try {
      onSaved(saveVoucher(input, accounts));
    } catch (err) {
      setError((err as Error).message || 'Could not save the voucher.');
    }
  };

  /** Fill the last line with whatever makes the voucher balance. */
  const balance = () => {
    const diff = dr - cr;
    if (!diff) return;
    const last = rows[rows.length - 1];
    const target = last && !last.dr && !last.cr ? last : null;
    const amt = (Math.abs(diff) / 100).toFixed(2);
    const fill = diff > 0 ? { cr: amt, dr: '' } : { dr: amt, cr: '' };
    if (target) patch(target.key, fill);
    else setRows((list) => [...list, { ...blank(), ...fill }]);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={voucher ? `Edit voucher ${voucher.number}` : 'New voucher'}
      subtitle="Debits must equal credits to the paisa. Dated entries inside the period lock cannot be saved."
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
          <button type="button" className={controls.btnPrimary} onClick={save} disabled={dr === 0 || dr !== cr}>
            Save voucher
          </button>
        </>
      }
    >
      <div className={books.stack}>
        <div className={styles.formGrid}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-type`}>Type</label>
            <select id={`${uid}-type`} className={controls.select} value={type} onChange={(e) => setType(e.target.value as ManualVoucherType)}>
              {MANUAL_VOUCHER_TYPES.map((t) => (
                <option key={t} value={t}>{VOUCHER_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-date`}>Date</label>
            <input id={`${uid}-date`} type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor={`${uid}-no`}>Number</label>
            <input id={`${uid}-no`} className={`${controls.input} ${controls.inputMono}`} value={number} placeholder={preview} onChange={(e) => setNumber(e.target.value)} />
          </div>
        </div>
        <p className={controls.hint}>
          {type === 'JOURNAL' && 'Journal: adjustments with no cash — depreciation, provisions, GST set-off, opening balances, corrections.'}
          {type === 'CONTRA' && 'Contra: money moved between cash and bank accounts (cash deposited, withdrawn).'}
          {type === 'PAYMENT' && 'Payment: money paid out — credit a cash or bank account.'}
          {type === 'RECEIPT' && 'Receipt: money received — debit a cash or bank account.'}
        </p>

        <div className={styles.editorLines} role="group" aria-label="Voucher lines">
          <div className={styles.editorHead} aria-hidden="true">
            <span>Account</span>
            <span>Party (debtors / creditors)</span>
            <span>Debit ₹</span>
            <span>Credit ₹</span>
            <span />
          </div>
          {rows.map((r, i) => {
            const acc = byId.get(r.account_id);
            const needsParty = !!acc && PARTY_GROUPS.has(acc.group);
            return (
              <div key={r.key} className={styles.editorLine}>
                <select aria-label={`Line ${i + 1} account`} className={controls.select} value={r.account_id} onChange={(e) => patch(r.key, { account_id: e.target.value })}>
                  <option value="">Choose account…</option>
                  {GROUPS.map((g) => {
                    const list = accounts.filter((a) => a.group === g.id);
                    return list.length ? (
                      <optgroup key={g.id} label={g.label}>
                        {list.map((a) => (
                          <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </select>
                <input aria-label={`Line ${i + 1} party`} className={controls.input} value={r.party} disabled={!needsParty} placeholder={needsParty ? 'Party name' : '—'} onChange={(e) => patch(r.key, { party: e.target.value })} />
                <input aria-label={`Line ${i + 1} debit`} className={`${controls.input} ${books.numInput}`} inputMode="decimal" value={r.dr} placeholder="0.00" onChange={(e) => patch(r.key, { dr: e.target.value, ...(e.target.value ? { cr: '' } : {}) })} />
                <input aria-label={`Line ${i + 1} credit`} className={`${controls.input} ${books.numInput}`} inputMode="decimal" value={r.cr} placeholder="0.00" onChange={(e) => patch(r.key, { cr: e.target.value, ...(e.target.value ? { dr: '' } : {}) })} />
                <button type="button" className={controls.btnIcon} aria-label={`Remove line ${i + 1}`} disabled={rows.length <= 2} onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
        <div className={books.toolbar}>
          <div className={books.toolbarGroup}>
            <button type="button" className={controls.btnOutline} onClick={() => setRows((list) => [...list, blank()])}>
              <Plus size={16} /> Add line
            </button>
            <button type="button" className={controls.btnGhost} onClick={balance} disabled={dr === cr}>Balance last line</button>
          </div>
          <div className={styles.editorTotals} aria-live="polite">
            <span>Dr {money(dr)}</span>
            <span>Cr {money(cr)}</span>
            <span className={dr === cr && dr > 0 ? styles.balanced : styles.unbalanced}>
              {dr === cr ? (dr > 0 ? 'Balanced' : 'Enter amounts') : `Difference ${money(Math.abs(dr - cr))}`}
            </span>
          </div>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-narr`}>Narration</label>
          <textarea id={`${uid}-narr`} className={controls.textarea} rows={2} value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
        {error && <div className={controls.error} role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
