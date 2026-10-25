/**
 * Record supplier payments from a downloaded e-payment batch once the bank confirms (7U): load the
 * bank's response / status file or statement rows, check the matches, record all paid rows at once.
 * Lazy, inside the e-Payments document.
 */
import { useMemo, useState } from 'react';
import { CheckCheck, Upload } from 'lucide-react';
import { loadEpayBatches, matchResponse, needsConfirmation, parseBankResponse, recordConfirmed, type BankResponseRow } from '../../../lib/epay-confirm';
import { formatDate, formatMoney } from '../../../lib/utils';
import { fxbT } from '../../../i18n/areas/extras-7u';
import controls from '../../../styles/controls.module.css';
import surface from '../../../styles/surface.module.css';
import styles from './bankdocs.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

export default function EpayConfirmPanel({ notify, version }: { notify: Notify; version: number }) {
  const [tick, setTick] = useState(0);
  const batches = useMemo(() => [...loadEpayBatches()].reverse().slice(0, 30), [tick, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [batchId, setBatchId] = useState('');
  const batch = batches.find((b) => b.id === batchId) ?? batches[0];
  const [text, setText] = useState('');
  const [response, setResponse] = useState<BankResponseRow[] | null>(null);
  const [error, setError] = useState('');
  // Review M3: amount-only matches the user ticked (row ids); reset with every new file.
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(() => new Set());
  const result = useMemo(() => (batch && response ? matchResponse(batch, response) : null), [batch, response]);

  if (!batches.length) return <p className={styles.muted}>{fxbT('noBatches')}</p>;

  const read = (raw: string) => {
    setText(raw);
    setConfirmed(new Set());
    try {
      setResponse(parseBankResponse(raw));
      setError('');
    } catch (err) {
      setResponse(null);
      setError((err as Error).message);
    }
  };
  const record = () => {
    if (!batch || !result) return;
    try {
      const r = recordConfirmed(batch.id, result.matches, [...confirmed]);
      notify(fxbT('recordedPayments', { paid: String(r.paid), failed: String(r.failed), amount: `₹${formatMoney(r.total)}` }), 'success');
      setResponse(null);
      setText('');
      setTick((t) => t + 1);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const matchOf = (rowId: string) => result?.matches.find((m) => m.rowId === rowId);
  const recordable = !!result && result.matches.some((m) => m.status !== 'pending' && (!needsConfirmation(m) || confirmed.has(m.rowId)));
  const toggle = (rowId: string, on: boolean) => {
    const next = new Set(confirmed);
    if (on) next.add(rowId);
    else next.delete(rowId);
    setConfirmed(next);
  };
  const statusLabel = { sent: 'stSent', paid: 'stPaid', failed: 'stFailed', pending: 'stPending' } as const;

  return (
    <section className={surface.card} data-epay-confirm>
      <div className={surface.cardHead}>{fxbT('confirmTitle')}</div>
      <div className={`${surface.cardBody} ${styles.stack}`}>
        <p className={styles.muted}>{fxbT('confirmIntro')}</p>
        <label className={controls.field}><span className={controls.label}>{fxbT('batch')}</span>
          <select className={controls.select} value={batch?.id ?? ''} onChange={(e) => { setBatchId(e.target.value); setResponse(null); }}>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.number} · {formatDate(b.date)} · ₹{formatMoney(b.total)} · {b.rows.filter((r) => r.status === 'sent').length} {fxbT('open')}</option>)}
          </select></label>
        <div className={styles.toolbar}>
          <label className={controls.btnOutline}>
            <Upload size={16} /> {fxbT('loadFile')}
            <input type="file" accept=".csv,.txt,.tsv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) read(await f.text()); e.target.value = ''; }} />
          </label>
        </div>
        <label className={controls.field}><span className={controls.label}>{fxbT('orPaste')}</span>
          <textarea className={controls.textarea} rows={4} value={text} onChange={(e) => read(e.target.value)} aria-label={fxbT('orPaste')} /></label>
        {error && <p className={styles.bad}>{error}</p>}
        {batch && (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr><th>{fxbT('vendor')}</th><th>{fxbT('ref')}</th><th className={surface.numeric}>₹</th><th>{fxbT('status')}</th><th>{fxbT('bankSays')}</th></tr></thead>
              <tbody>
                {batch.rows.map((r) => {
                  const m = matchOf(r.id);
                  return (
                    <tr key={r.id}>
                      <td>{r.vendor_name}</td>
                      <td>{r.reference}</td>
                      <td className={surface.numeric}>{formatMoney(r.amount)}</td>
                      <td>{fxbT(statusLabel[r.status])}{r.utr ? ` · ${r.utr}` : ''}</td>
                      <td>
                        {m ? `${fxbT(statusLabel[m.status])} · ${fxbT(m.how === 'reference' ? 'byRef' : m.how === 'account' ? 'byAccount' : 'byAmount')}${m.utr ? ` · ${m.utr}` : ''}${m.date ? ` · ${formatDate(m.date)}` : ''}` : '—'}
                        {m && needsConfirmation(m) && (
                          <label style={{ display: 'block' }}>
                            <input type="checkbox" checked={confirmed.has(m.rowId)} onChange={(e) => toggle(m.rowId, e.target.checked)} /> {fxbT('confirmAmount')}
                          </label>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {result && result.matches.some(needsConfirmation) && <p className={styles.warn}>{fxbT('confirmAmountNote')}</p>}
        {result && result.unmatched.length > 0 && <p className={styles.warn}>{fxbT('unmatched', { lines: result.unmatched.join(', ') })}</p>}
        <div className={styles.toolbar}>
          <button type="button" className={controls.btnPrimary} onClick={record} disabled={!recordable}><CheckCheck size={16} /> {fxbT('recordAll')}</button>
        </div>
      </div>
    </section>
  );
}
