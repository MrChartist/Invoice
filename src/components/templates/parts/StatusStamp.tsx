import { effectiveStatus } from '../../../lib/invoice-status';
import { stampFor, type StampTone } from '../../../lib/design-prefs';
import type { InvoiceRecord } from '../../../types/invoice';
import { usePaper } from '../paper-context';
import styles from '../invoice-paper.module.css';

const TONE_CLASS: Record<StampTone, string> = {
  paid: styles.stampPaid,
  overdue: styles.stampOverdue,
  cancelled: styles.stampCancelled,
  draft: styles.stampDraft,
  custom: styles.stampCustom,
};

/** Diagonal status stamp / custom watermark, driven by design.watermark. */
export function StatusStamp({ invoice }: { invoice: InvoiceRecord }) {
  const { design } = usePaper();
  if (!design) return null;
  const stamp = stampFor(design.watermark, effectiveStatus(invoice), invoice.doc_type);
  if (!stamp) return null;
  return (
    <div className={styles.stampWrap} aria-hidden="true">
      <div className={`${styles.stampMark} ${TONE_CLASS[stamp.tone]}`} data-stamp={stamp.tone}>
        {stamp.label}
      </div>
    </div>
  );
}
