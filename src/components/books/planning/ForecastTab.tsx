import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Download } from 'lucide-react';
import type { BooksData } from '../../../lib/books';
import { HORIZONS, buildForecast, forecastCsv, gstTdsCommitments, loanCommitments, openingCash, payrollCommitments, type Forecast } from '../../../lib/cash-forecast';
import { shiftDay } from '../../../lib/dates';
import type { CreditLinkRow } from '../../../lib/amount-due';
import type { BusinessLoan } from '../../../lib/loans';
import { recurringDb } from '../../../lib/recurring';
import { getTable } from '../../../lib/storage';
import { formatDate, formatMoney, todayInput } from '../../../lib/utils';
import type { Cheque } from '../../../types/cheques';
import type { Vendor } from '../../../types/purchases';
import { downloadCsv } from '../download';
import controls from '../../../styles/controls.module.css';
import surface from '../../../styles/surface.module.css';
import styles from './cashflow.module.css';
import { useT } from '../../../i18n';
import { planT } from '../../../i18n/areas/books-planning';
import { plural } from '../../../i18n/areas/plural';

const KIND_KEY = {
  receivable: 'kindReceivable',
  recurring: 'kindRecurring',
  cheque_in: 'kindChequeIn',
  payable: 'kindPayable',
  cheque_out: 'kindChequeOut',
  expenses: 'kindExpenses',
  tax: 'kindTax',
  loan: 'kindLoan',
  salary: 'kindSalary',
} as const;

const inr = (n: number) => `₹${formatMoney(n)}`;
const short = (d: string) => formatDate(d).replace(/ \d{4}$/, '');

/** Weekly bars (money in up, money out down) with the closing balance as a line — plain SVG. */
function ForecastChart({ f }: { f: Forecast }) {
  useT();
  const W = 760;
  const H = 260;
  const pad = { l: 64, r: 12, t: 12, b: 28 };
  const n = f.buckets.length;
  const values = f.buckets.flatMap((b) => [b.inflow, -b.outflow, b.closing]).concat([f.opening, 0]);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const y = (v: number) => pad.t + ((max - v) / span) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / Math.max(n, 1);
  const bw = Math.max(3, Math.min(18, slot / 3));
  const x = (i: number) => pad.l + slot * i + slot / 2;
  const ticks = [max, (max + min) / 2, min];
  const line = f.buckets.map((b, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(b.closing).toFixed(1)}`).join(' ');
  const every = Math.ceil(n / 9);
  return (
    <figure className={styles.chartWrap} aria-label={planT('chartAria')}>
      <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={planT('chartSummary', { from: inr(f.opening), to: inr(f.totals.closing), lowest: inr(f.lowest.balance) })}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={styles.grid} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text className={styles.axisText} x={pad.l - 6} y={y(t) + 3} textAnchor="end">{formatMoney(Math.round(t))}</text>
          </g>
        ))}
        <line className={styles.zero} x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />
        {f.buckets.map((b, i) => (
          <g key={b.start}>
            {b.inflow > 0 && <rect className={styles.barIn} x={x(i) - bw - 1} width={bw} y={y(b.inflow)} height={Math.max(0.5, y(0) - y(b.inflow))}><title>{planT('weekIn', { week: short(b.start), amount: inr(b.inflow) })}</title></rect>}
            {b.outflow > 0 && <rect className={styles.barOut} x={x(i) + 1} width={bw} y={y(0)} height={Math.max(0.5, y(-b.outflow) - y(0))}><title>{planT('weekOut', { week: short(b.start), amount: inr(b.outflow) })}</title></rect>}
            {i % every === 0 && <text className={styles.axisText} x={x(i)} y={H - 8} textAnchor="middle">{short(b.start)}</text>}
          </g>
        ))}
        <path className={styles.line} d={line} />
        {f.buckets.map((b, i) => (
          <circle key={b.start} className={styles.dot} cx={x(i)} cy={y(b.closing)} r={2.5}>
            <title>{planT('closingOn', { date: short(b.end), amount: inr(b.closing) })}</title>
          </circle>
        ))}
      </svg>
      <figcaption className={styles.legend}>
        <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.swIn}`} /> {planT('moneyIn')}</span>
        <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.swOut}`} /> {planT('moneyOut')}</span>
        <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.swLine}`} /> {planT('closingBalance')}</span>
      </figcaption>
    </figure>
  );
}

