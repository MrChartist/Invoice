import type { InvoiceRecord } from '../../../types/invoice';
import { partyBalanceRows } from '../../../lib/party-balance';
import { usePaper } from '../paper-context';
import { cn } from '../../../lib/utils';
import styles from '../invoice-paper.module.css';

/**
 * "Previous balance ₹A + This bill ₹B = Total due ₹C" (8.5, daily khata loop). Printed only when the
 * design turns it on AND the bill carries its own `party_balance_snapshot` — taken when the bill was
 * first issued, so a reprint never changes (Critical Rule 3); legacy bills print nothing. Accent
 * variable only. The wording stays English on paper, like the other printed labels.
 */
export function PartyBalanceBlock({ invoice, compact }: { invoice: InvoiceRecord; compact?: boolean }) {
  const { show, currency } = usePaper();
  if (!show.partyBalance) return null;
  const rows = partyBalanceRows(invoice.party_balance_snapshot);
  if (!rows) return null;
  const m = (n: number) => `${currency(Math.abs(n), 'INR')}${n < -0.004 ? ' Cr' : ''}`;
  return (
    <section className={cn(styles.partyBal, compact && styles.partyBalCompact)} aria-label="Party balance" data-party-balance>
      <div className={styles.partyBalRow}><span>{rows.previous < 0 ? 'Previous balance (advance)' : 'Previous balance'}</span><span>{m(rows.previous)}</span></div>
      <div className={styles.partyBalRow}><span>+ This bill</span><span>{m(rows.bill)}</span></div>
      {rows.paid > 0.004 && <div className={styles.partyBalRow}><span>− Received now</span><span>{m(rows.paid)}</span></div>}
      <div className={cn(styles.partyBalRow, styles.partyBalTotal)}><span>{rows.total < -0.004 ? 'Advance left' : 'Total due'}</span><span>{m(rows.total)}</span></div>
    </section>
  );
}
