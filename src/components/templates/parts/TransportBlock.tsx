import type { InvoiceRecord } from '../../../types/invoice';
import { transportRows } from '../../../lib/transport';
import { usePaper } from '../paper-context';
import styles from '../invoice-paper.module.css';

/**
 * Transport / dispatch details (P1-24) for the free-form layouts: mode, transporter, vehicle,
 * LR / RR and e-Way bill numbers. Reads the document's own snapshot only; nothing is printed
 * when the document has no transport details, so older documents look exactly as before.
 */
export function TransportBlock({ invoice, skipEway, compact }: { invoice: InvoiceRecord; skipEway?: string; compact?: boolean }) {
  const { date } = usePaper();
  const rows = transportRows(invoice.transport, (d) => date(d), { skipEway });
  if (rows.length === 0) return null;
  return (
    <section className={compact ? styles.extraCompact : styles.extra} aria-label="Transport details" data-transport>
      {!compact && <div className={styles.eyebrow}>Transport</div>}
      <dl className={styles.extraGrid}>
        {rows.map((r) => (
          <div key={r.key} className={styles.extraItem} data-transport-row={r.key}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
