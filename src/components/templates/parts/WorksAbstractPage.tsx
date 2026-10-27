import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { InvoiceRecord } from '../../../types/invoice';
import type { CnAbstractRow } from '../../../types/construction-r11';
import { abstractGrand, abstractSections } from '../../../lib/construction/cn-abstract';
import { deductionsTotal, netPayableOf } from '../../../lib/construction/cn-print';
import { formatQuantity } from '../../../lib/utils';
import { num } from '../../../lib/invoice-calc';
import { usePaper } from '../paper-context';
import { PL } from './works-label';
import { pe } from './works-text';
import styles from './works-paper.module.css';

/**
 * R11 (CN-A4): the abstract of cost as the following page of the same document ("Abstract of cost — 4th RA bill to
 * INV/…"), so the PDF, the share link and every print copy carry it. Sections A. BOQ items, B. extra items,
 * C. substituted items, D. deviation quantities with sub-totals; then gross this bill, GST, bill amount, deductions and
 * net payable. Printed from the snapshot `boq_terms.cn.abstract` only — the bill as certified. The R3-B4 annexure page
 * pattern: `break-before: page` for printing, a spacer to the next page boundary for the sliced PDF capture.
 */
export function WorksAbstractPage({ invoice }: { invoice: InvoiceRecord }) {
  const cfg = usePaper();
  const ref = useRef<HTMLDivElement>(null);
  const [spacer, setSpacer] = useState(0);
  const cn = invoice.boq_terms?.cn;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || cfg.size.autoHeight) return;
    const parent = el.offsetParent as HTMLElement | null;
    const top = el.offsetTop + (parent?.offsetTop ?? 0);
    const page = cfg.size.height;
    const rest = top % page;
    const next = rest === 0 ? 0 : Math.max(page - rest, 0);
    if (Math.abs(next - spacer) > 1) setSpacer(next);
  });

  const rows = cn?.abstract;
  if (!rows?.length || cn?.paper === 'summary') return null;
  const bi = cfg.bilingual;
  const cur = invoice.currency;
  const m = (n: number) => cfg.money(n, cur);
  const q = (n: number) => formatQuantity(n);
  const grand = abstractGrand(rows);
  const deds = invoice.ra_deductions ?? [];
  const row = (r: CnAbstractRow) => (
    <tr key={r.id} data-abstract-row={r.kind}>
      <td>{r.ref}</td>
      <td>{r.description}{r.approval ? <span className={styles.sub}> · approval {r.approval}</span> : null}</td>
      <td>{r.unit}</td>
      <td className={styles.n}>{r.boq_qty ? q(r.boq_qty) : ''}</td>
      <td className={styles.n}>{m(r.rate)}</td>
      <td className={styles.n}>{q(r.prev_qty)}</td>
      <td className={styles.n}>{m(r.prev_amount)}</td>
      <td className={styles.n}>{q(r.this_qty)}</td>
      <td className={styles.n}>{m(r.this_amount)}</td>
      <td className={styles.n}>{q(r.cum_qty)}</td>
      <td className={styles.n}>{m(r.cum_amount)}</td>
      <td className={styles.n}>{r.pct ? `${r.pct}%` : ''}</td>
      <td>{r.mb ?? ''}</td>
    </tr>
  );
  return (
    <>
      <div ref={ref} aria-hidden="true" className={styles.spacer} style={{ height: spacer }} />
      <section className={styles.page} data-works-abstract>
        <div className={styles.pageHead}>
          <span className={styles.pageTitle}>{pe('p.abstractTitle', { bill: cn?.header?.ra_label ?? `RA bill no. ${invoice.ra_no ?? ''}`, number: invoice.invoice_number || 'DRAFT' })}</span>
          <span className={styles.meta}>{invoice.client?.name} · {cfg.date(invoice.issue_date)}</span>
        </div>
        {cn?.header?.name_of_work && <div className={styles.meta}>{pe('p.nameOfWork')}: {cn.header.name_of_work}</div>}
        <table className={styles.table}>
          <thead>
            <tr>
              <th><PL k="p.itemNo" bi={bi} /></th>
              <th><PL k="p.description" bi={bi} /></th>
              <th><PL k="p.unit" bi={bi} /></th>
              <th className={styles.n}><PL k="p.boqQty" bi={bi} /></th>
              <th className={styles.n}><PL k="p.rate" bi={bi} /></th>
              <th className={styles.n}><PL k="p.prevQty" bi={bi} /></th>
              <th className={styles.n}><PL k="p.prevAmt" bi={bi} /></th>
              <th className={styles.n}><PL k="p.thisQty" bi={bi} /></th>
              <th className={styles.n}><PL k="p.thisAmt" bi={bi} /></th>
              <th className={styles.n}><PL k="p.cumQty" bi={bi} /></th>
              <th className={styles.n}><PL k="p.cumAmt" bi={bi} /></th>
              <th className={styles.n}><PL k="p.pct" bi={bi} /></th>
              <th><PL k="p.mb" bi={bi} /></th>
            </tr>
          </thead>
          <tbody>
            {abstractSections(rows).map((s) => (
              <SectionRows key={s.kind} title={s.title} rows={s.rows.map(row)} prev={m(s.prev)} cur={m(s.this)} cum={m(s.cum)} />
            ))}
            <tr className={styles.total}>
              <td colSpan={6}><PL k="p.abstractTotal" bi={bi} /></td>
              <td className={styles.n}>{m(grand.prev)}</td>
              <td />
              <td className={styles.n}>{m(grand.this)}</td>
              <td />
              <td className={styles.n}>{m(grand.cum)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
        <table className={`${styles.dedTable} ${styles.summary}`}>
          <tbody>
            <tr><td><PL k="p.grossThis" bi={bi} /></td><td className={styles.n}>{m(num(invoice.taxable_value))}</td></tr>
            <tr><td><PL k="p.gst" bi={bi} /></td><td className={styles.n}>{m(num(invoice.tax_amount))}</td></tr>
            <tr><td><PL k="p.billTotal" bi={bi} /></td><td className={styles.n}>{m(num(invoice.total))}</td></tr>
            {deds.map((d, i) => <tr key={`${d.kind}-${i}`}><td>Less: {d.label}</td><td className={styles.n}>-{m(d.amount)}</td></tr>)}
            {deds.length > 0 && <tr><td><PL k="p.totalDeductions" bi={bi} /></td><td className={styles.n}>-{m(deductionsTotal(deds))}</td></tr>}
            <tr className={styles.net}><td><PL k="p.net" bi={bi} /></td><td className={styles.n}>{m(netPayableOf(invoice))}</td></tr>
          </tbody>
        </table>
        <div className={styles.meta}>{pe('p.workingPaper')}</div>
      </section>
    </>
  );
}

function SectionRows({ title, rows, prev, cur, cum }: { title: string; rows: ReactNode[]; prev: string; cur: string; cum: string }) {
  return (
    <>
      <tr className={styles.section}><td colSpan={13}>{title}</td></tr>
      {rows}
      <tr className={styles.total}>
        <td colSpan={6}>{pe('p.subtotal')}</td>
        <td className={styles.n}>{prev}</td>
        <td />
        <td className={styles.n}>{cur}</td>
        <td />
        <td className={styles.n}>{cum}</td>
        <td colSpan={2} />
      </tr>
    </>
  );
}
