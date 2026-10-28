import type { InvoiceRecord } from '../../../types/invoice';
import { mpPaper } from '../../../lib/manpower/mp-print';
import { formatMoney } from '../../../lib/utils';
import styles from './manpower-paper.module.css';
import DutyAnnex from './manpower/DutyAnnex';

/**
 * R17-A4 manpower particulars after the parties (after the travel block, before the GST grid; never on receipt paper):
 * site, service month, the post summary (post, SAC, heads, duties, rate, amount; ≤ 12 rows) and the regime sentence —
 * from the document's `mp` snapshot only. Lazy inside TemplateEngine; accent variable only. B–D add their parts
 * (duty annexure, TDS line, compliance refs, arrears) as `parts/manpower/*.tsx` arms below.
 */
export default function ManpowerBlock({ invoice }: { invoice: InvoiceRecord }) {
  if (!invoice.mp) return null;
  const p = mpPaper(invoice.mp);
  if (!p.rows.length && !p.decl && !p.posts.length) return null;
  const n = (v?: number) => (v == null ? '' : formatMoney(v));
  return (
    <section className={styles.block} aria-label="Manpower" data-manpower-block={invoice.mp.regime ?? ''}>
      {p.rows.length > 0 && (
        <dl className={styles.grid}>
          {p.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {p.posts.length > 0 && (
        <table className={styles.posts} data-manpower-posts>
          <thead><tr><th>Post</th><th>SAC</th><th>Heads</th><th>Duties</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>
            {p.posts.map((r, i) => <tr key={i}><td>{[r.site, r.post].filter(Boolean).join(' · ')}</td><td>{r.sac}</td><td>{r.heads}</td><td>{r.duties ?? ''}</td><td>{n(r.rate)}</td><td>{n(r.amount)}</td></tr>)}
          </tbody>
        </table>
      )}
      {p.decl && <p className={styles.decl} data-manpower-decl>{p.decl}</p>}
      <DutyAnnex mp={invoice.mp} />
    </section>
  );
}
