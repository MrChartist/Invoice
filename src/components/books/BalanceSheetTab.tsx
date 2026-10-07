import { useMemo } from 'react';
import { Download, Info } from 'lucide-react';
import { balanceSheet, balanceSheetCsv, type BooksData } from '../../lib/books';
import { formatDate, formatMoney } from '../../lib/utils';
import { downloadCsv } from './download';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './books.module.css';

export function BalanceSheetTab({ data, asOf }: { data: BooksData; asOf: string }) {
  const b = useMemo(() => balanceSheet(data, asOf), [data, asOf]);
  const row = (label: string, v: number, sub = false) => (
    <li className={sub ? styles.stmtSub : styles.stmtRow}>
      <span>{label}</span>
      <span className={styles.amt}>{formatMoney(v)}</span>
    </li>
  );

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <span className={styles.indicative}><Info size={13} aria-hidden="true" /> Indicative — not a statutory statement</span>
        <button
          type="button"
          className={controls.btnOutline}
          onClick={() => downloadCsv(`balance-sheet-${asOf}.csv`, balanceSheetCsv(b))}
        >
          <Download size={16} /> Export CSV
        </button>
      </div>

      <div className={styles.notice} role="note">
        <Info size={16} className={styles.noticeIcon} aria-hidden="true" />
        <span>
          Position as of {formatDate(asOf)}, derived from invoices, receipts, purchases and payments recorded
          in this app plus the opening cash / bank balances you entered. Fixed assets, loans, GST already
          paid to the government and capital movements are not tracked, so they land in the balancing
          line “Capital &amp; other”. Ask your accountant before relying on it.
        </span>
      </div>

      <div className={styles.twoCol}>
        <div className={surface.card}>
          <div className={surface.cardHead}>Assets</div>
          <ul className={styles.statement}>
            {row('Cash in hand', b.assets.cash)}
            {row('Bank', b.assets.bank)}
            {row('Receivables (customers owe you)', b.assets.receivables)}
            {row('GST input credit receivable', b.assets.itcReceivable)}
            {row('Advances paid to vendors', b.assets.vendorAdvances)}
            <li className={styles.stmtTotal}>
              <span>Total assets</span>
              <span className={styles.amt}>{formatMoney(b.assets.total)}</span>
            </li>
          </ul>
        </div>

        <div className={surface.card}>
          <div className={surface.cardHead}>Liabilities &amp; equity</div>
          <ul className={styles.statement}>
            <li className={styles.stmtHead}><span>Liabilities</span><span /></li>
            {row('Payables (you owe vendors)', b.liabilities.payables)}
            {row('GST, cess & TCS payable (output − ITC)', b.liabilities.gstPayable)}
            {row('Advances from customers', b.liabilities.customerAdvances)}
            <li className={styles.stmtTotal}>
              <span>Total liabilities</span>
              <span className={styles.amt}>{formatMoney(b.liabilities.total)}</span>
            </li>
            <li className={styles.stmtHead}><span>Equity</span><span /></li>
            {row('Retained earnings (accrual profit to date)', b.equity.retainedEarnings)}
            {row('Capital & other (balancing figure)', b.equity.capitalAndOther)}
            <li className={styles.stmtTotal}>
              <span>Total equity</span>
              <span className={styles.amt}>{formatMoney(b.equity.total)}</span>
            </li>
            <li className={styles.stmtTotal}>
              <span>Liabilities + equity</span>
              <span className={styles.amt}>{formatMoney(b.liabilities.total + b.equity.total)}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
