/**
 * Storage primitives: one synchronous key/value API over two backends.
 *
 *  - `local`: plain localStorage (Node tests, browsers without IndexedDB, and every
 *    boot until `initStorage()` succeeds).
 *  - `idb` (Phase 4.2): `initStorage()` (awaited in main.tsx before the first render and before
 *    anything reads data; modules imported by main.tsx must not read storage at load time) reads every `mrchartist_inv_*` data key from IndexedDB into an in-memory
 *    map. `readRaw/writeRaw/removeRaw` (and so `getTable/setTable`) stay synchronous and
 *    serve that map; writes go through to IndexedDB in batches (next task, plus a flush
 *    on `pagehide` / hidden). Other tabs are told over a BroadcastChannel and refresh.
 *
 * Device-local keys (PIN credential / lockout / session / idle, last backup, the backend
 * marker, interface language) and the non-prefixed `theme` always stay in localStorage.
 *
 * Every read is fail-soft (a corrupt or unavailable store yields an empty table rather
 * than a white screen) and every write reports failures so the UI can tell the user their
 * data did NOT save: synchronously (StorageWriteError) for localStorage, and through
 * `subscribeStorageFailure` for an IndexedDB write that fails after the fact.
 */

import { ASSET_TABLE, SNAPSHOT_TABLES, decodeRows, encodeRows, parseAssets, serializeAssets, type AssetIndex } from './assets';
import { DATA_STORE, idbAvailable, idbClear, idbTx, resetIdbConnection } from './idb-kv';
import { COMPANY_REGISTRY_KEY, DEFAULT_COMPANY_ID, activeCompanyId } from './company-registry';
import { requireAccess, requireTableWrite } from './access';
import {
  VAULT_KEY,
  VaultError,
  createVault,
  isSealed,
  isVaultRecord,
  rewrapVault,
  seal,
  unseal,
  unwrapDek,
  type VaultRecord,
} from './vault';

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

/** Interface language of THIS device (5.4): 'en' (default) or 'hi'. Read before unlock, never backed up. */
export const LANG_KEY = `${DB_PREFIX}lang`;

/** Device-local marker: 'idb' once this device's data has moved to IndexedDB. */
export const STORAGE_BACKEND_KEY = `${DB_PREFIX}storage_backend`;

/** Keys that describe THIS device's state: they stay in localStorage and never travel in a backup. */
export const DEVICE_LOCAL_KEYS: readonly string[] = [
  SINGLETON_KEYS.auth,
  `${DB_PREFIX}auth_guard`,
  /** Extra local users (6.21: clerk / viewer PIN hashes) and their per-user lockout counters. */
  `${DB_PREFIX}auth_users`,
  `${DB_PREFIX}auth_guard_users`,
  `${DB_PREFIX}idle_min`,
  `${DB_PREFIX}session`,
  `${DB_PREFIX}last_backup`,
  STORAGE_BACKEND_KEY,
  COMPANY_REGISTRY_KEY,
  `${DB_PREFIX}sync_device`, // folder sync (5.7): this device's id / name / per-company switch
  LANG_KEY,
  `${DB_PREFIX}save_choice`, // 8G A4: the editor's last Save / Save & print / Save & WhatsApp choice
];

/**
 * Folder sync bookkeeping (5.7): per company (IndexedDB, sealed in vault mode) but never in a backup or
 * the restore undo copy: it describes what THIS device last exchanged with the sync folder. A restore or
 * erase removes it, so the next sync compares from scratch and surfaces differences as conflicts.
 */
export const SYNC_META_KEYS: readonly string[] = [`${DB_PREFIX}sync_state`, `${DB_PREFIX}sync_conflicts`, `${DB_PREFIX}sync_audit`];
/**
 * Working drafts of THIS device (8.21: POS bills on hold): per company in the data store, so sealed in
 * vault mode, but never in a backup, never synced, not announced to other tabs; restore / erase remove them.
 */
export const DEVICE_DRAFT_KEYS: readonly string[] = [`${DB_PREFIX}pos_held`];
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
/** Moves on every write, removal or cross-tab refresh of any key this module serves (see `storageVersion`). */
let dataVersion = 0;

/**
 * A counter that changes whenever anything stored through this module may have changed: every
 * `writeRaw` / `removeRaw` (so every `setTable` / `setJson`), another tab's IndexedDB change, boot,
 * unlock and reset. Writes made behind its back (another tab's localStorage write: listen for the
 * window `storage` event) are not seen.
 */
