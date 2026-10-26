import { useLayoutEffect, useRef, useState } from 'react';
import type { InvoiceRecord } from '../../../types/invoice';
import type {} from '../../../types/service-r3';
import { annexureTotals } from '../../../lib/annexure';
import { usePaper } from '../paper-context';
import styles from './annexure-paper.module.css';

const hrs = (m: number) => (Math.round((Number(m) || 0) / 0.6) / 100).toFixed(2);

/**
 * R3-B4: the timesheet / expense annexure printed as a following page ("Annexure to INV/…"), from the
 * invoice's own snapshot only (Critical Rule 3). Rendered lazily by TemplateEngine, never on thermal
 * paper. `break-before: page` starts it on a new sheet when printing; for the PDF (sliced at fixed page
 * heights) a spacer pushes it to the next page boundary.
 */
export default function AnnexureBlock({ invoice }: { invoice: InvoiceRecord }) {
  const cfg = usePaper();
  const ref = useRef<HTMLDivElement>(null);
  const [spacer, setSpacer] = useState(0);
  const a = invoice.annexure;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || cfg.size.autoHeight) return;
    // Offset of the block inside the paper (ignores preview scaling transforms).
    const parent = el.offsetParent as HTMLElement | null;
    const top = el.offsetTop + (parent?.offsetTop ?? 0);
    const page = cfg.size.height;
    const rest = top % page;
    const next = rest === 0 ? 0 : Math.max(page - rest, 0);
    if (Math.abs(next - spacer) > 1) setSpacer(next);
  });

  if (!a || (!a.rows.length && !a.expenses?.length)) return null;
  const t = annexureTotals(a);
  const money = (n: number) => cfg.currency(n, invoice.currency);

  return (
    <>
      <div ref={ref} aria-hidden="true" className={styles.spacer} style={{ height: spacer }} data-annexure-spacer />
      <section className={styles.annexure} data-annexure>
        <div className={styles.head}>
          <span className={styles.title}>Annexure to {invoice.invoice_number || 'DRAFT'}</span>
          <span className={styles.meta}>
            {invoice.client?.name} · {cfg.date(invoice.issue_date)}
          </span>
        </div>
        {a.rows.length > 0 && (
          <>
            <div className={styles.section}>Timesheet</div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Who</th>
                  <th>Project / task</th>
                  <th>Description</th>
                  <th className={styles.n}>Hours</th>
                  <th className={styles.n}>Billed h</th>
                  <th className={styles.n}>Rate</th>
                  <th className={styles.n}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {a.rows.map((r, i) => (
                  <tr key={r.ref ?? i}>
                    <td>{cfg.date(r.date)}</td>
                    <td>{r.who ?? ''}</td>
                    <td>{[r.project, r.task].filter(Boolean).join(' › ')}</td>
                    <td>{r.description}</td>
                    <td className={styles.n}>{hrs(r.minutes)}</td>
                    <td className={styles.n}>{hrs(r.billed_minutes)}</td>
                    <td className={styles.n}>{cfg.money(r.rate, invoice.currency)}</td>
                    <td className={styles.n}>{cfg.money(r.amount, invoice.currency)}</td>
                  </tr>
                ))}
                <tr className={styles.total}>
                  <td colSpan={4}>Total time</td>
                  <td className={styles.n}>{hrs(t.minutes)}</td>
                  <td className={styles.n}>{hrs(t.billed_minutes)}</td>
                  <td />
                  <td className={styles.n}>{money(t.time_amount)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
        {a.expenses && a.expenses.length > 0 && (
          <>
            <div className={styles.section}>Expenses</div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>Description</th>
                  <th className={styles.n}>Markup</th>
                  <th className={styles.n}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {a.expenses.map((x, i) => (
                  <tr key={x.ref ?? i}>
                    <td>{cfg.date(x.date)}</td>
                    <td>{x.vendor}</td>
                    <td>
                      {x.description}
                      {x.pure_agent && <span className={styles.flag}> · pure agent (Rule 33), outside the taxable value</span>}
                    </td>
                    <td className={styles.n}>{x.markup_pct ? `${x.markup_pct}%` : '–'}</td>
                    <td className={styles.n}>{cfg.money(x.amount, invoice.currency)}</td>
                  </tr>
                ))}
                <tr className={styles.total}>
                  <td colSpan={4}>Total expenses</td>
                  <td className={styles.n}>{money(t.expense_amount)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
        <div className={styles.foot}>
          Totals tie to the time and expense lines of {invoice.invoice_number || 'this document'} ({money(t.total)} before GST). Hours are billed hours after the billing step.
        </div>
      </section>
    </>
  );
}
