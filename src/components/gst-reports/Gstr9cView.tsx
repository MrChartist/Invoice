/** GSTR-9C reconciliation working paper (WP-6). Lazy-loaded tab of the GST reports page. */
import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { buildGstr9 } from '../../lib/gstr9';
import { buildGstr9c, type Gstr9cAdjustments, type Gstr9cLine } from '../../lib/gstr9c';
import { gstr9cRateWise, gstr9cTable14, notesItcForFy } from '../../lib/gstr9c-extra';
import { loadIsdInward } from '../../lib/isd';
import { journalItcReversals } from '../../lib/gst-reports'; // R6-C4
import { r7T } from '../../i18n/areas/gst-tds-7r';
import { fyPeriod, gstSummary, itcWithCess, loadBooksData, profitAndLoss } from '../../lib/books';
import { advanceTaxEvents } from '../../lib/advance-tax';
import { readLinks } from '../../lib/documents';
import { getTable } from '../../lib/storage';
import { formatMoney } from '../../lib/utils';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import local from './gst-reports.module.css';
import styles from './gst-setoff.module.css';
import { useT } from '../../i18n';
import { soT } from '../../i18n/areas/gst-setoff';

export interface Gstr9cViewProps {
  fyStart: number;
  gstin: string;
  filerStateCode: string;
  /** Aggregate turnover of the FY entered on the page (₹), 0 = computed. */
  turnover?: number;
}

const ADJ_FIELDS: { key: keyof Gstr9cAdjustments; id: string }[] = [
  { key: 'unbilledOpening', id: '5B' },
  { key: 'advancesClosing', id: '5C' },
  { key: 'deemedSupply', id: '5D' },
  { key: 'creditNotesAfterFy', id: '5E' },
  { key: 'tradeDiscounts', id: '5F' },
  { key: 'unbilledClosing', id: '5H' },
  { key: 'advancesOpening', id: '5I' },
  { key: 'creditNotesNotGst', id: '5J' },
  { key: 'other', id: '5K-N' },
  { key: 'itcEarlierFy', id: '12B' },
  { key: 'itcLaterFy', id: '12C' },
];

