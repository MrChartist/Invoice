import { useLayoutEffect, useRef } from 'react';
import type { InvoiceRecord } from '../../../../types/invoice';
import { showTicketAnnexure, ticketAnnexRows, ticketAnnexTotals } from '../../../../lib/travel/tv-annexure';
import { usePaper } from '../../paper-context';
import styles from '../annexure-paper.module.css';

/**
 * PENDING 13 (R15-C cut 3): the air-ticket list as a following page ("Ticket annexure to INV/…"), the R3-B4 annexure
 * pattern — from the document's `tv.lines` snapshot only (Critical Rule 3), lazy, never on receipt paper. 'fares' adds
 * the fare split (basic, taxes, the airline's GST: recovered at actual as pure agent, Rule 33 — not our output tax).
 */
export default function TicketAnnexurePage({ invoice }: { invoice: InvoiceRecord }) {
  const cfg = usePaper();
  const ref = useRef<HTMLDivElement>(null);
  // The spacer height is written straight to the element (no state: one pass, no re-render loop).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || cfg.size.autoHeight) return;
    const parent = el.offsetParent as HTMLElement | null;
    const top = el.offsetTop + (parent?.offsetTop ?? 0);
    const rest = top % cfg.size.height;
    const next = rest === 0 ? 0 : Math.max(cfg.size.height - rest, 0);
    el.style.height = `${next}px`;
  });
  if (!showTicketAnnexure(invoice.items, invoice.tv)) return null;
  const rows = ticketAnnexRows(invoice.items, invoice.tv);
  const fares = invoice.tv?.ticket_annexure === 'fares';
  const t = ticketAnnexTotals(rows);
  const m = (n: number | undefined) => cfg.money(n ?? 0, invoice.currency);
  return (
    <>
      <div ref={ref} aria-hidden="true" className={styles.spacer} />
      <section className={styles.annexure} data-ticket-annexure={rows.length}>
        <div className={styles.head}>
          <span className={styles.title}>Ticket annexure to {invoice.invoice_number || 'DRAFT'}</span>
          <span className={styles.meta}>{invoice.client?.name} · {cfg.date(invoice.issue_date)}</span>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th><th>Passenger</th><th>Airline</th><th>Ticket no.</th><th>PNR</th><th>Sector</th><th>Class</th>
              {fares && <><th className={styles.n}>Basic</th><th className={styles.n}>Taxes</th><th className={styles.n}>Airline GST</th><th className={styles.n}>Fare</th></>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.line_id}>
                <td>{i + 1}</td><td>{r.pax ?? ''}</td><td>{r.airline ?? ''}</td><td>{r.ticket_no ?? ''}</td><td>{r.pnr ?? ''}</td><td>{r.sector ?? ''}</td>
                <td>{r.class === 'other' ? 'Other' : 'Economy'}{r.intl ? ' · Intl' : ''}</td>
                {fares && <><td className={styles.n}>{m(r.basic)}</td><td className={styles.n}>{m(r.taxes)}</td><td className={styles.n}>{m(r.airline_gst)}</td><td className={styles.n}>{m(r.fare)}</td></>}
              </tr>
            ))}
            {fares && (
              <tr className={styles.total}>
                <td colSpan={7}>Total ({rows.length} tickets)</td>
                <td className={styles.n}>{m(t.basic)}</td><td className={styles.n}>{m(t.taxes)}</td><td className={styles.n}>{m(t.airline_gst)}</td><td className={styles.n}>{m(t.fare)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className={styles.foot}>Fares are recovered at actual as a pure agent (Rule 33) and are outside our taxable value. Working paper — verify with your CA.</div>
      </section>
    </>
  );
}
