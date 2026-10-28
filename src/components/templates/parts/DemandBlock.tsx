import type { InvoiceRecord } from '../../../types/invoice';
import { usePaper } from '../paper-context';
import { PL } from './works-label';
import styles from './works-paper.module.css';

/**
 * R11 (CN-C3): the demand letter part of a builder's stage demand — unit / tower / carpet area / RERA no., the stage and
 * its %, "Agreement value · Demanded so far · Received · Balance due", the one-third land working (or the after-CC "not
 * a supply" note), interest on delay, the payment-plan stages and "Pay only to this account". Read only from the
 * document's own snapshot `boq_terms.cn.demand` (Critical Rule 3). Accent variables only.
 */
export function DemandBlock({ invoice }: { invoice: InvoiceRecord }) {
  const { currency, bilingual: bi } = usePaper();
  const d = invoice.boq_terms?.cn?.demand;
  if (!d) return null;
  const m = (n: number | undefined) => currency(Number(n) || 0, invoice.currency);
  // Earlier demands (incl. GST) + this document − received so far (a working figure).
  const balance = Math.max((Number(d.previously_billed) || 0) + (Number(invoice.total) || 0) - (Number(d.previously_received) || 0), 0);
  const acc = d.account ? `${d.account.name}${d.account.no ? ` · A/c ${d.account.no}` : ''}${d.account.ifsc ? ` · IFSC ${d.account.ifsc}` : ''}` : '';
  return (
    <section className={styles.box} aria-label="Demand letter" data-demand>
      <div className={styles.boxTitle}><PL k="p.demand" vars={{ number: d.number ?? '' }} bi={bi} /></div>
      <div className={styles.declare}>
        <p><PL k="p.unitLine" vars={{ unit: d.unit ?? '', tower: d.tower ? `, ${d.tower}` : '', carpet: d.carpet_sqm ?? '', booking: d.booking_no ?? '' }} bi={bi} /></p>
        {d.rera_no && <p><PL k="p.rera" vars={{ no: d.rera_no }} bi={bi} /></p>}
        <p><strong><PL k="p.stageLine" vars={{ stage: d.stage_label ?? '', pct: d.pct ?? '' }} bi={bi} /></strong></p>
      </div>
      <table className={styles.dedTable}>
        <tbody>
          <tr><td><PL k="p.agreementValue" bi={bi} /></td><td className={styles.n}>{m(d.agreement_value)}</td></tr>
          <tr><td><PL k="p.demanded" bi={bi} /></td><td className={styles.n}>{m(d.demanded)}</td></tr>
          <tr><td><PL k="p.receivedSoFar" bi={bi} /></td><td className={styles.n}>{m(d.previously_received)}</td></tr>
          <tr data-demand-balance><td><PL k="p.balanceDue" bi={bi} /></td><td className={styles.n}>{m(balance)}</td></tr>
        </tbody>
      </table>
      <div className={styles.declare}>
        {d.cc_after ? <p data-demand-cc><PL k="p.afterCc" bi={bi} /></p> : d.land && (
          <p data-demand-land><PL k="p.land" vars={{ land: m(d.land.land), taxable: m(d.land.taxable), half: d.land.notif / 2, notif: d.land.notif, eff: d.land.effective }} bi={bi} /></p>
        )}
        {d.interest && <p><PL k="p.interest" vars={{ days: d.interest.days, rate: d.interest.rate }} bi={bi} /></p>}
        {!!d.plan?.length && <p data-demand-plan><strong><PL k="p.plan" bi={bi} /></strong>: {d.plan.map((s) => `${s.label} ${s.pct}%`).join(' · ')}</p>}
        {acc && <p data-demand-account><strong><PL k="p.payTo" vars={{ acc }} bi={bi} /></strong></p>}
        <p><PL k="p.demandNote" bi={bi} /></p>
      </div>
    </section>
  );
}

