import type { InvoiceRecord } from '../../../types/invoice';
import { psAnnexure } from '../../../lib/prof/ps-print';
import styles from './prof-paper.module.css';

/**
 * R14 (PS-A5) professional annexure as a following page, after the R3-B4 timesheet annexure: the matter's time by
 * timekeeper (A), the disbursement schedule (B1), stage computation (B4) and media schedule (B5) — from the snapshot
 * only, never recomputed. Nothing without a section.
 */
export default function ProfAnnexurePage({ invoice }: { invoice: InvoiceRecord }) {
  const sections = psAnnexure(invoice);
  if (!sections.length) return null;
  return (
    <section className={styles.page} data-prof-annexure>
      <div className={styles.title}>Annexure: {invoice.invoice_number || 'draft'}</div>
      {sections.map((s) => (
        <table key={s.title} className={styles.table} aria-label={s.title}>
          <caption className={styles.title}>{s.title}</caption>
          <thead><tr>{s.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{s.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      ))}
    </section>
  );
}