export function storageVersion(): number {
  return dataVersion;
}

/* Vault mode (5.8): with a vault, every value in IndexedDB is sealed with `vaultKey`. */
let vaultKey: CryptoKey | null = null;
let vaultId: string | null = null;
/** Boot found a vault: the sealed data waits here until `unlockStorage(passphrase)`. */
let locked: { lsKeys: string[] } | null = null;
/** Keys left untouched by the last unlock (could not be decrypted, or were not encrypted). */
let skippedKeys: string[] = [];
/** Set once a write was refused because another tab changed vault mode: no further writes until reload. */
let vaultConflict: StorageWriteError | null = null;

class VaultConflictError extends Error {}

/**
 * One readwrite transaction on the data store that first reads the vault record and aborts unless
 * its id is `expect` (null = "no vault"). The check and the writes are atomic, so a write can never
 * land in a store whose vault mode another tab has just changed.
 */
async function guardedWrite(expect: string | null, write: (s: IDBObjectStore) => void): Promise<void> {
  let conflict = false;
  try {
    await idbTx(
      DATA_STORE,
      'readwrite',
      (s, tx) => {
        const r = s.get(VAULT_KEY);
        r.onsuccess = () => {
          const rec: unknown = r.result;
          const id = rec === undefined ? null : isVaultRecord(rec) ? rec.id : '';
          if (id !== expect) {
            conflict = true;
            tx.abort();
            return;
          }
          write(s);
        };
      },
      { commit: false },
    );
  } catch (err) {
    if (conflict) throw new VaultConflictError('Vault mode was changed in another tab.');
    throw err;
  }
}

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
  const key = vaultKey;
  const expect = vaultId;
  const run = (async () => {
    const values: (string | null)[] = key
      ? await Promise.all(batch.map(([k, v]) => (v === null ? null : seal(key, k, v))))
      : batch.map(([, v]) => v);
    // Sealed values only into this tab's vault; readable ones only into a store with no vault.
    await guardedWrite(expect, (s) => {
      batch.forEach(([k], i) => {
        const v = values[i];
        if (v === null) s.delete(k);
        else s.put(v, k);
      });
    });
  })().then(
    () => {
      for (const [k, v] of batch) if (pending.has(k) && pending.get(k) === v) pending.delete(k);
      setFlushError(null);
      try {
        channel?.postMessage({ keys: batch.map(([k]) => k) });
      } catch {
        /* other tabs see it on their next load */
      }
    },
    (err: unknown) => {
      if (err instanceof VaultConflictError) {
        vaultConflict = new StorageWriteError(
          'Vault mode was changed in another tab, so changes in this tab can no longer be saved. Reload this tab.',
          false,
        );
        setFlushError(vaultConflict);
      } else setFlushError(toWriteError(err));
    },
  );
  flushing = run;
  try {
    await run;
  } finally {
    flushing = null;
  }
}

/**
 * Flush, then reload: for restore / erase / reset paths that reload straight away. If the flush
 * failed, ask first — a reload would drop the unsaved changes.
 */
