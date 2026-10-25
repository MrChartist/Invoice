/**
 * Edit log of one record (WP-7, P0-10 / P1-23 — TallyPrime "Edit Log": altered by / on, with the
 * before → after of every change). Archives included. Lazy-friendly; any screen can open it:
 *   const EditLog = lazy(() => import('../audit/EditLog').then((m) => ({ default: m.EditLog })));
 *   <EditLog open recordId={voucher.id} name={voucher.number} onClose={…} />
 */
import { useMemo } from 'react';
import { History } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { audit } from '../../lib/audit';
import { AUDIT_ACTION_LABELS } from '../../types/audit';
import { useT } from '../../i18n';
import { migT } from '../../i18n/areas/migration';
import { AuditChanges } from './AuditChanges';
import { formatWhen } from './audit-format';
import styles from './audit.module.css';

export interface EditLogProps {
  open: boolean;
  recordId: string;
  /** Shown in the title (voucher number, bill number, party name …). */
  name?: string;
  onClose: () => void;
}

export function EditLog({ open, recordId, name, onClose }: EditLogProps) {
  useT();
  const rows = useMemo(() => (open ? audit.forRecord(recordId) : []), [open, recordId]);
  return (
    <Modal open={open} onClose={onClose} size="lg" title={<><History size={18} aria-hidden="true" /> {migT('editLogTitle', { name: name || recordId })}</>}>
      {rows.length === 0 ? (
        <p>{migT('editLogEmpty')}</p>
      ) : (
        <ol className={styles.changes} aria-label={migT('editLog')}>
          {rows.map((r) => (
            <li key={r.id} className={styles.change} style={{ display: 'block' }}>
              <div>
                <strong>{AUDIT_ACTION_LABELS[r.action]}</strong> · {formatWhen(r.at)}{r.by ? ` · ${migT('alteredBy', { name: r.by })}` : ''}
              </div>
              <div>{r.summary}</div>
              <AuditChanges changes={r.changes} />
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
