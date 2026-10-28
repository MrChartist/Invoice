import { lazy, Suspense, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Ban, FileMinus2, FilePlus2, FileText, ArrowRightLeft, History, Layers } from 'lucide-react';
import { StatusBadge } from '../ui/StatusBadge';
import { formatCurrency, formatDate } from '../../lib/utils';
import { activeCancellation, buildDocumentChain, readLinks, type ChainNode } from '../../lib/documents';
import { localDb } from '../../lib/localDb';
import { DOCUMENT_LABELS } from '../../types/invoice';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import { salesT } from '../../i18n/areas/sales';
import { docLabel } from '../../i18n/labels';
import { s2T } from '../../i18n/areas/sales-r2';
import styles from './documents.module.css';

export interface DocumentTimelineProps {
  /** Any document in the chain; the whole chain is shown. */
  invoiceId: string;
  /** Change to force a re-read after saving something. */
  refreshKey?: number | string;
  className?: string;
}


function RelIcon({ node }: { node: ChainNode }) {
  const p = { size: 13, 'aria-hidden': true } as const;
  if (node.doc.status === 'Cancelled') return <Ban {...p} />;
  if (node.relation === 'credit_note') return <FileMinus2 {...p} />;
  if (node.relation === 'debit_note') return <FilePlus2 {...p} />;
  if (node.relation === 'converted') return <ArrowRightLeft {...p} />;
  if (node.relation === 'progress') return <Layers {...p} />;
  if (node.relation === 'revised') return <History {...p} />;
  return <FileText {...p} />;
}

/**
 * Vertical timeline of a document and everything derived from it. Quotations / sales orders also show
 * progress billing (R2-B2) and quotations their revisions (R2-B3), both loaded on demand.
 */
export function DocumentTimeline({ invoiceId, refreshKey, className }: DocumentTimelineProps) {
  useT(); // re-render on a language switch (5.4)
  const doc = useMemo(() => {
    void refreshKey;
    return localDb.invoices.getById(invoiceId);
  }, [invoiceId, refreshKey]);
  const progress = !!doc && (doc.doc_type === 'QUOTATION' || doc.doc_type === 'SALES_ORDER') && doc.status !== 'Draft';
  const revisions = !!doc && doc.doc_type === 'QUOTATION';
  return (
    <>
      {(progress || revisions) && doc && (
        <Suspense fallback={null}>
          {progress && <ProgressPanel source={doc} refreshKey={refreshKey} />}
          {revisions && <RevisionsPanel quote={doc} refreshKey={refreshKey} />}
        </Suspense>
      )}
      <ChainTimeline invoiceId={invoiceId} refreshKey={refreshKey} className={className} />
    </>
  );
}

const ProgressPanel = lazy(() => import('./ProgressPanel').then((m) => ({ default: m.ProgressPanel })));
const RevisionsPanel = lazy(() => import('./RevisionsPanel').then((m) => ({ default: m.RevisionsPanel })));

function ChainTimeline({ invoiceId, refreshKey, className }: DocumentTimelineProps) {
  const { chain, links } = useMemo(() => {
    void refreshKey;
    const l = readLinks();
    return { links: l, chain: buildDocumentChain(invoiceId, l, localDb.invoices.getAll()) };
  }, [invoiceId, refreshKey]);

  if (chain.length <= 1 && !activeCancellation(invoiceId, links)) {
    return <p className={styles.empty}>{salesT('tl.none')}</p>;
  }

  return (
    <ol className={cn(styles.timeline, className)} aria-label={salesT('tl.aria')}>
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
                <span className={styles.relTag}>{node.relation === 'progress' || node.relation === 'revised' ? s2T(`tl.${node.relation}`) : salesT(`tl.${node.relation}`)}</span>
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
                {node.doc.doc_type in DOCUMENT_LABELS ? docLabel(node.doc.doc_type) : node.doc.doc_type} · {formatDate(node.doc.issue_date)} ·{' '}
                {formatCurrency(node.doc.total, node.doc.currency || 'INR')}
              </span>
              {cancel?.reason && <span className={styles.cancelNote}>{salesT('tl.cancelledReason', { reason: cancel.reason })}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
