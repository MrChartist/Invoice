import { useMemo } from 'react';
import { Download, Info, Printer } from 'lucide-react';
import { loadStockValuer, ratioAnalysis, ratioText, type Ledger, type RatioItem } from '../../../lib/ledger';
import type { Period } from '../../../lib/books';
import { toCsv } from '../../../lib/csv';
import { formatDate, formatMoney } from '../../../lib/utils';
import { downloadCsv } from '../download';
import { useT } from '../../../i18n';
import { tallyT } from '../../../i18n/areas/tally';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './tally.module.css';

const show = (r: RatioItem) => (r.unit === 'money' ? (r.value === null ? '—' : `₹${formatMoney(r.value / 100)}`) : ratioText(r));

/** Tally's Ratio Analysis from the ledger, with drill-down to the accounts behind each figure. */
export function RatioTab({ ledger, period, asOf, onOpenAccount }: { ledger: Ledger; period: Period; asOf: string; onOpenAccount: (id: string) => void }) {
  useT();
  // Closing stock (WP-2 reports engine) per the company setting, so stock ratios use the valued stock.
  const r = useMemo(() => ratioAnalysis(ledger, period, asOf, loadStockValuer()), [ledger, period, asOf]);
  const csv = () => toCsv([['Item', 'Value', 'Formula'], ...[...r.groups, ...r.ratios].map((x) => [x.label, x.unit === 'money' && x.value !== null ? (x.value / 100).toFixed(2) : ratioText(x), x.formula])]);
  const table = (title: string, items: RatioItem[]) => (
    <div className={surface.card}>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <caption className={surface.srOnly}>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{title}</th>
              <th scope="col" className={surface.numeric}>{tallyT('value')}</th>
              <th scope="col">{tallyT('formula')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id}>
                <td>
                  {x.accounts.length ? (
                    <button type="button" className={controls.btnGhost} title={tallyT('drill')} onClick={() => onOpenAccount(x.accounts[0])}>{x.label}</button>
                  ) : (
                    x.label
                  )}
                </td>
                <td className={surface.numeric} data-ratio={x.id}>{show(x)}</td>
                <td className={styles.formula}>{x.formula}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  return (
    <div className={books.stack}>
      <div className={`${books.toolbar} no-print`}>
        <div className={books.toolbarGroup}>
          <span className={books.indicative}><Info size={13} aria-hidden="true" /> {tallyT('verifyCa')}</span>
          <strong>{tallyT('ratioTitle')}</strong>
          <span className={books.muted}>{formatDate(period.start)} – {formatDate(r.asOf)}</span>
        </div>
        <div className={books.toolbarGroup}>
          <button type="button" className={controls.btnOutline} onClick={() => window.print()}><Printer size={16} /> {tallyT('print')}</button>
          <button type="button" className={controls.btnOutline} onClick={() => downloadCsv(`ratio-analysis-${period.start}_to_${r.asOf}.csv`, csv())}><Download size={16} /> {tallyT('csv')}</button>
        </div>
      </div>
      <div className={books.twoCol}>
        {table(tallyT('principalGroups'), r.groups)}
        {table(tallyT('principalRatios'), r.ratios)}
      </div>
      <p className={books.muted}>{tallyT('ratioNote')}</p>
    </div>
  );
}
