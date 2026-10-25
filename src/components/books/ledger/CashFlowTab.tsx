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
import { useT } from '../../../i18n';
import { ledgerT } from '../../../i18n/areas/books-ledger';

export function CashFlowTab({ ledger, period }: { ledger: Ledger; period: Period }) {
  useT();
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
          {cf.difference === 0 ? ledgerT('cfTie') : ledgerT('difference', { amount: money(cf.difference) })}
        </span>
      </StatementToolbar>
      <PrintTitle title={ledgerT('cfTitle')} sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />

      <div className={books.notice} role="note">
        <Info size={16} className={books.noticeIcon} aria-hidden="true" />
        <span>{ledgerT('cfNotice')}</span>
      </div>

      <div className={surface.card}>
        <ul className={books.statement}>
          <li className={books.stmtHead}><span>{ledgerT('cfA')}</span><span /></li>
          {row({ label: ledgerT('cfNetProfit'), amount: cf.netProfit }, false)}
          {cf.operating.adjustments.map((l) => row(l))}
          {cf.operating.workingCapital.map((l) => row(l))}
          {total(ledgerT('cfNetA'), cf.operating.total)}
          <li className={books.stmtHead}><span>{ledgerT('cfB')}</span><span /></li>
          {cf.investing.lines.map((l) => row(l))}
          {total(ledgerT('cfNetB'), cf.investing.total)}
          <li className={books.stmtHead}><span>{ledgerT('cfC')}</span><span /></li>
          {cf.financing.lines.map((l) => row(l))}
          {total(ledgerT('cfNetC'), cf.financing.total)}
          {total(ledgerT('cfNetChange'), cf.netChange)}
          {row({ label: ledgerT('cfOpening'), amount: cf.openingCash }, false)}
          {row({ label: ledgerT('cfClosing'), amount: cf.closingCash }, false)}
        </ul>
      </div>
    </div>
  );
}
