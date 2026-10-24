import { useMemo } from 'react';
import { Info } from 'lucide-react';
import { cashFlowCsv, cashFlowStatement, type CashFlowLine, type Ledger } from '../../../lib/ledger';
import type { Period } from '../../../lib/books';
import { formatDate } from '../../../lib/utils';
import { money } from './format';
import { PrintTitle, StatementToolbar } from './shared';
import surface from '../../../styles/surface.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';

export function CashFlowTab({ ledger, period }: { ledger: Ledger; period: Period }) {
  const cf = useMemo(() => cashFlowStatement(ledger, period), [ledger, period]);
  const row = (l: CashFlowLine, sub = true) => (
    <li key={l.label} className={sub ? books.stmtSub : books.stmtRow}>
      <span>{l.label}</span>
      <span className={books.amt}>{money(l.amount)}</span>
    </li>
  );
  const total = (label: string, amount: number) => (
    <li className={books.stmtTotal}>
      <span>{label}</span>
      <span className={books.amt}>{money(amount)}</span>
    </li>
  );

  return (
    <div className={books.stack}>
      <StatementToolbar csv={() => cashFlowCsv(cf)} filename={`cash-flow-${period.start}_to_${period.end}.csv`}>
        <span className={cf.difference === 0 ? styles.tieOk : styles.tieBad}>
          {cf.difference === 0 ? 'Reconciles to cash & bank' : `Difference ${money(cf.difference)}`}
        </span>
      </StatementToolbar>
      <PrintTitle title="Cash-flow statement (AS 3, indirect method)" sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />

      <div className={books.notice} role="note">
        <Info size={16} className={books.noticeIcon} aria-hidden="true" />
        <span>
          Indirect method: net profit adjusted for non-cash items and working-capital changes. Cash &amp; cash equivalents are the cash
          and bank accounts; interest and taxes are not split out separately. Verify with your CA.
        </span>
      </div>

      <div className={surface.card}>
        <ul className={books.statement}>
          <li className={books.stmtHead}><span>A. Cash flow from operating activities</span><span /></li>
          {row({ label: 'Net profit / (loss) for the period', amount: cf.netProfit }, false)}
          {cf.operating.adjustments.map((l) => row(l))}
          {cf.operating.workingCapital.map((l) => row(l))}
          {total('Net cash from operating activities', cf.operating.total)}
          <li className={books.stmtHead}><span>B. Cash flow from investing activities</span><span /></li>
          {cf.investing.lines.map((l) => row(l))}
          {total('Net cash from investing activities', cf.investing.total)}
          <li className={books.stmtHead}><span>C. Cash flow from financing activities</span><span /></li>
          {cf.financing.lines.map((l) => row(l))}
          {total('Net cash from financing activities', cf.financing.total)}
          {total('Net increase / (decrease) in cash & cash equivalents (A + B + C)', cf.netChange)}
          {row({ label: 'Cash & cash equivalents at the beginning', amount: cf.openingCash }, false)}
          {row({ label: 'Cash & cash equivalents at the end', amount: cf.closingCash }, false)}
        </ul>
      </div>
    </div>
  );
}