/** Cash-flow forecast (6.18) — Books tab "Forecast". Lazy-loaded. */
export default function ForecastTab({ data }: { data: BooksData }) {
  useT();
  const [horizon, setHorizon] = useState<number>(90);
  const [withExpenses, setWithExpenses] = useState(false);
  const [skipStale, setSkipStale] = useState(false);
  const [commit, setCommit] = useState(true); // PENDING 39
  const today = todayInput();
  const f = useMemo(() => {
    const opening = openingCash(data, today);
    const end = shiftDay(today, horizon - 1);
    const commitments = commit
      ? [
        ...gstTdsCommitments(data.invoices, data.purchases, data.vendors, today, end),
        ...loanCommitments(getTable<BusinessLoan>('business_loans').filter((l) => l && typeof l.id === 'string'), end),
        ...payrollCommitments(getTable('payroll_runs'), getTable('payroll_payments'), today, end),
      ]
      : [];
    return buildForecast({
      links: getTable<CreditLinkRow>('doc_links'),
      commitments,
      today,
      horizon,
      opening,
      invoices: data.invoices,
      payments: data.transactions,
      purchases: data.purchases,
      vendors: data.vendors as Vendor[],
      recurring: recurringDb.getAll(),
      cheques: getTable<Cheque>('cheques'),
      includeExpenses: withExpenses,
      skipOverdueAfter: skipStale ? 90 : undefined,
    });
  }, [data, today, horizon, withExpenses, skipStale, commit]);

  return (
    <div className={styles.stack}>
      <div className={styles.estimate} role="note">
        <AlertTriangle size={16} aria-hidden="true" />
        <span>
          <strong>{planT('estimateStrong')}</strong> {planT('estimateText')}
        </span>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.group}>
          <div className={controls.segment} role="radiogroup" aria-label={planT('forecastPeriod')}>
            {HORIZONS.map((h) => (
              <button key={h} type="button" role="radio" aria-checked={horizon === h} className={horizon === h ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setHorizon(h)}>
                {planT('days', { n: h })}
              </button>
            ))}
          </div>
          <label className={controls.check}>
            <input type="checkbox" checked={withExpenses} onChange={(e) => setWithExpenses(e.target.checked)} /> {planT('addAvgExpenses')}
            {f.averageMonthlyExpenses > 0 && ` (${inr(f.averageMonthlyExpenses)})`}
          </label>
          <label className={controls.check}>
            <input type="checkbox" checked={skipStale} onChange={(e) => setSkipStale(e.target.checked)} /> {planT('leaveOutOverdue')}
          </label>
          <label className={controls.check}>
            <input type="checkbox" checked={commit} onChange={(e) => setCommit(e.target.checked)} data-forecast-commitments /> {planT('addCommitments')}
          </label>
        </div>
        <button type="button" className={controls.btnOutline} onClick={() => downloadCsv(`cash-forecast-${today}-${horizon}d.csv`, forecastCsv(f))}>
          <Download size={16} /> {planT('exportCsv')}
        </button>
      </div>

      <div className={styles.kpis}>
        <div className={styles.kpi}><span className={styles.kpiLabel}>{planT('kpiToday')}</span><span className={styles.kpiValue}>{inr(f.opening)}</span></div>
        <div className={styles.kpi}><span className={styles.kpiLabel}>{planT('kpiIn')}</span><span className={`${styles.kpiValue} ${styles.pos}`}>{inr(f.totals.inflow)}</span></div>
        <div className={styles.kpi}><span className={styles.kpiLabel}>{planT('kpiOut')}</span><span className={`${styles.kpiValue} ${styles.neg}`}>{inr(f.totals.outflow)}</span></div>
        <div className={styles.kpi}><span className={styles.kpiLabel}>{planT('kpiInDays', { n: f.horizon })}</span><span className={`${styles.kpiValue} ${f.totals.closing < 0 ? styles.neg : ''}`}>{inr(f.totals.closing)}</span></div>
        <div className={styles.kpi}><span className={styles.kpiLabel}>{planT('kpiLowest')}</span><span className={`${styles.kpiValue} ${f.lowest.balance < 0 ? styles.neg : ''}`}>{inr(f.lowest.balance)}</span></div>
      </div>
      {f.firstNegative && (
        <p className={styles.estimate} role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{planT('goesNegative', { date: formatDate(f.firstNegative) })}</span>
        </p>
      )}
      {f.excludedForeign > 0 && <p className={styles.muted}>{planT('foreignLeftOut', { n: f.excludedForeign })}</p>}

      <div className={surface.card}>
        <ForecastChart f={f} />
      </div>

      <div className={surface.card}>
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <caption className={surface.srOnly}>{planT('weeklyCaption')}</caption>
            <thead>
              <tr>
                <th>{planT('colWeek')}</th>
                <th className={styles.numeric}>{planT('colOpening')}</th>
                <th className={styles.numeric}>{planT('moneyIn')}</th>
                <th className={styles.numeric}>{planT('moneyOut')}</th>
                <th className={styles.numeric}>{planT('colNet')}</th>
                <th className={styles.numeric}>{planT('colClosing')}</th>
              </tr>
            </thead>
            <tbody>
              {f.buckets.map((b) => (
                <tr key={b.start}>
                  <td>{short(b.start)} – {short(b.end)}</td>
                  <td className={styles.numeric}>{formatMoney(b.opening)}</td>
                  <td className={`${styles.numeric} ${styles.pos}`}>{b.inflow ? formatMoney(b.inflow) : '-'}</td>
                  <td className={`${styles.numeric} ${styles.neg}`}>{b.outflow ? formatMoney(b.outflow) : '-'}</td>
                  <td className={styles.numeric}>{formatMoney(b.net)}</td>
                  <td className={`${styles.numeric} ${b.closing < 0 ? styles.neg : ''}`}>{formatMoney(b.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className={`${surface.card} ${styles.more}`}>
        <summary>{plural(planT, 'whatsInOne', 'whatsInMany', f.items.length)}</summary>
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>{planT('colExpected')}</th>
                <th>{planT('colType')}</th>
                <th>{planT('colParty')}</th>
                <th>{planT('colReference')}</th>
                <th>{planT('colBasis')}</th>
                <th className={styles.numeric}>{planT('colAmount')}</th>
              </tr>
            </thead>
            <tbody>
              {f.items.map((it, i) => (
                <tr key={`${it.kind}-${it.ref}-${it.date}-${i}`}>
                  <td>{formatDate(it.date)}{it.overdue && <span className={styles.overdue}>{planT('overdue')}</span>}</td>
                  <td>{planT(KIND_KEY[it.kind])}</td>
                  <td>{it.party}</td>
                  <td>{it.link ? <Link to={it.link}>{it.ref || '-'}</Link> : it.ref || '-'}</td>
                  <td className={styles.muted}>{it.basis}</td>
                  <td className={`${styles.numeric} ${it.direction === 'in' ? styles.pos : styles.neg}`}>{it.direction === 'in' ? '+' : '−'}{formatMoney(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {f.lags.length > 0 && (
          <p className={styles.muted} style={{ padding: '0.75rem 1rem' }}>
            {planT('usualDelay', { list: f.lags.slice(0, 8).map((l) => planT(l.receipts === 1 ? 'lagItemOne' : 'lagItemMany', { party: l.party, days: `${l.days >= 0 ? '+' : ''}${l.days}`, n: l.receipts })).join(' · ') })}
          </p>
        )}
      </details>
    </div>
  );
}
