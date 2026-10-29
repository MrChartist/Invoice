/**
 * Day Book from the ledger (WP-2, P0-3): every voucher — sales, credit / debit notes, receipts,
 * purchases, expenses, payments, manual journal / contra / payment / receipt vouchers, fixed assets,
 * depreciation and openings — with a voucher-type filter. Alt+F1 shows each voucher's ledger lines.
 * Enter / click opens the voucher (its document, or the voucher editor for a manual one).
 */
import { Fragment, useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { ledgerDayBook, voucherTarget, type Ledger, type LedgerVoucherKind } from '../../../lib/ledger';
import type { Period } from '../../../lib/books';
import { toCsv } from '../../../lib/csv';
import { formatDate } from '../../../lib/utils';
import { reportsT } from '../../../i18n/areas/reports-engine';
import { purCategory } from '../../../i18n/areas/purchases';

/** QA-3 F19: voucher types and expense heads in the interface language (stored values stay English). */
const kindLabel = (k: string): string => (`vk.${k}` in reportsT.en ? reportsT(`vk.${k}` as never) : k);
import { useT } from '../../../i18n';
import { EmptyState } from '../../ui/EmptyState';
import { useDrillRows, useReportPrefs } from './drill-hooks';
import { ReportOptions } from './ReportToolbar';
import { ReportStrip } from './DrillStack';
import { useOpenVoucher } from './report-env';
import { money } from './format';
import { PrintTitle, StatementToolbar } from './shared';
import surface from '../../../styles/surface.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';

export function DayBookTab({ ledger, period }: { ledger: Ledger; period: Period }) {
  useT();
  const [kinds, setKinds] = useState<LedgerVoucherKind[]>([]);
  const [prefs, setPrefs] = useReportPrefs('day-book');
  const openVoucher = useOpenVoucher();
  const all = useMemo(() => ledgerDayBook(ledger, period), [ledger, period]);
  const book = useMemo(() => (kinds.length ? ledgerDayBook(ledger, period, kinds) : all), [ledger, period, kinds, all]);
  // R20-C: Shift+Enter shows one voucher's ledger lines; filter facts, Alt+I new entry on that day.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const nav = useDrillRows(book.entries.length, (i) => openVoucher(book.entries[i].voucher), {
    fact: (i) => {
      const { voucher: v, amount, debitAccount, creditAccount } = book.entries[i];
      return { text: [v.party, v.number, kindLabel(v.kind), debitAccount, creditAccount].join(' '), date: v.date, narr: v.narration, amt: amount };
    },
    voucher: (i) => book.entries[i]?.voucher,
    expand: (i) => {
      const id = book.entries[i]?.voucher.id ?? '';
      setOpen((s) => new Set(s.has(id) ? [...s].filter((x) => x !== id) : [...s, id]));
    },
  });
  const shown = book.entries.filter((_, i) => nav.shown(i));
  // The date shows on the first shown row of each day.
  const dayStart = new Set<number>();
  for (let i = 0, last = ''; i < book.entries.length; i++) {
    if (!nav.shown(i) || book.entries[i].voucher.date === last) continue;
    dayStart.add(i);
    last = book.entries[i].voucher.date;
  }
  const toggle = (k: LedgerVoucherKind) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const name = (id: string) => ledger.byId.get(id)?.name ?? id;

  const csv = () =>
    toCsv([
      ['Day Book', `${period.start} to ${period.end}`, 'Working paper — verify with your CA'],
      ['Date', 'Voucher type', 'Vch no.', 'Party', 'Debit ledger', 'Credit ledger', 'Narration', 'Amount'],
      // R20-C: rows hidden or filtered out on screen are left out (the total is of the rows exported).
      ...shown.map((e) => [e.voucher.date, e.voucher.kind, e.voucher.number, e.voucher.party, e.debitAccount, e.creditAccount, e.voucher.narration, e.amount / 100]),
      ['', '', '', '', '', '', 'Total', shown.reduce((t, e) => t + e.amount, 0) / 100],
    ]);

  return (
    <div className={books.stack}>
      <div className={`${books.presets} no-print`} role="group" aria-label={reportsT('filterType')}>
        <button type="button" className={kinds.length === 0 ? books.chipActive : books.chip} aria-pressed={kinds.length === 0} onClick={() => setKinds([])}>
          {reportsT('all')}
        </button>
        {all.kinds.map((k) => (
          <button key={k} type="button" className={kinds.includes(k) ? books.chipActive : books.chip} aria-pressed={kinds.includes(k)} onClick={() => toggle(k)}>
            {kindLabel(k)}
          </button>
        ))}
      </div>
      <StatementToolbar csv={book.entries.length ? csv : undefined} filename={`day-book-${period.start}_to_${period.end}.csv`}>
        <ReportOptions prefs={prefs} onChange={setPrefs} options={['showNarration']} />
      </StatementToolbar>
      <PrintTitle title={reportsT('dayBook')} sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />

      <div className={surface.card}>
        {book.entries.length === 0 ? (
          <EmptyState icon={BookOpen} title={reportsT('noVouchers')} text={reportsT('noVouchersText')} />
        ) : (
          <div className={`${surface.tableWrap} ${styles.wrap}`}>
            <table className={surface.table} {...nav.table}>
              <caption className={surface.srOnly}>{reportsT('dayBook')}</caption>
              <thead>
                <tr>
                  <th scope="col">{reportsT('date')}</th>
                  <th scope="col">{reportsT('particulars')}</th>
                  <th scope="col">{reportsT('vchType')}</th>
                  <th scope="col">{reportsT('vchNo')}</th>
                  <th scope="col" className={surface.numeric}>{reportsT('debit')}</th>
                  <th scope="col" className={surface.numeric}>{reportsT('credit')}</th>
                </tr>
              </thead>
              <tbody id={nav.bodyId}>
                {book.entries.map((e, i) => {
                  const v = e.voucher;
                  const showDate = dayStart.has(i);
                  const target = voucherTarget(v);
                  return (
                    <Fragment key={v.id}>
                      <tr {...nav.row(i)}>
                        <td>{showDate ? formatDate(v.date) : ''}</td>
                        <td>
                          <div>{v.party || `${purCategory(e.debitAccount)} / ${purCategory(e.creditAccount)}`}</div>
                          {prefs.showNarration && v.narration && <div className={books.narration}>{v.narration}</div>}
                        </td>
                        <td><span className={v.source === 'manual' ? styles.badgeManual : styles.badge}>{kindLabel(v.kind)}</span></td>
                        <td>
                          {target.type === 'none' ? (
                            <span className={surface.mono}>{v.number || '—'}</span>
                          ) : (
                            <button type="button" className={styles.rowButton} onClick={() => openVoucher(v)}>{v.number || reportsT('open')}</button>
                          )}
                        </td>
                        <td className={surface.numeric} colSpan={2}>{money(e.amount)}</td>
                      </tr>
                      {(prefs.detailed || open.has(v.id)) && nav.shown(i) &&
                        v.lines.map((l, k) => (
                          <tr key={`${v.id}-${k}`} className={styles.detail}>
                            <td />
                            <td style={{ paddingLeft: l.cr ? '2.5rem' : '1.25rem' }}>
                              {l.cr ? `${reportsT('to')} ` : `${reportsT('by')} `}
                              {name(l.account)}
                              {l.party ? ` — ${l.party}` : ''}
                            </td>
                            <td />
                            <td />
                            <td className={surface.numeric}>{l.dr ? money(l.dr) : ''}</td>
                            <td className={surface.numeric}>{l.cr ? money(l.cr) : ''}</td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
                <tr className={books.totalRow}>
                  <td colSpan={4}>{reportsT('dayBookTotal', { count: book.entries.length })}</td>
                  <td className={surface.numeric}>{money(book.totalDebit)}</td>
                  <td className={surface.numeric}>{money(book.totalCredit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ReportStrip />
      <p className={books.muted}>{reportsT('dayBookNote')}</p>
    </div>
  );
}
