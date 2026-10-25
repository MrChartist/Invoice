import { Suspense, lazy } from 'react';
import { Bell } from 'lucide-react';
import styles from './NotificationBell.module.css';

// The notification engine (compliance calendar, reminders, cheques, interest) loads just after
// first paint; until then the same-sized bell is shown, inert.
const NotificationBell = lazy(() => import('./NotificationBell').then((m) => ({ default: m.NotificationBell })));

export function NotificationBellSlot({ onNavigate }: { onNavigate: (href: string) => void }) {
  return (
    <Suspense
      fallback={
        <div className={styles.root}>
          <button type="button" className={styles.bell} aria-label="Notifications" disabled>
            <Bell size={18} />
          </button>
        </div>
      }
    >
      <NotificationBell onNavigate={onNavigate} />
    </Suspense>
  );
}