export function reloadAfterFlush(): void {
  void flushStorage().finally(() => {
    const err = flushError;
    if (err && !window.confirm(`${err.message}\n\nSome changes are not saved. Reload anyway and lose them?`)) return;
    window.location.reload();
  });
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
  const values = await Promise.all(
    reqs.map(async (r, i): Promise<string | null | undefined> => {
      const v: unknown = r.result;
      if (typeof v !== 'string') return null;
      if (!isSealed(v)) return vaultKey ? undefined : v; // a vault store holds only sealed values
      if (!vaultKey) return undefined; // sealed by a vault this tab has not unlocked: its broadcast reloads us
      try {
        return await unseal(vaultKey, wanted[i], v);
      } catch {
        return undefined;
      }
    }),
  );
  wanted.forEach((k, i) => {
    if (pending.has(k)) return; // this tab's newer, unsaved write wins (as it did with localStorage)
    const v = values[i];
    if (v === undefined) return;
    if (v === null) cache.delete(k);
    else cache.set(k, v);
  });
  dataVersion++;
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
      // Per company, so tabs on another company's data are not told about keys they do not hold.
      const company = activeCompanyId();
      channel = new BroadcastChannel(company === DEFAULT_COMPANY_ID ? SYNC_CHANNEL : `${SYNC_CHANNEL}__${company}`);
      channel.onmessage = (e: MessageEvent) => {
        const msg = e.data as { keys?: unknown; vault?: unknown } | null;
        if (msg?.vault === 'changed') {
          // Another tab switched vault mode on/off: this tab's key (or lack of one) is stale.
          if (typeof window !== 'undefined') reloadAfterFlush();
          return;
        }
        const keys = msg?.keys;
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

async function readAllData(): Promise<{ data: Map<string, string>; meta: boolean; vault: unknown }> {
  const [keysReq, valuesReq] = await idbTx(DATA_STORE, 'readonly', (s) => [s.getAllKeys(), s.getAll()] as const);
  const keys = keysReq.result;
  const values = valuesReq.result as unknown[];
  const data = new Map<string, string>();
  let meta = false;
  let vault: unknown = undefined;
  keys.forEach((k, i) => {
    const v = values[i];
    if (k === META_KEY) meta = true;
    else if (k === VAULT_KEY) vault = v;
    else if (typeof k === 'string' && !isLocalOnlyKey(k) && typeof v === 'string') data.set(k, v);
  });
  return { data, meta, vault };
}

export type StorageInit =
  | { backend: 'idb'; moved: number }
  /** Plain localStorage: IndexedDB is missing or failed, and the data is still in localStorage. */
  | { backend: 'local'; reason: string }
  /** This device's data lives in IndexedDB, which cannot be opened now: do not start on an empty store. */
  | { backend: 'unavailable'; reason: string; vaultDamaged?: boolean }
  /** Vault mode: the data is encrypted; call `unlockStorage(passphrase)` before anything reads it. */
  | { backend: 'locked' };

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
    // localStorage copies (pre-4.2 data, stale tabs) belong to the main company only.
    if (ls && activeCompanyId() === DEFAULT_COMPANY_ID) {
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && !isLocalOnlyKey(k)) {
          const v = ls.getItem(k);
          if (v !== null) lsData.set(k, v);
        }
      }
    }
    const stored = await withTimeout(readAllData(), timeout);
    if (stored.vault !== undefined) {
      if (!isVaultRecord(stored.vault)) {
        return { backend: 'unavailable', reason: 'The vault record on this device is damaged.', vaultDamaged: true };
      }
      // The data is read again at unlock time (another tab may change it meanwhile); listen for a
      // vault change elsewhere so the unlock screen reloads.
      locked = { lsKeys: [...lsData.keys()] };
      installIdbListeners();
      return { backend: 'locked' };
    }
    // Sealed values but no vault record (deleted, or lost half-way): this is encrypted data that can
    // never be opened again. Never boot in plain mode over it — that would write readable data next to
    // (and over) the sealed values. The unavailable screen offers the erase instead.
    for (const v of stored.data.values()) {
      if (isSealed(v)) {
        return { backend: 'unavailable', reason: 'The data on this device is encrypted but its vault record is missing (vault damaged).', vaultDamaged: true };
      }
    }
    const lsIsTruth = marked ? !stored.meta : lsData.size > 0 || !stored.meta;
    const target = new Map(lsIsTruth ? lsData : stored.data);
    if (!lsIsTruth) for (const [k, v] of lsData) if (!target.has(k)) target.set(k, v);

    const puts = [...target].filter(([k, v]) => stored.data.get(k) !== v);
    const dels = [...stored.data.keys()].filter((k) => !target.has(k));
    if (!stored.meta || puts.length > 0 || dels.length > 0) {
      await withTimeout(
        // Guarded: if another tab turned vault mode on meanwhile, nothing readable is written.
        guardedWrite(null, (s) => {
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
    dataVersion++;
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
    resetIdbConnection(true); // a stuck open must not block later IndexedDB use (safety snapshot, folder backup)
    return fail((err as Error)?.message ?? String(err));
  }
}

/**
 * Vault mode: decrypt the store into the cache and switch to the IndexedDB backend (after
 * `initStorage()` returned `locked`). The store and the vault record are read afresh here, so a tab
 * that sat on the unlock screen while another tab worked opens the current data. Throws
 * VaultError('wrong-passphrase'). Values that fail to decrypt, and values that are not encrypted at
 * all (nothing legitimate writes those into a vault store), are left untouched and reported.
 */
export async function unlockStorage(passphrase: string): Promise<{ unreadable: string[] }> {
  if (!locked) throw new VaultError('Nothing is locked.', 'bad-record');
  const fresh = await readAllData();
  const unreadable: string[] = [];
  const plain = new Map<string, string>();
  let key: CryptoKey | null = null;
  let id: string | null = null;
  if (fresh.vault !== undefined) {
    if (!isVaultRecord(fresh.vault)) throw new VaultError('The vault record on this device is damaged.', 'bad-record');
    key = await unwrapDek(fresh.vault, passphrase);
    id = fresh.vault.id;
    const k = key;
    await Promise.all(
      [...fresh.data].map(async ([name, v]) => {
        if (!isSealed(v)) {
          unreadable.push(name);
          return;
        }
        try {
          plain.set(name, await unseal(k, name, v));
        } catch {
          unreadable.push(name);
        }
      }),
    );
  } else {
    // Vault mode was turned off in another tab meanwhile: the store is readable as it is.
    for (const [name, v] of fresh.data) {
      if (isSealed(v)) unreadable.push(name);
      else plain.set(name, v);
    }
  }
  // A stale tab's localStorage copy is dropped, not imported: it could be planted plaintext.
  const ls = store();
  for (const k of locked.lsKeys) {
    try {
      ls?.removeItem(k);
    } catch {
      /* ignored from now on */
    }
  }
  locked = null;
  cache.clear();
  pending.clear();
  for (const [k, v] of plain) cache.set(k, v);
  dataVersion++;
  vaultKey = key;
  vaultId = id;
  skippedKeys = unreadable.sort();
  backend = 'idb';
  installIdbListeners();
  return { unreadable: [...skippedKeys] };
}

export function vaultEnabled(): boolean {
  return vaultKey !== null;
}

/**
 * Things kept outside the data store that must follow a vault switch (the restore undo copy in the
 * `kv` store, registered by backup.ts): `before` reads them with the old key, `after` re-stores them
 * under the new mode.
 */
export interface VaultTransitionHook {
  before: () => Promise<unknown>;
  after: (state: unknown) => Promise<void>;
}
const transitionHooks: VaultTransitionHook[] = [];
export function registerVaultTransition(hook: VaultTransitionHook): void {
  transitionHooks.push(hook);
}
async function aroundVaultSwitch(change: () => Promise<void>): Promise<void> {
  const states = await Promise.all(transitionHooks.map((h) => h.before().catch(() => undefined)));
  await change();
  await Promise.all(transitionHooks.map((h, i) => h.after(states[i]).catch(() => undefined)));
}

function announceVaultChange(): void {
  try {
    channel?.postMessage({ vault: 'changed' });
  } catch {
    /* other tabs notice on their next flush or load */
  }
}

/** Hold back flushes while `fn` rewrites the whole store, then let them run (sealed or not, per the new mode). */
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  await flushStorage();
  while (flushing) await flushing;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  flushing = gate;
  try {
    return await fn();
  } finally {
    flushing = null;
    release();
    if (pending.size > 0) scheduleFlush();
  }
}

async function readVaultRecord(): Promise<VaultRecord | null> {
  const [rec] = await idbTx(DATA_STORE, 'readonly', (s) => [s.get(VAULT_KEY)] as const);
  return isVaultRecord(rec.result) ? rec.result : null;
}

/**
 * Turn vault mode on: every value is re-written sealed, together with the vault record, in one
 * transaction, then read back and decrypted to confirm. Needs the IndexedDB backend.
 */
export async function enableVault(passphrase: string): Promise<void> {
  requireAccess('security.manage'); // roles (6.21): owner only
  if (backend !== 'idb') throw new VaultError('Vault mode needs this browser’s database (IndexedDB), which is not in use.', 'bad-record');
  if (vaultKey) throw new VaultError('Vault mode is already on.', 'bad-record');
  const { record, key } = await createVault(passphrase);
  await aroundVaultSwitch(() => exclusive(async () => {
    const snapshot = [...cache];
    const sealed = await Promise.all(snapshot.map(async ([k, v]) => [k, await seal(key, k, v)] as const));
    await guardedWrite(null, (s) => {
      for (const [k, v] of sealed) s.put(v, k);
      s.put(record, VAULT_KEY);
    });
    const check = await readAllData();
    let ok = isVaultRecord(check.vault) && check.vault.id === record.id;
    for (const [k, v] of snapshot) {
      if (!ok) break;
      const got = check.data.get(k);
      ok = got !== undefined && (await unseal(key, k, got).catch(() => null)) === v;
    }
    if (!ok) {
      // Put the readable copy back before reporting.
      await guardedWrite(record.id, (s) => {
        for (const [k, v] of snapshot) s.put(v, k);
        s.delete(VAULT_KEY);
      });
      throw new VaultError('The encrypted copy could not be verified; vault mode was not turned on.', 'decrypt-failed');
    }
    vaultKey = key;
    vaultId = record.id;
  }));
  announceVaultChange();
}

/** Turn vault mode off (needs the passphrase): every value is written back readable and the record removed. */
export async function disableVault(passphrase: string): Promise<void> {
  requireAccess('security.manage');
  if (!vaultKey) throw new VaultError('Vault mode is not on.', 'bad-record');
  const record = await readVaultRecord();
  if (!record) throw new VaultError('The vault record is missing.', 'bad-record');
  if (record.id !== vaultId) throw new VaultError('Vault mode was changed in another tab. Reload this tab.', 'bad-record');
  await unwrapDek(record, passphrase); // wrong passphrase -> throws, nothing changes
  await aroundVaultSwitch(() => exclusive(async () => {
    const snapshot = [...cache];
    // Sealed values that never decrypted are unreadable for good once the record goes; left behind, the
    // next boot would (rightly) report a damaged vault. Plain values found in the store stay.
    const skipped = skippedKeys.filter((k) => !cache.has(k));
    const reqs = skipped.length ? await idbTx(DATA_STORE, 'readonly', (s) => skipped.map((k) => s.get(k))) : [];
    const orphans = skipped.filter((_, i) => {
      const v: unknown = reqs[i].result;
      return typeof v === 'string' && isSealed(v);
    });
    await guardedWrite(record.id, (s) => {
      for (const [k, v] of snapshot) s.put(v, k);
      for (const k of orphans) s.delete(k);
      s.delete(VAULT_KEY);
    });
    const check = await readAllData();
    const ok = check.vault === undefined && snapshot.every(([k, v]) => check.data.get(k) === v);
    if (!ok) throw new VaultError('The readable copy could not be verified. Reload and try again.', 'decrypt-failed');
    vaultKey = null;
    vaultId = null;
    skippedKeys = [];
  }));
  announceVaultChange();
}

/** New passphrase for the same data key: only the vault record changes. */
export async function changeVaultPassphrase(current: string, next: string): Promise<void> {
  requireAccess('security.manage');
  if (!vaultKey) throw new VaultError('Vault mode is not on.', 'bad-record');
  const record = await readVaultRecord();
  if (!record) throw new VaultError('The vault record is missing.', 'bad-record');
  if (record.id !== vaultId) throw new VaultError('Vault mode was changed in another tab. Reload this tab.', 'bad-record');
  const updated = await rewrapVault(record, current, next);
  await guardedWrite(record.id, (s) => {
    s.put(updated, VAULT_KEY);
  });
}

/** Seal / open a value with the unlocked vault key (restore undo copy). Pass-through without a vault. */
export async function vaultSeal(name: string, plaintext: string): Promise<string> {
  return vaultKey ? seal(vaultKey, name, plaintext) : plaintext;
}

export async function vaultUnseal(name: string, value: string): Promise<string | null> {
  if (!isSealed(value)) return value;
  if (!vaultKey) return null;
  try {
    return await unseal(vaultKey, name, value);
  } catch {
    return null;
  }
}

/**
 * Erase / Forgot-PIN: drop the vault. The key is forgotten first so the queued deletes of the
 * wipe still flush; the record goes so the next boot starts fresh instead of asking for a
 * passphrase to an empty store.
 */
export async function forgetVault(): Promise<void> {
  if (!vaultKey && !locked && skippedKeys.length === 0) return;
  const orphans = skippedKeys;
  vaultKey = null;
  vaultId = null;
  skippedKeys = [];
  try {
    await idbTx(DATA_STORE, 'readwrite', (s) => {
      s.delete(VAULT_KEY);
      for (const k of orphans) s.delete(k); // values the wipe cannot see (never decrypted)
    });
  } catch {
    /* the wipe still removes the data */
  }
}

/** "Forgot passphrase" on the unlock screen: delete everything this app stored on the device. */
export async function eraseLockedDevice(): Promise<void> {
  locked = null;
  vaultKey = null;
  vaultId = null;
  await idbTx(DATA_STORE, 'readwrite', (s) => {
    s.clear();
  });
  await idbClear();
  const ls = store();
  if (ls) {
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(DB_PREFIX)) keys.push(k);
    }
    for (const k of keys) ls.removeItem(k);
  }
}

