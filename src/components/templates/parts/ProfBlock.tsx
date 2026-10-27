import type { InvoiceRecord } from '../../../types/invoice';
import { psBoxes } from '../../../lib/prof/ps-print';
import styles from './prof-paper.module.css';

/**
 * R14 (PS-A5) professional particulars after the parties (before the GST grid; never on receipt paper): matter code /
 * name / court / case no., engagement number and model, the billing basis and — for exports — purpose code and the
 * export check, from the document's `ps` snapshot only. Lazy inside TemplateEngine; accent variable only. B / C / D add
 * their arm in `ps-print.ts` `psBoxes`.
 */
export default function ProfBlock({ invoice }: { invoice: InvoiceRecord }) {
  if (!invoice.ps) return null;
  return (
    <>
      {psBoxes(invoice.ps).map((b) => (
        <section key={b.title} className={styles.block} aria-label={b.title} data-prof-block={invoice.ps!.kind ?? 'fee'}>
          <div className={styles.title}>{b.title}</div>
          <dl className={styles.grid}>
            {b.rows.map(([k, v]) => (
              <div key={k} className={styles.item}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </section>
      ))}
    </>
  );
}
