/**
 * 7O (7.96): TDS deposit / Form 26Q / Form 16A due dates inside the GST compliance calendar. Lazy-loaded by
 * `ComplianceView`, so the GST page chunk does not carry the TDS engine; renders nothing until TDS is used.
 * Working paper — verify with your CA (CBDT extensions are not tracked).
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { loadTdsDue, usesTds, type DueItem } from '../../lib/tds-payables';
import { formatDate, formatMoney } from '../../lib/utils';
import { useT } from '../../i18n';
import { tdsT } from '../../i18n/areas/tds';
import { o7T } from '../../i18n/areas/gst-tds-7o';
import { ita25Words } from '../../i18n/areas/ita2025';
import { formText, periodStart } from '../../lib/ita2025';
import surface from '../../styles/surface.module.css';
import local from '../gst-reports/gst-reports.module.css';

const STATUS_KEY: Record<DueItem['status'], 'stDone' | 'stLate' | 'stOverdue' | 'stUpcoming'> = {
  done: 'stDone',
  late: 'stLate',
  overdue: 'stOverdue',
  upcoming: 'stUpcoming',
};

export function TdsDueCalendar({ today }: { today: string }) {
  useT();
  const items = useMemo(() => (usesTds() ? loadTdsDue(today) : []), [today]);
  if (!items.length) return null;
  // Open items first (overdue, upcoming), then the rest of the current year.
  const shown = [...items.filter((d) => d.status === 'overdue' || d.status === 'upcoming'), ...items.filter((d) => d.status === 'done' || d.status === 'late')].slice(0, 12);
  return (
    <section data-tds-due-calendar>
      <h3 className={local.tbHeading}>{o7T('tdsCalTitle')}</h3>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <caption className={surface.srOnly}>{o7T('tdsCalTitle')}</caption>
          <thead>
            <tr>
              <th scope="col">{tdsT('calendar')}</th>
              <th scope="col">{tdsT('due')}</th>
              <th scope="col" className={surface.numeric}>₹</th>
              <th scope="col">{tdsT('status')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.what === 'deposit'
                    ? tdsT('whatDeposit', { kind: d.kind, period: d.period })
                    : d.what === 'return'
                      ? tdsT('whatReturn', { form: formText('26Q', periodStart(d.period), ita25Words()), period: d.period })
                      : tdsT('whatCert', { period: d.period })}
                </td>
                <td>{formatDate(d.due)}</td>
                <td className={surface.numeric}>{formatMoney(d.amount)}</td>
                <td>{tdsT(STATUS_KEY[d.status])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={surface.sectionNote}>
        {o7T('tdsCalNote')} <Link to="/tds">{o7T('tdsCalOpen')}</Link>
      </p>
    </section>
  );
}

export default TdsDueCalendar;
