import { useMemo } from 'react';
import { Store } from 'lucide-react';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import type { PurchasePayment } from '../../lib/purchases';
import { disallowance43Bh, fyStartYear, isMse, msmeBills } from '../../lib/msme';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useT } from '../../i18n';
import { purT } from '../../i18n/areas/purchases';
import surface from '../../styles/surface.module.css';

export interface MsmeCardProps {
  purchases: PurchaseRecord[];
  vendors: Vendor[];
  payments: PurchasePayment[];
  today: string;
}

/** "MSME payments due": open bills from micro / small vendors, 45-day limits and Sec 43B(h) exposure. */
export function MsmeCard({ purchases, vendors, payments, today }: MsmeCardProps) {
  useT(); // re-render on a language switch (5.4)
  const data = useMemo(() => {
    if (!vendors.some(isMse)) return null;
    const open = msmeBills(purchases, vendors, payments, today).filter((b) => b.unpaid > 0);
    const fy = fyStartYear(today);
    const years = [disallowance43Bh(purchases, vendors, payments, fy - 1, today), disallowance43Bh(purchases, vendors, payments, fy, today)];
    return { open, years: years.filter((y) => y.total > 0 || y.atRisk > 0) };
  }, [purchases, vendors, payments, today]);

  if (!data || (data.open.length === 0 && data.years.length === 0)) return null;

  return (
    <section className={surface.card}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}><Store size={18} /> {purT('msmeTitle')}</span>
      </div>
      {data.open.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>{purT('thVendor')}</th>
                <th>{purT('msmeBill')}</th>
                <th>{purT('msmePayBy')}</th>
                <th className={surface.numeric}>{purT('msmeUnpaid')}</th>
                <th className={surface.numeric}>{purT('msmeInterest')}</th>
              </tr>
            </thead>
            <tbody>
              {data.open.slice(0, 8).map((b) => (
                <tr key={b.id}>
                  <td>{b.vendorName} <span className={surface.badge}>{b.category === 'MICRO' ? purT('msmeMicro') : purT('msmeSmall')}</span></td>
                  <td className={surface.mono}>{b.billNumber}</td>
                  <td>
                    {formatDate(b.limit)}{' '}
                    {b.daysOverdue > 0 && <span className={`${surface.badge} ${surface.badgeOverdue}`}>{purT('msmeLate', { n: b.daysOverdue })}</span>}
                  </td>
                  <td className={surface.numeric}>{formatCurrency(b.unpaid)}</td>
                  <td className={surface.numeric}>{b.interest > 0 ? formatCurrency(b.interest) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={surface.cardBody}>
        {data.years.map((y) => (
          <p key={y.fy} className={surface.sectionNote}>
            <strong>Sec 43B(h), {y.fy}:</strong> {purT('msmeDisallowed', { amount: formatCurrency(y.total) })}
            {y.atRisk > 0 && <> · {purT('msmeAtRisk', { amount: formatCurrency(y.atRisk) })}</>}.
          </p>
        ))}
        <p className={surface.sectionNote}>
          {purT('msmeNote')}
        </p>
      </div>
    </section>
  );
}
