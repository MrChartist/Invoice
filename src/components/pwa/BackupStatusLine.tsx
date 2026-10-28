import { lazy, Suspense, useEffect, useState } from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { getLastBackup, hasBackupWorthyData } from '../../lib/auto-backup-schedule';
import { PHONE_NUDGE_DOCS, docsSinceBackup, phoneBackupDue } from '../../lib/phone-backup';
import { subscribeStorageChanges } from '../../lib/storage';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import { phoneT } from '../../i18n/areas/phone';
import styles from './PhoneBackup.module.css';

const ShareBackupDialog = lazy(() => import('./ShareBackupDialog').then((m) => ({ default: m.ShareBackupDialog })));

/** "3 h ago" in the interface language. */
function backupAge(iso: string, now: Date): string {
  const diff = Math.max(0, now.getTime() - Date.parse(iso));
  if (diff < 60_000) return phoneT('justNow');
  if (diff < 3_600_000) return phoneT('minAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return phoneT('hoursAgo', { n: Math.floor(diff / 3_600_000) });
  return phoneT('daysAgo', { n: Math.floor(diff / 86_400_000) });
}

function read(now: Date) {
  const last = getLastBackup();
  const valid = last && !Number.isNaN(Date.parse(last)) ? last : null;
  const newDocs = docsSinceBackup(valid);
  const due = phoneBackupDue({ lastIso: valid, now, hasData: hasBackupWorthyData(), newDocs });
  return { last: valid, newDocs, due };
}

/**
 * Persistent backup line (8.20): "Backed up 2 h ago ✓" or "Not backed up — tap to save". On the phone
 * Dashboard and at the top of the bell. Tapping opens Share backup (or a download where sharing is not
 * available). Owner only — the host checks `data.backup`.
 */
export function BackupStatusLine({ compact, onResult }: { compact?: boolean; onResult?: (message: string, ok: boolean) => void }) {
  useT();
  const [state, setState] = useState(() => read(new Date()));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const refresh = () => setState(read(new Date()));
    const timer = setInterval(refresh, 60_000);
    const off = subscribeStorageChanges(refresh);
    return () => {
      clearInterval(timer);
      off();
    };
  }, []);

  const now = new Date();
  const text = !state.last ? phoneT('statusNever')
    : !state.due ? phoneT('statusOk', { age: backupAge(state.last, now) })
      : state.newDocs >= PHONE_NUDGE_DOCS ? phoneT('statusNew', { n: state.newDocs })
        : phoneT('statusStale', { age: backupAge(state.last, now) });
  const Icon = state.due || !state.last ? ShieldAlert : CheckCircle2;

  return (
    <>
      <button
        type="button"
        className={cn(styles.line, compact && styles.compact, state.due || !state.last ? styles.due : styles.ok)}
        onClick={() => setOpen(true)}
        aria-label={phoneT('statusAria', { status: text })}
        data-backup-status={state.due || !state.last ? 'due' : 'ok'}
      >
        <Icon size={16} aria-hidden="true" />
        <span>{text}</span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <ShareBackupDialog
            open={open}
            onClose={() => {
              setOpen(false);
              setState(read(new Date()));
            }}
            onResult={onResult}
          />
        </Suspense>
      )}
    </>
  );
}
