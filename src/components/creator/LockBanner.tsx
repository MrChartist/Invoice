import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, LockOpen } from 'lucide-react';
import { PinConfirmModal } from '../audit/PinConfirmModal';
import {
  getLockUntil,
  grantOverride,
  lockState,
  overrideRemainingMs,
  prettyDay,
  revokeOverride,
} from '../../lib/period-lock';
import controls from '../../styles/controls.module.css';
import styles from '../audit/audit.module.css';

export interface LockBannerProps {
  /** Saved document id ('' for a new document). */
  docId: string;
  docNumber?: string;
  issueDate: string;
  /** Called after the lock state changed (override granted / revoked / expired). */
  onChange?: () => void;
}

/**
 * Read-only notice for a document inside the locked period, with the PIN-guarded
 * "Unlock" path. Renders nothing for open documents.
 */
export function LockBanner({ docId, docNumber, issueDate, onChange }: LockBannerProps) {
  const [pinOpen, setPinOpen] = useState(false);
  const [, force] = useState(0);
  const lockUntil = getLockUntil();
  const state = lockState({ id: docId, issue_date: issueDate }, lockUntil);
  const remaining = docId ? overrideRemainingMs(docId) : 0;

  // Re-lock automatically when the override window ends.
  useEffect(() => {
    if (state !== 'overridden' || remaining <= 0) return;
    const t = setTimeout(() => {
      force((n) => n + 1);
      onChange?.();
    }, remaining + 50);
    return () => clearTimeout(t);
  }, [state, remaining, onChange]);

  if (state === 'open') return null;

  if (state === 'overridden') {
    const mins = Math.max(1, Math.ceil(remaining / 60_000));
    return (
      <div className={`${styles.lockBanner} ${styles.overrideBanner}`} role="status">
        <LockOpen size={18} aria-hidden="true" />
        <div className={styles.lockText}>
          <strong>Lock overridden for this document</strong>
          <span>
            Books are locked up to {prettyDay(lockUntil)}. You can edit {docNumber || 'this document'} for about {mins} more minute{mins === 1 ? '' : 's'}; every change is logged.
          </span>
        </div>
        <div className={styles.lockActions}>
          <button
            type="button"
            className={`${controls.btnOutline} ${controls.btnSm}`}
            onClick={() => {
              revokeOverride(docId);
              force((n) => n + 1);
              onChange?.();
            }}
          >
            <Lock size={14} /> Re-lock now
          </button>
        </div>
      </div>
    );
  }

  const isNew = !docId;
  return (
    <>
      <div className={styles.lockBanner} role="alert">
        <Lock size={18} aria-hidden="true" />
        <div className={styles.lockText}>
          <strong>{isNew ? 'This date is in a locked period' : 'This document is locked (read-only)'}</strong>
          <span>
            {isNew
              ? `Books are locked up to ${prettyDay(lockUntil)}. Pick an issue date after that to save this document.`
              : `Books are locked up to ${prettyDay(lockUntil)}, and ${docNumber || 'this document'} is dated ${prettyDay(issueDate)}. It cannot be edited, cancelled, deleted or paid.`}
          </span>
        </div>
        <div className={styles.lockActions}>
          {!isNew && (
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setPinOpen(true)}>
              <LockOpen size={14} /> Unlock with PIN
            </button>
          )}
          <Link to="/settings?tab=defaults" className={`${controls.btnGhost} ${controls.btnSm}`}>
            Lock settings
          </Link>
        </div>
      </div>
      <PinConfirmModal
        open={pinOpen}
        title="Unlock this document"
        message={`Enter your PIN to edit ${docNumber || 'this document'} even though the books are locked. The override lasts 10 minutes for this document only and is recorded in the activity log.`}
        confirmLabel="Unlock"
        onClose={() => setPinOpen(false)}
        onSubmit={async (pin) => {
          const ok = await grantOverride(pin, { scope: docId, docNumber });
          if (ok) {
            force((n) => n + 1);
            onChange?.();
          }
          return ok;
        }}
      />
    </>
  );
}
