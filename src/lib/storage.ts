/**
 * Storage primitives: one synchronous key/value API over two backends.
 *
 *  - `local`: plain localStorage (Node tests, browsers without IndexedDB, and every
 *    boot until `initStorage()` succeeds).
 *  - `idb` (Phase 4.2): `initStorage()` (awaited in main.tsx before the app module is
 *    loaded) reads every `mrchartist_inv_*` data key from IndexedDB into an in-memory
 *    map. `readRaw/writeRaw/removeRaw` (and so `getTable/setTable`) stay synchronous and
 *    serve that map; writes go through to IndexedDB in batches (next task, plus a flush
 *    on `pagehide` / hidden). Other tabs are told over a BroadcastChannel and refresh.
 *
 * Device-local keys (PIN credential / lockout / session / idle, last backup, the backend
 * marker) and the non-prefixed `theme` always stay in localStorage.
 *
 * Every read is fail-soft (a corrupt or unavailable store yields an empty table rather
 * than a white screen) and every write reports failures so the UI can tell the user their
 * data did NOT save: synchronously (StorageWriteError) for localStorage, and through
 * `subscribeStorageFailure` for an IndexedDB write that fails after the fact.
 */

import { ASSET_TABLE, SNAPSHOT_TABLES, decodeRows, encodeRows, parseAssets, serializeAssets, type AssetIndex } from './assets';
import { DATA_STORE, idbAvailable, idbTx, resetIdbConnection } from './idb-kv';

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

/** Device-local marker: 'idb' once this device's data has moved to IndexedDB. */
export const STORAGE_BACKEND_KEY = `${DB_PREFIX}storage_backend`;

/** Keys that describe THIS device's state: they stay in localStorage and never travel in a backup. */
export const DEVICE_LOCAL_KEYS: readonly string[] = [
  SINGLETON_KEYS.auth,
  `${DB_PREFIX}auth_guard`,
  `${DB_PREFIX}idle_min`,
  `${DB_PREFIX}session`,
  `${DB_PREFIX}last_backup`,
  STORAGE_BACKEND_KEY,
];
const DEVICE_LOCAL = new Set(DEVICE_LOCAL_KEYS);

/** True for keys that always live in localStorage, whatever the backend. */
export const isLocalOnlyKey = (key: string): boolean => !key.startsWith(DB_PREFIX) || DEVICE_LOCAL.has(key);

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

/* ── IndexedDB-backed cache ────────────────────────────────────── */

export type StorageBackend = 'local' | 'idb';
let backend: StorageBackend = 'local';
const cache = new Map<string, string>();
/** Writes not yet committed to IndexedDB (null = delete). */
const pending = new Map<string, string | null>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
let flushError: StorageWriteError | null = null;
const failureListeners = new Set<() => void>();
const changeListeners = new Set<(key: string) => void>();
let channel: BroadcastChannel | null = null;
let listenersInstalled = false;

export const SYNC_CHANNEL = 'mrchartist_inv_sync';
const META_KEY = '__meta__';
const QUOTA_MESSAGE = 'Browser storage is full. Export a backup, then delete old invoices or large logos.';

export function storageBackend(): StorageBackend {
  return backend;
}

const inCache = (key: string) => backend === 'idb' && !isLocalOnlyKey(key);

function toWriteError(err: unknown): StorageWriteError {
  const name = (err as { name?: string } | null)?.name;
  const quota = name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
  return new StorageWriteError(quota ? QUOTA_MESSAGE : `Could not save: ${(err as Error)?.message ?? 'unknown error'}`, quota);
}

/** The last background (IndexedDB) write failure, or null once a later write succeeded. */
export function storageFailure(): StorageWriteError | null {
  return flushError;
}

export function subscribeStorageFailure(fn: () => void): () => void {
  failureListeners.add(fn);
  return () => failureListeners.delete(fn);
}

function setFlushError(err: StorageWriteError | null): void {
  if (err === flushError) return;
  flushError = err;
  for (const fn of failureListeners) fn();
}

