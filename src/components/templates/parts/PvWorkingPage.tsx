import { useLayoutEffect, useRef, useState } from 'react';
import type { InvoiceRecord } from '../../../types/invoice';
import { num } from '../../../lib/invoice-calc';
import { usePaper } from '../paper-context';
import { PL } from './works-label';
import { pe } from './works-text';
import styles from './works-paper.module.css';

/**
 * R11 (CN-B3): the price-variation working as the following page of the supplementary bill / credit note, printed
 * from the snapshot `boq_terms.cn.pv` only (components, shares, base and current indices, weighted change, M, W and the
 * amount) — never recomputed at print. Same page-break pattern as the abstract page.
 */
export function PvWorkingPage({ invoice }: { invoice: InvoiceRecord }) {
  const cfg = usePaper();
  const ref = useRef<HTMLDivElement>(null);
  const [spacer, setSpacer] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || cfg.size.autoHeight) return;
    const top = el.offsetTop + ((el.offsetParent as HTMLElement | null)?.offsetTop ?? 0);
    const rest = top % cfg.size.height;
    const next = rest === 0 ? 0 : Math.max(cfg.size.height - rest, 0);
    if (Math.abs(next - spacer) > 1) setSpacer(next);
  });
  const pv = invoice.boq_terms?.cn?.pv;
  if (!pv?.rows?.length) return null;
  const bi = cfg.bilingual;
  const m = (x: number) => cfg.money(x, invoice.currency);
  const pct = (x: number) => `${(x * 100).toFixed(4)}%`;
  return (
    <>
      <div ref={ref} aria-hidden="true" className={styles.spacer} style={{ height: spacer }} />
      <section className={styles.page} data-pv-working>
        <div className={styles.pageHead}>
          <span className={styles.pageTitle}>{pe('p.pvTitle', { number: pv.number ?? '', clause: pv.clause ?? '', from: cfg.date(pv.period_from ?? ''), to: cfg.date(pv.period_to ?? '') })}</span>
          <span className={styles.meta}>{invoice.client?.name} · {invoice.invoice_number || 'DRAFT'}</span>
        </div>
        <div className={styles.meta}>{pe('p.pvFormula', { m: num(pv.m_factor), base: pv.base_month ?? '-' })}</div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th><PL k="p.component" bi={bi} /></th>
              <th className={styles.n}><PL k="p.share" bi={bi} /></th>
              <th className={styles.n}><PL k="p.baseIndex" bi={bi} /></th>
              <th className={styles.n}><PL k="p.currentIndex" bi={bi} /></th>
              <th className={styles.n}><PL k="p.weighted" bi={bi} /></th>
            </tr>
          </thead>
          <tbody>
            {pv.rows.map((r) => (
              <tr key={r.key}><td>{r.key}</td><td className={styles.n}>{r.share_pct}</td><td className={styles.n}>{r.base_index}</td><td className={styles.n}>{r.current_index}</td><td className={styles.n}>{pct(r.weighted)}</td></tr>
            ))}
            <tr className={styles.total}><td colSpan={4}>Σ</td><td className={styles.n}>{pct(num(pv.sum))}</td></tr>
          </tbody>
        </table>
        <table className={`${styles.dedTable} ${styles.summary}`}>
          <tbody>
            <tr><td><PL k="p.workValue" bi={bi} /></td><td className={styles.n}>{m(num(pv.work_value))}</td></tr>
            <tr className={styles.net}><td><PL k="p.pvAmount" bi={bi} /> (M × W × Σ)</td><td className={styles.n} data-pv-amount>{m(num(pv.amount))}</td></tr>
          </tbody>
        </table>
        <div className={styles.meta}>{pe('p.pvNote')}</div>
      </section>
    </>
  );
}
