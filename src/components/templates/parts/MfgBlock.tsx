import type { InvoiceRecord } from '../../../types/invoice';
import { mfBoxes } from '../../../lib/mfg/mf-print';
import styles from './mfg-paper.module.css';

/**
 * R13 (MF-A5) job particulars after the parties (before the GST grid; never on receipt paper): customer PO and drawing
 * list, print-job particulars, food / export-authorisation lines — from the document's `mf` snapshot only. Lazy inside
 * TemplateEngine; accent variable only. B / C / D add their arm in `mf-print.ts` `mfBoxes`.
 */
export default function MfgBlock({ invoice }: { invoice: InvoiceRecord }) {
  if (!invoice.mf) return null;
  return (
    <>
      {mfBoxes(invoice.mf).map((b) => (
        <section key={b.title} className={styles.block} aria-label={b.title} data-mfg-block={invoice.mf!.kind ?? 'header'}>
          <div className={styles.title}>{b.title}</div>
          <dl className={styles.grid}>
            {b.rows.map(([k, v]) => (
              <div key={k} className={styles.item}><dt>{k}</dt><dd>{String(v)}</dd></div>
            ))}
          </dl>
        </section>
      ))}
    </>
  );
}
