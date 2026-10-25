import { useMemo, useState } from 'react';
import { Download, Percent, PiggyBank, TrendingDown, TrendingUp } from 'lucide-react';
import {
  gstSummary,
  monthlyTrend,
  profitAndLoss,
  profitLossCsv,
  type Basis,
  type BooksData,
  type Period,
} from '../../lib/books';
import { formatMoney } from '../../lib/utils';
import { TrendChart } from './TrendChart';
import { downloadCsv, tone } from './download';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './books.module.css';
import { useT } from '../../i18n';
import { booksT } from '../../i18n/areas/books';

export function ProfitLossTab({ data, period }: { data: BooksData; period: Period }) {
  useT();
  const [basis, setBasis] = useState<Basis>('accrual');
  const pnl = useMemo(() => profitAndLoss(data, period, basis), [data, period, basis]);
  const trend = useMemo(() => monthlyTrend(data, period, basis), [data, period, basis]);
  const gst = useMemo(() => gstSummary(data, period), [data, period]);

  const cls = (n: number) => {
    const t = tone(n);
    return t ? styles[t] : '';
  };
  const maxExpense = Math.max(...pnl.expenses.map((e) => e.amount), 1);

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={controls.segment} role="group" aria-label={booksT('basisGroup')}>
          <button
            type="button"
            className={basis === 'accrual' ? controls.segmentBtnActive : controls.segmentBtn}
            aria-pressed={basis === 'accrual'}
            onClick={() => setBasis('accrual')}
          >
            {booksT('accrual')}
          </button>
          <button
            type="button"
            className={basis === 'cash' ? controls.segmentBtnActive : controls.segmentBtn}
            aria-pressed={basis === 'cash'}
            onClick={() => setBasis('cash')}
          >
            {booksT('cash')}
          </button>
        </div>
        <button
          type="button"
          className={controls.btnOutline}
          onClick={() => downloadCsv(`profit-loss-${basis}-${period.start}_to_${period.end}.csv`, profitLossCsv(pnl))}
        >
          <Download size={16} /> {booksT('exportCsv')}
        </button>
      </div>

      <p className={styles.muted} style={{ margin: 0 }}>
        {basis === 'accrual'
          ? booksT('accrualNote')
          : booksT('cashNote')}
        {' '}{booksT('gstLiabilityNote')}
      </p>

      <div className={surface.statGrid}>
        <div className={surface.stat}>
          <div className={surface.statTop}>
            <span className={surface.statLabel}>{booksT('income')}</span>
            <span className={surface.statIcon}><TrendingUp size={15} color="var(--profit)" /></span>
          </div>
          <div className={surface.statValue}>{formatMoney(pnl.income)}</div>
          <div className={surface.statHint}>{booksT('incomeHint')}</div>
        </div>
        <div className={surface.stat}>
          <div className={surface.statTop}>
            <span className={surface.statLabel}>{booksT('expenses')}</span>
            <span className={surface.statIcon}><TrendingDown size={15} color="var(--loss)" /></span>
          </div>
          <div className={surface.statValue}>{formatMoney(pnl.totalExpenses)}</div>
          <div className={surface.statHint}>{booksT('expensesHint')}</div>
        </div>
        <div className={surface.stat}>
          <div className={surface.statTop}>
            <span className={surface.statLabel}>{booksT('netProfit')}</span>
            <span className={surface.statIcon}><PiggyBank size={15} /></span>
          </div>
          <div className={`${surface.statValue} ${cls(pnl.netProfit)}`}>{formatMoney(pnl.netProfit)}</div>
          <div className={surface.statHint}>{booksT('grossHint', { amount: formatMoney(pnl.grossProfit) })}</div>
        </div>
        <div className={surface.stat}>
          <div className={surface.statTop}>
            <span className={surface.statLabel}>{booksT('margin')}</span>
            <span className={surface.statIcon}><Percent size={15} /></span>
          </div>
          <div className={`${surface.statValue} ${cls(pnl.margin)}`}>{pnl.margin.toFixed(1)}%</div>
          <div className={surface.statHint}>{booksT('marginHint')}</div>
        </div>
      </div>

      <div className={surface.card}>
        <div className={surface.cardHead}>{booksT('monthlyTrend')}</div>
        <TrendChart points={trend} />
      </div>

      <div className={styles.twoCol}>
        <div className={surface.card}>
          <div className={surface.cardHead}>{booksT('plStatement')}</div>
          <ul className={styles.statement}>
            <li className={styles.stmtHead}><span>{booksT('income')}</span><span>{booksT('amountRs')}</span></li>
            <li className={styles.stmtRow}><span>{booksT('salesCharges')}</span><span className={styles.amt}>{formatMoney(pnl.sales)}</span></li>
            <li className={styles.stmtSub}><span>{booksT('lessCreditNotes')}</span><span className={styles.amt}>{formatMoney(pnl.creditNotes)}</span></li>
            <li className={styles.stmtTotal}><span>{booksT('netIncome')}</span><span className={styles.amt}>{formatMoney(pnl.income)}</span></li>
            <li className={styles.stmtHead}><span>{booksT('directCosts')}</span><span /></li>
            {pnl.expenses.filter((e) => e.direct).map((e) => (
              <li key={`d-${e.category}`} className={styles.stmtRow}><span>{e.category}</span><span className={styles.amt}>{formatMoney(e.amount)}</span></li>
            ))}
            <li className={styles.stmtTotal}>
              <span>{booksT('grossProfit')}</span>
              <span className={`${styles.amt} ${cls(pnl.grossProfit)}`}>{formatMoney(pnl.grossProfit)}</span>
            </li>
            <li className={styles.stmtHead}><span>{booksT('indirectExpenses')}</span><span /></li>
            {pnl.expenses.filter((e) => !e.direct).map((e) => (
              <li key={`i-${e.category}`} className={styles.stmtRow}><span>{e.category}</span><span className={styles.amt}>{formatMoney(e.amount)}</span></li>
            ))}
            <li className={styles.stmtTotal}>
              <span>{booksT('netProfit')}</span>
              <span className={`${styles.amt} ${cls(pnl.netProfit)}`}>{formatMoney(pnl.netProfit)}</span>
            </li>
          </ul>
        </div>

        <div className={styles.stack}>
          <div className={surface.card}>
            <div className={surface.cardHead}>{booksT('expensesByCategory')}</div>
            {pnl.expenses.length === 0 ? (
              <p className={styles.muted} style={{ padding: '1.25rem', margin: 0 }}>
                {booksT('noExpenses')}
              </p>
            ) : (
              <ul className={styles.barList}>
                {pnl.expenses.map((e) => (
                  <li key={`${e.direct}-${e.category}`} className={styles.barItem}>
                    <div className={styles.barMeta}>
                      <span>{e.category}{e.direct ? booksT('directSuffix') : ''}</span>
                      <span className={styles.amt}>{formatMoney(e.amount)}</span>
                    </div>
                    <div className={styles.barTrack} aria-hidden="true">
                      <div
                        className={e.direct ? styles.barFillDirect : styles.barFill}
                        style={{ width: `${Math.max((e.amount / maxExpense) * 100, 0)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={surface.card}>
            <div className={surface.cardHead}>{booksT('gstPosition')}</div>
            <ul className={styles.statement}>
              <li className={styles.stmtRow}><span>{booksT('outputGst')}</span><span className={styles.amt}>{formatMoney(gst.outputTotal)}</span></li>
              <li className={styles.stmtSub}><span>CGST / SGST / IGST</span><span className={styles.amt}>{formatMoney(gst.outputCgst)} / {formatMoney(gst.outputSgst)} / {formatMoney(gst.outputIgst)}</span></li>
              <li className={styles.stmtRow}><span>{booksT('lessItc')}</span><span className={styles.amt}>{formatMoney(gst.itc)}</span></li>
              <li className={styles.stmtSub}><span>{booksT('blockedGst')}</span><span className={styles.amt}>{formatMoney(gst.blockedGst)}</span></li>
              <li className={styles.stmtTotal}>
                <span>{gst.netPayable >= 0 ? booksT('netGstPayable') : booksT('itcCarry')}</span>
                <span className={styles.amt}>{formatMoney(Math.abs(gst.netPayable))}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
