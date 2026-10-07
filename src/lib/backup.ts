/**
 * Backup / restore of everything the app keeps in localStorage.
 *
 * Exports carry only `mrchartist_inv_*` keys and never the PIN session. Imports
 * accept the same keys (and the older flat `{key: value}` file) and refuse
 * anything outside that namespace, so a doctored file cannot overwrite
 * unrelated site data.
 */

import { DB_PREFIX, collectAppData, readRaw, writeRaw } from './storage';
import { DEVICE_LOCAL_KEYS } from './auth';
import { localDayOf } from './dates';
import { audit } from './audit';
import { CryptoError, decryptString, encryptString, isCipherEnvelope, type CipherEnvelope } from './crypto';

export const BACKUP_APP_ID = 'mrchartist-invoice';

export const LAST_BACKUP_KEY = `${DB_PREFIX}last_backup`;

/** Wrapper for a passphrase-encrypted export. `envelope.ct` decrypts to a plain BackupFile JSON string. */
export interface EncryptedBackupFile {
  app: typeof BACKUP_APP_ID;
  encrypted: true;
  version: 1;
  exportedAt: string;
  envelope: CipherEnvelope;
}

/** Thrown by parseBackup() for an encrypted file so the UI can ask for the passphrase. */
export class EncryptedBackupError extends Error {
  readonly code = 'encrypted';
  constructor() {
    super('This backup is encrypted. Enter its passphrase to restore it.');
    this.name = 'EncryptedBackupError';
  }
}

const LOCAL_ONLY = new Set<string>(DEVICE_LOCAL_KEYS);

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  version: 1;
  exportedAt: string;
  data: Record<string, string>;
}

export interface BackupSummary {
  invoices: number;
  clients: number;
  keys: number;
}

export function buildBackup(now: Date = new Date()): BackupFile {
  const data = collectAppData();
  for (const key of LOCAL_ONLY) delete data[key];
  return { app: BACKUP_APP_ID, version: 1, exportedAt: now.toISOString(), data };
}

export function backupFilename(now: Date = new Date(), encrypted = false): string {
  return `mrchartist-invoice-backup-${localDayOf(now)}${encrypted ? '.encrypted' : ''}.json`;
}

/** Records that a backup was just exported. Call it after the file has been handed to the user. */
export function markBackupDone(now: Date = new Date()): void {
  try {
    writeRaw(LAST_BACKUP_KEY, now.toISOString());
  } catch {
    /* a failed bookkeeping write must never fail the export */
  }
}

/** ISO timestamp of the last export, or null. */
export function getLastBackup(): string | null {
  const raw = readRaw(LAST_BACKUP_KEY);
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

/** Whole days since the last export (null if never). */
export function daysSinceBackup(now: Date = new Date()): number | null {
  const last = getLastBackup();
  return last ? Math.max(0, Math.floor((now.getTime() - Date.parse(last)) / 86_400_000)) : null;
}

/** Encrypts the full backup with a passphrase (AES-GCM-256, PBKDF2-SHA-256). Returns the file text. */
export async function buildEncryptedBackup(passphrase: string, now: Date = new Date()): Promise<string> {
  if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
  const plain = JSON.stringify(buildBackup(now));
  const file: EncryptedBackupFile = {
    app: BACKUP_APP_ID,
    encrypted: true,
    version: 1,
    exportedAt: now.toISOString(),
    envelope: await encryptString(plain, passphrase),
  };
  return JSON.stringify(file, null, 2);
}

/** True when the text is one of our passphrase-encrypted exports. */
export function isEncryptedBackup(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as Partial<EncryptedBackupFile> | null;
    return !!parsed && parsed.app === BACKUP_APP_ID && parsed.encrypted === true;
  } catch {
    return false;
  }
}

/** Decrypts an encrypted export and validates it like parseBackup(). Throws a readable Error on a wrong passphrase. */
export async function decryptBackup(
  text: string,
  passphrase: string,
): Promise<{ data: Record<string, string>; summary: BackupSummary }> {
  let parsed: Partial<EncryptedBackupFile> | null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!parsed || parsed.app !== BACKUP_APP_ID || parsed.encrypted !== true || !isCipherEnvelope(parsed.envelope)) {
    throw new Error('This is not an encrypted invoice backup.');
  }
  let plain: string;
  try {
    plain = await decryptString(parsed.envelope, passphrase);
  } catch (err) {
    if (err instanceof CryptoError) throw new Error(err.message, { cause: err });
    throw err;
  }
  return parseBackup(plain);
}

function countRows(raw: string | undefined): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/** Validates a backup file's text. Throws a readable Error when it is not one of ours. */
export function parseBackup(text: string): { data: Record<string, string>; summary: BackupSummary } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('This does not look like an invoice backup.');
  }

  const root = parsed as Record<string, unknown>;
  if (root.app === BACKUP_APP_ID && root.encrypted === true) throw new EncryptedBackupError();
  const source = (root.app === BACKUP_APP_ID && root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;

  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith(DB_PREFIX) || LOCAL_ONLY.has(key)) continue;
    if (typeof value === 'string') data[key] = value;
  }
  if (Object.keys(data).length === 0) {
    throw new Error('No invoice data found in this file.');
  }

  return {
    data,
    summary: {
      invoices: countRows(data[`${DB_PREFIX}invoices`]),
      clients: countRows(data[`${DB_PREFIX}clients`]),
      keys: Object.keys(data).length,
    },
  };
}

/** Writes validated backup keys into storage. Throws StorageWriteError if the quota is hit. */
export function applyBackup(data: Record<string, string>): void {
  // All-or-nothing: if the browser refuses a write half-way (quota), put back what was
  // there before so a failed restore can never leave a mix of old and new tables.
  const written: Array<[string, string | null]> = [];
  try {
    for (const [key, value] of Object.entries(data)) {
      const before = readRaw(key);
      writeRaw(key, value);
      written.push([key, before]);
    }
  } catch (err) {
    for (const [key, before] of written.reverse()) {
      try {
        if (before === null) localStorage.removeItem(key);
        else writeRaw(key, before);
      } catch {
        /* best effort: the original error is what the user needs to see */
      }
    }
    throw err;
  }
  // Restoring replaces whatever was there; that is allowed even over a locked period, but never silent.
  audit.record({
    entity: 'system',
    entity_id: 'backup',
    action: 'restore',
    summary: `Data restored from a backup (${Object.keys(data).length} data keys)`,
  });
}

/**
 * A true restore: the device ends up with exactly the backup's tables (anything
 * the file does not contain is removed), all-or-nothing. If any write fails the
 * previous contents come back untouched. Device-local keys (PIN, lockout) are
 * never touched. Prefer this over `applyBackup` when "replace my data" is meant.
 */
export function restoreBackup(data: Record<string, string>): void {
  const snapshot = collectAppData();
  for (const key of LOCAL_ONLY) delete snapshot[key];
  try {
    wipeAppData();
    applyBackup(data);
  } catch (err) {
    wipeAppData();
    for (const [key, value] of Object.entries(snapshot)) {
      try {
        writeRaw(key, value);
      } catch {
        /* best effort — the original error below is what the user needs */
      }
    }
    throw err;
  }
}

/** Removes every app-owned key except this device's PIN / lock settings. */
export function wipeAppData(): void {
  for (const key of Object.keys(collectAppData())) {
    if (!LOCAL_ONLY.has(key)) localStorage.removeItem(key);
  }
}
