import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Download, Landmark, Scale, Wallet } from 'lucide-react';
import {
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

export interface CashBankTabProps {
  vouchers: Voucher[];
  openings: OpeningBalance[];
  period: Period;
  onEditOpening: () => void;
}

export function CashBankTab({ vouchers, openings, period, onEditOpening }: CashBankTabProps) {
  const [account, setAccount] = useState<CashAccount>('cash');
  const book = useMemo(() => cashBook(vouchers, openings, account, period), [vouchers, openings, account, period]);
  const name = account === 'cash' ? 'Cash book' : 'Bank book';

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={controls.segment} role="group" aria-label="Book">
          <button
            type="button"
            className={account === 'cash' ? controls.segmentBtnActive : controls.segmentBtn}
            aria-pressed={account === 'cash'}
            onClick={() => setAccount('cash')}
          >
            Cash book
          </button>
          <button
            type="button"
            className={account === 'bank' ? controls.segmentBtnActive : controls.segmentBtn}
            aria-pressed={account === 'bank'}
            onClick={() => setAccount('bank')}
          >
            Bank book
          </button>
        </div>
        <div className={styles.toolbarGroup}>
          <button type="button" className={controls.btnOutline} onClick={onEditOpening}>
            <Scale size={16} /> Opening balances
          </button>
          <button
            type="button"
            className={controls.btnOutline}
            onClick={() => downloadCsv(`${account}-book-${period.start}_to_${period.end}.csv`, cashBookCsv(book))}
          >
            <Download size={16} /> Export CSV
          </button>
        </div>
      </div>

      {book.openingMissing && (
        <div className={styles.noticeWarn} role="note">
          <AlertTriangle size={16} className={styles.noticeIcon} aria-hidden="true" />
          <span>
            No opening balance is set for {account === 'cash' ? 'cash in hand' : 'the bank'}, so the book starts at zero.
            {' '}
            <button type="button" className={styles.link} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={onEditOpening}>
              Set opening balance
            </button>
          </span>
        </div>
      )}

      <div className={surface.statGrid}>
        <div className={surface.stat}>
          <div className={surface.statTop}>
            <span className={surface.statLabel}>Opening</span>
            <span className={surface.statIcon}>{account === 'cash' ? <Wallet size={15} /> : <Landmark size={15} />}</span>
          </div>
          <div className={surface.statValue}>{formatMoney(book.opening)}</div>
          <div className={surface.statHint}>on {formatDate(period.start)}</div>
        </div>
        <div className={surface.stat}>
          <div className={surface.statTop}>
            <span className={surface.statLabel}>Receipts</span>
            <span className={surface.statIcon}><ArrowDownLeft size={15} color="var(--profit)" /></span>
          </div>
          <div className={`${surface.statValue} ${styles.pos}`}>{formatMoney(book.totalReceipts)}</div>
          <div className={surface.statHint}>money in</div>
        </div>
        <div className={surface.stat}>
          <div className={surface.statTop}>
            <span className={surface.statLabel}>Payments</span>
            <span className={surface.statIcon}><ArrowUpRight size={15} color="var(--loss)" /></span>
          </div>
          <div className={`${surface.statValue} ${styles.neg}`}>{formatMoney(book.totalPayments)}</div>
          <div className={surface.statHint}>money out</div>
        </div>
        <div className={surface.stat}>
          <div className={surface.statTop}>
            <span className={surface.statLabel}>Closing</span>
            <span className={surface.statIcon}><Scale size={15} /></span>
          </div>
          <div className={surface.statValue}>{formatMoney(book.closing)}</div>
          <div className={surface.statHint}>on {formatDate(period.end)}</div>
        </div>
      </div>

      <div className={surface.card}>
        <div className={surface.cardHead}>{name}</div>
        {book.rows.length === 0 ? (
          <EmptyState
            icon={account === 'cash' ? Wallet : Landmark}
            title={`No ${account} movements`}
            text={
              account === 'cash'
                ? 'Receipts and payments made in cash show up here.'
                : 'UPI, bank transfer, cheque and card receipts and payments show up here.'
            }
          />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{name}</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Particulars</th>
                  <th scope="col">Type</th>
                  <th scope="col">Method</th>
                  <th scope="col" className={surface.numeric}>Receipt</th>
                  <th scope="col" className={surface.numeric}>Payment</th>
                  <th scope="col" className={surface.numeric}>Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className={styles.dayRow}>
                  <td colSpan={6}>Opening balance</td>
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
                    <td>{r.voucher.type}</td>
                    <td>{r.voucher.method}</td>
                    <td className={`${surface.numeric} ${r.receipt ? styles.pos : ''}`}>{r.receipt ? formatMoney(r.receipt) : ''}</td>
                    <td className={`${surface.numeric} ${r.payment ? styles.neg : ''}`}>{r.payment ? formatMoney(r.payment) : ''}</td>
                    <td className={surface.numeric}>{formatMoney(r.balance)}</td>
                  </tr>
                ))}
                <tr className={styles.totalRow}>
                  <td colSpan={4}>Closing balance</td>
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
