import type { InvoiceRecord, SenderProfile } from '../../../types/invoice';
import { amountInWordsHi } from '../../../lib/amount-in-words-hi';
import { cnDeclarations, deductionNotes, deductionsTotal, groupDeductions, netPayableOf, netPayableWords } from '../../../lib/construction/cn-print';
import { receivableTotal } from '../../../lib/rcm';
import { usePaper } from '../paper-context';
import { SupplyDeclaration } from './SupplyDeclaration';
import { PL } from './works-label';
import { pe } from './works-text';
import styles from './works-paper.module.css';

/**
 * R11 (CN-A5): under the totals of a works bill — the deductions and recoveries grouped Statutory / Recoveries / Held /
 * Other (label, base, rate, amount), Net payable in figures and words, the notes (GST on the full value, GST TDS u/s 51,
 * labour cess), the works-contract declaration, then the contractor's certificate with the signature and, for
 * government work, the "Measured by / Checked by / Passed for payment" boxes. Every figure comes from the document's
 * snapshot (`ra_deductions`, `ra_net_payable`, `boq_terms.cn`), never recomputed at print.
 */
export function WorksDeductionsBlock({ invoice, sender }: { invoice: InvoiceRecord; sender: SenderProfile }) {
  const { currency, show, bilingual: bi } = usePaper();
  const cur = invoice.currency;
  const m = (n: number) => currency(n, cur);
  const cn = invoice.boq_terms?.cn;
  const groups = groupDeductions(invoice.ra_deductions);
  const hasDeds = groups.length > 0;
  const net = netPayableOf(invoice);
  const notes = [...deductionNotes(invoice.ra_deductions, m), ...cnDeclarations(cn, !!invoice.ra_no)];
  const cert = cn?.certificate;
  const from = invoice.sender ?? sender; // Critical Rule 3: the document's own sender snapshot
  return (
    <>
      {hasDeds && (
        <section className={styles.deds} aria-label="Deductions and net payable" data-works-deductions>
          <div className={styles.notes}>
            <strong><PL k="p.deductions" bi={bi} /></strong>
            <span>{pe('p.workingPaper')}</span>
          </div>
          <div>
            <table className={styles.dedTable}>
              <tbody>
                <tr>
                  <td><PL k="p.billTotal" bi={bi} /></td>
                  <td className={styles.n}>{m(receivableTotal(invoice))}</td>
                </tr>
                {groups.map((g) => (
                  <GroupRows key={g.group} g={g} m={m} bi={bi} />
                ))}
                <tr>
                  <td><PL k="p.totalDeductions" bi={bi} /></td>
                  <td className={styles.n}>-{m(deductionsTotal(invoice.ra_deductions))}</td>
                </tr>
                <tr className={styles.net} data-net-payable>
                  <td><PL k="p.net" bi={bi} /></td>
                  <td className={styles.n}>{m(net)}</td>
                </tr>
              </tbody>
            </table>
            {show.words && (
              <div className={styles.words} data-net-words>
                {pe('p.words')}: {netPayableWords(net, cur)}
                {bi && <span className={styles.hi} lang="hi">{amountInWordsHi(net, cur)}</span>}
              </div>
            )}
          </div>
        </section>
      )}
      {notes.map((n) => <SupplyDeclaration key={n} text={n} />)}
      {cert && (cert.text || cert.boxes) && (
        <section className={styles.cert} aria-label="Contractor's certificate" data-works-certificate>
          {cert.text && (
            <div className={styles.certText}>
              <strong><PL k="p.certificate" bi={bi} /></strong>
              <div>{cert.text}</div>
            </div>
          )}
          <div className={styles.signRow}>
            <div className={styles.signBox}>
              <span className={styles.signHead}>{pe('p.forContractor', { name: from?.companyName || 'the contractor' })}</span>
              {show.signature && from?.signature ? <img src={from.signature} alt="Signature" className={styles.signImg} /> : <span />}
              <span className={styles.signLine}><PL k="p.signatory" bi={bi} /></span>
            </div>
            {cert.boxes && (['p.measuredBy', 'p.checkedBy', 'p.passedFor'] as const).map((k) => (
              <div key={k} className={styles.signBox} data-signoff={k.slice(2)}>
                <span className={styles.signHead}><PL k={k} bi={bi} /></span>
                <span />
                <span className={styles.signLine}><PL k="p.nameDesig" bi={bi} /></span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function GroupRows({ g, m, bi }: { g: ReturnType<typeof groupDeductions>[number]; m: (n: number) => string; bi: boolean }) {
  return (
    <>
      <tr className={styles.group}>
        <td colSpan={2}><PL k={`p.g.${g.group}`} bi={bi} /></td>
      </tr>
      {g.rows.map((d, i) => (
        <tr key={`${d.kind}-${i}`} data-ded-row={d.kind}>
          <td>
            Less: {d.label}
            {d.base > 0 && <span className={styles.sub}> ({pe('p.on', { base: m(d.base) })}{d.rate && !d.label.includes('%') ? ` @ ${d.rate}%` : ''})</span>}
          </td>
          <td className={styles.n}>-{m(d.amount)}</td>
        </tr>
      ))}
    </>
  );
}
