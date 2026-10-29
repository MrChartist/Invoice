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

/*
 * PERF-3 row-level storage. A table in CHUNKED (a snapshot table) that has MIN_ROWS rows or more is kept in
 * IndexedDB as chunks of CHUNK rows: `rows:<key>` = head `{"v":1,"n":<chunks>,"g":<random>}` and
 * `rows:<key>:<i>` = rows iC … iC+C-1 as JSON joined by ','; the logical value is `[` + chunks.join(',') + `]`,
 * byte for byte the JSON of the whole table. In memory such a value is a `Rows` object (`t` = its text once
 * read). A plain string at `<key>` (the old layout, or what writeRaw / restore / sync write) and chunks are
 * exclusive: every chunked write deletes it, every plain write deletes the chunks (both: see `openRows`). A save
 * re-serialises and writes only the chunks whose rows changed (plus the head when rows were added, removed or
 * moved). The head is the cross-tab etag for those: an incremental write commits only if the stored head is the
 * one this tab last saw, else the whole table is written; in-place edits merge per chunk (last writer wins).
 */
const CHUNKED = new Set([DB_PREFIX + 'invoices']);
const CHUNK = 16;
const MIN_ROWS = 128;
interface Rows {
  c: string[];
  t?: string;
}
type Val = string | Rows;
const textOf = (v: Val): string => (typeof v === 'string' ? v : (v.t ??= `[${v.c.join(',')}]`));
const lenOf = (v: Val | undefined): number => (v === undefined ? 0 : typeof v === 'string' ? v.length : v.c.reduce((n, x) => n + x.length + 1, 1));
const headKey = (k: string) => `rows:${k}`;
const chunkKey = (k: string, i: number | string) => `rows:${k}:${i}`;
const chunkRange = (k: string) => IDBKeyRange.bound(chunkKey(k, ''), chunkKey(k, '\uffff'));
/** Delete the chunked copy of `k` (head and every chunk). */
function clearRows(s: IDBObjectStore, k: string): void {
  s.delete(headKey(k));
  s.delete(chunkRange(k));
}
/** Delete every record of these keys. */
function dropKeys(s: IDBObjectStore, keys: Iterable<string>): void {
  for (const k of keys) {
    s.delete(k);
    if (CHUNKED.has(k)) clearRows(s, k);
  }
}
/** Re-write the store copy of `snapshot` as `recs` (its `physical` records, plain or sealed). */
function putAll(s: IDBObjectStore, snapshot: [string, Val][], recs: [string, string][]): void {
  dropKeys(s, snapshot.map(([k]) => k).filter((k) => CHUNKED.has(k)));
  for (const [k, v] of recs) s.put(v, k);
}
/** Chunks of each chunked key to write at the next flush (-1 = the head); true = all of them. */
const dirt = new Map<string, Set<number> | true>();
/** The stored head of each chunked key as this tab last read or wrote it (sealed in vault mode). */
const heads = new Map<string, string>();
/** Physical records of a value: the plain key, or a fresh head and every chunk. */
const headRec = (k: string, v: Rows): [string, string] => [headKey(k), JSON.stringify({ v: 1, n: v.c.length, g: generateId() })];
const physical = (k: string, v: Val): [string, string][] =>
  typeof v === 'string' ? [[k, v]] : [headRec(k, v), ...v.c.map((x, i): [string, string] => [chunkKey(k, i), x])];
/** Same logical value (rare paths: verification after a whole-store write). */
const sameVal = (a: Val | undefined, b: Val): boolean => a !== undefined && textOf(a) === textOf(b);

type Opener = (name: string, v: string) => string | undefined | Promise<string | undefined>;
/** Opens a stored value with this tab's vault key; a vault store holds only sealed values, a plain one none. */
const tabOpener: Opener = (name, v) => (!isSealed(v) ? (vaultKey ? undefined : v) : vaultKey ? unseal(vaultKey, name, v).catch(() => undefined) : undefined);
/** [chunk index, stored value] of `k`'s chunk records. */
const chunksOf = (k: string, keys: IDBValidKey[], vals: unknown[]): [number, unknown][] =>
  keys.map((p, j) => {
    const i = String(p).slice(chunkKey(k, '').length);
    return [/^\d+$/.test(i) ? +i : -1, vals[j]];
  });
