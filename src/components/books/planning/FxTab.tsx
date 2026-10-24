import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Info } from 'lucide-react';
import type { BooksData, Period } from '../../../lib/books';
import { foreignReceipts, realisedCsv, realisedTotals, revaluationCsv, revalueReceivables } from '../../../lib/fx-gain';
import { shiftDay } from '../../../lib/dates';
import { localDb } from '../../../lib/localDb';
import { isDateLocked } from '../../../lib/period-lock';
import { formatDate, formatMoney, todayInput } from '../../../lib/utils';
import { downloadCsv } from '../download';
import controls from '../../../styles/controls.module.css';
import surface from '../../../styles/surface.module.css';
import styles from './cashflow.module.css';

const inr = (n: number) => `₹${formatMoney(n)}`;
const signed = (n: number) => <span className={n < 0 ? styles.neg : n > 0 ? styles.pos : ''}>{n < 0 ? `(${formatMoney(-n)})` : formatMoney(n)}</span>;

/** Realised and unrealised exchange differences (6.19) — Books tab "FX gain/loss". Lazy-loaded. */
export default function FxTab({ data, period, onChanged, notify }: { data: BooksData; period: Period; onChanged: () => void; notify: (msg: string) => void }) {
  const rows = useMemo(() => foreignReceipts(data.invoices, data.transactions, period), [data, period]);
  const totals = realisedTotals(rows);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const today = todayInput();
  const [asOf, setAsOf] = useState(period.end < today ? period.end : today);
  const [closing, setClosing] = useState<Record<string, string>>({});
  const rates = useMemo(() => Object.fromEntries(Object.entries(closing).map(([k, v]) => [k, Number(v) || undefined])), [closing]);
  const rev = useMemo(() => revalueReceivables(data.invoices, data.transactions, rates, asOf), [data, rates, asOf]);

  const saveRate = (paymentId: string) => {
    const raw = (draft[paymentId] ?? '').trim();
    const value = raw ? Number(raw) : undefined;
    if (raw && !(Number(raw) > 0)) return setError('Enter the realised rate in rupees, or clear it.');
    try {
      localDb.payments.setRealisedRate(paymentId, value);
      setError('');
      setDraft((d) => {
        const next = { ...d };
        delete next[paymentId];
        return next;
      });
      onChanged();
      notify(value ? 'Realised rate saved — the ledger now books the exchange difference' : 'Realised rate cleared');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className={styles.stack}>
      <div className={styles.estimate} role="note">
        <Info size={16} aria-hidden="true" />
        <span>
          Foreign-currency invoices are booked at their invoice rate, which GST returns, the e-Invoice and tax figures keep using
          (Rule 34) — nothing here changes GST. Enter the rate your bank actually converted at on each receipt: the difference is a
          realised exchange gain or loss, posted automatically to <strong>4930 Foreign exchange gain / loss</strong>. Working
          paper — verify with your CA.
        </span>
      </div>

      <section className={surface.card} aria-labelledby="fx-realised">
        <div className={surface.cardHead}>
          <span id="fx-realised">Realised on receipts · {formatDate(period.start)} – {formatDate(period.end)}</span>
          <button type="button" className={controls.btnOutline} disabled={!rows.length} onClick={() => downloadCsv(`fx-realised-${period.start}_to_${period.end}.csv`, realisedCsv(rows, period))}>
            <Download size={16} /> CSV
          </button>
        </div>
        <div className={styles.kpis} style={{ padding: '1rem' }}>
          <div className={styles.kpi}><span className={styles.kpiLabel}>Gain</span><span className={`${styles.kpiValue} ${styles.pos}`}>{inr(totals.gain)}</span></div>
          <div className={styles.kpi}><span className={styles.kpiLabel}>Loss</span><span className={`${styles.kpiValue} ${styles.neg}`}>{inr(totals.loss)}</span></div>
          <div className={styles.kpi}><span className={styles.kpiLabel}>Net</span><span className={styles.kpiValue}>{signed(totals.net)}</span></div>
          <div className={styles.kpi}><span className={styles.kpiLabel}>Receipts without a rate</span><span className={styles.kpiValue}>{totals.missingRate}</span></div>
        </div>
        {error && <p className={controls.error} role="alert" style={{ margin: '0 1rem 1rem' }}>{error}</p>}
        {rows.length === 0 ? (
          <p className={styles.muted} style={{ padding: '0 1rem 1rem' }}>No receipts against foreign-currency invoices in this period.</p>
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice</th>
                  <th>Party</th>
                  <th className={styles.numeric}>Amount</th>
                  <th className={styles.numeric}>Invoice rate</th>
                  <th>Realised rate (₹)</th>
                  <th className={styles.numeric}>Gain / (loss)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const locked = isDateLocked(r.date);
                  const value = draft[r.paymentId] ?? (r.realisedRate ? String(r.realisedRate) : '');
                  const dirty = draft[r.paymentId] !== undefined;
                  return (
                    <tr key={r.paymentId}>
                      <td>{formatDate(r.date)}</td>
                      <td><Link to={`/invoice/${r.invoiceId}`}>{r.invoiceNumber}</Link></td>
                      <td>{r.party}</td>
                      <td className={styles.numeric}>{r.currency} {formatMoney(r.foreign)}</td>
                      <td className={styles.numeric}>{r.bookRate ?? '—'}</td>
                      <td>
                        <span className={styles.group}>
                          <input
                            className={`${controls.input} ${controls.inputNumeric} ${styles.rateInput}`}
                            type="number"
                            step="0.0001"
                            min="0"
                            inputMode="decimal"
                            aria-label={`Realised rate for ${r.invoiceNumber} receipt of ${formatDate(r.date)}`}
                            value={value}
                            disabled={locked || r.bookRate === null}
                            onChange={(e) => setDraft((d) => ({ ...d, [r.paymentId]: e.target.value }))}
                          />
                          {dirty && (
                            <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => saveRate(r.paymentId)}>
                              Save
                            </button>
                          )}
                        </span>
                      </td>
                      <td className={styles.numeric}>{r.fx ? signed(r.fx.gain) : <span className={styles.muted}>{r.bookRate === null ? 'no invoice rate' : '—'}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={surface.card} aria-labelledby="fx-reval">
        <div className={surface.cardHead}>
          <span id="fx-reval">Period-end revaluation of open receivables (unrealised — not posted)</span>
          <button type="button" className={controls.btnOutline} disabled={!rev.rows.length} onClick={() => downloadCsv(`fx-revaluation-${asOf}.csv`, revaluationCsv(rev))}>
            <Download size={16} /> CSV
          </button>
        </div>
        <div className={styles.toolbar} style={{ padding: '1rem' }}>
          <div className={styles.group}>
            <label className={controls.field}>
              <span className={controls.label}>As on</span>
              <input className={controls.input} type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
            </label>
            {rev.currencies.map((c) => (
              <label key={c} className={controls.field}>
                <span className={controls.label}>Closing rate ₹ per {c}</span>
                <input
                  className={`${controls.input} ${controls.inputNumeric} ${styles.rateInput}`}
                  type="number"
                  step="0.0001"
                  min="0"
                  inputMode="decimal"
                  value={closing[c] ?? ''}
                  onChange={(e) => setClosing((m) => ({ ...m, [c]: e.target.value }))}
                  placeholder="RBI / FEDAI rate"
                />
              </label>
            ))}
          </div>
        </div>
        {rev.rows.length === 0 ? (
          <p className={styles.muted} style={{ padding: '0 1rem 1rem' }}>No foreign-currency invoices are open on {formatDate(asOf)}.</p>
        ) : (
          <>
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Party</th>
                    <th className={styles.numeric}>Open</th>
                    <th className={styles.numeric}>Invoice rate</th>
                    <th className={styles.numeric}>At invoice rate</th>
                    <th className={styles.numeric}>At closing rate</th>
                    <th className={styles.numeric}>Unrealised</th>
                  </tr>
                </thead>
                <tbody>
                  {rev.rows.map((r) => (
                    <tr key={r.invoiceId}>
                      <td><Link to={`/invoice/${r.invoiceId}`}>{r.invoiceNumber}</Link> <span className={styles.muted}>{formatDate(r.issueDate)}</span></td>
                      <td>{r.party}</td>
                      <td className={styles.numeric}>{r.currency} {formatMoney(r.openForeign)}</td>
                      <td className={styles.numeric}>{r.bookRate}</td>
                      <td className={styles.numeric}>{formatMoney(r.bookInr)}</td>
                      <td className={styles.numeric}>{r.closingInr === null ? '—' : formatMoney(r.closingInr)}</td>
                      <td className={styles.numeric}>{r.unrealised === null ? <span className={styles.muted}>enter rate</span> : signed(r.unrealised)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.muted} style={{ padding: '0.75rem 1rem 1rem' }}>
              Net unrealised {rev.totals.unrealised >= 0 ? 'gain' : 'loss'} {inr(Math.abs(rev.totals.unrealised))}
              {rev.totals.missingRate > 0 && ` (${rev.totals.missingRate} invoice(s) without a closing rate left out)`}. If your CA wants it in the
              accounts (AS 11), post a journal on {formatDate(asOf)} — {rev.totals.unrealised >= 0 ? 'Dr Sundry debtors, Cr 4930 Foreign exchange gain / loss' : 'Dr 4930 Foreign exchange gain / loss, Cr Sundry debtors'} — and reverse it on{' '}
              {formatDate(shiftDay(asOf, 1))}, so the realised difference is booked in full when the money arrives. Nothing is posted from this report.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
