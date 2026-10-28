import type { InvoiceRecord } from '../../../types/invoice';
import { logisticsPaper } from '../../../lib/logistics/lg-print';
import styles from './manpower-paper.module.css';
import DisbSchedule from './logistics/DisbSchedule';

/**
 * R19-A4 job particulars after the parties (after the society block, before the GST grid; never on receipt paper): job
 * no., direction / mode, route, house / master bill, vessel or flight, shipping bill / bill of entry, packages,
 * weights, CBM and the place-of-supply reason B writes (the containers line was cut, PRD §3 cut 1) — from the document's
 * `lg` snapshot only. Lazy inside TemplateEngine; it shares the R17 particulars box styles (template variables only:
 * accent / muted / line / soft). C (disbursement schedule) and D (manifest / storage summaries) add
 * `parts/logistics/*.tsx` parts below.
 */
export default function LogisticsBlock({ invoice }: { invoice: InvoiceRecord }) {
  if (!invoice.lg) return null;
  const p = logisticsPaper(invoice.lg);
  if (!p.rows.length && !p.reason && !invoice.lg.disb?.length) return null;
  return (
    <section className={styles.block} aria-label="Shipment" data-logistics-block>
      <dl className={styles.grid}>
        {p.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {p.reason && <p className={styles.decl}>{p.reason}</p>}
      <DisbSchedule lg={invoice.lg} />
    </section>
  );
}
