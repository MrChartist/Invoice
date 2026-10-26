import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertOctagon, AlertTriangle, Bell, BellOff, CheckCheck, Clock, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../i18n';
import { SINGLETON_KEYS, getJson, getTable, subscribeStorageChanges } from '../../lib/storage';
import { readApprovalPolicy } from '../../lib/approval-gate';
import { can } from '../../lib/access';
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
import { BackupStatusLine } from '../pwa/BackupStatusLine';
import styles from './NotificationBell.module.css';

export interface NotificationBellProps {
  /** Called with a notification's `href` when its call-to-action is used. */
  onNavigate: (href: string) => void;
  /** Re-evaluate every N ms while mounted (default 60 000). */
  pollMs?: number;
  className?: string;
}

/**
 * Batch expiry (6.6) and reorder (Phase 7) alerts need the stock engine: load that provider lazily,
 * and only once some stock item tracks batches or has a reorder level, so simple users never download it.
 */
let expiryAlerts: 'off' | 'loading' | 'on' = 'off';
function ensureExpiryAlerts(onReady: () => void): void {
  if (expiryAlerts !== 'off') return;
  try {
    const items = getTable<{ track_stock?: boolean; track_batches?: boolean; reorder_level?: number; reorder_by_godown?: Record<string, number> }>('stock_items');
    // Batch expiry (6.6) and reorder-level (Phase 7) alerts share one lazily loaded provider.
    const wants = (i: (typeof items)[number]) =>
      i.track_batches || Number(i.reorder_level) > 0 || Object.values(i.reorder_by_godown ?? {}).some((v) => Number(v) > 0);
    if (!items.some((i) => i.track_stock && wants(i)) && !getTable('job_work_out').length) return; // 7S: job-work clocks
  } catch {
    return;
  }
  expiryAlerts = 'loading';
  import('../../lib/stock-alerts')
    .then((m) => {
      m.registerExpiryAlerts();
      expiryAlerts = 'on';
      onReady();
    })
    .catch(() => {
      expiryAlerts = 'off';
    });
}

/**
 * Phase 7 notices (pending approvals, AMC reminders, GST set-off due): their provider loads lazily and
 * only once approvals are on for an approver, an AMC contract exists or the GST set-off screen was used.
 */
let businessAlerts: 'off' | 'loading' | 'on' = 'off';
function ensureBusinessAlerts(onReady: () => void): void {
  if (businessAlerts !== 'off') return;
  try {
    // 7O: TDS deposit / 26Q reminders once TDS is in use (a challan, or a bill / payment carrying TDS).
    const tds = (r: unknown) => Number((r as { tds_amount?: unknown } | null)?.tds_amount) > 0;
    const used = getTable('amc_contracts').length > 0 || getTable('gst_setoffs').length > 0 || getTable('gst_challans').length > 0
      || getTable('tds_challans').length > 0 || getTable('purchases').some(tds) || getTable('purchase_payments').some(tds)
      // 7R: TCS (27EQ) reminders once an invoice carries TCS.
      || getTable('invoices').some((r) => Number((r as { tcs_amount?: unknown } | null)?.tcs_amount) > 0);
    if (!used && !(readApprovalPolicy().enabled && can('doc.approve'))) return;
  } catch {
    return;
  }
  businessAlerts = 'loading';
  import('../../lib/business-alerts')
    .then((m) => {
      m.registerBusinessAlerts();
      businessAlerts = 'on';
      onReady();
    })
    .catch(() => {
      businessAlerts = 'off';
    });
}

/**
 * 8D GST guards (IRP 30-day window, return time bar): lazily, once an AATO is entered on a profile, an IRN /
 * e-Way Bill is recorded, or a tax invoice is more than two years old.
 */
let guardAlerts: 'off' | 'loading' | 'on' = 'off';
function ensureGstGuardAlerts(onReady: () => void): void {
  if (guardAlerts !== 'off') return;
  try {
    const old = `${new Date().getFullYear() - 2}-12-31`;
    const aato = (getJson<{ profiles?: { einvoice_aato?: number }[] } | null>(SINGLETON_KEYS.settings, null)?.profiles ?? []).some((p) => Number(p?.einvoice_aato) > 0);
    if (!aato && !getTable('einvoice_meta').length
      && !getTable<{ issue_date?: string; status?: string }>('invoices').some((i) => i?.status !== 'Draft' && String(i?.issue_date ?? '9') < old)) return;
  } catch {
    return;
  }
  guardAlerts = 'loading';
  import('../../lib/gst-guard-alerts')
    .then((m) => {
      m.registerGstGuardAlerts();
      guardAlerts = 'on';
      onReady();
    })
    .catch(() => {
      guardAlerts = 'off';
    });
}

