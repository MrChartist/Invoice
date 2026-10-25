import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import type { InvoiceRecord } from '../../types/invoice';
import { progressReport, type LinkLike } from '../../lib/progress-billing';
import { progressSummaryCsv } from '../../lib/sales-reports';
import { getTable } from '../../lib/storage';
import { downloadText } from '../../lib/download';
import { formatDate, formatMoney } from '../../lib/utils';
import { useT } from '../../i18n';
import { s2T } from '../../i18n/areas/sales-r2';
import controls from '../../styles/controls.module.css';
import styles from './sales-r2.module.css';

/** R2-B2: Progress billing summary by party / quotation (taxable value) with CSV. */
export function ProgressReportModal({ onClose }: { onClose: () => void }) {
  useT(); // re-render on a language switch (5.4)
  const rows = useMemo(() => progressReport(getTable<InvoiceRecord>('invoices'), getTable<LinkLike>('doc_links')), []);
  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={s2T('p.reportTitle')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{s2T('close')}</button>
          <button type="button" className={controls.btnPrimary} disabled={!rows.length} onClick={() => downloadText('progress-billing.csv', progressSummaryCsv(rows), 'text/csv')}>{s2T('exportCsv')}</button>
        </>
      }
    >
      {rows.length === 0 ? <p className={styles.muted}>{s2T('p.reportEmpty')}</p> : (
        <div className={styles.tableScroll} data-progress-report>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{s2T('party')}</th><th>{s2T('p.document')}</th>
                <th className={styles.num}>{s2T('p.quoted')}</th><th className={styles.num}>{s2T('p.invoiced')}</th>
                <th className={styles.num}>{s2T('p.credited')}</th><th className={styles.num}>{s2T('p.remaining')}</th>
                <th className={styles.num}>{s2T('p.pctCol')}</th><th className={styles.num}>{s2T('p.stages')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sourceId}>
                  <td>{r.party}</td>
                  <td><Link to={`/invoice/${r.sourceId}`} onClick={onClose}>{r.number}</Link><div className={styles.muted}>{formatDate(r.date)}</div></td>
                  <td className={styles.num}>{formatMoney(r.quoted)}</td>
                  <td className={styles.num}>{formatMoney(r.invoiced)}</td>
                  <td className={styles.num}>{formatMoney(r.credited)}</td>
                  <td className={styles.num}>{formatMoney(r.remaining)}</td>
                  <td className={styles.num}>{r.percent}%</td>
                  <td className={styles.num}>{r.stages}{r.closed ? ' ✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
