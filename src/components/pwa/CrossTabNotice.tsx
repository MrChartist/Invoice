import { useState, useSyncExternalStore } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { externalVersion, subscribeExternal } from '../../lib/cross-tab';
import controls from '../../styles/controls.module.css';
import styles from './Pwa.module.css';

/**
 * "Changed in another tab" notice. Screens are not refreshed behind the user's back
 * (that would drop half-typed input); Refresh remounts the current page with fresh data.
 */
export function CrossTabNotice({ onRefresh }: { onRefresh: () => void }) {
  const version = useSyncExternalStore(subscribeExternal, externalVersion, externalVersion);
  const [seen, setSeen] = useState(version);
  if (version === seen) return null;

  return (
    <div className={styles.dock}>
      <section className={styles.banner} role="status" aria-label="Data changed in another tab">
        <span className={styles.icon} aria-hidden="true">
          <RefreshCw size={16} />
        </span>
        <div className={styles.text}>
          <p className={styles.title}>Updated in another tab</p>
          <p className={styles.desc}>Your data was changed in another tab or window, or by folder sync. Refresh to see the latest.</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
              onClick={() => {
                setSeen(version);
                onRefresh();
              }}
            >
              Refresh
            </button>
          </div>
        </div>
        <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => setSeen(version)}>
          <X size={16} />
        </button>
      </section>
    </div>
  );
}
