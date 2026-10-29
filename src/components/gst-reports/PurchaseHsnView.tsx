/** Purchase-side HSN / rate register (WP-6). Lazy-loaded tab of the GST reports page. */
import { useMemo } from 'react';
import { periodRange, type ReportPeriod } from '../../lib/gst-reports';
import { purchaseHsnRegister } from '../../lib/hsn-purchase-register';
import { loadHsnMaster } from '../../lib/hsn-master';
import { getTable } from '../../lib/storage';
import { DataTable, Money } from './DataTable';
import surface from '../../styles/surface.module.css';
import local from './gst-reports.module.css';
import styles from './gst-setoff.module.css';
import { useT } from '../../i18n';
import { soT } from '../../i18n/areas/gst-setoff';

export interface PurchaseHsnViewProps {
  period: ReportPeriod;
  filerStateCode: string;
}

export function PurchaseHsnView({ period, filerStateCode }: PurchaseHsnViewProps) {
  useT();
  const reg = useMemo(() => {
    const { from, to } = periodRange(period);
    return purchaseHsnRegister(getTable<unknown>('purchases'), { from, to, filerStateCode, master: loadHsnMaster() });
  }, [period, filerStateCode]);

  return (
    <div className={local.tabBody} style={{ padding: 0 }} data-gst-purchase-hsn>
      <DataTable
        caption={soT('purHsnTitle')}
        emptyText={soT('purHsnEmpty')}
        rows={reg.rows}
        rowKey={(r) => `${r.hsn}|${r.rate}|${r.uqc}`}
        columns={[
          { key: 'h', label: soT('hsnCode'), render: (r) => <span className={surface.mono}>{r.hsn}</span> },
          { key: 'd', label: soT('hsnDesc'), render: (r) => r.description },
          { key: 'u', label: soT('hsnUqc'), render: (r) => r.uqc || '-' },
          { key: 'q', label: soT('colQty'), numeric: true, render: (r) => r.qty || '' },
          { key: 'r', label: soT('hsnRate'), numeric: true, render: (r) => r.rate },
          { key: 't', label: soT('colTaxable'), numeric: true, render: (r) => <Money value={r.taxable} />, total: (r) => r.taxable },
          { key: 'i', label: 'IGST', numeric: true, render: (r) => <Money value={r.igst} />, total: (r) => r.igst },
          { key: 'c', label: 'CGST', numeric: true, render: (r) => <Money value={r.cgst} />, total: (r) => r.cgst },
          { key: 's', label: 'SGST', numeric: true, render: (r) => <Money value={r.sgst} />, total: (r) => r.sgst },
          { key: 'ce', label: soT('hsnCess'), numeric: true, render: (r) => <Money value={r.cess} />, total: (r) => r.cess },
          { key: 'b', label: soT('colBills'), numeric: true, render: (r) => r.bills },
        ]}
      />
      {reg.linesWithoutHsn > 0 && <p className={styles.muted}>{soT('noHsnLines', { n: reg.linesWithoutHsn })}</p>}
      <h3 className={local.tbHeading}>{soT('colRateWise')}</h3>
      <DataTable
        caption={soT('colRateWise')}
        emptyText={soT('purHsnEmpty')}
        rows={reg.byRate}
        rowKey={(r) => String(r.rate)}
        columns={[
          { key: 'r', label: soT('hsnRate'), numeric: true, render: (r) => r.rate },
          { key: 't', label: soT('colTaxable'), numeric: true, render: (r) => <Money value={r.taxable} />, total: (r) => r.taxable },
          { key: 'x', label: 'GST', numeric: true, render: (r) => <Money value={r.tax} />, total: (r) => r.tax },
          { key: 'c', label: soT('hsnCess'), numeric: true, render: (r) => <Money value={r.cess} />, total: (r) => r.cess },
        ]}
      />
      <p className={styles.muted}>{soT('disclaimer')}</p>
    </div>
  );
}

export default PurchaseHsnView;
