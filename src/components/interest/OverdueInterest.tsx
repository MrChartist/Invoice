import { Percent } from 'lucide-react';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import {
  INTEREST_DISCLAIMER,
  buildInterestItem,
  describeBasis,
  getLateFeeConfig,
  type InterestResult,
} from '../../lib/interest';
import { useInterest } from './useInterest';
import { termsMentionInterest } from '../../lib/reminders';
import { formatCurrency, formatDate } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import styles from './interest.module.css';

function whenText(r: InterestResult, asOf?: string): string {
  if (r.settled && r.settled_on) return `to payment on ${formatDate(r.settled_on)}`;
  return asOf ? `as of ${formatDate(asOf)}` : 'as of today';
}

/** A one-line "Interest accrued ₹X (as of today)" pill; renders nothing when there is none. */
export function InterestChip({ invoice, asOf }: { invoice: InvoiceRecord; asOf?: string }) {
  const r = useInterest(invoice, asOf);
  if (!r.eligible || !(r.amount > 0)) return null;
  return (
    <span className={styles.chip} title={INTEREST_DISCLAIMER}>
      <Percent size={12} aria-hidden="true" />
      <span>
        Interest accrued <span className={styles.chipAmount}>{formatCurrency(r.amount, invoice.currency || 'INR')}</span>{' '}
        <span className={styles.chipWhen}>({whenText(r, asOf)})</span>
      </span>
    </span>
  );
}

export interface OverdueInterestProps {
  invoice: InvoiceRecord;
  /** YYYY-MM-DD; defaults to today. */
  asOf?: string;
  /**
   * When given, a button "Add as an Interest line" appears. The handler should put the item on a
   * NEW invoice / draft (never silently on the one it was computed from).
   */
  onAddLine?: (item: InvoiceItem) => void;
}

/** Chip + how it was worked out + the legal-hygiene wording + the explicit add-to-invoice action. */
export function OverdueInterest({ invoice, asOf, onAddLine }: OverdueInterestProps) {
  const r = useInterest(invoice, asOf);
  const config = getLateFeeConfig(invoice.sender?.id);
  if (!r.eligible || !(r.amount > 0)) return null;
  const cur = invoice.currency || 'INR';
  const mentioned = termsMentionInterest(invoice);
  return (
    <div className={styles.panel}>
      <InterestChip invoice={invoice} asOf={asOf} />
      <details className={styles.details}>
        <summary>How this was worked out</summary>
        <p className={styles.note}>{describeBasis(config)}.</p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th className={styles.num}>Days</th>
                <th className={styles.num}>On</th>
                <th className={styles.num}>Interest</th>
              </tr>
            </thead>
            <tbody>
              {r.segments.map((s) => (
                <tr key={s.from}>
                  <td>{formatDate(s.from)}</td>
                  <td>{formatDate(s.to)}</td>
                  <td className={styles.num}>{s.days}</td>
                  <td className={styles.num}>{formatCurrency(s.balance, cur)}</td>
                  <td className={styles.num}>{formatCurrency(s.amount, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.capped && r.cap_amount !== undefined && (
          <p className={styles.note}>Limited by your cap of {formatCurrency(r.cap_amount, cur)}.</p>
        )}
        <p className={styles.note}>{INTEREST_DISCLAIMER}</p>
        {!mentioned && (
          <p className={styles.warn}>
            This invoice&rsquo;s terms do not mention interest or late fees, so it may not be claimable. Reminders
            will not mention it.
          </p>
        )}
      </details>
      {onAddLine && (
        <div className={styles.actions}>
          <button
            type="button"
            className={`${controls.btnOutline} ${controls.btnSm}`}
            onClick={() => {
              const item = buildInterestItem(r, config, invoice.invoice_number);
              if (item) onAddLine(item);
            }}
          >
            Add as an &ldquo;Interest&rdquo; line on a new invoice
          </button>
        </div>
      )}
    </div>
  );
}
