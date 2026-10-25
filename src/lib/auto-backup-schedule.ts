/**
 * Backup scheduling and nudge state (pure + localStorage-backed config). Split out of
 * auto-backup.ts so the app shell (BackupNudge, AutoBackupRunner timing) does not load the
 * backup builder, encryption and folder-writing code until a backup actually runs.
 * Re-exported from auto-backup.ts, so existing imports keep working.
 */

import { DB_PREFIX, readRaw, removeRaw, writeRaw } from './storage';
import { requireAccess } from './access';

export type BackupFrequency = 'daily' | 'weekly' | 'on-close';

export interface AutoBackupConfig {
  enabled: boolean;
  frequency: BackupFrequency;
  /** How many dated files to keep in the folder. */
  retention: number;
}

export const LAST_BACKUP_KEY = `${DB_PREFIX}last_backup`;
export const CONFIG_KEY = `${DB_PREFIX}auto_backup`;
export const SNOOZE_KEY = `${DB_PREFIX}backup_snooze`;
export const HANDLE_KEY = 'backup-dir-handle';
/** IndexedDB entry holding the non-extractable backup encryption key. */
export const ENC_KEY = 'backup-enc-key';

export const NUDGE_AFTER_DAYS = 7;
export const SNOOZE_DAYS = 3;
export const RETENTION_OPTIONS = [3, 5, 7, 14, 30] as const;
export const DEFAULT_CONFIG: AutoBackupConfig = { enabled: false, frequency: 'daily', retention: 7 };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** "on-close" saves at most once per this window so tab switching does not spam writes. */
const ON_CLOSE_MIN_GAP = 5 * 60_000;

const FREQUENCIES: BackupFrequency[] = ['daily', 'weekly', 'on-close'];

/* ── Pure logic ────────────────────────────────────────────────── */

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Is a scheduled backup due? A missing/invalid last-backup is always due. */
export function shouldBackup(lastIso: string | null | undefined, now: Date, frequency: BackupFrequency): boolean {
  const last = parseTime(lastIso);
  if (last === null) return true;
  const elapsed = now.getTime() - last;
  if (elapsed < 0) return false; // clock moved backwards; do not hammer the folder
  switch (frequency) {
    case 'daily':
      return elapsed >= DAY;
    case 'weekly':
      return elapsed >= 7 * DAY;
    case 'on-close':
      return elapsed >= ON_CLOSE_MIN_GAP;
    default:
      return false;
  }
}

/** Should the non-blocking "back up your data" banner show? */
export function shouldNudge(opts: {
  lastIso: string | null | undefined;
  now: Date;
  hasData: boolean;
  snoozeUntilIso?: string | null;
  afterDays?: number;
}): boolean {
  if (!opts.hasData) return false;
  const snooze = parseTime(opts.snoozeUntilIso);
  if (snooze !== null && opts.now.getTime() < snooze) return false;
  const last = parseTime(opts.lastIso);
  if (last === null) return true;
  return opts.now.getTime() - last > (opts.afterDays ?? NUDGE_AFTER_DAYS) * DAY;
}

/** Short human text: "just now", "3 hours ago", "5 days ago". */
export function describeAge(iso: string | null | undefined, now: Date): string {
  const t = parseTime(iso);
  if (t === null) return 'never';
  const diff = Math.max(0, now.getTime() - t);
  if (diff < 60_000) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(diff / DAY);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

const FILE_RE = /^mrchartist-invoice-backup-(\d{4}-\d{2}-\d{2})(?:\.encrypted)?(?: \(\d+\))?\.json$/;

/** Only files we wrote ourselves are ever rotated away. */
export function isBackupFile(name: string): boolean {
  return FILE_RE.test(name);
}

/** Names to delete so only the newest `keep` dated backups remain. Foreign files are never listed. */
export function filesToDelete(names: string[], keep: number): string[] {
  const limit = Math.max(1, Math.floor(keep) || 1);
  const ours = names
    .filter(isBackupFile)
    .sort((a, b) => {
      const da = FILE_RE.exec(a)![1];
      const db = FILE_RE.exec(b)![1];
      if (da !== db) return da < db ? 1 : -1; // newest date first
      return a < b ? 1 : a > b ? -1 : 0;
    });
  return ours.slice(limit);
}

/** Tolerant parser for the stored config; never throws. */
export function parseConfig(raw: string | null | undefined): AutoBackupConfig {
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    const p = JSON.parse(raw) as Partial<AutoBackupConfig> | null;
    const frequency = FREQUENCIES.includes(p?.frequency as BackupFrequency)
      ? (p!.frequency as BackupFrequency)
      : DEFAULT_CONFIG.frequency;
    const r = Number(p?.retention);
    const retention = Number.isFinite(r) ? Math.min(60, Math.max(1, Math.round(r))) : DEFAULT_CONFIG.retention;
    return { enabled: p?.enabled === true, frequency, retention };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/* ── Persistence (localStorage) ────────────────────────────────── */

export function getConfig(): AutoBackupConfig {
  return parseConfig(readRaw(CONFIG_KEY));
}

/** Owner only (6.21): the schedule decides when full copies of the books are written out. */
export function saveConfig(config: AutoBackupConfig): void {
  requireAccess('data.backup');
  try {
    writeRaw(CONFIG_KEY, JSON.stringify(parseConfig(JSON.stringify(config))));
  } catch {
    /* quota — the config is tiny; the next successful write wins */
  }
}

export function getLastBackup(): string | null {
  return readRaw(LAST_BACKUP_KEY);
}

export function recordBackup(now: Date = new Date()): void {
  try {
    writeRaw(LAST_BACKUP_KEY, now.toISOString());
    removeRaw(SNOOZE_KEY);
  } catch {
    /* storage full: the backup itself already succeeded */
  }
}

export function snoozeNudge(now: Date = new Date(), days = SNOOZE_DAYS): void {
  try {
    writeRaw(SNOOZE_KEY, new Date(now.getTime() + days * DAY).toISOString());
  } catch {
    /* ignore */
  }
}

export function getSnooze(): string | null {
  return readRaw(SNOOZE_KEY);
}

/** True when the user has created anything worth protecting. */
export function hasBackupWorthyData(): boolean {
  for (const t of ['invoices', 'clients', 'transactions', 'items_catalog', 'vendors', 'purchases']) {
    const raw = readRaw(DB_PREFIX + t);
    if (raw && raw.length > 2 && raw.trim() !== '[]') return true;
  }
  return false;
}

/* ── Encryption (opt-in) ───────────────────────────────────────── */
