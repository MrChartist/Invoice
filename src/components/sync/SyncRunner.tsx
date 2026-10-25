import { useEffect } from 'react';
import { syncEnabledHere } from '../../lib/sync-device';

const EVERY_MS = 5 * 60_000;

/**
 * Headless (folder sync, 5.7). Mount once inside the app shell. When sync is on for the open company
 * on this device, runs a sync shortly after start and every 5 minutes while the tab is visible. The
 * sync code is imported only then. Unattended runs never prompt for folder access; the Settings panel
 * asks instead. Renders nothing.
 */
export function SyncRunner() {
  useEffect(() => {
    if (!syncEnabledHere()) return;
    const run = () => {
      if (document.visibilityState === 'hidden' || !syncEnabledHere()) return;
      void import('../../lib/sync-folder').then((m) => m.runSyncNow()).catch(() => undefined);
    };
    const first = setTimeout(run, 4000);
    const timer = setInterval(run, EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return null;
}
