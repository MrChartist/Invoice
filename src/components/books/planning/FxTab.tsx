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
import { useT } from '../../../i18n';
import { planT } from '../../../i18n/areas/books-planning';
import { nodes } from '../../../i18n/areas/nodes';
import { DateField } from '../../ui/DateField';

const inr = (n: number) => `₹${formatMoney(n)}`;
const signed = (n: number) => <span className={n < 0 ? styles.neg : n > 0 ? styles.pos : ''}>{n < 0 ? `(${formatMoney(-n)})` : formatMoney(n)}</span>;

/** Realised and unrealised exchange differences (6.19) — Books tab "FX gain/loss". Lazy-loaded. */
export default function FxTab({ data, period, onChanged, notify }: { data: BooksData; period: Period; onChanged: () => void; notify: (msg: string) => void }) {
  useT();
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
    if (raw && !(Number(raw) > 0)) return setError(planT('rateInvalid'));
    try {
      localDb.payments.setRealisedRate(paymentId, value);
      setError('');
      setDraft((d) => {
        const next = { ...d };
        delete next[paymentId];
        return next;
      });
      onChanged();
      notify(value ? planT('rateSaved') : planT('rateCleared'));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className={styles.stack}>
      <div className={styles.estimate} role="note">
        <Info size={16} aria-hidden="true" />
        <span>{nodes(planT('fxNotice'), { account: <strong>4930 Foreign exchange gain / loss</strong> })}</span>
      </div>

      <section className={surface.card} aria-labelledby="fx-realised">
        <div className={surface.cardHead}>
          <span id="fx-realised">{planT('realisedHead', { start: formatDate(period.start), end: formatDate(period.end) })}</span>
          <button type="button" className={controls.btnOutline} disabled={!rows.length} onClick={() => downloadCsv(`fx-realised-${period.start}_to_${period.end}.csv`, realisedCsv(rows, period))}>
            <Download size={16} /> CSV
          </button>
        </div>
        <div className={styles.kpis} style={{ padding: '1rem' }}>
          <div className={styles.kpi}><span className={styles.kpiLabel}>{planT('gain')}</span><span className={`${styles.kpiValue} ${styles.pos}`}>{inr(totals.gain)}</span></div>
          <div className={styles.kpi}><span className={styles.kpiLabel}>{planT('loss')}</span><span className={`${styles.kpiValue} ${styles.neg}`}>{inr(totals.loss)}</span></div>
          <div className={styles.kpi}><span className={styles.kpiLabel}>{planT('net')}</span><span className={styles.kpiValue}>{signed(totals.net)}</span></div>
          <div className={styles.kpi}><span className={styles.kpiLabel}>{planT('missingRate')}</span><span className={styles.kpiValue}>{totals.missingRate}</span></div>
        </div>
        {error && <p className={controls.error} role="alert" style={{ margin: '0 1rem 1rem' }}>{error}</p>}
        {rows.length === 0 ? (
          <p className={styles.muted} style={{ padding: '0 1rem 1rem' }}>{planT('noForeignReceipts')}</p>
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead>
                <tr>
                  <th>{planT('colDate')}</th>
                  <th>{planT('colInvoice')}</th>
                  <th>{planT('colParty')}</th>
                  <th className={styles.numeric}>{planT('colAmount')}</th>
                  <th className={styles.numeric}>{planT('colInvoiceRate')}</th>
                  <th>{planT('colRealisedRate')}</th>
                  <th className={styles.numeric}>{planT('colGainLoss')}</th>
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
                      <td className={styles.numeric}>{r.bookRate ?? '-'}</td>
                      <td>
                        <span className={styles.group}>
                          <input
                            className={`${controls.input} ${controls.inputNumeric} ${styles.rateInput}`}
                            type="number"
                            step="0.0001"
                            min="0"
                            inputMode="decimal"
                            aria-label={planT('rateAria', { invoice: r.invoiceNumber, date: formatDate(r.date) })}
                            value={value}
                            disabled={locked || r.bookRate === null || r.netted}
                            onChange={(e) => setDraft((d) => ({ ...d, [r.paymentId]: e.target.value }))}
                          />
                          {dirty && (
                            <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => saveRate(r.paymentId)}>
                              {planT('saveBtn')}
                            </button>
                          )}
                        </span>
                      </td>
                      <td className={styles.numeric}>{r.fx ? signed(r.fx.gain) : <span className={styles.muted}>{r.bookRate === null ? planT('noInvoiceRate') : '-'}</span>}</td>
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
          <span id="fx-reval">{planT('revalHead')}</span>
          <button type="button" className={controls.btnOutline} disabled={!rev.rows.length} onClick={() => downloadCsv(`fx-revaluation-${asOf}.csv`, revaluationCsv(rev))}>
            <Download size={16} /> CSV
          </button>
        </div>
        <div className={styles.toolbar} style={{ padding: '1rem' }}>
          <div className={styles.group}>
            <label className={controls.field}>
              <span className={controls.label}>{planT('asOn')}</span>
              <DateField className={controls.input} value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
            </label>
            {rev.currencies.map((c) => (
              <label key={c} className={controls.field}>
                <span className={controls.label}>{planT('closingRate', { currency: c })}</span>
                <input
                  className={`${controls.input} ${controls.inputNumeric} ${styles.rateInput}`}
                  type="number"
                  step="0.0001"
                  min="0"
                  inputMode="decimal"
                  value={closing[c] ?? ''}
                  onChange={(e) => setClosing((m) => ({ ...m, [c]: e.target.value }))}
                  placeholder={planT('ratePh')}
                />
              </label>
            ))}
          </div>
        </div>
        {rev.rows.length === 0 ? (
          <p className={styles.muted} style={{ padding: '0 1rem 1rem' }}>{planT('noOpenForeign', { date: formatDate(asOf) })}</p>
        ) : (
          <>
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <thead>
                  <tr>
                    <th>{planT('colInvoice')}</th>
                    <th>{planT('colParty')}</th>
                    <th className={styles.numeric}>{planT('colOpen')}</th>
                    <th className={styles.numeric}>{planT('colInvoiceRate')}</th>
                    <th className={styles.numeric}>{planT('colAtInvoice')}</th>
                    <th className={styles.numeric}>{planT('colAtClosing')}</th>
                    <th className={styles.numeric}>{planT('colUnrealised')}</th>
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
                      <td className={styles.numeric}>{r.closingInr === null ? '-' : formatMoney(r.closingInr)}</td>
                      <td className={styles.numeric}>{r.unrealised === null ? <span className={styles.muted}>{planT('enterRate')}</span> : signed(r.unrealised)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.muted} style={{ padding: '0.75rem 1rem 1rem' }}>
              {planT(rev.totals.unrealised >= 0 ? 'netUnrealisedGain' : 'netUnrealisedLoss', { amount: inr(Math.abs(rev.totals.unrealised)) })}
              {rev.totals.missingRate > 0 && planT('revalMissing', { n: rev.totals.missingRate })}
              {planT('revalAdvice', {
                date: formatDate(asOf),
                entry: rev.totals.unrealised >= 0 ? 'Dr Sundry debtors, Cr 4930 Foreign exchange gain / loss' : 'Dr 4930 Foreign exchange gain / loss, Cr Sundry debtors',
                reverse: formatDate(shiftDay(asOf, 1)),
              })}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
