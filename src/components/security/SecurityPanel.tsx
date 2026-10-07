import { useState } from 'react';
import { KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { ChangePinModal } from './ChangePinModal';
import { EncryptedBackup } from './EncryptedBackup';
import { IDLE_CHOICES, getIdleTimeout, logout, setIdleTimeout } from '../../lib/auth';
import { daysSinceBackup, getLastBackup } from '../../lib/backup';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Security.module.css';

interface Props {
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  /** Called after "Lock now" has cleared the session — typically `() => setAuthed(false)`. */
  onLock?: () => void;
}

function idleLabel(minutes: number): string {
  if (minutes === 0) return 'Never';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
}

/** Settings → Security: PIN, auto-lock, and encrypted backups. */
export function SecurityPanel({ notify, onLock }: Props) {
  const [pinOpen, setPinOpen] = useState(false);
  const [idle, setIdle] = useState(getIdleTimeout);

  const last = getLastBackup();
  const days = daysSinceBackup();

  return (
    <div className={styles.panel}>
      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <KeyRound size={16} /> PIN &amp; auto-lock
          </span>
        </div>
        <div className={surface.cardBody}>
          <div className={styles.rowBetween}>
            <div className={styles.rowText}>
              <strong>PIN</strong>
              <span>Stored only as a salted PBKDF2 hash. Five wrong attempts trigger a temporary lock that doubles each time.</span>
            </div>
            <button type="button" className={controls.btnOutline} onClick={() => setPinOpen(true)}>
              <KeyRound size={16} /> Change PIN
            </button>
          </div>

          <hr className={styles.divider} />

          <div className={styles.rowBetween}>
            <div className={styles.rowText}>
              <strong>Lock after inactivity</strong>
              <span>The app locks when you have not touched it for this long. Invoices are autosaved, so nothing is lost.</span>
            </div>
            <div className={`${controls.field} ${styles.selectWrap}`}>
              <select
                className={controls.select}
                aria-label="Auto-lock after inactivity"
                value={idle}
                onChange={(e) => {
                  const minutes = Number(e.target.value);
                  setIdleTimeout(minutes);
                  setIdle(minutes);
                  notify(minutes === 0 ? 'Auto-lock turned off' : `Auto-lock after ${idleLabel(minutes)}`);
                }}
              >
                {IDLE_CHOICES.map((m) => (
                  <option key={m} value={m}>{idleLabel(m)}</option>
                ))}
              </select>
            </div>
          </div>

          <hr className={styles.divider} />

          <div className={styles.rowBetween}>
            <div className={styles.rowText}>
              <strong>Lock now</strong>
              <span>Return to the PIN screen immediately.</span>
            </div>
            <button
              type="button"
              className={controls.btnOutline}
              onClick={() => {
                logout();
                if (onLock) onLock();
                else window.location.reload();
              }}
            >
              <Lock size={16} /> Lock now
            </button>
          </div>
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <ShieldCheck size={16} /> Encrypted backup
          </span>
          {last ? (
            <span className={days !== null && days > 30 ? styles.badgeWarn : styles.badgeOk}>
              Last backup {days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}
            </span>
          ) : (
            <span className={styles.badgeWarn}>No backup yet</span>
          )}
        </div>
        <div className={surface.cardBody}>
          <EncryptedBackup notify={notify} />
        </div>
      </section>

      <ChangePinModal open={pinOpen} onClose={() => setPinOpen(false)} onChanged={() => notify('PIN changed')} />
    </div>
  );
}
