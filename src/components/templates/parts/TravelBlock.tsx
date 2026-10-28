import type { InvoiceRecord } from '../../../types/invoice';
import { tvPaper } from '../../../lib/travel/tv-print';
import styles from './travel-paper.module.css';

/**
 * R15-B4 travel particulars after the parties (after the professional block, before the GST grid; never on receipt
 * paper): trip / event code, destination, dates, lead passenger and pax count, the regime sentence and up to 6
 * itinerary rows — from the document's `tv` snapshot only. Lazy inside TemplateEngine; accent variable only. C / D
 * add their parts (ticket table, TCS line) as `parts/travel/*.tsx`.
 */
export default function TravelBlock({ invoice }: { invoice: InvoiceRecord }) {
  if (!invoice.tv) return null;
  const p = tvPaper(invoice.tv);
  if (!p.rows.length && !p.decl && !p.itin.length) return null;
  return (
    <section className={styles.block} aria-label={p.title} data-travel-block={invoice.tv.regime ?? ''}>
      <div className={styles.title}>{p.title}</div>
      {p.rows.length > 0 && (
        <dl className={styles.grid}>
          {p.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {p.itin.length > 0 && (
        <table className={styles.table}>
          <tbody>{p.itin.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      )}
      {p.decl && <p className={styles.decl} data-travel-decl>{p.decl}</p>}
    </section>
  );
}
