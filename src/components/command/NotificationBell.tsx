import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertOctagon, AlertTriangle, Bell, BellOff, CheckCheck, Clock, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  dismiss,
  loadNotifState,
  loadVisibleNotifications,
  markAllRead,
  markRead,
  pruneState,
  saveNotifState,
  snooze,
  unreadCount,
  buildContext,
  collectNotifications,
  type NotifState,
  type NotificationSeverity,
  type SnoozeDays,
  type VisibleNotification,
} from '../../lib/notifications';
import styles from './NotificationBell.module.css';

export interface NotificationBellProps {
  /** Called with a notification's `href` when its call-to-action is used. */
  onNavigate: (href: string) => void;
  /** Re-evaluate every N ms while mounted (default 60 000). */
  pollMs?: number;
  className?: string;
}

const SEVERITY_ICON: Record<NotificationSeverity, typeof Info> = {
  critical: AlertOctagon,
  warning: AlertTriangle,
  info: Info,
};

export function NotificationBell({ onNavigate, pollMs = 60000, className }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<VisibleNotification[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const refresh = useCallback(() => {
    try {
      setItems(loadVisibleNotifications(new Date()));
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const timer = setInterval(refresh, pollMs);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh, pollMs]);

  // Close on outside click / Escape; return focus to the bell.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const mutate = (fn: (states: NotifState[], now: Date) => NotifState[]) => {
    const now = new Date();
    const active = collectNotifications(buildContext(now)).map((n) => n.id);
    saveNotifState(pruneState(fn(loadNotifState(), now), active, now));
    refresh();
  };

  const unread = unreadCount(items);

  const onCta = (n: VisibleNotification) => {
    mutate((s, now) => markRead(s, n.id, now));
    setOpen(false);
    if (n.href) onNavigate(n.href);
  };

  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <div ref={rootRef} className={cn(styles.root, className)}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.bell}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (!open) refresh();
          setOpen((v) => !v);
        }}
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className={styles.panel}
          role="dialog"
          aria-label="Notifications"
        >
          <div className={styles.head}>
            <h2 className={styles.title}>Notifications</h2>
            {unread > 0 && (
              <button
                type="button"
                className={styles.textBtn}
                onClick={() => mutate((s, now) => markAllRead(s, items.map((i) => i.id), now))}
              >
                <CheckCheck size={14} aria-hidden="true" /> Mark all read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className={styles.empty}>
              <BellOff size={22} aria-hidden="true" />
              <p>You are all caught up.</p>
            </div>
          ) : (
            <ul className={styles.list}>
              {items.map((n) => {
                const Icon = SEVERITY_ICON[n.severity];
                return (
                  <li key={n.id} className={cn(styles.item, !n.read && styles.unread)} data-severity={n.severity}>
                    <span className={cn(styles.sev, styles[n.severity])} aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <div className={styles.body}>
                      <p className={styles.itemTitle}>
                        {n.title}
                        <span className={styles.srOnly}> ({n.severity}{n.read ? ', read' : ', unread'})</span>
                      </p>
                      <p className={styles.detail}>{n.detail}</p>
                      <div className={styles.actions}>
                        {n.href && n.cta && (
                          <button type="button" className={styles.cta} onClick={() => onCta(n)}>
                            {n.cta}
                          </button>
                        )}
                        {!n.read && (
                          <button
                            type="button"
                            className={styles.textBtn}
                            onClick={() => mutate((s, now) => markRead(s, n.id, now))}
                          >
                            Mark read
                          </button>
                        )}
                        {([1, 7] as SnoozeDays[]).map((d) => (
                          <button
                            key={d}
                            type="button"
                            className={styles.textBtn}
                            onClick={() => mutate((s, now) => snooze(s, n.id, d, now))}
                            aria-label={`Snooze for ${d === 1 ? '1 day' : '7 days'}: ${n.title}`}
                          >
                            <Clock size={12} aria-hidden="true" /> {d}d
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.dismiss}
                      aria-label={`Dismiss: ${n.title}`}
                      onClick={() => mutate((s) => dismiss(s, n.id))}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
