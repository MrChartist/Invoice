import { useId, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BookText } from 'lucide-react';
import { GROUPS, accountStatement, accountStatementCsv, partiesOf, type Ledger, type LedgerVoucher } from '../../../lib/ledger';
import type { Period } from '../../../lib/books';
import { formatDate } from '../../../lib/utils';
import { EmptyState } from '../../ui/EmptyState';
import { drCr, money } from './format';
import { PrintTitle, StatementToolbar } from './shared';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';
import { useT } from '../../../i18n';
import { ledgerT } from '../../../i18n/areas/books-ledger';
import { voucherTypeLabel } from '../../../i18n/areas/books';
import { SelectField } from '../../ui/SelectField';

interface Props {
  ledger: Ledger;
  period: Period;
  accountId: string;
  party: string;
  onSelect: (accountId: string, party?: string) => void;
  onOpenVoucher: (v: LedgerVoucher) => void;
}

export function LedgerTab({ ledger, period, accountId, party, onSelect, onOpenVoucher }: Props) {
  useT();
  const uid = useId();
  const account = ledger.byId.get(accountId) ?? ledger.byId.get('bank')!;
  const parties = useMemo(() => partiesOf(ledger, account.id), [ledger, account.id]);
  const st = useMemo(() => accountStatement(ledger, account.id, period, party || undefined), [ledger, account.id, period, party]);

  return (
    <div className={books.stack}>
      <div className={`${styles.filters} no-print`}>
        <div className={`${controls.field} ${styles.filterField}`}>
          <label className={controls.label} htmlFor={`${uid}-acct`}>{ledgerT('account')}</label>
          <SelectField id={`${uid}-acct`} className={controls.select} value={account.id} onChange={(e) => onSelect(e.target.value)}>
            {GROUPS.map((g) => {
              const list = ledger.accounts.filter((a) => a.group === g.id);
              return list.length ? (
                <optgroup key={g.id} label={g.label}>
                  {list.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </SelectField>
        </div>
        {parties.length > 0 && (
          <div className={`${controls.field} ${styles.filterField}`}>
            <label className={controls.label} htmlFor={`${uid}-party`}>{ledgerT('party')}</label>
            <SelectField id={`${uid}-party`} className={controls.select} value={party} onChange={(e) => onSelect(account.id, e.target.value)}>
              <option value="">{ledgerT('allParties')}</option>
              {parties.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </SelectField>
          </div>
        )}
      </div>

      {st && (
        <>
          <StatementToolbar csv={() => accountStatementCsv(st)} filename={`ledger-${account.code}-${period.start}_to_${period.end}.csv`} />
          <PrintTitle title={ledgerT('ledgerTitle', { account: `${account.code} ${account.name}${party ? `: ${party}` : ''}` })} sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />
          <div className={surface.card}>
            {st.rows.length === 0 && !st.opening ? (
              <EmptyState icon={BookText} title={ledgerT('ledgerEmptyTitle')} text={ledgerT('ledgerEmptyText')} />
            ) : (
              <div className={`${surface.tableWrap} ${styles.wrap}`}>
                <table className={surface.table}>
                  <caption className={surface.srOnly}>{ledgerT('ledgerOf', { name: account.name })}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{ledgerT('colDate')}</th>
                      <th scope="col">{ledgerT('colParticulars')}</th>
                      <th scope="col">{ledgerT('colVoucher')}</th>
                      <th scope="col" className={surface.numeric}>{ledgerT('colDebit')}</th>
                      <th scope="col" className={surface.numeric}>{ledgerT('colCredit')}</th>
                      <th scope="col" className={surface.numeric}>{ledgerT('colBalance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={styles.groupRow}>
                      <td>{formatDate(period.start)}</td>
                      <td colSpan={4}>{ledgerT('openingBalance')}</td>
                      <td className={surface.numeric}>{drCr(st.opening)}</td>
                    </tr>
                    {st.rows.map((r) => (
                      <tr key={r.voucher.id}>
                        <td>{formatDate(r.voucher.date)}</td>
                        <td>
                          <div>{r.particulars || '-'}</div>
                          <div className={books.narration}>{[r.voucher.party, r.voucher.narration].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td>
                          <span className={r.voucher.source === 'manual' ? styles.badgeManual : styles.badge}>{voucherTypeLabel(r.voucher.kind)}</span>{' '}
                          {r.voucher.link ? (
                            <Link className={books.link} to={r.voucher.link}>{r.voucher.number || ledgerT('open')}</Link>
                          ) : r.voucher.source === 'manual' ? (
                            <button type="button" className={styles.rowButton} onClick={() => onOpenVoucher(r.voucher)}>{r.voucher.number}</button>
                          ) : (
                            <span className={surface.mono}>{r.voucher.number}</span>
                          )}
                        </td>
                        <td className={surface.numeric}>{r.debit ? money(r.debit) : ''}</td>
                        <td className={surface.numeric}>{r.credit ? money(r.credit) : ''}</td>
                        <td className={surface.numeric}>{drCr(r.balance)}</td>
                      </tr>
                    ))}
                    <tr className={books.totalRow}>
                      <td colSpan={3}>{ledgerT('closingBalance')}</td>
                      <td className={surface.numeric}>{money(st.totalDebit)}</td>
                      <td className={surface.numeric}>{money(st.totalCredit)}</td>
                      <td className={surface.numeric}>{drCr(st.closing)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
