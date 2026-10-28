import type { InvoiceRecord, SenderProfile } from '../../../types/invoice';
import { exportPrintRows } from '../../../lib/trade/exporter';
import styles from './export-block.module.css';

/**
 * R4-C1 export details under the parties: IEC / AD code (from the document's own sender snapshot, Critical Rule 3)
 * and the Incoterms / ports / countries / vessel / marks / payment terms of the document. Lazy inside TemplateEngine;
 * renders nothing without data. Colours come from the paper's accent variable only.
 */
export default function ExportBlock({ invoice, sender }: { invoice: InvoiceRecord; sender: SenderProfile }) {
  const rows = exportPrintRows(invoice, invoice.sender ?? sender);
  if (!rows.length) return null;
  return (
    <section className={styles.block} aria-label="Export details" data-export-block>
      <div className={styles.title}>Export details</div>
      <dl className={styles.grid}>
        {rows.map((r) => (
          <div key={r.key} className={styles.item} data-export-row={r.key}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