export function Gstr9cView({ fyStart, gstin, filerStateCode, turnover }: Gstr9cViewProps) {
  useT();
  const [adj, setAdj] = useState<Record<string, string>>({});
  const base = useMemo(() => {
    const books = loadBooksData();
    const period = fyPeriod(fyStart);
    const g9 = buildGstr9(books.invoices, getTable<unknown>('purchases'), {
      fyStart,
      gstin,
      filerStateCode,
      links: readLinks(),
      advances: advanceTaxEvents(books.advances ?? [], books.transactions, books.invoices),
      purchaseNotes: books.purchaseReturns ?? [],
      isdInward: loadIsdInward(),
      itcReversals: journalItcReversals(getTable('vouchers')), // R6-C4
      turnover: turnover || 0,
    });
    const g = gstSummary(books, period);
    const purchases = getTable<unknown>('purchases');
    return {
      g9,
      books: {
        turnover: profitAndLoss(books, period).income,
        tax: { igst: g.outputIgst, cgst: g.outputCgst, sgst: g.outputSgst, cess: g.outputCess ?? 0 },
        itc: itcWithCess(g),
        // 7R (7.127): supplier notes split out of Table 12.
        notesItc: notesItcForFy(books.purchaseReturns, fyStart),
      },
      // 7R (7.127): rate-wise Table 9 and expense-wise Table 14.
      rate9: gstr9cRateWise(g9, purchases, filerStateCode),
      t14: gstr9cTable14(g9, purchases, filerStateCode, books.purchaseReturns ?? []),
    };
  }, [fyStart, gstin, filerStateCode, turnover]);
  const report = useMemo(() => {
    const a: Gstr9cAdjustments = {};
    for (const f of ADJ_FIELDS) a[f.key] = Number(adj[f.key]) || 0;
    return buildGstr9c(base.g9, base.books, a);
  }, [base, adj]);

  const lines = (rows: Gstr9cLine[], caption: string) => (
    <div className={styles.scroll}>
      <table className={styles.grid} aria-label={caption}>
        <thead>
          <tr>
            <th scope="col">{soT('c9Line')}</th>
            <th scope="col" style={{ textAlign: 'left' }}>{caption}</th>
            <th scope="col">{soT('c9Amount')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{r.total ? <strong>{r.label}</strong> : r.label}</td>
              <td className={r.total && /[QGF]$/.test(r.id) && Math.abs(r.amount) > 1 ? styles.bad : undefined}>{r.total ? <strong>{formatMoney(r.amount)}</strong> : formatMoney(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className={local.tabBody} style={{ padding: 0 }} data-gst-9c>
      <div className={`${surface.card} ${local.disclaimer}`} role="note">
        <AlertTriangle size={16} aria-hidden style={{ flexShrink: 0, color: 'var(--warning)' }} />
        <span>{soT('c9Intro')} {soT('disclaimer')}</span>
      </div>
      <p className={styles.muted}>{report.required ? soT('c9Required') : soT('c9NotRequired')} {soT('c9BooksHint')}</p>

      <h3 className={local.tbHeading}>{soT('c9Adjust')}</h3>
      <div className={styles.formGrid}>
        {ADJ_FIELDS.map((f) => (
          <label key={f.key} className={controls.field}>
            <span className={controls.label}>{f.id} · {report.table5.find((r) => r.id === f.id)?.label ?? report.table12.find((r) => r.id === f.id)?.label ?? f.id}</span>
            <input type="number" step="0.01" className={controls.input} value={adj[f.key] ?? ''} onChange={(e) => setAdj((x) => ({ ...x, [f.key]: e.target.value }))} />
          </label>
        ))}
      </div>

      <h3 className={local.tbHeading}>{soT('c9Turnover')}</h3>
      {lines(report.table5, soT('c9Turnover'))}
      {lines(report.table7, soT('colTaxable'))}

      <h3 className={local.tbHeading}>{soT('c9Tax')}</h3>
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label={soT('c9Tax')}>
          <thead>
            <tr>
              <th scope="col">{soT('c9Head')}</th>
              <th scope="col">{soT('c9Books')}</th>
              <th scope="col">{soT('c9Returns')}</th>
              <th scope="col">{soT('c9Diff')}</th>
            </tr>
          </thead>
          <tbody>
            {report.table9.map((r) => (
              <tr key={r.head}>
                <th scope="row">{r.head}</th>
                <td>{formatMoney(r.books)}</td>
                <td>{formatMoney(r.returns)}</td>
                <td className={Math.abs(r.diff) > 1 ? styles.bad : styles.ok}>{formatMoney(r.diff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className={local.tbHeading}>{r7T('c9RateTitle')}</h3>
      <p className={styles.muted}>{r7T('c9RateHint')}</p>
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label={r7T('c9RateTitle')} data-9c-rate>
          <thead>
            <tr>
              <th scope="col">{soT('c9Line')}</th>
              <th scope="col" style={{ textAlign: 'left' }}>{r7T('c9Rate')}</th>
              <th scope="col">{r7T('c9Taxable')}</th>
              <th scope="col">CGST</th>
              <th scope="col">SGST</th>
              <th scope="col">IGST</th>
              <th scope="col">Cess</th>
            </tr>
          </thead>
          <tbody>
            {base.rate9.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td style={{ textAlign: 'left' }}>{r.total ? <strong>{r.label}</strong> : r.label}</td>
                <td>{r.total ? '' : formatMoney(r.taxable)}</td>
                {(['cgst', 'sgst', 'igst', 'cess'] as const).map((k) => <td key={k} className={r.id === '9Q' && Math.abs(r[k]) > 1 ? styles.bad : undefined}>{formatMoney(r[k])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className={local.tbHeading}>{soT('c9Itc')}</h3>
      {lines(report.table12, soT('c9Itc'))}
      <p className={styles.muted}>{soT('c9Reasons')}</p>

      <h3 className={local.tbHeading}>{r7T('c9T14Title')}</h3>
      <p className={styles.muted}>{r7T('c9T14Hint')}</p>
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label={r7T('c9T14Title')} data-9c-t14>
          <thead>
            <tr>
              <th scope="col">{soT('c9Line')}</th>
              <th scope="col" style={{ textAlign: 'left' }}>{r7T('c9Expense')}</th>
              <th scope="col">{r7T('c9Value')}</th>
              <th scope="col">{r7T('c9TotalItc')}</th>
              <th scope="col">{r7T('c9Eligible')}</th>
            </tr>
          </thead>
          <tbody>
            {base.t14.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{r.total ? <strong>{r.label}</strong> : r.label}</td>
                <td>{r.total && !r.value ? '' : formatMoney(r.value)}</td>
                <td>{r.total && !r.itc ? '' : formatMoney(r.itc)}</td>
                <td className={r.id === '14T' && Math.abs(r.eligible) > 1 ? styles.bad : undefined}>{formatMoney(r.eligible)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Gstr9cView;
