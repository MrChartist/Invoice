import { RefreshCw, X } from 'lucide-react';
import { useUpdateAvailable } from '../../lib/pwa';
import { useT } from '../../i18n';
import { pwaT } from '../../i18n/areas/pwa';
import controls from '../../styles/controls.module.css';
import styles from './Pwa.module.css';

/** "New version ready - Reload". Renders nothing until a new service worker is waiting. */
export function UpdateToast() {
  useT(); // re-render on a language switch (5.4)
  const { available, apply, dismiss } = useUpdateAvailable();
  if (!available) return null;

  return (
    <div className={styles.dock}>
      <div className={styles.banner} role="status" aria-live="polite">
        <span className={styles.icon} aria-hidden="true">
          <RefreshCw size={16} />
        </span>
        <div className={styles.text}>
          <p className={styles.title}>{pwaT('updateTitle')}</p>
          <p className={styles.desc}>{pwaT('updateDesc')}</p>
          <div className={styles.actions}>
            <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={apply}>
              {pwaT('reload')}
            </button>
            <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={dismiss}>
              {pwaT('later')}
            </button>
          </div>
        </div>
        <button type="button" className={styles.close} onClick={dismiss} aria-label={pwaT('dismissUpdate')}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
