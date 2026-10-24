import { formatCustomValue, printableValues } from '../../../lib/custom-fields';
import type { CustomFieldValue } from '../../../types/custom-fields';
import type { InvoiceRecord } from '../../../types/invoice';
import { usePaper } from '../paper-context';
import styles from '../invoice-paper.module.css';

/**
 * "Extra details" (6.23): the document's printable custom fields, label + value as snapshotted
 * on the invoice when it was saved. Renders nothing when there are none, so documents without
 * custom fields print exactly as before. Colours come from the template's accent variable.
 */
export function CustomFieldsBlock({ invoice, compact }: { invoice: InvoiceRecord; compact?: boolean }) {
  const { date } = usePaper();
  const rows = printableValues(invoice.custom_values);
  if (rows.length === 0) return null;
  return (
    <section className={compact ? styles.extraCompact : styles.extra} aria-label="Extra details" data-custom-fields>
      {!compact && <div className={styles.eyebrow}>Details</div>}
      <dl className={styles.extraGrid}>
        {rows.map((v) => (
          <div key={v.id} className={styles.extraItem}>
            <dt>{v.label}</dt>
            <dd>{formatCustomValue(v, (d) => date(d))}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Printable item fields under a line's name: "Batch: A12 · Expiry: 1 Jan 2027". */
export function ItemCustomLine({ values }: { values: CustomFieldValue[] | undefined }) {
  const { date } = usePaper();
  const rows = printableValues(values);
  if (rows.length === 0) return null;
  return (
    <div className={styles.itemDesc}>
      {rows.map((v) => `${v.label}: ${formatCustomValue(v, (d) => date(d))}`).join(' · ')}
    </div>
  );
}
