/**
 * Scheduled backups to a user-chosen folder (File System Access API) with a manual
 * download fallback for Safari / Firefox.
 *
 * Pure, unit-tested helpers: shouldBackup, shouldNudge, isBackupFile, filesToDelete,
 * parseConfig, describeAge. Everything touching browser APIs is feature-detected and
 * fail-soft: it returns a status object and never throws.
 */

import { requireAccess } from './access';
import { VAULT_PLAIN_BACKUP_MESSAGE, backupFilename, buildEncryptedBackupWithKey, buildScheduledBackup, exportPlainBackup, plainBackupAllowed } from './backup';
import { deriveEncryptionKey, type StoredEncryptionKey } from './crypto';
import { downloadText } from './download';
import { idbClear, idbDel, idbGet, idbSet } from './idb-kv';
import { forgetVault, vaultEnabled } from './storage';

export * from './auto-backup-schedule';
import { ENC_KEY, HANDLE_KEY, filesToDelete, getConfig, getLastBackup, hasBackupWorthyData, recordBackup, shouldBackup } from './auto-backup-schedule';

let cachedKey: StoredEncryptionKey | null | undefined;

function isStoredKey(v: unknown): v is StoredEncryptionKey {
  const k = v as StoredEncryptionKey | null;
  return !!k && typeof k === 'object' && typeof k.salt === 'string' && Number.isInteger(k.iter) && !!k.key;
}

/** The stored backup key, or null when scheduled backups are written as plain JSON. */
export async function getBackupKey(): Promise<StoredEncryptionKey | null> {
  if (cachedKey !== undefined) return cachedKey;
  const v = await idbGet<StoredEncryptionKey>(ENC_KEY);
  cachedKey = isStoredKey(v) ? v : null;
  return cachedKey;
}

export async function hasBackupEncryption(): Promise<boolean> {
  return (await getBackupKey()) !== null;
}

/**
 * Turn on encrypted backups. The passphrase itself is never stored: a key derived from it
 * (non-extractable, encrypt-only) is kept in IndexedDB. Restoring a file needs the passphrase.
 */
export async function setBackupPassphrase(passphrase: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (passphrase.length < 8) return { ok: false, message: 'Use a passphrase of at least 8 characters.' };
  try {
    requireAccess('data.backup');
    const stored = await deriveEncryptionKey(passphrase);
    if (!(await idbSet(ENC_KEY, stored))) return { ok: false, message: 'This browser could not store the encryption key.' };
    cachedKey = stored;
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error)?.message || 'Could not set up encryption.' };
  }
}

/**
 * Forget everything this device keeps outside localStorage: the restore undo copy, the backup
 * encryption key and the backup-folder handle. Erase and the Forgot-PIN reset call it so a new
 * PIN holder can neither "undo" the owner's data back nor write over the owner's backup folder.
 */
export async function forgetDeviceData(): Promise<void> {
  await idbClear();
  cachedKey = null;
  await forgetVault(); // vault mode: the next boot starts fresh instead of asking for a passphrase
}

/** Owner only. In vault mode scheduled backups then stop (they are never written readable). */
export async function clearBackupPassphrase(): Promise<void> {
  requireAccess('data.backup');
  await idbDel(ENC_KEY);
  cachedKey = null;
}

/**
 * File name and text for a backup, encrypted when a key is stored. Owner only, except `scheduled`
 * (unattended runs into the folder the owner set up). Without a key the file is plain JSON, which is
 * refused in vault mode (the data is encrypted at rest; a readable copy in a synced folder would undo it).
 */
export async function backupPayload(now: Date, key: StoredEncryptionKey | null = null, opts: { scheduled?: boolean } = {}): Promise<{ filename: string; text: string }> {
  if (key) return { filename: backupFilename(now, true), text: await buildEncryptedBackupWithKey(key, now, opts) };
  if (!opts.scheduled) return { filename: backupFilename(now), text: exportPlainBackup(now) };
  if (!plainBackupAllowed()) throw new Error(VAULT_PLAIN_BACKUP_MESSAGE);
  return { filename: backupFilename(now), text: JSON.stringify(buildScheduledBackup(now), null, 2) };
}

/** Vault mode is on but no backup passphrase is set: every backup this module writes would be refused. */
export async function backupNeedsEncryption(): Promise<boolean> {
  return vaultEnabled() && (await getBackupKey()) === null;
}

/** True when `readBack` is exactly what was written and parses as one of our backups. */
export function isIntactBackup(readBack: string, written: string): boolean {
  if (readBack !== written) return false;
  try {
    const parsed = JSON.parse(readBack) as { app?: unknown } | null;
    return parsed?.app === 'mrchartist-invoice';
  } catch {
    return false;
  }
}

/* ── File System Access plumbing ───────────────────────────────── */

type PermState = 'granted' | 'denied' | 'prompt';
interface FsFileHandle {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  getFile?(): Promise<{ text(): Promise<string> }>;
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

/** Owner only (throws AccessDeniedError): the folder receives full copies of the books. */
export async function chooseBackupFolder(): Promise<{ ok: true; name: string } | { ok: false; reason: 'unsupported' | 'cancelled' | 'failed' }> {
  requireAccess('data.backup');
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
  requireAccess('data.backup');
  await idbDel(HANDLE_KEY);
}

export type BackupResult =
  | {
      ok: true;
      filename: string;
      method: 'folder' | 'download';
      deleted: string[];
      folder?: string;
      /** Folder backups are read back after writing: true = the file reopened intact. */
      verified?: boolean;
    }
  | { ok: false; reason: 'unsupported' | 'no-folder' | 'permission' | 'denied' | 'encryption' | 'error'; message: string };

/** Manual fallback: normal browser download (encrypted when a key is stored). Counts as a backup. */
export async function downloadBackupNow(now: Date = new Date()): Promise<BackupResult> {
  try {
    // Local roles (6.21): handing someone a full copy of the books is owner-only. Automatic folder
    // backups the owner set up keep running whoever is signed in (they go to the owner's folder).
    requireAccess('data.backup');
  } catch (err) {
    return { ok: false, reason: 'denied', message: (err as Error).message };
  }
  try {
    if (await backupNeedsEncryption()) return { ok: false, reason: 'encryption', message: VAULT_PLAIN_BACKUP_MESSAGE };
    const { filename, text } = await backupPayload(now, await getBackupKey());
    downloadText(filename, text, 'application/json');
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
  // "Back up now" is a person asking for a full copy: owner only (6.21). Unattended runs keep going
  // whoever is signed in — the owner chose the folder and the schedule (both owner-only to change).
  if (opts.interactive) {
    try {
      requireAccess('data.backup');
    } catch (err) {
      return { ok: false, reason: 'denied', message: (err as Error).message };
    }
  }
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

    if (await backupNeedsEncryption()) return { ok: false, reason: 'encryption', message: VAULT_PLAIN_BACKUP_MESSAGE };
    const { filename, text } = await backupPayload(now, await getBackupKey(), { scheduled: !opts.interactive });
    const file = await dir.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    await writable.write(text);
    await writable.close();

    // Read the file back: a backup that cannot be reopened is not a backup.
    let verified: boolean | undefined;
    try {
      const back = await (await dir.getFileHandle(filename)).getFile?.();
      if (back) verified = isIntactBackup(await back.text(), text);
    } catch {
      verified = false;
    }
    if (verified === false) {
      return { ok: false, reason: 'error', message: 'The backup file could not be read back from the folder. Try again or pick another folder.' };
    }
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
    return { ok: true, filename, method: 'folder', deleted, folder: dir.name, verified };
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
