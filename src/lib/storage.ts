/**
 * localStorage primitives.
 *
 * Every read is fail-soft (a corrupt or unavailable store yields an empty
 * table rather than a white screen) and every write reports quota failures so
 * the UI can tell the user their data did NOT save instead of losing it
 * silently. `localStorage` is also absent in the Node test runtime, which this
 * module tolerates.
 */

export const DB_PREFIX = 'mrchartist_inv_';

export const KEYS = {
  clients: 'clients',
  items: 'items_catalog',
  invoices: 'invoices',
  transactions: 'transactions',
} as const;

/** Full keys that are not tables but still belong to the app's backup set. */
export const SINGLETON_KEYS = {
  settings: `${DB_PREFIX}settings`,
  template: `${DB_PREFIX}template`,
  draft: `${DB_PREFIX}draft`,
  auth: `${DB_PREFIX}auth`,
} as const;

export const THEME_KEY = 'theme';

export class StorageWriteError extends Error {
  readonly quotaExceeded: boolean;
  constructor(message: string, quotaExceeded: boolean) {
    super(message);
    this.name = 'StorageWriteError';
    this.quotaExceeded = quotaExceeded;
  }
}

function store(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Touching a property is what actually throws in restricted contexts.
    localStorage.getItem(`${DB_PREFIX}__probe`);
    return localStorage;
  } catch {
    return null;
  }
}

export function isStorageAvailable(): boolean {
  return store() !== null;
}

export function readRaw(fullKey: string): string | null {
  try {
    return store()?.getItem(fullKey) ?? null;
  } catch {
    return null;
  }
}

export function writeRaw(fullKey: string, value: string): void {
  const s = store();
  if (!s) throw new StorageWriteError('Local storage is not available in this browser.', false);
  try {
    s.setItem(fullKey, value);
  } catch (err) {
    const quota =
      err instanceof DOMException &&
      (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    throw new StorageWriteError(
      quota
        ? 'Browser storage is full. Export a backup, then delete old invoices or large logos.'
        : `Could not write to local storage: ${(err as Error)?.message ?? 'unknown error'}`,
      quota,
    );
  }
}

export function removeRaw(fullKey: string): void {
  try {
    store()?.removeItem(fullKey);
  } catch {
    /* nothing to do — the value is already unreachable */
  }
}

export function getTable<T>(name: string): T[] {
  const raw = readRaw(DB_PREFIX + name);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function setTable<T>(name: string, rows: T[]): void {
  writeRaw(DB_PREFIX + name, JSON.stringify(rows));
}

export function getJson<T>(fullKey: string, fallback: T): T {
  const raw = readRaw(fullKey);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJson(fullKey: string, value: unknown): void {
  writeRaw(fullKey, JSON.stringify(value));
}

export function generateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the manual generator */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Every app-owned key/value pair — the payload for export/import backups. */
export function collectAppData(): Record<string, string> {
  const s = store();
  const out: Record<string, string> = {};
  if (!s) return out;
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (key && key.startsWith(DB_PREFIX)) {
      const value = s.getItem(key);
      if (value !== null) out[key] = value;
    }
  }
  return out;
}

/** Approximate bytes used by app data — surfaced in Settings as a usage meter. */
export function appDataSize(): number {
  return Object.entries(collectAppData()).reduce((sum, [k, v]) => sum + k.length + v.length, 0);
}
