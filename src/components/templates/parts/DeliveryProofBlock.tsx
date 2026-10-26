import type { InvoiceRecord } from '../../../types/invoice';
import { proofSignatureData } from '../../../lib/doc-evidence';
import { cn } from '../../../lib/utils';
import styles from './docs-r3-pages.module.css';

/**
 * R3-C2 "Received by" block: the receiver's signature snapshot on the document itself (Critical Rule 3:
 * a reprint never changes). Lazy inside TemplateEngine; renders nothing without a proof.
 */
export default function DeliveryProofBlock({ invoice, compact }: { invoice: InvoiceRecord; compact?: boolean }) {
  const proof = invoice.delivery_proof;
  if (!proof?.receiver) return null;
  const sig = proofSignatureData(proof);
  const when = new Date(proof.signed_at);
  return (
    <section className={cn(styles.proof, compact && styles.compact)} aria-label="Received by" data-delivery-proof>
      <p className={styles.proofHead}>Received by</p>
      {sig && <img className={styles.proofSig} src={sig} alt={`Signature of ${proof.receiver}`} />}
      <p>
        <strong>{proof.receiver}</strong>
        {Number.isNaN(when.getTime()) ? '' : ` · ${when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`}
      </p>
      {proof.remark && <p>{proof.remark}</p>}
    </section>
  );
}
