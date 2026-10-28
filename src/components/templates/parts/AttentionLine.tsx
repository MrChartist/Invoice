import type { InvoiceRecord } from '../../../types/invoice';
import type {} from '../../../types/contacts';
import { attentionText } from '../../../lib/contacts';
import { visitText } from '../paper-helpers';
import styles from './sales-r2-paper.module.css';

/**
 * R2-B4: "Kind attn.: R. Iyer, Accounts" under the bill-to party, from the document's own `attention`
 * snapshot (Critical Rule 3: editing the contact later never changes a printed document). Printed
 * wording stays English, like the other paper labels.
 */
export function AttentionLine({ invoice }: { invoice: InvoiceRecord }) {
  const text = attentionText(invoice.attention);
  const visit = visitText(invoice); // R10 (SV-B1): UHID · doctor (reg. no.) · token
  if (!text && !visit) return null;
  return (
    <>
      {visit && <div className={styles.attn} data-visit>{visit}</div>}
      {text && (
        <div className={styles.attn} data-attention>
          <span className={styles.attnLabel}>Kind attn.:</span> {text}
        </div>
      )}
    </>
  );
}
