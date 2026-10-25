import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, LockOpen } from 'lucide-react';
import { PinConfirmModal } from '../audit/PinConfirmModal';
import { can } from '../../lib/access';
import {
  getLockUntil,
  grantOverride,
  lockState,
  overrideRemainingMs,
  prettyDay,
  revokeOverride,
} from '../../lib/period-lock';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { edT } from '../../i18n/areas/editor';
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
  useT(); // re-render on a language switch (5.4)
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
          <strong>{edT('lbOverridden')}</strong>
          <span>
            {edT(mins === 1 ? 'lbOverrideOne' : 'lbOverrideMany', { date: prettyDay(lockUntil), doc: docNumber || edT('lbThisDoc'), n: mins })}
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
            <Lock size={14} /> {edT('lbRelock')}
          </button>
        </div>
      </div>
    );
  }

  const isNew = !docId;
  // Local roles (6.21): only the owner may unlock a period or open lock settings.
  const owner = can('period.override');
  return (
    <>
      <div className={styles.lockBanner} role="alert">
        <Lock size={18} aria-hidden="true" />
        <div className={styles.lockText}>
          <strong>{isNew ? edT('lbNewTitle') : edT('lbDocTitle')}</strong>
          <span>
            {isNew
              ? edT('lbNewText', { date: prettyDay(lockUntil) })
              : edT('lbDocText', { date: prettyDay(lockUntil), doc: docNumber || edT('lbThisDoc'), issued: prettyDay(issueDate) })}
          </span>
        </div>
        <div className={styles.lockActions}>
          {!isNew && owner && (
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setPinOpen(true)}>
              <LockOpen size={14} /> {edT('lbUnlockPin')}
            </button>
          )}
          {owner ? (
            <Link to="/settings?tab=defaults" className={`${controls.btnGhost} ${controls.btnSm}`}>
              {edT('lbSettings')}
            </Link>
          ) : (
            <span className={controls.hint}>{edT('lbOwnerOnly')}</span>
          )}
        </div>
      </div>
      <PinConfirmModal
        open={pinOpen}
        title={edT('lbPinTitle')}
        message={edT('lbPinMsg', { doc: docNumber || edT('lbThisDoc') })}
        confirmLabel={edT('lbUnlock')}
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
