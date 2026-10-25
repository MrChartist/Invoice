import { lazy, Suspense, useEffect, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { getLastBackup, getSnooze, hasBackupWorthyData, snoozeNudge } from '../../lib/auto-backup-schedule';
import { docsSinceBackup, phoneBackupDue } from '../../lib/phone-backup';
import { useT } from '../../i18n';
import { phoneT } from '../../i18n/areas/phone';
import controls from '../../styles/controls.module.css';
import styles from './Pwa.module.css';

const ShareBackupDialog = lazy(() => import('./ShareBackupDialog').then((m) => ({ default: m.ShareBackupDialog })));

function due(): boolean {
  const lastIso = getLastBackup();
  return phoneBackupDue({ lastIso, now: new Date(), hasData: hasBackupWorthyData(), snoozeUntilIso: getSnooze(), newDocs: docsSinceBackup(lastIso) });
}

/** Phones (8.20): after 10 new documents or 3 days, offer "Share backup" (encrypted, OS share sheet). */
export function PhoneBackupNudge() {
  useT();
  const [show, setShow] = useState(false);
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
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
  const later = () => {
    snoozeNudge();
    setShow(false);
  };
  return (
    <div className={styles.dock}>
      <section className={styles.banner} role="region" aria-label={phoneT('nudgeRegion')}>
        <span className={styles.icon} aria-hidden="true"><ShieldAlert size={16} /></span>
        <div className={styles.text}>
          <p className={styles.title}>{phoneT('nudgeTitle')}</p>
          <p className={styles.desc}>{phoneT('nudgeDesc')}</p>
          <div className={styles.actions}>
            <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={() => setSharing(true)}>{phoneT('shareNow')}</button>
            <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={later}>{phoneT('later')}</button>
          </div>
        </div>
        <button type="button" className={styles.close} aria-label={phoneT('dismiss')} onClick={later}><X size={16} /></button>
      </section>
      {sharing && (
        <Suspense fallback={null}>
          <ShareBackupDialog
            open
            onClose={() => {
              setSharing(false);
              setShow(due());
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