/**
 * 8C notices (bills due this week, recurring / draft bills, inbox documents, purchase approvals): lazy,
 * and only once an unpaid bill with a due date or one of the 8C tables has rows.
 */
let captureAlerts: 'off' | 'loading' | 'on' = 'off';
function ensureCaptureAlerts(onReady: () => void): void {
  if (captureAlerts !== 'off') return;
  try {
    const due = (r: unknown) => { const p = r as { due_date?: string; total?: number; amount_paid?: number } | null; return !!p?.due_date && Number(p.amount_paid) < Number(p.total); };
    if (!['doc_inbox', 'purchase_drafts', 'recurring_bills', 'payment_requests'].some((t) => getTable(t).length) && !getTable('purchases').some(due)) return;
  } catch {
    return;
  }
  captureAlerts = 'loading';
  import('../../lib/capture-alerts')
    .then((m) => {
      m.registerCaptureAlerts();
      captureAlerts = 'on';
      onReady();
    })
    .catch(() => {
      captureAlerts = 'off';
    });
}

/** 8.109: month-end pack schedule (device-local) — its provider loads only once a schedule is set. */
let packAlerts: 'off' | 'loading' | 'on' = 'off';
function ensurePackAlerts(onReady: () => void): void {
  if (packAlerts !== 'off') return;
  try {
    if (!(Number(JSON.parse(globalThis.localStorage?.getItem('mrchartist_report_pack') ?? '{}')?.day) > 0)) return;
  } catch {
    return;
  }
  packAlerts = 'loading';
  import('../../lib/report-pack-alerts')
    .then((m) => {
      m.registerPackAlerts(onReady);
      packAlerts = 'on';
      onReady();
    })
    .catch(() => {
      packAlerts = 'off';
    });
}

// R3-C: e-Way Bill expiry (only once `einvoice_meta` holds an e-Way Bill number) and DSC expiry (only once
// `dsc_register` has rows) — each provider loads lazily on its own.
const r3cAlerts: Record<string, 'off' | 'loading' | 'on'> = {};
function ensureR3cAlerts(onReady: () => void): void {
  const gate = (id: string, wants: () => boolean, load: () => Promise<void>) => {
    if (r3cAlerts[id] && r3cAlerts[id] !== 'off') return;
    try {
      if (!wants()) return;
    } catch {
      return;
    }
    r3cAlerts[id] = 'loading';
    load().then(() => { r3cAlerts[id] = 'on'; onReady(); }, () => { r3cAlerts[id] = 'off'; });
  };
  gate('eway', () => getTable<{ eway_no?: string }>('einvoice_meta').some((m) => !!m?.eway_no), () => import('../../lib/eway-alerts').then((m) => m.registerEwayAlerts()));
  gate('dsc', () => getTable('dsc_register').length > 0, () => import('../../lib/dsc-alerts').then((m) => m.registerDscAlerts()));
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
    const reload = () => {
      try {
        setItems(loadVisibleNotifications(new Date()));
      } catch {
        /* keep what is shown */
      }
    };
    ensureExpiryAlerts(reload);
    ensureBusinessAlerts(reload);
    ensureGstGuardAlerts(reload);
    ensureCaptureAlerts(reload);
    ensurePackAlerts(reload);
    ensureR3cAlerts(reload); // R3-C
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const timer = setInterval(refresh, pollMs);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    const unsubscribe = subscribeStorageChanges(refresh);
    return () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh, pollMs]);

  // Close on outside click / Escape; return focus to the bell.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // A dialog opened from the panel (Share backup) is portalled outside it: keep the panel open.
      if (!rootRef.current?.contains(e.target as Node) && !(e.target as Element | null)?.closest?.('[aria-modal="true"]')) setOpen(false);
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
    if (n.href) {
      // Backup / storage notices land on the tab that fixes them.
      const dataTab = n.href === '/settings' && /^(backup|storage):/.test(n.id);
      onNavigate(dataTab ? '/settings?tab=data' : n.href);
    }
  };

  const label = unread ? t('shell.notificationsUnread', { n: unread }) : t('shell.notifications');

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
          {/* 8.20: persistent backup line for whoever may back up (owner). */}
          {can('data.backup') && <BackupStatusLine compact />}

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
