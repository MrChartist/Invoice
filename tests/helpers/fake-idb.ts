/**
 * Minimal in-memory IndexedDB for the storage tests (no dependency). Implements only what
 * src/lib/idb-kv.ts uses: open/upgrade, object stores with out-of-line keys, transactions
 * with get/put/delete/clear/getAll/getAllKeys, commit(), oncomplete/onerror/onabort, and
 * connection close / versionchange. Transactions are atomic: a failed one changes nothing.
 *
 * Fault injection: `failNextWrite(name)` makes the next readwrite transaction fail with a
 * DOMException-like error of that name; `corruptNextRead()` flips one value in the next read;
 * `hang = true` leaves open requests pending forever.
 */

type Op = { kind: 'get' | 'put' | 'delete' | 'clear' | 'getAll' | 'getAllKeys'; key?: unknown; value?: unknown; req: FakeRequest };

class FakeRequest {
  result: unknown = undefined;
  error: unknown = null;
  onsuccess: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
}

const err = (name: string) => Object.assign(new Error(name), { name });

export class FakeIDB {
  /** dbName -> storeName -> key -> value */
  dbs = new Map<string, { version: number; stores: Map<string, Map<string, unknown>> }>();
  opens = 0;
  hang = false;
  private failWrite: string | null = null;
  private corruptRead = false;
  private conns = new Set<FakeDB>();

  failNextWrite(name = 'QuotaExceededError'): void {
    this.failWrite = name;
  }
  corruptNextRead(): void {
    this.corruptRead = true;
  }
  reset(): void {
    for (const c of this.conns) c.close();
    this.conns.clear();
    this.dbs.clear();
    this.opens = 0;
    this.hang = false;
    this.failWrite = null;
    this.corruptRead = false;
  }
  /** Direct access for assertions / simulating another tab. */
  store(db: string, store: string): Map<string, unknown> {
    const d = this.dbs.get(db);
    if (!d) throw new Error(`no database ${db}`);
    const s = d.stores.get(store);
    if (!s) throw new Error(`no store ${store}`);
    return s;
  }
  /** Simulate another tab upgrading the schema. */
  fireVersionChange(): void {
    for (const c of [...this.conns]) c.onversionchange?.();
  }

  open(name: string, version?: number): FakeRequest & { onupgradeneeded?: (() => void) | null } {
    const req = new FakeRequest() as FakeRequest & { onupgradeneeded?: (() => void) | null };
    this.opens++;
    if (this.hang) return req;
    setTimeout(() => {
      let d = this.dbs.get(name);
      const target = version ?? d?.version ?? 1;
      if (d && target < d.version) {
        req.error = err('VersionError');
        req.onerror?.({});
        return;
      }
      if (!d) {
        d = { version: 0, stores: new Map() };
        this.dbs.set(name, d);
      }
      const db = new FakeDB(this, d);
      this.conns.add(db);
      req.result = db;
      if (target > d.version) {
        d.version = target;
        req.onupgradeneeded?.();
      }
      req.onsuccess?.({});
    }, 0);
    return req;
  }

  /** Called by transactions. */
  run(tx: FakeTx): void {
    setTimeout(() => {
      if (tx.aborted) return;
      const d = tx.db.data;
      const write = tx.mode === 'readwrite';
      if (write && this.failWrite) {
        tx.error = err(this.failWrite);
        this.failWrite = null;
        tx.onerror?.({});
        tx.onabort?.({});
        return;
      }
      // Work on copies so the transaction is all-or-nothing.
      const copies = new Map<string, Map<string, unknown>>();
      for (const n of tx.names) copies.set(n, new Map(d.stores.get(n)));
      const corrupt = !write && this.corruptRead;
      for (const op of tx.ops) {
        const s = copies.get(op.store)!;
        const sortedKeys = () => [...s.keys()].sort();
        switch (op.kind) {
          case 'get':
            op.req.result = structuredClone(s.get(String(op.key)));
            break;
          case 'put':
            s.set(String(op.key), structuredClone(op.value));
            op.req.result = op.key;
            break;
          case 'delete':
            s.delete(String(op.key));
            break;
          case 'clear':
            s.clear();
            break;
          case 'getAllKeys':
            op.req.result = sortedKeys();
            break;
          case 'getAll': {
            const vals = sortedKeys().map((k) => structuredClone(s.get(k)));
            if (corrupt) {
              const i = vals.findIndex((v) => typeof v === 'string');
              if (i >= 0) {
                vals[i] = `${vals[i] as string}!`;
                this.corruptRead = false; // consumed only once a value was actually flipped
              }
            }
            op.req.result = vals;
            break;
          }
        }
      }
      if (write) for (const [n, m] of copies) d.stores.set(n, m);
      for (const op of tx.ops) op.req.onsuccess?.({});
      tx.oncomplete?.({});
    }, 0);
  }
  forget(db: FakeDB): void {
    this.conns.delete(db);
  }
}

class FakeDB {
  closed = false;
  onversionchange: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly idb: FakeIDB;
  readonly data: { version: number; stores: Map<string, Map<string, unknown>> };
  constructor(idb: FakeIDB, data: { version: number; stores: Map<string, Map<string, unknown>> }) {
    this.idb = idb;
    this.data = data;
  }
  get objectStoreNames() {
    return { contains: (n: string) => this.data.stores.has(n) };
  }
  createObjectStore(n: string) {
    this.data.stores.set(n, new Map());
  }
  transaction(names: string | string[], mode: 'readonly' | 'readwrite' = 'readonly') {
    if (this.closed) throw err('InvalidStateError');
    const list = Array.isArray(names) ? names : [names];
    for (const n of list) if (!this.data.stores.has(n)) throw err('NotFoundError');
    const tx = new FakeTx(this, list, mode);
    this.idb.run(tx);
    return tx;
  }
  close() {
    this.closed = true;
    this.idb.forget(this);
  }
}

class FakeTx {
  ops: (Op & { store: string })[] = [];
  error: unknown = null;
  aborted = false;
  oncomplete: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onabort: ((e: unknown) => void) | null = null;
  readonly db: FakeDB;
  readonly names: string[];
  readonly mode: 'readonly' | 'readwrite';
  constructor(db: FakeDB, names: string[], mode: 'readonly' | 'readwrite') {
    this.db = db;
    this.names = names;
    this.mode = mode;
  }
  objectStore(name: string) {
    const add = (kind: Op['kind'], key?: unknown, value?: unknown) => {
      if (kind !== 'get' && kind !== 'getAll' && kind !== 'getAllKeys' && this.mode !== 'readwrite') throw err('ReadOnlyError');
      const req = new FakeRequest();
      this.ops.push({ kind, key, value, req, store: name });
      return req;
    };
    return {
      get: (k: unknown) => add('get', k),
      put: (v: unknown, k: unknown) => add('put', k, v),
      delete: (k: unknown) => add('delete', k),
      clear: () => add('clear'),
      getAll: () => add('getAll'),
      getAllKeys: () => add('getAllKeys'),
    };
  }
  commit() {
    /* requests run on the next macrotask anyway */
  }
  abort() {
    this.aborted = true;
    this.onabort?.({});
  }
}

export const fakeIdb = new FakeIDB();

/** Install as `globalThis.indexedDB`. */
export function installFakeIdb(): FakeIDB {
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = fakeIdb;
  return fakeIdb;
}

export function uninstallFakeIdb(): void {
  delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
}