/** Called with each key another tab changed, after this tab's cache holds the new value. */
export function subscribeStorageChanges(fn: (key: string) => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function scheduleFlush(): void {
  if (flushTimer === null) flushTimer = setTimeout(() => void flushStorage(), 0);
}

/**
 * Commit every pending write to IndexedDB now. Resolves when done (also on failure:
 * see `storageFailure()`). Await it before reloading the page after a bulk change.
 * A no-op on the localStorage backend.
 */
export async function flushStorage(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  while (flushing) await flushing;
  if (backend !== 'idb' || pending.size === 0) return;
  const batch = [...pending];
  const run = idbTx(DATA_STORE, 'readwrite', (s) => {
    for (const [k, v] of batch) {
      if (v === null) s.delete(k);
      else s.put(v, k);
    }
  }).then(
    () => {
      for (const [k, v] of batch) if (pending.has(k) && pending.get(k) === v) pending.delete(k);
      setFlushError(null);
      try {
        channel?.postMessage({ keys: batch.map(([k]) => k) });
      } catch {
        /* other tabs see it on their next load */
      }
    },
    (err: unknown) => setFlushError(toWriteError(err)),
  );
  flushing = run;
  try {
    await run;
  } finally {
    flushing = null;
  }
}

/** Flush, then reload: for restore / erase / reset paths that reload straight away. */
export function reloadAfterFlush(): void {
  void flushStorage().finally(() => window.location.reload());
}

async function onRemoteChange(keys: unknown[]): Promise<void> {
  const wanted = keys.filter((k): k is string => typeof k === 'string' && !isLocalOnlyKey(k));
  if (backend !== 'idb' || wanted.length === 0) return;
  let reqs: IDBRequest[];
  try {
    reqs = await idbTx(DATA_STORE, 'readonly', (s) => wanted.map((k) => s.get(k)));
  } catch {
    return;
  }
  wanted.forEach((k, i) => {
    if (pending.has(k)) return; // this tab's newer, unsaved write wins (as it did with localStorage)
    const v: unknown = reqs[i].result;
    if (typeof v === 'string') cache.set(k, v);
    else cache.delete(k);
  });
  for (const k of wanted) for (const fn of changeListeners) fn(k);
}

function installIdbListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('pagehide', () => void flushStorage());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushStorage();
    });
  }
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(SYNC_CHANNEL);
      channel.onmessage = (e: MessageEvent) => {
        const keys = (e.data as { keys?: unknown } | null)?.keys;
        if (Array.isArray(keys)) void onRemoteChange(keys);
      };
      (channel as BroadcastChannel & { unref?: () => void }).unref?.(); // Node: never keep the process alive
    } catch {
      channel = null;
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`IndexedDB did not answer within ${ms} ms`)), ms);
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

async function readAllData(): Promise<{ data: Map<string, string>; meta: boolean }> {
  const [keysReq, valuesReq] = await idbTx(DATA_STORE, 'readonly', (s) => [s.getAllKeys(), s.getAll()] as const);
  const keys = keysReq.result;
  const values = valuesReq.result as unknown[];
  const data = new Map<string, string>();
  let meta = false;
  keys.forEach((k, i) => {
    const v = values[i];
    if (k === META_KEY) meta = true;
    else if (typeof k === 'string' && !isLocalOnlyKey(k) && typeof v === 'string') data.set(k, v);
  });
  return { data, meta };
}

export type StorageInit =
  | { backend: 'idb'; moved: number }
  /** Plain localStorage: IndexedDB is missing or failed, and the data is still in localStorage. */
  | { backend: 'local'; reason: string }
  /** This device's data lives in IndexedDB, which cannot be opened now: do not start on an empty store. */
  | { backend: 'unavailable'; reason: string };

/**
 * Boot step (main.tsx, before the app module is loaded): switch to the IndexedDB-backed cache.
 *
 * Until this device has completed a verified move, localStorage is the source of truth:
 * every localStorage data key is written into IndexedDB in ONE transaction together with a
 * marker, read back and compared, and only then is the localStorage copy removed. Any
 * failure leaves localStorage untouched and the session on the `local` backend; the next
 * boot retries. Afterwards IndexedDB is the truth: a data key found in localStorage (an
 * outdated tab still running old code) is imported only when IndexedDB lacks it, otherwise
 * dropped, so it can never overwrite newer data.
 */
export async function initStorage(opts: { timeoutMs?: number } = {}): Promise<StorageInit> {
  if (backend === 'idb') return { backend: 'idb', moved: 0 };
  const timeout = opts.timeoutMs ?? 8000;
  const ls = store();
  let marked = false;
  try {
    marked = ls?.getItem(STORAGE_BACKEND_KEY) === 'idb';
  } catch {
    /* unreadable: treat as not moved */
  }
  const fail = (reason: string): StorageInit => (marked ? { backend: 'unavailable', reason } : { backend: 'local', reason });
  if (!idbAvailable()) return fail('IndexedDB is not available in this browser.');

  try {
    const lsData = new Map<string, string>();
    if (ls) {
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && !isLocalOnlyKey(k)) {
          const v = ls.getItem(k);
          if (v !== null) lsData.set(k, v);
        }
      }
    }
    const stored = await withTimeout(readAllData(), timeout);
    const lsIsTruth = marked ? !stored.meta : lsData.size > 0 || !stored.meta;
    const target = new Map(lsIsTruth ? lsData : stored.data);
    if (!lsIsTruth) for (const [k, v] of lsData) if (!target.has(k)) target.set(k, v);

    const puts = [...target].filter(([k, v]) => stored.data.get(k) !== v);
    const dels = [...stored.data.keys()].filter((k) => !target.has(k));
    if (!stored.meta || puts.length > 0 || dels.length > 0) {
      await withTimeout(
        idbTx(DATA_STORE, 'readwrite', (s) => {
          for (const k of dels) s.delete(k);
          for (const [k, v] of puts) s.put(v, k);
          s.put(Date.now(), META_KEY); // marker: a verified copy was made (value = when)
        }),
        timeout,
      );
      const check = await withTimeout(readAllData(), timeout);
      const ok = check.meta && check.data.size === target.size && [...target].every(([k, v]) => check.data.get(k) === v);
      if (!ok) throw new Error('The IndexedDB copy did not match localStorage.');
    }

    for (const [k, v] of target) cache.set(k, v);
    backend = 'idb';
    installIdbListeners();
    try {
      ls?.setItem(STORAGE_BACKEND_KEY, 'idb'); // before removing the copy: never boot on an empty localStorage
      for (const k of lsData.keys()) ls?.removeItem(k);
    } catch {
      /* the copy stays behind; it is ignored from now on */
    }
    return { backend: 'idb', moved: lsIsTruth ? puts.length : 0 };
  } catch (err) {
    resetIdbConnection(); // a stuck open must not block later IndexedDB use (safety snapshot, folder backup)
    return fail((err as Error)?.message ?? String(err));
  }
}

