/**
 * The app's IndexedDB database (`mrchartist_inv_kv`, or `mrchartist_inv_kv__<id>` for an extra company,
 * see company-registry.ts), opened once per tab.
 *
 *  - `kv`   (v1): small structured-clone values that cannot live in localStorage
 *               (folder handle, backup key, safety snapshot). `idbGet/idbSet/idbDel/idbClear`.
 *  - `data` (v2): the app's `mrchartist_inv_*` tables as strings, behind the synchronous
 *               cache in `storage.ts` (Phase 4.2).
 *
 * The connection is shared and re-opened after the browser closes it (or another tab
 * upgrades the schema). kv helpers are fail-soft: on any error get -> undefined,
 * set/del/clear -> false. Data-store helpers reject so storage.ts can react.
 */

import { activeCompanyId, companyDbName, pinCompany } from './company-registry';


// v3 (vault mode, 5.8): no schema change. The bump makes tabs still running an older build lose their
// connection (versionchange) and fail to reopen (VersionError), so they cannot write into a vault store.
// v4 (PERF-3 row-level storage): no schema change either. Big tables may now be stored as chunk records
// (`rows:<key>…`, storage.ts) that an older build cannot read; the bump keeps such builds out of the store.
// Never lower it, and never ship a build at v4+ without the chunk reader.
const DB_VERSION = 4;
export const KV_STORE = 'kv';
export const DATA_STORE = 'data';
const FAILED = 'IndexedDB failed';

let conn: Promise<IDBDatabase> | null = null;

export function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function openDb(): Promise<IDBDatabase> {
  if (conn) return conn;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    if (!idbAvailable()) {
      reject(new Error(FAILED));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      // One database per company (6.20); the main company keeps `mrchartist_inv_kv`.
      req = indexedDB.open(companyDbName(pinCompany(activeCompanyId())!), DB_VERSION);
    } catch (err) {
      reject(err as Error);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [KV_STORE, DATA_STORE]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => {
      const db = req.result;
      const drop = () => {
        if (conn === p) conn = null;
      };
      // Another tab wants a newer schema: step aside so it is not blocked.
      db.onversionchange = () => {
        db.close();
        drop();
      };
      db.onclose = drop;
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error(FAILED));
  });
  conn = p;
  p.catch(() => {
    if (conn === p) conn = null;
  });
  return p;
}

/**
 * Run one transaction on `store`; resolves with what `fn` returns once the transaction has committed.
 * `fn` may queue more requests from a request's `onsuccess` (and abort the transaction there); pass
 * `{ commit: false }` then, so the transaction is not committed before those callbacks run.
 */
export async function idbTx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore, tx: IDBTransaction) => T,
  opts: { commit?: boolean } = {},
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(store, mode);
    } catch (err) {
      // The connection was closed under us (e.g. version change): forget it so the next call re-opens.
      conn = null;
      reject(err);
      return;
    }
    let out: T;
    try {
      out = fn(tx.objectStore(store), tx);
    } catch (err) {
      try {
        tx.abort();
      } catch {
        /* already finished */
      }
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error ?? new Error(FAILED));
    tx.onabort = () => reject(tx.error ?? new Error(FAILED));
    // Send it now rather than at the end of the task (matters during pagehide).
    if (opts.commit !== false) (tx as IDBTransaction & { commit?: () => void }).commit?.();
  });
}

export async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
  try {
    const req = await idbTx(KV_STORE, 'readonly', (s) => s.get(key));
    return (req.result as T | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  try {
    await idbTx(KV_STORE, 'readwrite', (s) => s.put(value, key));
    return true;
  } catch {
    return false;
  }
}

export async function idbDel(key: string): Promise<boolean> {
  try {
    await idbTx(KV_STORE, 'readwrite', (s) => s.delete(key));
    return true;
  } catch {
    return false;
  }
}

/** Empty the kv store (folder handle, backup key, safety snapshot). The data store is storage.ts's business. */
export async function idbClear(): Promise<boolean> {
  try {
    await idbTx(KV_STORE, 'readwrite', (s) => s.clear());
    return true;
  } catch {
    return false;
  }
}

/**
 * Forget the shared connection (closing it once it opens). Used when an open did not answer in
 * time, so a later call starts afresh instead of waiting on the stuck request (`keepCompany`: the tab
 * stays pinned to its company, QA7 G1, so the reopen never follows another tab's switch); also a test
 * seam for a reload (which forgets the pin, as a real reload does).
 */
export function resetIdbConnection(keepCompany?: boolean): void {
  const p = conn;
  conn = null;
  if (!keepCompany) pinCompany(null);
  p?.then(
    (db) => db.close(),
    () => {},
  );
}
