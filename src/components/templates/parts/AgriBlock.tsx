import type { InvoiceRecord } from '../../../types/invoice';
import { agriRows } from './agri-rows';
import styles from './agri-paper.module.css';

/**
 * R12 (AG-A5) agri particulars after the parties: a ruled box per kind — storage (rent), dealer (inputs), milk, custom
 * milling — read from the document's `ag` snapshot only (never recomputed; old documents without `ag` print as before).
 * Lazy inside TemplateEngine; accent variable only. B / C / D refine their own rows here (one arm each).
 */
export default function AgriBlock({ invoice }: { invoice: InvoiceRecord }) {
  if (!invoice.ag) return null;
  return (
    <>
      {agriRows(invoice.ag).map((b) => (
        <section key={b.title} className={styles.block} aria-label={b.title} data-agri-block={invoice.ag!.kind}>
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