/** Test seam: back to plain localStorage with an empty cache. */
export function resetStorageBackend(): void {
  backend = 'local';
  cache.clear();
  pending.clear();
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  flushing = null;
  flushError = null;
  assetCache = null;
  try {
    channel?.close();
  } catch {
    /* already closed */
  }
  channel = null;
  listenersInstalled = false;
}

/* ── Synchronous API ───────────────────────────────────────────── */

export function isStorageAvailable(): boolean {
  return backend === 'idb' || store() !== null;
}

export function readRaw(fullKey: string): string | null {
  if (inCache(fullKey)) return cache.get(fullKey) ?? null;
  try {
    return store()?.getItem(fullKey) ?? null;
  } catch {
    return null;
  }
}

export function writeRaw(fullKey: string, value: string): void {
  if (inCache(fullKey)) {
    // While IndexedDB refuses writes for lack of space, refuse anything that grows the data so
    // the UI shows its usual "storage is full" error; shrinking writes go through and retry.
    if (flushError?.quotaExceeded && value.length > (cache.get(fullKey)?.length ?? 0)) throw flushError;
    cache.set(fullKey, value);
    pending.set(fullKey, value);
    scheduleFlush();
    return;
  }
  const s = store();
  if (!s) throw new StorageWriteError('Local storage is not available in this browser.', false);
  try {
    s.setItem(fullKey, value);
  } catch (err) {
    throw toWriteError(err);
  }
}

export function removeRaw(fullKey: string): void {
  if (inCache(fullKey)) {
    if (!cache.has(fullKey) && !pending.has(fullKey)) return;
    cache.delete(fullKey);
    pending.set(fullKey, null);
    scheduleFlush();
    return;
  }
  try {
    store()?.removeItem(fullKey);
  } catch {
    /* nothing to do — the value is already unreachable */
  }
}

/** Parsed asset table, re-parsed only when the stored text changes. */
let assetCache: { raw: string | null; idx: AssetIndex } | null = null;

function assetIndex(): AssetIndex {
  const raw = readRaw(DB_PREFIX + ASSET_TABLE);
  if (!assetCache || assetCache.raw !== raw) assetCache = { raw, idx: parseAssets(raw) };
  return assetCache.idx;
}

export function getTable<T>(name: string): T[] {
  const raw = readRaw(DB_PREFIX + name);
  if (!raw) return [];
  let rows: T[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    rows = parsed as T[];
  } catch {
    return [];
  }
  // Snapshot images are stored by reference (assets.ts); readers always get the data URL back.
  return SNAPSHOT_TABLES.has(name) ? decodeRows(rows, assetIndex()) : rows;
}

export function setTable<T>(name: string, rows: T[]): void {
  if (!SNAPSHOT_TABLES.has(name)) {
    writeRaw(DB_PREFIX + name, JSON.stringify(rows));
    return;
  }
  const idx = assetIndex();
  const encoded = encodeRows(rows, idx);
  if (encoded.added) {
    const raw = serializeAssets(idx);
    try {
      // The asset goes in first so a stored reference can never dangle.
      writeRaw(DB_PREFIX + ASSET_TABLE, raw);
      assetCache = { raw, idx };
    } catch (err) {
      assetCache = null; // idx holds an asset that was not stored
      throw err;
    }
  }
  writeRaw(DB_PREFIX + name, JSON.stringify(encoded.rows));
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
  if (s) {
    try {
      for (let i = 0; i < s.length; i++) {
        const key = s.key(i);
        // With the cache, localStorage only holds device-local keys (anything else is a stale copy).
        if (key && key.startsWith(DB_PREFIX) && (backend === 'local' || isLocalOnlyKey(key))) {
          const value = s.getItem(key);
          if (value !== null) out[key] = value;
        }
      }
    } catch {
      /* unreadable localStorage: report what the cache has */
    }
  }
  if (backend === 'idb') for (const [key, value] of cache) out[key] = value;
  return out;
}

/** Approximate bytes used by app data — surfaced in Settings as a usage meter. */
export function appDataSize(): number {
  return Object.entries(collectAppData()).reduce((sum, [k, v]) => sum + k.length + v.length, 0);
}
