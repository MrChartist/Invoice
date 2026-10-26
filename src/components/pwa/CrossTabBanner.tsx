import { RefreshCw, X } from 'lucide-react';
import { pwaT } from '../../i18n/areas/pwa';
import { tabCompanyT } from '../../i18n/areas/tab-company';
import controls from '../../styles/controls.module.css';
import styles from './Pwa.module.css';

/**
 * The "changed in another tab" banner (lazy: it shows only after another tab wrote, so it stays out of first paint).
 * `moved` (QA7 G1): another tab switched the device's company, so this tab still holds the old company's data and
 * must reload into the new one rather than keep editing under the new company's name.
 */
export function CrossTabBanner({ moved, onRefresh, onDismiss }: { moved: boolean; onRefresh: () => void; onDismiss: () => void }) {
  return (
    <div className={styles.dock}>
      <section className={styles.banner} role="status" data-company-moved={moved || undefined} aria-label={pwaT('crossRegion')}>
        <span className={styles.icon} aria-hidden="true">
          <RefreshCw size={16} />
        </span>
        <div className={styles.text}>
          <p className={styles.title}>{moved ? tabCompanyT('title') : pwaT('crossTitle')}</p>
          <p className={styles.desc}>{moved ? tabCompanyT('desc') : pwaT('crossDesc')}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
              onClick={() => {
                onDismiss();
                if (moved) location.reload();
                else onRefresh();
              }}
            >
              {pwaT(moved ? 'reload' : 'refresh')}
            </button>
          </div>
        </div>
        <button type="button" className={styles.close} aria-label={pwaT('dismiss')} onClick={onDismiss}>
          <X size={16} />
        </button>
      </section>
    </div>
  );
}
