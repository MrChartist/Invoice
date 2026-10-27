import type { InvoiceRecord } from '../../../types/invoice';
import type { CalcTotals } from '../../../lib/invoice-calc';
import type { worksLineText } from '../paper-helpers';
import { currencySymbol, formatQuantity } from '../../../lib/utils';
import { usePaper } from '../paper-context';
import { PL } from './works-label';
import styles from './works-paper.module.css';

/**
 * R11 (CN-A4) "pwd" paper: the item table itself carries the cumulative columns — item no., description (M-book /
 * class sub-line), unit, BOQ qty, rate, up to previous / this bill / up to date quantity and this bill's amount. Rows
 * are the bill's own lines (amounts from the calculator, so the table ties to the totals); quantities from the
 * snapshot `boq_terms.cn.lines`. Non-gst layouts only (on the `gst` layout the abstract page carries the columns).
 */
export function RaItemsTable({ invoice, totals, lineText }: { invoice: InvoiceRecord; totals: CalcTotals; /** `worksLineText` (passed by TemplateEngine, keeps paper-helpers in the preview chunk). */ lineText: typeof worksLineText }) {
  const { money, bilingual: bi } = usePaper();
  const cn = invoice.boq_terms?.cn;
  const cur = invoice.currency;
  return (
    <table className={styles.table} data-ra-items>
      <thead>
        <tr>
          <th>#</th>
          <th><PL k="p.itemNo" bi={bi} /></th>
          <th><PL k="p.description" bi={bi} /></th>
          <th><PL k="p.unit" bi={bi} /></th>
          <th className={styles.n}><PL k="p.boqQty" bi={bi} /></th>
          <th className={styles.n}><PL k="p.rate" bi={bi} /></th>
          <th className={styles.n}><PL k="p.prevQty" bi={bi} /></th>
          <th className={styles.n}><PL k="p.thisQty" bi={bi} /></th>
          <th className={styles.n}><PL k="p.cumQty" bi={bi} /></th>
          <th className={styles.n}><PL k="p.thisAmt" bi={bi} /> ({currencySymbol(cur)})</th>
        </tr>
      </thead>
      <tbody>
        {totals.lines.map((line, i) => {
          const src = invoice.items.find((it) => it.id === line.id);
          const l = src ? cn?.lines?.[src.id] : undefined;
          const sub = lineText(src, cn);
          return (
            <tr key={line.id}>
              <td className={styles.n}>{i + 1}</td>
              <td>{l?.ref ?? src?.boq_ref ?? ''}</td>
              <td>
                <div>{line.name || '—'}</div>
                {sub && <div className={styles.sub}>{sub}</div>}
              </td>
              <td>{line.unit ?? ''}</td>
              <td className={styles.n}>{l?.boq_qty ? formatQuantity(l.boq_qty) : ''}</td>
              <td className={styles.n}>{money(line.rate, cur)}</td>
              <td className={styles.n}>{l?.prev_qty !== undefined ? formatQuantity(l.prev_qty) : ''}</td>
              <td className={styles.n}>{formatQuantity(line.quantity)}</td>
              <td className={styles.n}>{l?.cum_qty !== undefined ? formatQuantity(l.cum_qty) : ''}</td>
              <td className={styles.n}>{money(line.taxable, cur)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