/** Test seam: back to plain localStorage with an empty cache. */
export function resetStorageBackend(): void {
  vaultKey = null;
  vaultId = null;
  locked = null;
  skippedKeys = [];
  vaultConflict = null;
  backend = 'local';
  cache.clear();
  pending.clear();
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  flushing = null;
  flushError = null;
  assetCache = null;
  parsedCache.clear();
  readTrace = null;
  dataVersion++;
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
  if (readTrace) readTrace.add(fullKey);
  if (inCache(fullKey)) return cache.get(fullKey) ?? null;
  try {
    return store()?.getItem(fullKey) ?? null;
  } catch {
    return null;
  }
}

export function writeRaw(fullKey: string, value: string): void {
  dataVersion++;
  if (inCache(fullKey)) {
    if (vaultConflict) throw vaultConflict;
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
  dataVersion++;
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

/** Every app data key starting with `fullPrefix` (e.g. one per stored attachment), in no particular order. */
export function listKeys(fullPrefix: string): string[] {
  if (backend === 'idb' && !isLocalOnlyKey(fullPrefix)) {
    return [...cache.keys()].filter((k) => k.startsWith(fullPrefix));
  }
  const out: string[] = [];
  const s = store();
  if (!s) return out;
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(fullPrefix)) out.push(k);
    }
  } catch {
    /* unreadable: nothing listed */
  }
  return out;
}

