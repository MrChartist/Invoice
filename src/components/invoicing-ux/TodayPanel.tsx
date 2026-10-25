import { useMemo } from 'react';
import { CalendarDays, MessageCircle } from 'lucide-react';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { accountBalanceAt, buildVouchers, type BooksData } from '../../lib/books';
import { localDayOf } from '../../lib/dates';
import { todaySummary, todayText } from '../../lib/today';
import { whatsappLink } from '../../lib/share';
import { cn, formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { uxT } from '../../i18n/areas/invoicing-ux';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import ux from './ux.module.css';

/** 8.105 Dashboard "Today" card: the day at a glance, and one tap to send it to the owner's own WhatsApp. */
export function TodayPanel({ books }: { books: BooksData }) {
  useT();
  const day = localDayOf(new Date());
  const s = useMemo(() => {
    let cash: number | null;
    try {
      cash = accountBalanceAt(buildVouchers(books), books.openings, 'cash', day);
    } catch {
      cash = null;
    }
    return todaySummary({ invoices: books.invoices, payments: books.transactions, purchases: getTable('purchases'), vendors: books.vendors, cashInHand: cash }, day);
  }, [books, day]);
  const profile = localDb.settings.activeProfile();
  const m = (n: number) => formatCurrency(n, 'INR');
  const rows: [string, number][] = [
    [uxT('tdSales', { n: s.bills }), s.sales],
    [uxT('tdCash'), s.cash],
    [uxT('tdUpi'), s.upi],
    [uxT('tdBank'), s.bank],
    [uxT('tdUdhaar'), s.udhaar],
    [uxT('tdExpenses'), s.expenses],
  ];
  return (
    <div className={surface.card} data-tile="today">
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}><CalendarDays size={16} /> {uxT('tdTitle')}</span>
        <a className={cn(controls.btnOutline, controls.btnSm)} href={whatsappLink(profile?.companyPhone, todayText(s, profile?.companyName ?? ''))} target="_blank" rel="noreferrer" data-today-share>
          <MessageCircle size={14} /> {uxT('tdShare')}
        </a>
      </div>
      <div className={surface.cardBody}>
        <ul className={ux.list}>
          {rows.map(([label, v]) => <li key={label}><span>{label}</span><strong>{m(v)}</strong></li>)}
          {s.cashInHand !== null && <li><span>{uxT('tdCashInHand')}</span><strong className={s.cashInHand < 0 ? ux.bad : undefined}>{m(s.cashInHand)}</strong></li>}
        </ul>
      </div>
    </div>
  );
}

export default TodayPanel;
