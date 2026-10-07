/**
 * Backup / restore of everything the app keeps in localStorage.
 *
 * Exports carry only `mrchartist_inv_*` keys and never the PIN session. Imports
 * accept the same keys (and the older flat `{key: value}` file) and refuse
 * anything outside that namespace, so a doctored file cannot overwrite
 * unrelated site data.
 */

import { DB_PREFIX, SINGLETON_KEYS, collectAppData, writeRaw } from './storage';

export const BACKUP_APP_ID = 'mrchartist-invoice';

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
  delete data[SINGLETON_KEYS.auth];
  return { app: BACKUP_APP_ID, version: 1, exportedAt: now.toISOString(), data };
}

export function backupFilename(now: Date = new Date()): string {
  return `mrchartist-invoice-backup-${now.toISOString().slice(0, 10)}.json`;
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
  const source = (root.app === BACKUP_APP_ID && root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>;

  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith(DB_PREFIX) || key === SINGLETON_KEYS.auth) continue;
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
  for (const [key, value] of Object.entries(data)) writeRaw(key, value);
}

/** Removes every app-owned key except the PIN session. */
export function wipeAppData(): void {
  for (const key of Object.keys(collectAppData())) {
    if (key !== SINGLETON_KEYS.auth) localStorage.removeItem(key);
  }
}