/** Parsed asset table, re-parsed only when the stored text changes. */
let assetCache: { raw: string | null; idx: AssetIndex } | null = null;

function assetIndex(): AssetIndex {
  const raw = readRaw(DB_PREFIX + ASSET_TABLE);
  if (!assetCache || assetCache.raw !== raw) assetCache = { raw, idx: parseAssets(raw) };
  return assetCache.idx;
}

/* ── Parsed-rows cache (PERF-1) ────────────────────────────────── */

/**
 * Every table is parsed once per stored version and the parsed rows are shared:
 *
 *  - `peekTable` hands out the shared rows themselves (read-only).
 *  - `getTable` hands out a NEW array of NEW top-level row objects (`{ ...row }`), so callers may
 *    push / splice / sort the array and assign any field of a row, exactly as with a fresh parse.
 *    Nested values (a row's `items`, `sender`, `client` …) are shared with the cache and must not be
 *    mutated in place — replace them instead (`row.items = row.items.map(...)`). In dev builds and
 *    under `node --test` every cached row is deep-frozen, so an in-place nested write throws there.
 *  - The entry is keyed on the identity of the stored string (and, for snapshot tables, of the
 *    asset table), so a `setTable`, `writeRaw`, restore, sync merge or another tab's change is seen
 *    by the very next read: there is no separate invalidation to forget.
 *  - `setTable` seeds the next version from the rows it was given: a row that is the cached row (or
 *    an unchanged `getTable` copy of it) is reused, every other row goes through a JSON round trip
 *    (exactly what a parse of the stored text would give), so a save does not re-parse the table.
 */
