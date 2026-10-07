import { useEffect, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import {
  downloadBackupNow,
  getLastBackup,
  getSnooze,
  hasBackupWorthyData,
  runAutoBackup,
  shouldNudge,
  snoozeNudge,
  getFolderHandle,
  type BackupResult,
} from '../../lib/auto-backup';
import controls from '../../styles/controls.module.css';
import styles from './Pwa.module.css';

export interface BackupNudgeProps {
  /** Optional hook so the host can show its own toast, e.g. notify(msg, tone). */
  onResult?: (result: BackupResult) => void;
}

function due(): boolean {
  return shouldNudge({
    lastIso: getLastBackup(),
    now: new Date(),
    hasData: hasBackupWorthyData(),
    snoozeUntilIso: getSnooze(),
  });
}

/** Non-blocking banner: shown when data exists and the last backup is over 7 days old. */
export function BackupNudge({ onResult }: BackupNudgeProps) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Delay so it never competes with first paint, and re-check when the tab returns.
    const check = () => setShow(due());
    const t = setTimeout(check, 2500);
    const onVis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (!show) return null;

  const backupNow = async () => {
    setBusy(true);
    // Prefer the connected folder; otherwise (or if it fails) fall back to a plain download.
    let result: BackupResult | null = null;
    if (await getFolderHandle()) result = await runAutoBackup({ interactive: true });
    if (!result || !result.ok) result = downloadBackupNow();
    setBusy(false);
    onResult?.(result);
    if (result.ok) setShow(false);
  };

  return (
    <div className={styles.dock}>
      <section className={styles.banner} role="region" aria-label="Backup reminder">
        <span className={styles.icon} aria-hidden="true">
          <ShieldAlert size={16} />
        </span>
        <div className={styles.text}>
          <p className={styles.title}>Back up your invoices</p>
          <p className={styles.desc}>
            Your data lives only in this browser. It has been over a week since your last backup.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
              onClick={backupNow}
              disabled={busy}
            >
              {busy ? 'Backing up...' : 'Backup now'}
            </button>
            <button
              type="button"
              className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
              onClick={() => {
                snoozeNudge();
                setShow(false);
              }}
            >
              Remind later
            </button>
          </div>
        </div>
        <button
          type="button"
          className={styles.close}
          aria-label="Dismiss backup reminder"
          onClick={() => {
            snoozeNudge();
            setShow(false);
          }}
        >
          <X size={16} />
        </button>
      </section>
    </div>
  );
}
