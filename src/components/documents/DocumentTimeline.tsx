import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Ban, FileMinus2, FilePlus2, FileText, ArrowRightLeft } from 'lucide-react';
import { StatusBadge } from '../ui/StatusBadge';
import { formatCurrency, formatDate } from '../../lib/utils';
import { activeCancellation, buildDocumentChain, readLinks, type ChainNode } from '../../lib/documents';
import { localDb } from '../../lib/localDb';
import { DOCUMENT_LABELS } from '../../types/invoice';
import { cn } from '../../lib/utils';
import styles from './documents.module.css';

export interface DocumentTimelineProps {
  /** Any document in the chain; the whole chain is shown. */
  invoiceId: string;
  /** Change to force a re-read after saving something. */
  refreshKey?: number | string;
  className?: string;
}

const REL_LABEL: Record<ChainNode['relation'], string> = {
  origin: 'Original',
  converted: 'Converted',
  credit_note: 'Credit note',
  debit_note: 'Debit note',
  cancelled: 'Cancelled',
};

function RelIcon({ node }: { node: ChainNode }) {
  const p = { size: 13, 'aria-hidden': true } as const;
  if (node.doc.status === 'Cancelled') return <Ban {...p} />;
  if (node.relation === 'credit_note') return <FileMinus2 {...p} />;
  if (node.relation === 'debit_note') return <FilePlus2 {...p} />;
  if (node.relation === 'converted') return <ArrowRightLeft {...p} />;
  return <FileText {...p} />;
}

/** Vertical timeline of a document and everything derived from it. */
export function DocumentTimeline({ invoiceId, refreshKey, className }: DocumentTimelineProps) {
  const { chain, links } = useMemo(() => {
    void refreshKey;
    const l = readLinks();
    return { links: l, chain: buildDocumentChain(invoiceId, l, localDb.invoices.getAll()) };
  }, [invoiceId, refreshKey]);

  if (chain.length <= 1 && !activeCancellation(invoiceId, links)) {
    return <p className={styles.empty}>No linked documents yet.</p>;
  }

  return (
    <ol className={cn(styles.timeline, className)} aria-label="Document history">
      {chain.map((node) => {
        const cancel = node.doc.status === 'Cancelled' ? activeCancellation(node.doc.id, links) : undefined;
        const current = node.doc.id === invoiceId;
        return (
          <li key={node.doc.id} className={styles.node} style={{ paddingLeft: `${Math.min(node.depth, 3) * 0.75}rem` }}>
            <span className={styles.rail}>
              <span
                className={cn(
                  styles.dot,
                  current && styles.dotCurrent,
                  node.doc.status === 'Cancelled' && styles.dotCancelled,
                )}
              >
                <RelIcon node={node} />
              </span>
            </span>
            <div className={styles.nodeBody}>
              <div className={styles.nodeTitle}>
                <span className={styles.relTag}>{REL_LABEL[node.relation]}</span>
                {current ? (
                  <strong aria-current="true">{node.doc.invoice_number}</strong>
                ) : (
                  <Link to={`/invoice/${node.doc.id}`} className={styles.nodeLink}>
                    {node.doc.invoice_number}
                  </Link>
                )}
                <StatusBadge status={node.doc.status} />
              </div>
              <span className={styles.nodeMeta}>
                {DOCUMENT_LABELS[node.doc.doc_type]} · {formatDate(node.doc.issue_date)} ·{' '}
                {formatCurrency(node.doc.total, node.doc.currency || 'INR')}
              </span>
              {cancel?.reason && <span className={styles.cancelNote}>Cancelled: {cancel.reason}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
