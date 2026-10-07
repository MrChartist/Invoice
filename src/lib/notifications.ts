/**
 * Notification centre — a provider registry plus built-in providers.
 *
 * A provider is a pure function of a `NotificationContext` (clock + data
 * snapshot) returning `AppNotification[]`. That keeps every rule testable with
 * a fixed clock. Only `buildContext` and the state helpers touch localStorage.
 *
 * Per-notification state (read / snoozed / dismissed) lives in the
 * `notif_state` table. Ids embed a fingerprint of the underlying condition
 * (e.g. the overdue count), so dismissing "3 overdue invoices" does not hide the
 * notice once a fourth falls overdue.
 */

import type { Client, InvoiceRecord, SenderProfile } from '../types/invoice';
import { round2 } from './invoice-calc';
import { effectiveStatus } from './invoice-status';
import { localDb } from './localDb';
import { KEYS, appDataSize, generateId, getTable, readRaw, setTable, writeRaw } from './storage';
import { formatCurrency } from './utils';
import { parseDay } from './dates';

/* ── Types ──────────────────────────────────────────────────── */

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface AppNotification {
  /** Stable across refreshes while the underlying condition is unchanged. */
  id: string;
  severity: NotificationSeverity;
  title: string;
  detail: string;
  href?: string;
  /** Label of the call-to-action that navigates to `href`. */
  cta?: string;
  /** ISO timestamp the condition was (re)detected. */
  at: string;
}

export interface NotificationContext {
  now: Date;
  invoices: InvoiceRecord[];
  clients: Client[];
  profile: SenderProfile | null;
  /** ISO string from `mrchartist_inv_last_backup`, or null if never. */
  lastBackup: string | null;
  storageUsedBytes: number;
  storageQuotaBytes: number;
}

export type NotificationProvider = (ctx: NotificationContext) => AppNotification[];

export interface NotifState {
  id: string;
  /** ISO time until which the notification is hidden (snooze / dismiss). */
  dismissed_until?: string;
  read_at?: string;
}

/* ── Constants ──────────────────────────────────────────────── */

export const NOTIF_TABLE = 'notif_state';
/** Full localStorage key. The backup feature should set this to an ISO string on success. */
export const LAST_BACKUP_KEY = 'mrchartist_inv_last_backup';

export const DUE_SOON_DAYS = 3;
export const STALE_DRAFT_DAYS = 7;
export const BACKUP_STALE_DAYS = 14;
export const STORAGE_WARN_RATIO = 0.8;
/** Browsers give ~5 MB of localStorage; sizes are counted in UTF-16 units × 2 bytes. */
export const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;
/** Invoices at or above this (₹) to a client without a GSTIN raise a notice. */
export const LARGE_INVOICE_THRESHOLD = 50000;

const DAY = 86400000;
const FOREVER = '9999-12-31T00:00:00.000Z';

/* ── Helpers ────────────────────────────────────────────────── */

