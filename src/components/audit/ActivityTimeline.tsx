import { useMemo, useState } from 'react';
import { Ban, FilePlus2, FilePenLine, KeyRound, Lock, RotateCcw, Trash2, Wallet } from 'lucide-react';
import { audit } from '../../lib/audit';
import { AUDIT_ACTION_LABELS, type AuditAction } from '../../types/audit';
import { AuditChanges } from './AuditChanges';
import { formatWhen, toneOf } from './audit-format';
import styles from './audit.module.css';

export interface ActivityTimelineProps {
  invoiceId: string;
  /** Change to force a re-read after the editor saves something. */
  refreshKey?: number | string;
  /** Rows shown before "Show all" (default 6). */
  initial?: number;
}

function ActionIcon({ action }: { action: AuditAction }) {
  const p = { size: 12, 'aria-hidden': true } as const;
  switch (action) {
    case 'create':
      return <FilePlus2 {...p} />;
    case 'delete':
      return <Trash2 {...p} />;
    case 'cancel':
      return <Ban {...p} />;
    case 'reinstate':
      return <RotateCcw {...p} />;
    case 'payment_add':
    case 'payment_remove':
      return <Wallet {...p} />;
    case 'override':
      return <KeyRound {...p} />;
    case 'lock':
    case 'unlock':
      return <Lock {...p} />;
    default:
      return <FilePenLine {...p} />;
  }
}

const DOT = { good: styles.dotCreate, bad: styles.dotDanger, lock: styles.dotLock, neutral: '' } as const;

/** Who-changed-what history of one document (edits, status changes, payments). */
export function ActivityTimeline({ invoiceId, refreshKey, initial = 6 }: ActivityTimelineProps) {
  const rows = useMemo(() => {
    void refreshKey;
    return audit.forInvoice(invoiceId);
  }, [invoiceId, refreshKey]);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0) return <p className={styles.emptyNote}>No recorded changes yet. Edits made from now on appear here.</p>;

  const shown = all ? rows : rows.slice(0, initial);
  return (
    <div>
      <ol className={styles.timeline} aria-label="Activity on this document">
        {shown.map((r) => {
          const expandable = (r.changes?.length ?? 0) > 0 && r.action !== 'create';
          return (
            <li key={r.id} className={styles.tItem}>
              <span className={`${styles.dot} ${DOT[toneOf(r.action)]}`}>
                <ActionIcon action={r.action} />
              </span>
              <div className={styles.tBody}>
                <div className={styles.tSummary}>{r.summary}</div>
                <span className={styles.tMeta}>
                  {AUDIT_ACTION_LABELS[r.action]} · {formatWhen(r.at)}
                </span>
                {expandable && (
                  <>
                    <button
                      type="button"
                      className={styles.more}
                      aria-expanded={open === r.id}
                      onClick={() => setOpen(open === r.id ? null : r.id)}
                    >
                      {open === r.id ? 'Hide changes' : `Show ${r.changes!.length} change${r.changes!.length === 1 ? '' : 's'}`}
                    </button>
                    {open === r.id && <AuditChanges changes={r.changes} />}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {rows.length > initial && (
        <button type="button" className={styles.more} onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
