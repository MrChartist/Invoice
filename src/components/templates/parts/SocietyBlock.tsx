import type { InvoiceRecord } from '../../../types/invoice';
import { societyPaper } from '../../../lib/society/hs-print';
import { formatMoney } from '../../../lib/utils';
import styles from './manpower-paper.module.css';

/**
 * R18-A4 society particulars after the parties (after the manpower block, before the GST grid; never on receipt
 * paper): unit, wing, area, member(s), period and due date, the heads table (head, basis, amount; ≤ 16 rows) and the
 * regime sentence (`hs.decl`, B2) and, with `hs.explain`, the "How your bill is worked out" footnote — from the document's `hs` snapshot only. Lazy inside TemplateEngine; it shares the
 * R17 particulars box styles (template variables only: accent / muted / line / soft). C (arrears, interest) and D (fund
 * note) add their parts as `parts/society/*.tsx` below.
 */
export default function SocietyBlock({ invoice }: { invoice: InvoiceRecord }) {
  if (!invoice.hs) return null;
  const p = societyPaper(invoice.hs);
  if (!p.rows.length && !p.heads.length && !invoice.hs.decl) return null;
  return (
    <section className={styles.block} aria-label="Society" data-society-block={invoice.hs.regime ?? ''}>
      <dl className={styles.grid}>
        {p.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {p.heads.length > 0 && (
        <table className={styles.posts}>
          <thead><tr><th>Head</th><th>Basis</th><th>Amount</th></tr></thead>
          <tbody>
            {p.heads.map((h) => <tr key={h.head_id}><td>{h.name}</td><td>{h.basis}</td><td>{formatMoney(h.amount)}</td></tr>)}
          </tbody>
        </table>
      )}
      {invoice.hs.decl && <p className={styles.decl}>{invoice.hs.decl}</p>}
      {p.explain?.length ? <div className={styles.decl} data-society-explain><strong>How your bill is worked out</strong>{p.explain.map((l) => <div key={l}>{l}</div>)}</div> : null}
    </section>
  );
}