interface ParsedEntry {
  table: string;
  raw: string;
  assets: string | null;
  rows: readonly unknown[];
}
const parsedCache = new Map<string, ParsedEntry>();
/** Cached row → the entry it belongs to. */
const rowEntry = new WeakMap<object, ParsedEntry>();
/** `getTable` copy → the cached row it was copied from. */
const copyOf = new WeakMap<object, object>();
const EMPTY_ROWS: readonly unknown[] = Object.freeze([]);
/** Parses per table since the last `resetParseCounts()` (test seam for the parse-count guard rails). */
const parseCounts = new Map<string, number>();

/** Freeze shared rows in dev builds and under `node --test`, so an in-place write to a shared row throws. */
const FREEZE_SHARED: boolean = (() => {
  try {
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) return true;
  } catch {
    /* no import.meta.env outside Vite */
  }
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return !!(env && (env.NODE_TEST_CONTEXT || env.MRC_FREEZE_SHARED === '1'));
})();
/** True when shared rows / memoised results are deep-frozen (dev builds, tests). */
export function sharedRowsFrozen(): boolean {
  return FREEZE_SHARED;
}

function deepFreeze(v: unknown): void {
  if (!v || typeof v !== 'object' || Object.isFrozen(v)) return;
  Object.freeze(v);
  if (Array.isArray(v)) for (const x of v) deepFreeze(x);
  else for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
}

/** Deep-freeze `v` in dev builds and tests (a no-op in production). Returns `v`. */
export function freezeShared<T>(v: T): T {
  if (FREEZE_SHARED) deepFreeze(v);
  return v;
}

