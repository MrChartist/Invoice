import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertOctagon, AlertTriangle, Bell, BellOff, CheckCheck, Clock, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../i18n';
import { DB_PREFIX, SINGLETON_KEYS, getJson, peekTable, readRaw, subscribeStorageChanges } from '../../lib/storage';
import { readApprovalPolicy } from '../../lib/approval-gate';
import { can } from '../../lib/access';
import {
  dismiss,
  loadNotifState,
  reusableVisibleNotifications,
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
    const items = peekTable<{ track_stock?: boolean; track_batches?: boolean; reorder_level?: number; reorder_by_godown?: Record<string, number> }>('stock_items');
    // Batch expiry (6.6) and reorder-level (Phase 7) alerts share one lazily loaded provider.
    const wants = (i: (typeof items)[number]) =>
      i.track_batches || Number(i.reorder_level) > 0 || Object.values(i.reorder_by_godown ?? {}).some((v) => Number(v) > 0);
    if (!items.some((i) => i.track_stock && wants(i)) && !peekTable('job_work_out').length) return; // 7S: job-work clocks
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
    const used = peekTable('amc_contracts').length > 0 || peekTable('gst_setoffs').length > 0 || peekTable('gst_challans').length > 0
      || peekTable('tds_challans').length > 0 || peekTable('purchases').some(tds) || peekTable('purchase_payments').some(tds)
      // 7R: TCS (27EQ) reminders once an invoice carries TCS.
      || peekTable('invoices').some((r) => Number((r as { tcs_amount?: unknown } | null)?.tcs_amount) > 0);
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
    if (!aato && !peekTable('einvoice_meta').length
      && !peekTable<{ issue_date?: string; status?: string }>('invoices').some((i) => i?.status !== 'Draft' && String(i?.issue_date ?? '9') < old)) return;
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
    if (!['doc_inbox', 'purchase_drafts', 'recurring_bills', 'payment_requests'].some((t) => peekTable(t).length) && !peekTable('purchases').some(due)) return;
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

// R3-B2: project budget warnings (80% / 100%) — the provider loads only once `project_tasks` has rows.
let projectAlerts: 'off' | 'loading' | 'on' = 'off';
function ensureProjectAlerts(onReady: () => void): void {
  if (projectAlerts !== 'off') return;
  try {
    if (!peekTable('project_tasks').length) return;
  } catch {
    return;
  }
  projectAlerts = 'loading';
  import('../../lib/project-alerts')
    .then((m) => {
      m.registerProjectAlerts();
      projectAlerts = 'on';
      onReady();
    })
    .catch(() => {
      projectAlerts = 'off';
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
  gate('eway', () => peekTable<{ eway_no?: string }>('einvoice_meta').some((m) => !!m?.eway_no), () => import('../../lib/eway-alerts').then((m) => m.registerEwayAlerts()));
  gate('dsc', () => peekTable('dsc_register').length > 0, () => import('../../lib/dsc-alerts').then((m) => m.registerDscAlerts()));
}

function runBell(force: boolean, setItems: (list: VisibleNotification[]) => void, reload: () => void): void {
  try {
    setItems(reusableVisibleNotifications(new Date(), force));
  } catch {
    setItems([]);
  }
  ensureExpiryAlerts(reload);
  ensureBusinessAlerts(reload);
  ensureGstGuardAlerts(reload);
  ensureCaptureAlerts(reload);
  ensurePackAlerts(reload);
  ensureProjectAlerts(reload); // R3-B
  ensureR3cAlerts(reload); // R3-C
  ensureProductionAlerts(reload); // R4-A
  ensureTransferAlerts(reload); // R4-B
  ensureTradeAlerts(reload); // R4-C
  ensureTrustAlerts(reload); // R4-C
  ensureMarketplaceAlerts(reload); // R5-A
  ensureTransportWorksAlerts(reload); // R5-B
}

/** Coalesces refresh requests into one run on the next task (a forced request wins). */
function bellScheduler(setItems: (list: VisibleNotification[]) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let force = false;
  const s = {
    schedule(f = false): void {
      force ||= f;
      if (timer !== null) return;
      timer = setTimeout(() => {
        const ff = force;
        timer = null;
        force = false;
        s.run(ff);
      }, 0);
    },
    run(f: boolean): void {
      runBell(f, setItems, () => s.schedule(true));
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      force = false;
    },
  };
  return s;
}

// R4-A: production orders past due / completed-not-closed and stock aged in QC — lazy, once an order or a QC godown exists.
let productionAlerts = 0;
function ensureProductionAlerts(onReady: () => void): void {
  if (productionAlerts || !(peekTable('production_orders').length || peekTable<{ kind?: string }>('godowns').some((g) => g?.kind === 'qc'))) return;
  productionAlerts = 1;
  import('../../lib/production/order-alerts').then((m) => { m.registerProductionAlerts(onReady); onReady(); }, () => { productionAlerts = 0; });
}

// R4-B: goods in transit too long and transfer requests past their needed-by date — lazy, once a request exists.
let transferAlerts = 0;
function ensureTransferAlerts(onReady: () => void): void {
  if (transferAlerts || !peekTable('transfer_requests').length) return;
  transferAlerts = 1;
  import('../../lib/retail/transfer-alerts').then((m) => { m.registerTransferAlerts(); onReady(); }, () => { transferAlerts = 0; });
}

// R4-C: export desk (LUT + realisation) — lazy, once an LUT row or an export invoice exists.
let tradeAlerts = 0;
function ensureTradeAlerts(onReady: () => void): void {
  if (tradeAlerts || !(peekTable('lut_register').length || peekTable<{ supply_type?: string; place_of_supply?: string }>('invoices').some((i) => /^EXPORT/.test(i?.supply_type ?? '') || /^9[67]$/.test(i?.place_of_supply ?? '')))) return;
  tradeAlerts = 1;
  import('../../lib/trade/export-alerts').then((m) => { m.registerTradeAlerts(); onReady(); }, () => { tradeAlerts = 0; });
}

// R4-C: recycle-bin purge after first paint and the 8-FY edit-log retention notice — lazy, once the bin has rows or the log is old.
let trustAlerts = 0;
function ensureTrustAlerts(onReady: () => void): void {
  if (trustAlerts || !(peekTable('recycle_bin').length || +(/"at":"(\d{4})/.exec(readRaw(DB_PREFIX + 'audit_log')?.slice(0, 400) ?? '')?.[1] ?? 1e4) < new Date().getFullYear() - 8)) return;
  trustAlerts = 1;
  import('../../lib/trust/trust-alerts').then((m) => { m.registerTrustAlerts(); onReady(); }, () => { trustAlerts = 0; });
}

// R5-A: marketplace notices — lazy, only with the marketplace pack on (same rule as `industry-packs.ts`) and a channel.
let marketplaceAlerts = 0;
function ensureMarketplaceAlerts(onReady: () => void): void {
  if (marketplaceAlerts || !peekTable('sales_channels').length) return;
  const s = getJson<{ industry_packs?: unknown; business_type?: string } | null>(SINGLETON_KEYS.settings, null);
  if (!(Array.isArray(s?.industry_packs) ? s.industry_packs.includes('marketplace') : s?.business_type === 'ecommerce')) return;
  marketplaceAlerts = 1;
  import('../../lib/marketplace/marketplace-alerts').then((m) => { m.registerMarketplaceAlerts(); onReady(); }, () => { marketplaceAlerts = 0; });
}

// R5-B: transport / works notices — each loads lazily, only with its pack on (same rule as `industry-packs.ts`).
const twAlerts: Record<string, number> = {};
function ensureTransportWorksAlerts(onReady: () => void): void {
  const s = getJson<{ industry_packs?: unknown; business_type?: string } | null>(SINGLETON_KEYS.settings, null);
  const gate = (p: string, type: string, load: () => Promise<unknown>) => {
    if (twAlerts[p] || !(Array.isArray(s?.industry_packs) ? s.industry_packs.includes(p) : s?.business_type === type)) return;
    twAlerts[p] = 1;
    load().then(onReady, () => { twAlerts[p] = 0; });
  };
  gate('transport', 'transport', () => import('../../lib/transport/transport-alerts')); // registers itself on load
  gate('works', 'contractor', () => import('../../lib/works/works-alerts'));
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

  // PERF-1: every trigger (poll, focus, cross-tab change, a provider that finished loading) is coalesced
  // into ONE run on the next task; unchanged data reuses the providers' last result (`reusableVisibleNotifications`).
  const [bell] = useState(() => bellScheduler(setItems));
  /** Immediate, fresh refresh (the bell is opened, a notice was acted on). */
  const refresh = useCallback(() => bell.run(true), [bell]);

  useEffect(() => {
    const schedule = (f = false) => bell.schedule(f);
    // First run after first paint, in idle time (never in the boot critical path).
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const idle = w.requestIdleCallback ? w.requestIdleCallback(() => schedule(), { timeout: 2000 }) : null;
    const boot = idle === null ? setTimeout(() => schedule(), 0) : null;
    const tick = () => schedule();
    // Another tab's localStorage write (device-local keys) is invisible to `storageVersion`: recompute.
    const onStorage = () => schedule(true);
    const timer = setInterval(tick, pollMs);
    window.addEventListener('focus', tick);
    window.addEventListener('storage', onStorage);
    const unsubscribe = subscribeStorageChanges(tick);
    return () => {
      unsubscribe();
      clearInterval(timer);
      if (idle !== null) w.cancelIdleCallback?.(idle);
      if (boot !== null) clearTimeout(boot);
      bell.cancel();
      window.removeEventListener('focus', tick);
      window.removeEventListener('storage', onStorage);
    };
  }, [bell, pollMs]);

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
