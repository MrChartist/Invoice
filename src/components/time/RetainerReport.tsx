import { Printer } from 'lucide-react';
import type { Retainer, RetainerReportRow } from '../../lib/retainers';
import { printHtmlDocument } from '../../lib/voucher-print';
import { retainerReportHtml } from './retainer-report-html';
import { downloadText } from '../../lib/download';
import { formatCurrency } from '../../lib/utils';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './service-r3.module.css';
import { svcT } from '../../i18n/areas/service-r3';

export function RetainerReport({ retainer, rows, company }: { retainer: Retainer; rows: readonly RetainerReportRow[]; company: { name: string; address?: string; gstin?: string } }) {
  const print = () => {
    const html = retainerReportHtml(retainer, rows, company);
    printHtmlDocument(html, (h) => downloadText(`retainer-${(retainer.client_name ?? 'client').replace(/[^\w-]+/g, '-')}.html`, h, 'text/html'));
  };
  return (
    <div className={styles.section} data-retainer-report>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead>
            <tr>
              <th>{svcT('period')}</th><th>{svcT('feeInvoice')}</th><th className={surface.numeric}>{svcT('allowance')}</th><th className={surface.numeric}>{svcT('used')}</th>
              <th className={surface.numeric}>{svcT('remaining')}</th><th className={surface.numeric}>{svcT('rolledOut')}</th><th className={surface.numeric}>{svcT('forfeited')}</th>
              <th className={surface.numeric}>{svcT('overage')}</th><th>{svcT('status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.period}>
                <td>{x.label}</td><td>{x.fee_invoice || '-'}</td><td className={surface.numeric}>{x.allowance_h}</td><td className={surface.numeric}>{x.used_h}</td>
                <td className={surface.numeric}>{x.remaining_h}</td><td className={surface.numeric}>{x.rolled_h}</td><td className={surface.numeric}>{x.forfeited_h}</td>
                <td className={surface.numeric}>{x.overage_h} · {formatCurrency(x.overage_invoiced)}</td><td>{x.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.row}>
        <button type="button" className={controls.btnOutline} onClick={print}><Printer size={16} /> {svcT('print')}</button>
      </div>
    </div>
  );
}
