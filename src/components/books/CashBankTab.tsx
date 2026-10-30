import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Download, Landmark, Scale, Wallet } from 'lucide-react';
import {
  bankAccountBook,
  cashBook,
  cashBookCsv,
  type CashAccount,
  type OpeningBalance,
  type Period,
  type Voucher,
} from '../../lib/books';
import { formatDate, formatMoney } from '../../lib/utils';
import { EmptyState } from '../ui/EmptyState';
import { downloadCsv } from './download';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './books.module.css';
import { useT } from '../../i18n';
import { booksT, voucherTypeLabel } from '../../i18n/areas/books';
import { methodLabel } from '../../i18n/labels';
import { bankAccountsDb } from '../../lib/bank-accounts';
import { bnkT } from '../../i18n/areas/banking';

export interface CashBankTabProps {
  vouchers: Voucher[];
  openings: OpeningBalance[];
  period: Period;
  onEditOpening: () => void;
}

export function CashBankTab({ vouchers, openings, period, onEditOpening }: CashBankTabProps) {
  useT();
  const [account, setAccount] = useState<CashAccount>('cash');
  // WP-5: with several bank accounts the bank book can show one account ('' = all accounts, the combined book).
  const [banks] = useState(() => bankAccountsDb.all());
  const [bankId, setBankId] = useState('');
  const bankAcc = account === 'bank' && bankId ? banks.find((b) => b.id === bankId) : undefined;
  const book = useMemo(
    () => (bankAcc ? bankAccountBook(vouchers, openings, bankAcc, period) : cashBook(vouchers, openings, account, period)),
    [vouchers, openings, account, period, bankAcc],
  );
  const name = account === 'cash' ? booksT('cashBook') : bankAcc ? `${booksT('bankBook')}: ${bankAcc.name}` : booksT('bankBook');

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={controls.segment} role="group" aria-label={booksT('book')}>
          <button
            type="button"
            className={account === 'cash' ? controls.segmentBtnActive : controls.segmentBtn}
            aria-pressed={account === 'cash'}
            onClick={() => setAccount('cash')}
          >
            {booksT('cashBook')}
          </button>
          <button
            type="button"
            className={account === 'bank' ? controls.segmentBtnActive : controls.segmentBtn}
            aria-pressed={account === 'bank'}
            onClick={() => setAccount('bank')}
          >
            {booksT('bankBook')}
          </button>
        </div>
        {account === 'bank' && banks.length > 1 && (
          <select className={controls.select} style={{ width: 'auto' }} aria-label={bnkT('bankAccount')} value={bankId} onChange={(e) => setBankId(e.target.value)}>
            <option value="">{bnkT('allBanks')}</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
        <div className={styles.toolbarGroup}>
          <button type="button" className={controls.btnOutline} onClick={onEditOpening}>
            <Scale size={16} /> {booksT('openingBalances')}
          </button>
          <button
            type="button"
            className={controls.btnOutline}
            onClick={() => downloadCsv(`${account}-book-${period.start}_to_${period.end}.csv`, cashBookCsv(book))}
          >
            <Download size={16} /> {booksT('exportCsv')}
          </button>
        </div>
      </div>

      {book.openingMissing && (
        <div className={styles.noticeWarn} role="note">
          <AlertTriangle size={16} className={styles.noticeIcon} aria-hidden="true" />
          <span>
            {account === 'cash' ? booksT('noOpeningCash') : booksT('noOpeningBank')}
            {' '}
            <button type="button" className={styles.link} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={onEditOpening}>
              {booksT('setOpening')}
            </button>
          </span>
        </div>
      )}

      <div className={surface.statGrid}>
        <div className={surface.stat}>
          <div className={surface.statTop}>
            <span className={surface.statLabel}>{booksT('statOpening')}</span>
            <span className={surface.statIcon}>{account === 'cash' ? <Wallet size={15} /> : <Landmark size={15} />}</span>
          </div>
          <div className={surface.statValue}>{formatMoney(book.opening)}</div>
          <div className={surface.statHint}>{booksT('statOn', { date: formatDate(period.start) })}</div>
        </div>
        <div className={surface.stat}>
          <div className={surface.statTop}>
            <span className={surface.statLabel}>{booksT('statReceipts')}</span>
            <span className={surface.statIcon}><ArrowDownLeft size={15} color="var(--sys-green-ink)" /></span>
          </div>
          <div className={`${surface.statValue} ${styles.pos}`}>{formatMoney(book.totalReceipts)}</div>
          <div className={surface.statHint}>{booksT('moneyIn')}</div>
        </div>
        <div className={surface.stat}>
          <div className={surface.statTop}>
            <span className={surface.statLabel}>{booksT('statPayments')}</span>
            <span className={surface.statIcon}><ArrowUpRight size={15} color="var(--sys-red-ink)" /></span>
          </div>
          <div className={`${surface.statValue} ${styles.neg}`}>{formatMoney(book.totalPayments)}</div>
          <div className={surface.statHint}>{booksT('moneyOut')}</div>
        </div>
        <div className={surface.stat}>
          <div className={surface.statTop}>
            <span className={surface.statLabel}>{booksT('statClosing')}</span>
            <span className={surface.statIcon}><Scale size={15} /></span>
          </div>
          <div className={surface.statValue}>{formatMoney(book.closing)}</div>
          <div className={surface.statHint}>{booksT('statOn', { date: formatDate(period.end) })}</div>
        </div>
      </div>

      <div className={surface.card}>
        <div className={surface.cardHead}>{name}</div>
        {book.rows.length === 0 ? (
          <EmptyState
            icon={account === 'cash' ? Wallet : Landmark}
            title={account === 'cash' ? booksT('noCashMovements') : booksT('noBankMovements')}
            text={
              account === 'cash'
                ? booksT('noCashText')
                : booksT('noBankText')
            }
          />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{name}</caption>
              <thead>
                <tr>
                  <th scope="col">{booksT('colDate')}</th>
                  <th scope="col">{booksT('colParticulars')}</th>
                  <th scope="col">{booksT('colType')}</th>
                  <th scope="col">{booksT('colMethod')}</th>
                  <th scope="col" className={surface.numeric}>{booksT('colReceipt')}</th>
                  <th scope="col" className={surface.numeric}>{booksT('colPayment')}</th>
                  <th scope="col" className={surface.numeric}>{booksT('colBalance')}</th>
                </tr>
              </thead>
              <tbody>
                <tr className={styles.dayRow}>
                  <td colSpan={6}>{booksT('openingBalance')}</td>
                  <td className={surface.numeric}>{formatMoney(book.opening)}</td>
                </tr>
                {book.rows.map((r) => (
                  <tr key={r.voucher.id}>
                    <td>{formatDate(r.date)}</td>
                    <td>
                      {r.voucher.party}
                      {r.voucher.number && (
                        <div className={styles.narration}>
                          {r.voucher.link ? (
                            <Link className={styles.link} to={r.voucher.link}>{r.voucher.number}</Link>
                          ) : (
                            r.voucher.number
                          )}
                        </div>
                      )}
                    </td>
                    <td>{voucherTypeLabel(r.voucher.type)}</td>
                    <td>{r.voucher.method ? methodLabel(r.voucher.method) : r.voucher.method}</td>
                    <td className={`${surface.numeric} ${r.receipt ? styles.pos : ''}`}>{r.receipt ? formatMoney(r.receipt) : ''}</td>
                    <td className={`${surface.numeric} ${r.payment ? styles.neg : ''}`}>{r.payment ? formatMoney(r.payment) : ''}</td>
                    <td className={surface.numeric}>{formatMoney(r.balance)}</td>
                  </tr>
                ))}
                <tr className={styles.totalRow}>
                  <td colSpan={4}>{booksT('closingBalance')}</td>
                  <td className={surface.numeric}>{formatMoney(book.totalReceipts)}</td>
                  <td className={surface.numeric}>{formatMoney(book.totalPayments)}</td>
                  <td className={surface.numeric}>{formatMoney(book.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
