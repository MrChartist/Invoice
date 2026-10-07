import { useEffect } from 'react';
import { runDueBackup } from '../../lib/auto-backup';
import { requestPersistentStorage } from '../../lib/pwa';

/**
 * Headless. Mount once inside the app shell. Runs due scheduled backups shortly after
 * start, hourly while open, and when the tab is hidden/closed (for the "on-close"
 * frequency). Also asks the browser to mark storage persistent. Renders nothing.
 * Unattended runs never prompt: if folder permission expired, the write is skipped and
 * the BackupNudge / AutoBackupPanel prompt the user instead.
 */
export function AutoBackupRunner() {
  useEffect(() => {
    const run = () => {
      void runDueBackup().catch(() => undefined);
    };
    const first = setTimeout(run, 5000);
    const hourly = setInterval(run, 60 * 60 * 1000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') run();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', run);
    void requestPersistentStorage();
    return () => {
      clearTimeout(first);
      clearInterval(hourly);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', run);
    };
  }, []);
  return null;
}