function registerEntry(table: string, raw: string, assets: string | null, rows: unknown[]): ParsedEntry {
  const entry: ParsedEntry = { table, raw, assets, rows };
  for (const r of rows) if (r && typeof r === 'object') rowEntry.set(r, entry);
  if (FREEZE_SHARED) deepFreeze(rows);
  parsedCache.set(table, entry);
  return entry;
}

function parseEntry(table: string, raw: string, assets: string | null): ParsedEntry {
  parseCounts.set(table, (parseCounts.get(table) ?? 0) + 1);
  let rows: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    /* corrupt: an empty table (fail-soft), cached until the text changes */
  }
  // Snapshot images are stored by reference (assets.ts); readers always get the data URL back.
  if (rows.length && SNAPSHOT_TABLES.has(table)) rows = decodeRows(rows, assetIndex());
  return registerEntry(table, raw, assets, rows);
}

/** The current entry of `table` if it still matches the stored text, else null. */
function liveEntry(table: string): ParsedEntry | null {
  const hit = parsedCache.get(table);
  if (!hit) return null;
  const raw = readRaw(DB_PREFIX + table);
  if (hit.raw !== raw) return null;
  if (SNAPSHOT_TABLES.has(table) && hit.assets !== readRaw(DB_PREFIX + ASSET_TABLE)) return null;
  return hit;
}

function sharedRows(table: string): readonly unknown[] {
  const raw = readRaw(DB_PREFIX + table);
  if (!raw) {
    parsedCache.delete(table);
    return EMPTY_ROWS;
  }
  const assets = SNAPSHOT_TABLES.has(table) ? readRaw(DB_PREFIX + ASSET_TABLE) : null;
  const hit = parsedCache.get(table);
  if (hit && hit.raw === raw && hit.assets === assets) return hit.rows;
  return parseEntry(table, raw, assets).rows;
}

/**
 * Rows of a table that the caller may change: a new array of new top-level row objects over the
 * shared parsed rows (see "Parsed-rows cache" above — nested values must be replaced, not mutated).
 */
export function getTable<T>(name: string): T[] {
  const rows = sharedRows(name);
  const out = new Array<T>(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r && typeof r === 'object') {
      const c = Array.isArray(r) ? r.slice() : { ...(r as object) };
      copyOf.set(c, r);
      out[i] = c as T;
    } else out[i] = r as T;
  }
  return out;
}

/**
 * Read-only view of a table for hot paths (lookups, number series, building a new array of rows).
 * Same rows as `getTable`, but parsed once per stored version and shared: never mutate the array
 * or a row (copy it, e.g. `{ ...row }`, or use `getTable` for rows you will change).
 */
export function peekTable<T>(name: string): readonly T[] {
  return sharedRows(name) as readonly T[];
}

/** Test seam: how many times `table` was parsed since `resetParseCounts()` (all tables when omitted). */
export function tableParseCount(table?: string): number {
  if (table) return parseCounts.get(table) ?? 0;
  let n = 0;
  for (const v of parseCounts.values()) n += v;
  return n;
}

export function resetParseCounts(): void {
  parseCounts.clear();
}

/**
 * Keys read through `readRaw` (so every `getTable` / `peekTable` / `getJson`) are added to this set
 * while it is installed: the dependency tracking behind `memoOnReads` (table-memo.ts).
 */
let readTrace: Set<string> | null = null;

/** Install (or with null remove) the read trace; returns the previous one. */
export function setReadTrace(trace: Set<string> | null): Set<string> | null {
  const prev = readTrace;
  readTrace = trace;
  return prev;
}

/**
 * Seed the cache with the version `setTable` just wrote, so the next read does not parse it back.
 * `rows` are the caller's rows, `stored` what was serialised (asset-encoded for snapshot tables).
 */
function seedEntry(table: string, raw: string, assets: string | null, prev: ParsedEntry | null, rows: readonly unknown[], stored: readonly unknown[]): void {
  if (!prev && rows.length > 64) {
    parsedCache.delete(table); // nothing to reuse: a lazy parse is cheaper than a round trip per row
    return;
  }
  const limit = Math.max(64, rows.length >> 2);
  const out = new Array<unknown>(rows.length);
  const fresh: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const orig = prev ? reusableRow(r, prev) : undefined;
    if (orig !== undefined) {
      out[i] = orig;
      continue;
    }
    if (fresh.length >= limit) {
      parsedCache.delete(table); // a bulk rewrite: parse lazily instead
      return;
    }
    fresh.push(i);
  }
  if (fresh.length) {
    const copies = fresh.map((i) => {
      const s = JSON.stringify(stored[i]);
      return s === undefined ? null : (JSON.parse(s) as unknown);
    });
    const decoded = SNAPSHOT_TABLES.has(table) ? decodeRows(copies, assetIndex()) : copies;
    fresh.forEach((i, k) => (out[i] = decoded[k]));
  }
  registerEntry(table, raw, assets, out);
  if (FREEZE_SHARED) verifySeed(table, raw, out);
}

