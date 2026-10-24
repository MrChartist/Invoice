import { useMemo } from 'react';
import { Store } from 'lucide-react';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import type { PurchasePayment } from '../../lib/purchases';
import { disallowance43Bh, fyStartYear, isMse, msmeBills } from '../../lib/msme';
import { formatCurrency, formatDate } from '../../lib/utils';
import surface from '../../styles/surface.module.css';

export interface MsmeCardProps {
  purchases: PurchaseRecord[];
  vendors: Vendor[];
  payments: PurchasePayment[];
  today: string;
}

/** "MSME payments due": open bills from micro / small vendors, 45-day limits and Sec 43B(h) exposure. */
export function MsmeCard({ purchases, vendors, payments, today }: MsmeCardProps) {
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
        <span className={surface.cardHeadIcon}><Store size={18} /> MSME payments due</span>
      </div>
      {data.open.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Bill</th>
                <th>Pay by</th>
                <th className={surface.numeric}>Unpaid</th>
                <th className={surface.numeric}>Interest (Sec 16)</th>
              </tr>
            </thead>
            <tbody>
              {data.open.slice(0, 8).map((b) => (
                <tr key={b.id}>
                  <td>{b.vendorName} <span className={surface.badge}>{b.category === 'MICRO' ? 'Micro' : 'Small'}</span></td>
                  <td className={surface.mono}>{b.billNumber}</td>
                  <td>
                    {formatDate(b.limit)}{' '}
                    {b.daysOverdue > 0 && <span className={`${surface.badge} ${surface.badgeOverdue}`}>{b.daysOverdue}d late</span>}
                  </td>
                  <td className={surface.numeric}>{formatCurrency(b.unpaid)}</td>
                  <td className={surface.numeric}>{b.interest > 0 ? formatCurrency(b.interest) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={surface.cardBody}>
        {data.years.map((y) => (
          <p key={y.fy} className={surface.sectionNote}>
            <strong>Sec 43B(h), {y.fy}:</strong> {formatCurrency(y.total)} disallowed
            {y.atRisk > 0 && <> · {formatCurrency(y.atRisk)} at risk unless paid by the limit or 31 March</>}.
          </p>
        ))}
        <p className={surface.sectionNote}>
          Limit = agreed due date, at most 45 days from the bill (15 days when no due date is set). Interest is compounded
          monthly at three times the RBI bank rate and is not deductible. Estimates — verify with your CA.
        </p>
      </div>
    </section>
  );
}
