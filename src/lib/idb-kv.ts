/**
 * Tiny IndexedDB key/value store. Exists because a FileSystemDirectoryHandle can be
 * structured-cloned into IndexedDB but not serialised into localStorage.
 * Every call is fail-soft: on any error (private mode, no IDB) get -> undefined,
 * set/del -> false.
 */

const DB_NAME = 'mrchartist_inv_kv';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
  try {
    return (await run<T | undefined>('readonly', (s) => s.get(key))) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.put(value, key));
    return true;
  } catch {
    return false;
  }
}

export async function idbDel(key: string): Promise<boolean> {
  try {
    await run('readwrite', (s) => s.delete(key));
    return true;
  } catch {
    return false;
  }
}