const SEVERITY_RANK: Record<NotificationSeverity, number> = { critical: 0, warning: 1, info: 2 };

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY);
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  // Bare yyyy-mm-dd is a local calendar day (not midnight UTC).
  const d = parseDay(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function outstanding(inv: InvoiceRecord): number {
  const v =
    typeof inv.balance_due === 'number' ? inv.balance_due : (inv.total ?? 0) - (inv.amount_paid ?? 0);
  return round2(Math.max(0, v));
}

const isReceivable = (inv: InvoiceRecord) =>
  (inv.doc_type === 'INVOICE' || inv.doc_type === 'TAX_INVOICE' || !inv.doc_type) &&
  inv.status !== 'Cancelled';

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ── Built-in providers ─────────────────────────────────────── */

export const overdueProvider: NotificationProvider = (ctx) => {
  const rows = ctx.invoices.filter(
    (i) => isReceivable(i) && effectiveStatus(i, ctx.now) === 'Overdue' && outstanding(i) > 0,
  );
  if (!rows.length) return [];
  const total = round2(rows.reduce((s, i) => s + outstanding(i), 0));
  return [
    {
      id: `overdue:${rows.length}:${total}`,
      severity: 'critical',
      title: `${plural(rows.length, 'invoice')} overdue`,
      detail: `${formatCurrency(total)} is past its due date. Follow up on payment.`,
      href: '/transactions',
      cta: 'Review overdue',
      at: ctx.now.toISOString(),
    },
  ];
};

export const dueSoonProvider: NotificationProvider = (ctx) => {
  const rows = ctx.invoices.filter((i) => {
    if (!isReceivable(i) || i.status === 'Draft' || i.status === 'Paid') return false;
    if (outstanding(i) <= 0) return false;
    const due = parseDate(i.due_date);
    if (!due) return false;
    const d = dayDiff(ctx.now, due);
    return d >= 0 && d <= DUE_SOON_DAYS;
  });
  if (!rows.length) return [];
  const total = round2(rows.reduce((s, i) => s + outstanding(i), 0));
  return [
    {
      id: `due-soon:${rows.length}:${total}`,
      severity: 'warning',
      title: `${plural(rows.length, 'invoice')} due within ${DUE_SOON_DAYS} days`,
      detail: `${formatCurrency(total)} is expected soon. Send a reminder.`,
      href: '/transactions',
      cta: 'View invoices',
      at: ctx.now.toISOString(),
    },
  ];
};

export const staleDraftProvider: NotificationProvider = (ctx) => {
  const rows = ctx.invoices.filter((i) => {
    if (i.status !== 'Draft') return false;
    const touched = parseDate(i.updated_at) ?? parseDate(i.created_at) ?? parseDate(i.issue_date);
    return !!touched && (ctx.now.getTime() - touched.getTime()) / DAY > STALE_DRAFT_DAYS;
  });
  if (!rows.length) return [];
  return [
    {
      id: `stale-drafts:${rows.length}`,
      severity: 'info',
      title: `${plural(rows.length, 'draft')} waiting over ${STALE_DRAFT_DAYS} days`,
      detail: 'Finish and send these, or delete them to keep your numbering tidy.',
      href: '/transactions',
      cta: 'Open drafts',
      at: ctx.now.toISOString(),
    },
  ];
};

export const backupProvider: NotificationProvider = (ctx) => {
  const last = parseDate(ctx.lastBackup ?? undefined);
  if (!last) {
    if (!ctx.invoices.length && !ctx.clients.length) return [];
    return [
      {
        id: 'backup:never',
        severity: 'warning',
        title: 'No backup yet',
        detail: 'Your data lives only in this browser. Download a backup file to stay safe.',
        href: '/settings',
        cta: 'Back up now',
        at: ctx.now.toISOString(),
      },
    ];
  }
  const age = Math.floor((ctx.now.getTime() - last.getTime()) / DAY);
  if (age < BACKUP_STALE_DAYS) return [];
  return [
    {
      id: 'backup:stale',
      severity: 'warning',
      title: `Last backup was ${plural(age, 'day')} ago`,
      detail: 'Download a fresh backup so recent invoices are not lost if the browser data is cleared.',
      href: '/settings',
      cta: 'Back up now',
      at: ctx.now.toISOString(),
    },
  ];
};

export const storageProvider: NotificationProvider = (ctx) => {
  if (ctx.storageQuotaBytes <= 0) return [];
  const ratio = ctx.storageUsedBytes / ctx.storageQuotaBytes;
  if (ratio <= STORAGE_WARN_RATIO) return [];
  const pct = Math.min(100, Math.round(ratio * 100));
  return [
    {
      id: `storage:${Math.floor(pct / 5) * 5}`,
      severity: ratio >= 0.95 ? 'critical' : 'warning',
      title: `Browser storage is ${pct}% full`,
      detail: 'Download a backup, then remove old invoices or large logos before saves start failing.',
      href: '/settings',
      cta: 'Manage data',
      at: ctx.now.toISOString(),
    },
  ];
};

export const profileProvider: NotificationProvider = (ctx) => {
  const p = ctx.profile;
  const missing: string[] = [];
  if (!p?.companyName?.trim()) missing.push('business name');
  if (!p?.companyGstin?.trim()) missing.push('GSTIN');
  if (!p?.accountNumber?.trim() || !p?.ifsc?.trim()) missing.push('bank details');
  if (!p?.upiId?.trim()) missing.push('UPI ID');
  if (!missing.length) return [];
  return [
    {
      id: `profile:${missing.join('|')}`,
      severity: 'info',
      title: 'Business profile is incomplete',
      detail: `Add your ${missing.join(', ')} so invoices show how to pay you.`,
      href: '/settings',
      cta: 'Complete profile',
      at: ctx.now.toISOString(),
    },
  ];
};

export const missingGstinProvider: NotificationProvider = (ctx) => {
  const names = new Map<string, string>();
  for (const inv of ctx.invoices) {
    if (!isReceivable(inv) || inv.status === 'Draft') continue;
    if ((inv.total ?? 0) < LARGE_INVOICE_THRESHOLD) continue;
    const c = inv.client;
    if (!c || c.gstin?.trim()) continue;
    // A client record may have been updated with a GSTIN after the snapshot.
    const live = ctx.clients.find((x) => (c.id && x.id === c.id) || x.name === c.name);
    if (live?.gstin?.trim()) continue;
    const key = (c.id ?? c.name ?? '').toLowerCase();
    if (key) names.set(key, c.name || c.company || 'Unnamed client');
  }
  if (!names.size) return [];
  const list = [...names.values()].sort();
  const shown = list.slice(0, 3).join(', ') + (list.length > 3 ? ` +${list.length - 3} more` : '');
  return [
    {
      id: `client-gstin:${[...names.keys()].sort().join('|')}`,
      severity: 'info',
      title: `${plural(list.length, 'client')} missing GSTIN on large invoices`,
      detail: `${shown} — invoices of ${formatCurrency(LARGE_INVOICE_THRESHOLD)}+ usually need the buyer's GSTIN for input tax credit.`,
      href: '/clients',
      cta: 'Add GSTIN',
      at: ctx.now.toISOString(),
    },
  ];
};

export const BUILTIN_PROVIDERS: NotificationProvider[] = [
  overdueProvider,
  dueSoonProvider,
  staleDraftProvider,
  backupProvider,
  storageProvider,
  profileProvider,
  missingGstinProvider,
];

/* ── Registry ───────────────────────────────────────────────── */

const registered = new Set<NotificationProvider>();

/** Adds a custom provider. Returns an unregister function. */
export function registerNotificationProvider(fn: NotificationProvider): () => void {
  registered.add(fn);
  return () => {
    registered.delete(fn);
  };
}

/**
 * Runs every provider (a throwing provider is skipped, never fatal), de-dupes
 * by id (first wins) and sorts by severity then recency.
 */
export function collectNotifications(
  ctx: NotificationContext,
  providers: NotificationProvider[] = [...BUILTIN_PROVIDERS, ...registered],
): AppNotification[] {
  const seen = new Set<string>();
  const out: AppNotification[] = [];
  for (const p of providers) {
    let list: AppNotification[];
    try {
      list = p(ctx) ?? [];
    } catch {
      continue;
    }
    for (const n of list) {
      if (!n || !n.id || seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
  }
  return out.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.at.localeCompare(a.at) || a.id.localeCompare(b.id),
  );
}

/* ── State (read / snooze / dismiss) ────────────────────────── */

export interface VisibleNotification extends AppNotification {
  read: boolean;
}

export type SnoozeDays = 1 | 7;

function upsert(states: NotifState[], id: string, patch: Partial<NotifState>): NotifState[] {
  const idx = states.findIndex((s) => s.id === id);
  if (idx < 0) return [...states, { id, ...patch }];
  const next = states.slice();
  next[idx] = { ...next[idx], ...patch };
  return next;
}

export function markRead(states: NotifState[], id: string, now: Date): NotifState[] {
  return upsert(states, id, { read_at: now.toISOString() });
}

export function markAllRead(states: NotifState[], ids: string[], now: Date): NotifState[] {
  return ids.reduce((acc, id) => markRead(acc, id, now), states);
}

export function snooze(states: NotifState[], id: string, days: SnoozeDays, now: Date): NotifState[] {
  return upsert(states, id, { dismissed_until: new Date(now.getTime() + days * DAY).toISOString() });
}

export function dismiss(states: NotifState[], id: string): NotifState[] {
  return upsert(states, id, { dismissed_until: FOREVER });
}

/** Hides dismissed/snoozed notifications and flags the read ones. */
export function applyState(
  list: AppNotification[],
  states: NotifState[],
  now: Date,
): VisibleNotification[] {
  const byId = new Map(states.map((s) => [s.id, s]));
  const out: VisibleNotification[] = [];
  for (const n of list) {
    const s = byId.get(n.id);
    const until = parseDate(s?.dismissed_until);
    if (until && until.getTime() > now.getTime()) continue;
    out.push({ ...n, read: !!s?.read_at });
  }
  return out;
}

/** Drops state rows whose notification no longer exists or whose snooze has lapsed unread. */
export function pruneState(states: NotifState[], activeIds: string[], now: Date): NotifState[] {
  const active = new Set(activeIds);
  return states.filter((s) => {
    if (!active.has(s.id)) return false;
    const until = parseDate(s.dismissed_until);
    if (until && until.getTime() <= now.getTime() && !s.read_at) return false;
    return true;
  });
}

export function unreadCount(list: VisibleNotification[]): number {
  return list.filter((n) => !n.read).length;
}

/* ── Storage-backed helpers (browser) ───────────────────────── */

export function loadNotifState(): NotifState[] {
  return getTable<NotifState>(NOTIF_TABLE);
}

export function saveNotifState(states: NotifState[]): void {
  try {
    setTable(NOTIF_TABLE, states);
  } catch {
    /* if storage is full the notice simply reappears — never block the UI */
  }
}

export function getLastBackup(): string | null {
  return readRaw(LAST_BACKUP_KEY);
}

/** Call after a successful backup download so the "no backup" notice clears. */
export function recordBackup(now: Date = new Date()): void {
  try {
    writeRaw(LAST_BACKUP_KEY, now.toISOString());
  } catch {
    /* ignore */
  }
}

export function buildContext(now: Date = new Date()): NotificationContext {
  return {
    now,
    invoices: getTable<InvoiceRecord>(KEYS.invoices),
    clients: getTable<Client>(KEYS.clients),
    profile: localDb.settings.activeProfile(),
    lastBackup: getLastBackup(),
    storageUsedBytes: appDataSize() * 2,
    storageQuotaBytes: STORAGE_QUOTA_BYTES,
  };
}

/** Convenience for the bell: current visible notifications from live data. */
export function loadVisibleNotifications(now: Date = new Date()): VisibleNotification[] {
  const all = collectNotifications(buildContext(now));
  return applyState(all, loadNotifState(), now);
}

/** Unique id helper for custom providers that need one-off notices. */
export function newNotificationId(prefix = 'custom'): string {
  return `${prefix}:${generateId()}`;
}