/** The cached row `r` stands for, if it can be reused as is: the row itself, or an unchanged `getTable` copy of it. */
function reusableRow(r: unknown, prev: ParsedEntry): unknown {
  if (!r || typeof r !== 'object') return r === null || typeof r === 'number' || typeof r === 'string' || typeof r === 'boolean' ? r : undefined;
  if (rowEntry.get(r) === prev) return r;
  const orig = copyOf.get(r);
  if (!orig || rowEntry.get(orig) !== prev) return undefined;
  if (Array.isArray(r)) return undefined; // (array rows are not app data shapes: round trip)
  const a = Object.keys(r);
  const b = Object.keys(orig);
  if (a.length !== b.length) return undefined;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] || (r as Record<string, unknown>)[a[i]] !== (orig as Record<string, unknown>)[a[i]]) return undefined;
  }
  return orig;
}

/** Dev / test self-check: the seeded rows serialise to exactly the stored text. */
function verifySeed(table: string, raw: string, rows: readonly unknown[]): void {
  const text = SNAPSHOT_TABLES.has(table) ? JSON.stringify(encodeRows(rows as unknown[], assetIndex()).rows) : JSON.stringify(rows);
  if (text !== raw) {
    parsedCache.delete(table);
    throw new Error(`storage: bad seed for ${table}`);
  }
}

/**
 * WP-7 (P0-10, MCA edit log): ONE observer of `setTable` writes. Called after a write succeeded with
 * the table name, the table's raw JSON before the write (null when it had none) and the rows written
 * (asset-encoded rows for snapshot tables). Only `setTable` reports: `writeRaw` (restore, sync merges,
 * migrations) does not. The observer must be cheap and must not write the table it is told about;
 * anything it throws is swallowed, so it can never break a save. `audit-edits.ts` is the only user.
 */
export type TableWriteHook = (name: string, prevRaw: string | null, rows: readonly unknown[]) => void;
let tableWriteHook: TableWriteHook | null = null;

/** Install (or with `null` remove) the single table-write observer. Returns the previous one. */
export function onTableWrite(hook: TableWriteHook | null): TableWriteHook | null {
  const prev = tableWriteHook;
  tableWriteHook = hook;
  return prev;
}

function notifyTableWrite(name: string, prevRaw: string | null, rows: readonly unknown[]): void {
  if (!tableWriteHook) return;
  try {
    tableWriteHook(name, prevRaw, rows);
  } catch {
    /* the observer never breaks a save */
  }
}

export function setTable<T>(name: string, rows: T[]): void {
  requireTableWrite(name); // roles (6.21): clerk / viewer limits, defence in depth
  const key = DB_PREFIX + name;
  const prevRaw = tableWriteHook ? readRaw(key) : null;
  const prev = liveEntry(name);
  if (!SNAPSHOT_TABLES.has(name)) {
    const raw = JSON.stringify(rows);
    writeRaw(key, raw);
    seedAfterWrite(name, raw, null, prev, rows, rows);
    notifyTableWrite(name, prevRaw, rows);
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
  const raw = JSON.stringify(encoded.rows);
  writeRaw(key, raw);
  // A new asset could resolve a reference an older cached row left unresolved: parse lazily then.
  seedAfterWrite(name, raw, readRaw(DB_PREFIX + ASSET_TABLE), encoded.added ? null : prev, rows, encoded.rows);
  notifyTableWrite(name, prevRaw, encoded.rows);
}

function seedAfterWrite(table: string, raw: string, assets: string | null, prev: ParsedEntry | null, rows: readonly unknown[], stored: readonly unknown[]): void {
  // The cache holds what `readRaw` returns; on localStorage that is a fresh string per read, so key on it.
  const current = readRaw(DB_PREFIX + table);
  if (current !== raw) {
    parsedCache.delete(table);
    return;
  }
  try {
    seedEntry(table, current, assets, prev, rows, stored);
  } catch (err) {
    parsedCache.delete(table);
    if (FREEZE_SHARED) throw err;
  }
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