/**
 * The logical value of chunked key `k` from its records: the plain string, or a complete set of chunks as `Rows`
 * plus the head it came with. Both: a build that could not see the chunks wrote the plain value, so every chunk row
 * is kept and its rows not among them (by id) are added. Undefined when a record cannot be opened or the chunk set
 * is incomplete: the key is then left untouched and refused (`refuse`), never adopted in part.
 */
async function openRows(k: string, base: unknown, head: unknown, chunks: [number, unknown][], open: Opener): Promise<[Val | null, string?] | undefined> {
  const plain = typeof base === 'string' ? await open(k, base) : null;
  if (plain === undefined) return undefined;
  if (typeof head !== 'string') return [plain];
  const h = await open(headKey(k), head);
  let n = 0;
  try {
    const o = JSON.parse(h!) as { v?: unknown; n?: unknown };
    if (o?.v === 1 && Number.isInteger(o.n)) n = o.n as number;
  } catch {
    /* unreadable head: refused below */
  }
  const c: string[] = [];
  const opened = await Promise.all(
    chunks.map(async ([i, v]) => typeof v !== 'string' || !(i >= 0 && i < n) || (c[i] = (await open(chunkKey(k, i), v))!) !== undefined),
  );
  if (opened.includes(false) || !(n > 0) || Object.keys(c).length !== n) return undefined;
  if (plain === null) return [{ c }, head];
  try {
    const rows = JSON.parse(`[${c.join(',')}]`) as unknown[];
    const ids = new Set(rows.map(idOf));
    return [JSON.stringify([...rows, ...(JSON.parse(plain) as unknown[]).filter((r) => idOf(r) === undefined || !ids.has(idOf(r)))])];
  } catch {
    return undefined;
  }
}

const cache = new Map<string, Val>();
/** Writes not yet committed to IndexedDB (null = delete). */
const pending = new Map<string, Val | null>();
/**
 * `dataVersion` at this tab's last write of each key, and the version up to which writes are in a
 * flush transaction (`sent`): a remote read that started before a key's write was sent is older than
 * this tab's value, even once a slow vault decrypt finishes after that write was flushed (QA12).
 */
const wrote = new Map<string, number>();
let sent = 0;
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
/** Chunked keys whose records could not be read in full: left untouched, every write to them refused. */
const refused = new Set<string>();
let refusal: StorageWriteError | null = null;
function refuse(keys: string[]): void {
  for (const k of keys)
    if (CHUNKED.has(k) && !refused.has(k)) {
      refused.add(k);
      if (!skippedKeys.includes(k)) skippedKeys.push(k); // erase still removes its records (forgetVault)
      refusal = new StorageWriteError('Some invoices on this device could not be read, so they were left untouched and cannot be changed. Export a backup and get help before you go on.', false);
    }
  if (refusal) setFlushError(refusal);
}
/** Set once a write was refused because another tab changed vault mode: no further writes until reload. */
let vaultConflict: StorageWriteError | null = null;

class VaultConflictError extends Error {}
/** An incremental chunk write found another head than this tab last saw (another tab rewrote the table). */
class RowsConflictError extends Error {}

/**
 * One readwrite transaction on the data store that first reads the vault record and aborts unless
 * its id is `expect` (null = "no vault"). The check and the writes are atomic, so a write can never
 * land in a store whose vault mode another tab has just changed. `heads`: chunk heads that must still
 * be stored as given (else RowsConflictError, nothing written).
 */
