import { RefreshCw, X } from 'lucide-react';
import { useUpdateAvailable } from '../../lib/pwa';
import controls from '../../styles/controls.module.css';
import styles from './Pwa.module.css';

/** "New version ready - Reload". Renders nothing until a new service worker is waiting. */
export function UpdateToast() {
  const { available, apply, dismiss } = useUpdateAvailable();
  if (!available) return null;

  return (
    <div className={styles.dock}>
      <div className={styles.banner} role="status" aria-live="polite">
        <span className={styles.icon} aria-hidden="true">
          <RefreshCw size={16} />
        </span>
        <div className={styles.text}>
          <p className={styles.title}>New version ready</p>
          <p className={styles.desc}>Reload to get the latest features. Your data is not affected.</p>
          <div className={styles.actions}>
            <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={apply}>
              Reload
            </button>
            <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={dismiss}>
              Later
            </button>
          </div>
        </div>
        <button type="button" className={styles.close} onClick={dismiss} aria-label="Dismiss update notice">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
