import type { InvoiceRecord } from '../../../types/invoice';
import { societyPaper } from '../../../lib/society/hs-print';
import { formatMoney } from '../../../lib/utils';
import styles from './society-paper.module.css';

/**
 * R18-A4 society particulars after the parties (after the manpower block, before the GST grid; never on receipt
 * paper): unit, wing, area, member(s), period and due date, the heads table (head, basis, amount; ≤ 16 rows), arrears
 * brought forward (memo) and interest on arrears (C1), the regime sentence (B2) and, when `hs.explain` is set, "How
 * your bill is worked out" — from the document's `hs` snapshot only. Lazy inside TemplateEngine; accent variable only.
 * B–D add their parts (fund note …) as `parts/society/*.tsx` arms below.
 */
export default function SocietyBlock({ invoice }: { invoice: InvoiceRecord }) {
  if (!invoice.hs) return null;
  const p = societyPaper(invoice.hs, formatMoney);
  if (!p.rows.length && !p.heads.length && !p.decl) return null;
  return (
    <section className={styles.block} aria-label="Society" data-society-block={invoice.hs.regime ?? ''}>
      {p.rows.length > 0 && (
        <dl className={styles.grid}>
          {p.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {p.heads.length > 0 && (
        <table className={styles.heads} data-society-heads>
          <thead><tr><th>Head</th><th>Basis</th><th>Amount</th></tr></thead>
          <tbody>
            {p.heads.map((h) => <tr key={h.head_id}><td>{h.name}</td><td>{h.basis}</td><td>{formatMoney(h.amount)}</td></tr>)}
          </tbody>
        </table>
      )}
      {p.arrears && <p className={styles.note} data-society-arrears>{p.arrears}</p>}
      {p.interest && <p className={styles.note} data-society-interest>{p.interest}</p>}
      {p.decl && <p className={styles.decl} data-society-decl>{p.decl}</p>}
      {p.explain.length > 0 && (
        <p className={styles.note} data-society-explain>
          <strong>How your bill is worked out: </strong>
          {p.explain.map(([h, b]) => `${h} — ${b}`).join('; ')}.
        </p>
      )}
    </section>
  );
}