async function guardedWrite(expect: string | null, write: (s: IDBObjectStore) => void, heads: [string, string | undefined][] = []): Promise<void> {
  let conflict: Error | null = null;
  try {
    await idbTx(
      DATA_STORE,
      'readwrite',
      (s, tx) => {
        const r = s.get(VAULT_KEY);
        const hs = heads.map(([k]) => s.get(k));
        (hs[hs.length - 1] ?? r).onsuccess = () => {
          const rec: unknown = r.result;
          const id = rec === undefined ? null : isVaultRecord(rec) ? rec.id : '';
          if (id !== expect) conflict = new VaultConflictError('Vault mode was changed in another tab.');
          else if (hs.some((h, i) => h.result !== heads[i][1])) conflict = new RowsConflictError();
          if (conflict) {
            tx.abort();
            return;
          }
          write(s);
        };
      },
      { commit: false },
    );
  } catch (err) {
    throw conflict ?? err;
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
  const dirty = new Map(dirt);
  dirt.clear();
  const ver = dataVersion;
  const key = vaultKey;
  const expect = vaultId;
  // Physical writes ([record, value | null = delete]), chunked keys cleared first, heads that must be unchanged.
  const ops: [string, string | null][] = [];
  const wipe: string[] = [];
  const checks: [string, string | undefined][] = [];
  for (const [k, v] of batch) {
    if (!CHUNKED.has(k)) ops.push([k, v as string | null]);
    else if (v === null || typeof v === 'string') {
      wipe.push(k);
      ops.push([k, v as string | null]);
    } else {
      const d = dirty.get(k) ?? true;
      ops.push([k, null]);
      if (d === true || !heads.has(k)) {
        wipe.push(k);
        ops.push(...physical(k, v));
      } else {
        checks.push([headKey(k), heads.get(k)]);
        if (d.has(-1)) ops.push(headRec(k, v));
        for (const i of d) if (i >= 0) ops.push([chunkKey(k, i), i < v.c.length ? v.c[i] : null]);
      }
    }
  }
  const run = (async () => {
    const values: (string | null)[] = key
      ? await Promise.all(ops.map(([k, v]) => (v === null ? null : seal(key, k, v))))
      : ops.map(([, v]) => v);
    // Sealed values only into this tab's vault; readable ones only into a store with no vault.
    await guardedWrite(
      expect,
      (s) => {
        sent = ver;
        for (const k of wipe) clearRows(s, k);
        ops.forEach(([k], i) => {
          const v = values[i];
          if (v === null) s.delete(k);
          else s.put(v, k);
        });
      },
      checks,
    );
    for (const k of wipe) heads.delete(k);
    ops.forEach(([k], i) => {
      const at = k.indexOf(':', 5); // `rows:<key>` (a head), not `rows:<key>:<i>`
      if (k.startsWith('rows:') && at < 0) heads.set(k.slice(5), values[i]!);
    });
  })().then(
    () => {
      for (const [k, v] of batch) if (pending.has(k) && pending.get(k) === v) pending.delete(k);
      setFlushError(refusal);
      try {
        channel?.postMessage({ keys: batch.map(([k]) => k) });
      } catch {
        /* other tabs see it on their next load */
      }
    },
    (err: unknown) => {
      // Not written: those chunks are still to write; all of them where another tab rewrote the table.
      const redo = err instanceof RowsConflictError;
      for (const [k, d] of dirty) {
        const now = dirt.get(k);
        dirt.set(k, redo || d === true || now === true ? true : new Set([...d, ...(now ?? [])]));
      }
      if (redo) scheduleFlush();
      else if (err instanceof VaultConflictError) {
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
  const at = sent;
  let reqs: IDBRequest[][];
  try {
    reqs = await idbTx(DATA_STORE, 'readonly', (s) =>
      wanted.map((k) => (CHUNKED.has(k) ? [s.get(k), s.get(headKey(k)), s.getAllKeys(chunkRange(k)), s.getAll(chunkRange(k))] : [s.get(k)])),
    );
  } catch {
    return;
  }
  const values = await Promise.all(
    reqs.map(([b, h, ks, vs], i) => openRows(wanted[i], b.result, h?.result, ks ? chunksOf(wanted[i], ks.result as IDBValidKey[], vs.result as unknown[]) : [], tabOpener)),
  );
  wanted.forEach((k, i) => {
    if (pending.has(k) || wrote.get(k)! > at) return; // this tab's newer write wins (as it did with localStorage)
    const r = values[i];
    if (!r) return;
    if (r[0] === null) cache.delete(k);
    else cache.set(k, r[0]);
    if (r[1]) heads.set(k, r[1]);
    else heads.delete(k);
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

/** Every data record of the store (`data`: values as stored, chunk records included), the marker and the vault record. */
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
    else if (typeof k === 'string' && (!isLocalOnlyKey(k) || k.startsWith('rows:')) && typeof v === 'string') data.set(k, v);
  });
  return { data, meta, vault };
}

/** The logical values of stored records (`bad`: keys whose records could not be opened). */
async function openAll(data: Map<string, string>, open: Opener): Promise<{ vals: Map<string, Val>; hs: Map<string, string>; bad: string[] }> {
  const vals = new Map<string, Val>();
  const hs = new Map<string, string>();
  const bad: string[] = [];
  const names = [...data.keys()].filter((k) => !k.startsWith('rows:'));
  for (const k of CHUNKED) if (!data.has(k) && data.has(headKey(k))) names.push(k);
  await Promise.all(
    names.map(async (k) => {
      const all = CHUNKED.has(k) ? [...data].filter(([p]) => p.startsWith(chunkKey(k, ''))) : [];
      const r = await openRows(k, data.get(k), CHUNKED.has(k) ? data.get(headKey(k)) : undefined, chunksOf(k, all.map(([p]) => p), all.map(([, v]) => v)), open);
      if (!r) bad.push(k);
      else if (r[0] !== null) {
        vals.set(k, r[0]);
        if (r[1]) hs.set(k, r[1]);
      }
    }),
  );
  return { vals, hs, bad };
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
    const plain: Opener = (_, v) => v;
    let opened = await openAll(stored.data, plain);
    const lsIsTruth = marked ? !stored.meta : lsData.size > 0 || !stored.meta;
    const target = new Map<string, Val>(lsIsTruth ? lsData : opened.vals);
    if (!lsIsTruth) for (const [k, v] of lsData) if (!target.has(k)) target.set(k, v);
    for (const k of opened.bad) target.delete(k); // never written over: refused below

    const puts = [...target].filter(([k, v]) => opened.vals.get(k) !== v);
    const dels = [...opened.vals.keys()].filter((k) => !target.has(k));
    if (!stored.meta || puts.length > 0 || dels.length > 0) {
      await withTimeout(
        // Guarded: if another tab turned vault mode on meanwhile, nothing readable is written.
        guardedWrite(null, (s) => {
          for (const k of [...dels, ...puts.map(([k]) => k)]) if (CHUNKED.has(k)) clearRows(s, k);
          for (const k of dels) s.delete(k);
          for (const [k, v] of puts) s.put(v as string, k); // (only strings: chunks are never moved in)
          s.put(Date.now(), META_KEY); // marker: a verified copy was made (value = when)
        }),
        timeout,
      );
      const check = await withTimeout(readAllData(), timeout);
      opened = await openAll(check.data, plain);
      const ok = check.meta && opened.vals.size === target.size && [...target].every(([k, v]) => sameVal(opened.vals.get(k), v));
      if (!ok) throw new Error('The IndexedDB copy did not match localStorage.');
    }

    for (const [k, v] of target) cache.set(k, v);
    for (const [k, h] of opened.hs) heads.set(k, h);
    refuse(opened.bad);
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
  let key: CryptoKey | null = null;
  let id: string | null = null;
  if (fresh.vault !== undefined) {
    if (!isVaultRecord(fresh.vault)) throw new VaultError('The vault record on this device is damaged.', 'bad-record');
    key = await unwrapDek(fresh.vault, passphrase);
    id = fresh.vault.id;
  }
  // Without a record, vault mode was turned off in another tab meanwhile: the store is readable as it is.
  const k = key;
  const { vals: plain, hs, bad: unreadable } = await openAll(fresh.data, (name, v) =>
    isSealed(v) !== !!k ? undefined : k ? unseal(k, name, v).catch(() => undefined) : v,
  );
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
  for (const [k, h] of hs) heads.set(k, h);
  dataVersion++;
  vaultKey = key;
  vaultId = id;
  skippedKeys = unreadable.sort();
  refuse(unreadable);
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
    const recs = snapshot.flatMap(([k, v]) => physical(k, v));
    const sealed = await Promise.all(recs.map(async ([k, v]): Promise<[string, string]> => [k, await seal(key, k, v)]));
    await guardedWrite(null, (s) => {
      putAll(s, snapshot, sealed);
      s.put(record, VAULT_KEY);
    });
    const check = await readAllData();
    let ok = isVaultRecord(check.vault) && check.vault.id === record.id;
    if (ok) {
      const got = (await openAll(check.data, (n, v) => unseal(key, n, v).catch(() => undefined))).vals;
      ok = snapshot.every(([k, v]) => sameVal(got.get(k), v));
    }
    if (!ok) {
      // Put the readable copy back before reporting.
      await guardedWrite(record.id, (s) => {
        putAll(s, snapshot, recs);
        s.delete(VAULT_KEY);
      });
      throw new VaultError('The encrypted copy could not be verified; vault mode was not turned on.', 'decrypt-failed');
    }
    heads.clear(); // every head was re-written: the next save of a chunked table writes it whole
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
    const reqs = skipped.length ? await idbTx(DATA_STORE, 'readonly', (s) => skipped.map((k) => [s.get(k), s.get(headKey(k))])) : [];
    const orphans = skipped.filter((_, i) => reqs[i].some((r) => typeof r.result === 'string' && isSealed(r.result)));
    await guardedWrite(record.id, (s) => {
      putAll(s, snapshot, snapshot.flatMap(([k, v]) => physical(k, v)));
      dropKeys(s, orphans);
      s.delete(VAULT_KEY);
    });
    const check = await readAllData();
    const got = (await openAll(check.data, (_, v) => v)).vals;
    const ok = check.vault === undefined && snapshot.every(([k, v]) => sameVal(got.get(k), v));
    if (!ok) throw new VaultError('The readable copy could not be verified. Reload and try again.', 'decrypt-failed');
    heads.clear();
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
  refused.clear();
  refusal = null;
  vaultKey = null;
  vaultId = null;
  skippedKeys = [];
  try {
    await idbTx(DATA_STORE, 'readwrite', (s) => {
      s.delete(VAULT_KEY);
      dropKeys(s, orphans); // values the wipe cannot see (never decrypted)
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
  refused.clear();
  refusal = null;
  vaultConflict = null;
  backend = 'local';
  cache.clear();
  pending.clear();
  dirt.clear();
  heads.clear();
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

/**
 * R15-A2: a writer holding one key's rows in memory (the audit batch) flushes them before that key is read; a raw
 * write or removal of the key by anyone else drops them (as if they had been written first and then overwritten).
 */
let pendingKey = '';
let pendingFlush = () => {};
let pendingDrop = () => {};
export function onPendingKey(fullKey: string, flush: () => void, drop: () => void): void {
  pendingKey = fullKey;
  pendingFlush = flush;
  pendingDrop = drop;
}

export function isStorageAvailable(): boolean {
  return backend === 'idb' || store() !== null;
}

export function readRaw(fullKey: string): string | null {
  const v = rawStamp(fullKey);
  return v === null ? null : textOf(v as Val);
}

/**
 * A version token of `fullKey` (a read, like `readRaw`): equal tokens mean the stored value is unchanged.
 * It is the stored string itself, or for a chunked table an object, so comparing it never builds the
 * table's text: hot "did it change?" checks (memos, search index, editor) use this instead of `readRaw`.
 */
export function rawStamp(fullKey: string): string | object | null {
  if (fullKey === pendingKey) pendingFlush();
  if (readTrace) readTrace.add(fullKey);
  if (inCache(fullKey)) return cache.get(fullKey) ?? null;
  try {
    return store()?.getItem(fullKey) ?? null;
  } catch {
    return null;
  }
}

/** Cache write (IndexedDB backend), queued for the next flush. */
function putVal(fullKey: string, value: Val): void {
  if (vaultConflict) throw vaultConflict;
  if (refused.has(fullKey)) throw refusal!;
  // While IndexedDB refuses writes for lack of space, refuse anything that grows the data so
  // the UI shows its usual "storage is full" error; shrinking writes go through and retry.
  if (flushError?.quotaExceeded && lenOf(value) > lenOf(cache.get(fullKey))) throw flushError;
  cache.set(fullKey, value);
  pending.set(fullKey, value);
  wrote.set(fullKey, dataVersion);
  scheduleFlush();
}

export function writeRaw(fullKey: string, value: string): void {
  if (fullKey === pendingKey) pendingDrop();
  dataVersion++;
  if (inCache(fullKey)) {
    putVal(fullKey, value);
    dirt.delete(fullKey);
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
  if (fullKey === pendingKey) pendingDrop();
  dataVersion++;
  if (inCache(fullKey)) {
    if (!cache.has(fullKey) && !pending.has(fullKey)) return;
    cache.delete(fullKey);
    pending.set(fullKey, null);
    dirt.delete(fullKey);
    wrote.set(fullKey, dataVersion);
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
  /** `rawStamp` of the table this entry was parsed from (for a chunked table: rows[i] is in chunk i / CHUNK). */
  raw: unknown;
  assets: unknown;
  rows: readonly unknown[];
}
const parsedCache = new Map<string, ParsedEntry>();
/** Cached row → the entry it belongs to. */
const rowEntry = new WeakMap<object, ParsedEntry>();
/** `getTable` copy → the cached row it was copied from. */
const copyOf = new WeakMap<object, object>();
const nestFrozen = new WeakSet<object>();
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

function registerEntry(table: string, raw: unknown, assets: unknown, rows: unknown[]): ParsedEntry {
  const entry: ParsedEntry = { table, raw, assets, rows };
  for (const r of rows) if (r && typeof r === 'object') rowEntry.set(r, entry);
  if (FREEZE_SHARED) deepFreeze(rows);
  // A chunked table reuses unchanged rows by identity, so a nested value changed in place would never be saved:
  // its rows' nested values are frozen in production too (once per row), so such a write throws instead.
  else if (typeof raw === 'object')
    for (const r of rows)
      if (r && typeof r === 'object' && !nestFrozen.has(r)) {
        nestFrozen.add(r);
        Object.values(r).forEach(deepFreeze);
      }
  parsedCache.set(table, entry);
  return entry;
}

function parseEntry(table: string, raw: Val, assets: unknown): ParsedEntry {
  parseCounts.set(table, (parseCounts.get(table) ?? 0) + 1);
  let rows: unknown[] = [];
  if (typeof raw !== 'string') {
    const c = raw.c;
    // Chunk by chunk, so rows line up with their chunks; chunks that do not (damaged) make it a plain value.
    try {
      rows = c.flatMap((x, j) => {
        const r = JSON.parse(`[${x}]`) as unknown[];
        if (!r.length || r.length > CHUNK || (r.length < CHUNK && j < c.length - 1)) throw new Error('unaligned');
        return r;
      });
    } catch {
      raw = textOf(raw);
      cache.set(DB_PREFIX + table, raw);
    }
  }
  if (typeof raw === 'string')
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
  const raw = rawStamp(DB_PREFIX + table);
  if (hit.raw !== raw) return null;
  if (SNAPSHOT_TABLES.has(table) && hit.assets !== rawStamp(DB_PREFIX + ASSET_TABLE)) return null;
  return hit;
}

function sharedRows(table: string): readonly unknown[] {
  const raw = rawStamp(DB_PREFIX + table) as Val | null;
  if (!raw) {
    parsedCache.delete(table);
    return EMPTY_ROWS;
  }
  const assets = SNAPSHOT_TABLES.has(table) ? rawStamp(DB_PREFIX + ASSET_TABLE) : null;
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
 * the table name, a getter of the table's raw JSON before the write (null when it had none) and a getter
 * of the rows written (asset-encoded rows for snapshot tables): getters, so a table the observer does not
 * watch never has its text built (PERF-3). Only `setTable` reports: `writeRaw` (restore, sync merges,
 * migrations) does not. The observer must be cheap and must not write the table it is told about;
 * anything it throws is swallowed, so it can never break a save. `audit-edits.ts` is the only user.
 */
export type TableWriteHook = (name: string, prevRaw: () => string | null, rows: () => readonly unknown[]) => void;
let tableWriteHook: TableWriteHook | null = null;

/** Install (or with `null` remove) the single table-write observer. Returns the previous one. */
export function onTableWrite(hook: TableWriteHook | null): TableWriteHook | null {
  const prev = tableWriteHook;
  tableWriteHook = hook;
  return prev;
}

function notifyTableWrite(name: string, prevRaw: () => string | null, rows: () => readonly unknown[]): void {
  if (!tableWriteHook) return;
  try {
    tableWriteHook(name, prevRaw, rows);
  } catch {
    /* the observer never breaks a save */
  }
}

/** Store the new asset table first, so a stored reference can never dangle. */
function storeAssets(idx: AssetIndex): void {
  const raw = serializeAssets(idx);
  try {
    writeRaw(DB_PREFIX + ASSET_TABLE, raw);
    assetCache = { raw, idx };
  } catch (err) {
    assetCache = null; // idx holds an asset that was not stored
    throw err;
  }
}

export function setTable<T>(name: string, rows: T[]): void {
  requireTableWrite(name); // roles (6.21): clerk / viewer limits, defence in depth
  const key = DB_PREFIX + name;
  const before = tableWriteHook ? (inCache(key) ? cache.get(key) ?? null : readRaw(key)) : null;
  const prevRaw = () => (before === null ? null : textOf(before));
  const prev = liveEntry(name);
  if (!SNAPSHOT_TABLES.has(name)) {
    const raw = JSON.stringify(rows);
    writeRaw(key, raw);
    seedAfterWrite(name, raw, null, prev, rows, rows);
    notifyTableWrite(name, prevRaw, () => rows);
    return;
  }
  const idx = assetIndex();
  if (CHUNKED.has(key) && inCache(key) && rows.length >= MIN_ROWS) {
    setRows(name, key, rows, prev, idx);
    notifyTableWrite(name, prevRaw, () => encodeRows(rows, idx).rows);
    return;
  }
  const encoded = encodeRows(rows, idx);
  if (encoded.added) storeAssets(idx);
  const raw = JSON.stringify(encoded.rows);
  writeRaw(key, raw);
  // A new asset could resolve a reference an older cached row left unresolved: parse lazily then.
  seedAfterWrite(name, raw, readRaw(DB_PREFIX + ASSET_TABLE), encoded.added ? null : prev, rows, encoded.rows);
  notifyTableWrite(name, prevRaw, () => encoded.rows);
}

const idOf = (r: unknown): unknown => (r && typeof r === 'object' ? (r as { id?: unknown }).id : r);

/**
 * PERF-3 `setTable` of a chunked table: only the chunks whose rows changed are serialised (and written
 * at the next flush). Rows are compared with the cached version by position: the cached row itself or an
 * unchanged `getTable` copy of it at the same place leaves its chunk alone. Without an aligned cached
 * version (first save after a plain write, a restore, a new logo …) every chunk is written once.
 */
function setRows(name: string, key: string, rows: readonly unknown[], prev: ParsedEntry | null, idx: AssetIndex): void {
  const pv = cache.get(key);
  const old = prev && typeof pv === 'object' && prev.raw === pv ? pv : null;
  const p = old ? prev!.rows : EMPTY_ROWS;
  const n = Math.ceil(rows.length / CHUNK);
  const c = old ? old.c.slice(0, n) : [];
  const out = new Array<unknown>(rows.length);
  const changed: number[] = [];
  let moved = rows.length !== p.length;
  let added = false;
  for (let j = 0; j < n; j++) {
    const a = j * CHUNK;
    const b = Math.min(rows.length, a + CHUNK);
    let same = j < c.length && b === Math.min(p.length, a + CHUNK);
    for (let i = a; i < b; i++) {
      const o = prev ? reusableRow(rows[i], prev) : undefined;
      out[i] = o;
      if (o === undefined || o !== p[i]) {
        same = false;
        if (idOf(rows[i]) !== idOf(p[i])) moved = true;
      }
    }
    if (same) continue;
    changed.push(j);
    const enc = encodeRows(rows.slice(a, b) as unknown[], idx);
    added ||= enc.added;
    const text = JSON.stringify(enc.rows);
    c[j] = text.slice(1, -1);
    const parsed = decodeRows(JSON.parse(text) as unknown[], idx);
    for (let i = a; i < b; i++) if (out[i] === undefined) out[i] = parsed[i - a];
  }
  if (added) storeAssets(idx);
  const v: Rows = { c };
  dataVersion++;
  putVal(key, v);
  const d = old ? dirt.get(key) ?? new Set<number>() : true;
  if (d !== true) {
    for (const j of changed) d.add(j);
    for (let j = n; j < old!.c.length; j++) d.add(j);
    if (moved) d.add(-1);
  }
  dirt.set(key, d);
  if (added) {
    parsedCache.delete(name); // a new asset could resolve a reference an older cached row left unresolved
    return;
  }
  registerEntry(name, v, rawStamp(DB_PREFIX + ASSET_TABLE), out);
  // Dev / test self-check: the rows of every re-written chunk serialise to exactly its text.
  if (FREEZE_SHARED)
    for (const j of changed)
      if (JSON.stringify(encodeRows(out.slice(j * CHUNK, (j + 1) * CHUNK), idx).rows).slice(1, -1) !== c[j]) {
        parsedCache.delete(name);
        throw new Error(`storage: bad seed for ${name}`);
      }
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
  return Object.fromEntries(appEntries().map(([k, v]) => [k, textOf(v)]));
}

function appEntries(): [string, Val][] {
  const s = store();
  const out: Record<string, Val> = {};
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
  return Object.entries(out);
}

/** Approximate bytes used by app data — surfaced in Settings as a usage meter. */
export function appDataSize(): number {
  return appEntries().reduce((sum, [k, v]) => sum + k.length + lenOf(v), 0);
}
