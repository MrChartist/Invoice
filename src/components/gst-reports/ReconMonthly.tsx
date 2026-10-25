/** Month-wise GSTR-1 vs GSTR-3B vs Books (WP-6). Lazy-loaded tab of the GST reports page. */
import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ReportPeriod } from '../../lib/gst-reports';
import { reconMonthly } from '../../lib/gst-recon-monthly';
import { gstSummary, itcWithCess, loadBooksData } from '../../lib/books';
import { advanceTaxEvents } from '../../lib/advance-tax';
import { readLinks } from '../../lib/documents';
import { getTable } from '../../lib/storage';
import { todayIso } from '../../lib/tax-rules';
import type { PurchaseReturn } from '../../types/purchases';
import { formatMoney } from '../../lib/utils';
import surface from '../../styles/surface.module.css';
import local from './gst-reports.module.css';
import styles from './gst-setoff.module.css';
import { useT } from '../../i18n';
import { soT } from '../../i18n/areas/gst-setoff';

export interface ReconMonthlyProps {
  period: ReportPeriod;
  gstin: string;
  filerStateCode: string;
}

const cell = (n: number | null) => (n === null ? '—' : formatMoney(n));
const diffCell = (n: number | null) => (n === null ? '—' : <span className={Math.abs(n) > 1 ? styles.bad : styles.ok}>{formatMoney(n)}</span>);

export function ReconMonthly({ period, gstin, filerStateCode }: ReconMonthlyProps) {
  useT();
  const rows = useMemo(() => {
    const books = loadBooksData();
    return reconMonthly(books.invoices, getTable<unknown>('purchases'), {
      fyStart: period.fyStart,
      gstin,
      filerStateCode,
      links: readLinks(),
      advances: advanceTaxEvents(books.advances ?? [], books.transactions, books.invoices),
      purchaseNotes: getTable<PurchaseReturn>('purchase_returns'),
      upTo: todayIso(),
      books: (from, to) => {
        const g = gstSummary(books, { start: from, end: to });
        return { tax: g.outputTotal + (g.outputCess ?? 0), itc: itcWithCess(g) };
      },
    });
  }, [period.fyStart, gstin, filerStateCode]);

  return (
    <div className={local.tabBody} style={{ padding: 0 }} data-gst-recon-monthly>
      <div className={`${surface.card} ${local.disclaimer}`} role="note">
        <AlertTriangle size={16} aria-hidden style={{ flexShrink: 0, color: 'var(--warning)' }} />
        <span>{soT('disclaimer')}</span>
      </div>
      <p className={styles.muted}>{soT('reconIntro')} {soT('reconFyHint')}</p>
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label={soT('reconTitle')}>
          <thead>
            <tr>
              <th scope="col">{soT('colMonth')}</th>
              <th scope="col">{soT('colG1')}</th>
              <th scope="col">{soT('colG3b')}</th>
              <th scope="col">{soT('colBooks')}</th>
              <th scope="col">{soT('colDiff13')}</th>
              <th scope="col">{soT('colDiff3Books')}</th>
              <th scope="col">{soT('colItc3b')}</th>
              <th scope="col">{soT('colItcBooks')}</th>
              <th scope="col">{soT('colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.from}>
                <th scope="row">{r.label}</th>
                <td>{cell(r.g1)}</td>
                <td>{cell(r.g3b)}</td>
                <td>{cell(r.books)}</td>
                <td>{diffCell(r.diff13)}</td>
                <td>{diffCell(r.diff3Books)}</td>
                <td>{cell(r.itc3b)}</td>
                <td>{r.itcBooks === null ? '—' : <span className={Math.abs(r.itc3b - r.itcBooks) > 1 ? styles.bad : undefined}>{formatMoney(r.itcBooks)}</span>}</td>
                <td className={r.ok ? styles.ok : styles.bad}>{r.ok ? soT('reconOk') : soT('reconDiff')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ReconMonthly;
