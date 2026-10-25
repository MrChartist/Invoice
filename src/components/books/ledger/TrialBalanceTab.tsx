import { Fragment, useMemo } from 'react';
import { Scale } from 'lucide-react';
import { GROUPS, trialBalance, trialBalanceCsv, type Ledger } from '../../../lib/ledger';
import type { Period } from '../../../lib/books';
import { formatDate } from '../../../lib/utils';
import { EmptyState } from '../../ui/EmptyState';
import { drCr, money } from './format';
import { PrintTitle, StatementToolbar } from './shared';
import surface from '../../../styles/surface.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';
import { useT } from '../../../i18n';
import { ledgerT } from '../../../i18n/areas/books-ledger';

export function TrialBalanceTab({ ledger, period, onOpenAccount }: { ledger: Ledger; period: Period; onOpenAccount: (id: string) => void }) {
  useT();
  const tb = useMemo(() => trialBalance(ledger, period), [ledger, period]);
  const ok = tb.totals.debit === tb.totals.credit && tb.totals.closingDr === tb.totals.closingCr;

  return (
    <div className={books.stack}>
      <StatementToolbar csv={() => trialBalanceCsv(tb)} filename={`trial-balance-${period.start}_to_${period.end}.csv`}>
        <span className={ok ? styles.tieOk : styles.tieBad}>{ok ? ledgerT('tbTie') : ledgerT('tbOut')}</span>
      </StatementToolbar>
      <PrintTitle title={ledgerT('tbTitle')} sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />

      <div className={surface.card}>
        {tb.rows.length === 0 ? (
          <EmptyState icon={Scale} title={ledgerT('tbEmptyTitle')} text={ledgerT('tbEmptyText')} />
        ) : (
          <div className={`${surface.tableWrap} ${styles.wrap}`}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{ledgerT('tbTitle')}</caption>
              <thead>
                <tr>
                  <th scope="col">{ledgerT('colCode')}</th>
                  <th scope="col">{ledgerT('colAccount')}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colOpening')}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colDebit')}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colCredit')}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colClosing')}</th>
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((g) => {
                  const rows = tb.rows.filter((r) => r.account.group === g.id);
                  if (!rows.length) return null;
                  return (
                    <Fragment key={g.id}>
                      <tr className={styles.groupRow}>
                        <td colSpan={6}>{g.label}</td>
                      </tr>
                      {rows.map((r) => (
                        <tr key={r.account.id}>
                          <td className={styles.code}>{r.account.code}</td>
                          <td>
                            <button type="button" className={styles.rowButton} onClick={() => onOpenAccount(r.account.id)}>{r.account.name}</button>
                          </td>
                          <td className={surface.numeric}>{drCr(r.opening)}</td>
                          <td className={surface.numeric}>{r.debit ? money(r.debit) : ''}</td>
                          <td className={surface.numeric}>{r.credit ? money(r.credit) : ''}</td>
                          <td className={surface.numeric}>{drCr(r.closing)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                <tr className={books.totalRow}>
                  <td colSpan={2}>{ledgerT('total')}</td>
                  <td className={surface.numeric}>{money(tb.totals.openingDr)} Dr / {money(tb.totals.openingCr)} Cr</td>
                  <td className={surface.numeric}>{money(tb.totals.debit)}</td>
                  <td className={surface.numeric}>{money(tb.totals.credit)}</td>
                  <td className={surface.numeric}>{money(tb.totals.closingDr)} Dr / {money(tb.totals.closingCr)} Cr</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className={books.muted}>
        {ledgerT('tbNote')}
      </p>
    </div>
  );
}
