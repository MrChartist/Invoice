import { Percent } from 'lucide-react';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import {
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
import { useT } from '../../i18n';
import { intT } from '../../i18n/areas/interest';

function whenText(r: InterestResult, asOf?: string): string {
  if (r.settled && r.settled_on) return intT('toPayment', { date: formatDate(r.settled_on) });
  return asOf ? intT('asOfDate', { date: formatDate(asOf) }) : intT('asOfToday');
}

/** A one-line "Interest accrued ₹X (as of today)" pill; renders nothing when there is none. */
export function InterestChip({ invoice, asOf }: { invoice: InvoiceRecord; asOf?: string }) {
  useT();
  const r = useInterest(invoice, asOf);
  if (!r.eligible || !(r.amount > 0)) return null;
  return (
    <span className={styles.chip} title={intT('disclaimer')}>
      <Percent size={12} aria-hidden="true" />
      <span>
        {intT('accrued')} <span className={styles.chipAmount}>{formatCurrency(r.amount, invoice.currency || 'INR')}</span>{' '}
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
  useT();
  const r = useInterest(invoice, asOf);
  const config = getLateFeeConfig(invoice.sender?.id);
  if (!r.eligible || !(r.amount > 0)) return null;
  const cur = invoice.currency || 'INR';
  const mentioned = termsMentionInterest(invoice);
  return (
    <div className={styles.panel}>
      <InterestChip invoice={invoice} asOf={asOf} />
      <details className={styles.details}>
        <summary>{intT('howWorked')}</summary>
        <p className={styles.note}>{describeBasis(config)}.</p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{intT('colFrom')}</th>
                <th>{intT('colTo')}</th>
                <th className={styles.num}>{intT('colDays')}</th>
                <th className={styles.num}>{intT('colOn')}</th>
                <th className={styles.num}>{intT('colInterest')}</th>
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
          <p className={styles.note}>{intT('capped', { amount: formatCurrency(r.cap_amount, cur) })}</p>
        )}
        <p className={styles.note}>{intT('disclaimer')}</p>
        {!mentioned && (
          <p className={styles.warn}>
            {intT('notInTerms')}
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
            {intT('addLine')}
          </button>
        </div>
      )}
    </div>
  );
}
