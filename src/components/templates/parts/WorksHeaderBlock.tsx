import type { InvoiceRecord } from '../../../types/invoice';
import { stateByCode } from '../../../lib/india-states';
import { headerRows } from '../../../lib/construction/cn-print';
import { usePaper } from '../paper-context';
import { PL } from './works-label';
import styles from './works-paper.module.css';

/**
 * R11 (CN-A3): the "Contract particulars" box of a works bill — name of work, agreement / work order, client office /
 * engineer, site (address, State), contract value, stipulated / extended completion, bill (RA no. / final), work done
 * from – to, date of measurement, M-book nos. From the document's own snapshot `boq_terms.cn.header` only (Critical
 * Rule 3); empty fields are skipped (`headerRows`). Lazy inside TemplateEngine, never on receipt paper. Accent only.
 */
export function WorksHeaderBlock({ invoice }: { invoice: InvoiceRecord }) {
  const { date, currency, bilingual } = usePaper();
  const rows = headerRows(invoice.boq_terms?.cn?.header, { date: (d) => date(d), money: (n) => currency(n, invoice.currency), state: (c) => stateByCode(c)?.name ?? c });
  if (!rows.length) return null;
  return (
    <section className={styles.box} aria-label="Contract particulars" data-works-header>
      <div className={styles.boxTitle}><PL k="p.particulars" bi={bilingual} /></div>
      <dl className={styles.grid}>
        {rows.map((r) => (
          <div key={r.key} className={r.wide ? `${styles.cell} ${styles.wide}` : styles.cell} data-works-field={r.key}>
            <dt><PL k={`p.${r.key}`} bi={bilingual} /></dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
