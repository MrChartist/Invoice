/**
 * Scheduled backups to a user-chosen folder (File System Access API) with a manual
 * download fallback for Safari / Firefox.
 *
 * Pure, unit-tested helpers: shouldBackup, shouldNudge, isBackupFile, filesToDelete,
 * parseConfig, describeAge. Everything touching browser APIs is feature-detected and
 * fail-soft: it returns a status object and never throws.
 */

import { backupFilename, buildBackup } from './backup';
import { downloadText } from './download';
import { idbDel, idbGet, idbSet } from './idb-kv';
import { DB_PREFIX, readRaw, removeRaw, writeRaw } from './storage';

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

const FILE_RE = /^mrchartist-invoice-backup-(\d{4}-\d{2}-\d{2})(?: \(\d+\))?\.json$/;

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

export function saveConfig(config: AutoBackupConfig): void {
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

/* ── File System Access plumbing ───────────────────────────────── */

type PermState = 'granted' | 'denied' | 'prompt';
interface FsFileHandle {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
export interface FsDirHandle {
  kind: 'directory';
  name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  removeEntry(name: string): Promise<void>;
  values(): AsyncIterable<{ kind: 'file' | 'directory'; name: string }>;
  queryPermission?(d: { mode: 'readwrite' }): Promise<PermState>;
  requestPermission?(d: { mode: 'readwrite' }): Promise<PermState>;
}

export function isFolderBackupSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export async function getFolderHandle(): Promise<FsDirHandle | null> {
  const h = await idbGet<FsDirHandle>(HANDLE_KEY);
  return h && h.kind === 'directory' ? h : null;
}

export async function chooseBackupFolder(): Promise<{ ok: true; name: string } | { ok: false; reason: 'unsupported' | 'cancelled' | 'failed' }> {
  if (!isFolderBackupSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const picker = (window as unknown as {
      showDirectoryPicker(o: { mode: 'readwrite'; id: string }): Promise<FsDirHandle>;
    }).showDirectoryPicker;
    const handle = await picker.call(window, { mode: 'readwrite', id: 'mrchartist-backups' });
    const saved = await idbSet(HANDLE_KEY, handle);
    return saved ? { ok: true, name: handle.name } : { ok: false, reason: 'failed' };
  } catch (err) {
    return { ok: false, reason: (err as Error)?.name === 'AbortError' ? 'cancelled' : 'failed' };
  }
}

export async function disconnectFolder(): Promise<void> {
  await idbDel(HANDLE_KEY);
}

export type BackupResult =
  | { ok: true; filename: string; method: 'folder' | 'download'; deleted: string[]; folder?: string }
  | { ok: false; reason: 'unsupported' | 'no-folder' | 'permission' | 'error'; message: string };

/** Manual fallback: normal browser download. Counts as a backup. */
export function downloadBackupNow(now: Date = new Date()): BackupResult {
  try {
    const filename = backupFilename(now);
    downloadText(filename, JSON.stringify(buildBackup(now), null, 2), 'application/json');
    recordBackup(now);
    return { ok: true, filename, method: 'download', deleted: [] };
  } catch (err) {
    return { ok: false, reason: 'error', message: (err as Error)?.message || 'Could not create the backup file.' };
  }
}

/**
 * Writes today's backup into the chosen folder and rotates old ones.
 * `interactive` must be true only from a click handler: re-requesting folder permission
 * needs a user gesture. Unattended runs (timers, page close) pass false and report
 * `permission` so the UI can ask the user to re-authorise.
 */
export async function runAutoBackup(opts: { interactive?: boolean; now?: Date } = {}): Promise<BackupResult> {
  const now = opts.now ?? new Date();
  if (!isFolderBackupSupported()) {
    return { ok: false, reason: 'unsupported', message: 'This browser cannot write to a folder. Use Download backup instead.' };
  }
  const dir = await getFolderHandle();
  if (!dir) return { ok: false, reason: 'no-folder', message: 'No backup folder is connected.' };

  try {
    let perm: PermState = (await dir.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (perm !== 'granted' && opts.interactive) {
      perm = (await dir.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
    }
    if (perm !== 'granted') {
      return { ok: false, reason: 'permission', message: 'Folder access expired. Click Back up now to re-allow it.' };
    }

    const filename = backupFilename(now);
    const file = await dir.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(buildBackup(now), null, 2));
    await writable.close();
    recordBackup(now);

    // Rotation is best effort: a failure here must not turn a good backup into an error.
    const deleted: string[] = [];
    try {
      const names: string[] = [];
      for await (const entry of dir.values()) if (entry.kind === 'file') names.push(entry.name);
      for (const name of filesToDelete(names, getConfig().retention)) {
        try {
          await dir.removeEntry(name);
          deleted.push(name);
        } catch {
          /* leave it; try again next run */
        }
      }
    } catch {
      /* ignore */
    }
    return { ok: true, filename, method: 'folder', deleted, folder: dir.name };
  } catch (err) {
    return { ok: false, reason: 'error', message: (err as Error)?.message || 'Could not write the backup.' };
  }
}

/** Runs a scheduled backup if one is due. Safe to call from timers and visibility events. */
export async function runDueBackup(now: Date = new Date()): Promise<BackupResult | null> {
  const cfg = getConfig();
  if (!cfg.enabled || !hasBackupWorthyData()) return null;
  if (!shouldBackup(getLastBackup(), now, cfg.frequency)) return null;
  return runAutoBackup({ now });
}
