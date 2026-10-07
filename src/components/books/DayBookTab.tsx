import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Download } from 'lucide-react';
import {
  VOUCHER_TYPES,
  dayBookCsv,
  dayBookRange,
  type Period,
  type Voucher,
  type VoucherType,
} from '../../lib/books';
import { formatDate, formatMoney } from '../../lib/utils';
import { EmptyState } from '../ui/EmptyState';
import { downloadCsv } from './download';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './books.module.css';

const TYPE_CLASS: Record<VoucherType, string> = {
  Sales: styles.vSales,
  'Credit Note': styles.vCredit,
  Receipt: styles.vReceipt,
  Purchase: styles.vPurchase,
  Expense: styles.vExpense,
  Payment: styles.vPayment,
};

export function DayBookTab({ vouchers, period }: { vouchers: Voucher[]; period: Period }) {
  const [types, setTypes] = useState<VoucherType[]>([]);

  const book = useMemo(
    () => dayBookRange(vouchers, period, types.length ? types : undefined),
    [vouchers, period, types],
  );

  const days = useMemo(() => {
    const map = new Map<string, Voucher[]>();
    for (const v of book.vouchers) {
      const list = map.get(v.date) ?? [];
      list.push(v);
      map.set(v.date, list);
    }
    return [...map.entries()];
  }, [book]);

  const toggle = (t: VoucherType) =>
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={styles.presets} role="group" aria-label="Filter by voucher type">
          <button
            type="button"
            className={types.length === 0 ? styles.chipActive : styles.chip}
            aria-pressed={types.length === 0}
            onClick={() => setTypes([])}
          >
            All
          </button>
          {VOUCHER_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={types.includes(t) ? styles.chipActive : styles.chip}
              aria-pressed={types.includes(t)}
              onClick={() => toggle(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={controls.btnOutline}
          disabled={book.vouchers.length === 0}
          onClick={() => downloadCsv(`day-book-${period.start}_to_${period.end}.csv`, dayBookCsv(book.vouchers))}
        >
          <Download size={16} /> Export CSV
        </button>
      </div>

      <div className={surface.card}>
        {book.vouchers.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No vouchers in this period"
            text="Sales, receipts, purchases and payments appear here as soon as they are recorded. Try a wider period or clear the type filter."
          />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>Day book vouchers</caption>
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Vch no.</th>
                  <th scope="col">Particulars</th>
                  <th scope="col">Narration</th>
                  <th scope="col" className={surface.numeric}>Debit</th>
                  <th scope="col" className={surface.numeric}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {days.map(([date, list]) => {
                  const dr = list.reduce((s, v) => s + v.debit, 0);
                  const cr = list.reduce((s, v) => s + v.credit, 0);
                  return (
                    <Fragment key={date}>
                      <tr className={styles.dayRow}>
                        <td colSpan={4}>{formatDate(date)}</td>
                        <td className={surface.numeric}>{formatMoney(dr)}</td>
                        <td className={surface.numeric}>{formatMoney(cr)}</td>
                      </tr>
                      {list.map((v) => (
                        <tr key={v.id}>
                          <td><span className={`${styles.vtype} ${TYPE_CLASS[v.type]}`}>{v.type}</span></td>
                          <td>
                            {v.link && v.type !== 'Receipt' ? (
                              <Link className={styles.link} to={v.link} aria-label={`Open ${v.number || 'invoice'}`}>
                                {v.number || 'Open'}
                              </Link>
                            ) : (
                              <span className={surface.mono}>{v.number || '—'}</span>
                            )}
                          </td>
                          <td>{v.party}</td>
                          <td className={styles.narration}>
                            {v.narration}
                            {v.method ? ` · ${v.method}` : ''}
                            {v.link && v.type === 'Receipt' && (
                              <>
                                {' '}
                                <Link className={styles.link} to={v.link}>view invoice</Link>
                              </>
                            )}
                          </td>
                          <td className={surface.numeric}>{v.debit ? formatMoney(v.debit) : ''}</td>
                          <td className={surface.numeric}>{v.credit ? formatMoney(v.credit) : ''}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                <tr className={styles.totalRow}>
                  <td colSpan={4}>Total ({book.vouchers.length} vouchers)</td>
                  <td className={surface.numeric}>{formatMoney(book.totalDebit)}</td>
                  <td className={surface.numeric}>{formatMoney(book.totalCredit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
