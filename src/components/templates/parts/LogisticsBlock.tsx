import type { InvoiceRecord } from '../../../types/invoice';
import { logisticsPaper } from '../../../lib/logistics/lg-print';
import styles from './manpower-paper.module.css';

/**
 * R19-A4 job particulars after the parties (after the society block, before the GST grid; never on receipt paper): job
 * no., direction / mode, route, house / master bill, vessel or flight, shipping bill / bill of entry, packages,
 * weights, CBM, the containers (≤ 8, then "+ N more") and the place-of-supply reason B writes — from the document's
 * `lg` snapshot only. Lazy inside TemplateEngine; it shares the R17 particulars box styles (template variables only:
 * accent / muted / line / soft). C (disbursement schedule) and D (manifest / storage summaries) add
 * `parts/logistics/*.tsx` parts below.
 */
export default function LogisticsBlock({ invoice }: { invoice: InvoiceRecord }) {
  if (!invoice.lg) return null;
  const p = logisticsPaper(invoice.lg);
  if (!p.rows.length && !p.containers && !p.reason) return null;
  return (
    <section className={styles.block} aria-label="Shipment" data-logistics-block={invoice.lg.job_no ?? ''}>
      <dl className={styles.grid}>
        {p.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        {p.containers && <div><dt>Containers</dt><dd>{p.containers}</dd></div>}
      </dl>
      {p.reason && <p className={styles.decl} data-lg-pos-reason>{p.reason}</p>}
    </section>
  );
}
