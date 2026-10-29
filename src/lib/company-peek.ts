/**
 * Read-only peek into the OTHER companies on this device (8G, 8.103 — SmartFind "all companies").
 *
 * Each company is its own IndexedDB database (`company-registry.ts`). This opens another company's
 * database WITHOUT a version (so it never upgrades or creates anything), reads the few search tables
 * from its `data` store in one read-only transaction and closes it. Vault-sealed values (`mcv1:`) and
 * unreadable rows are skipped — a locked company simply returns nothing. Nothing is ever written.
 */

import type { SearchData } from './search';

const DATA_STORE = 'data';
const PREFIX = 'mrchartist_inv_';
const TABLES = { invoices: 'invoices', clients: 'clients', items: 'items_catalog', vendors: 'vendors', bills: 'purchases', payments: 'transactions', vouchers: 'vouchers', cheques: 'cheques', advances: 'advances', einvoice: 'einvoice_meta' } as const;

export type PeekData = Omit<SearchData, 'pages' | 'actions'>;

function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(name);
    } catch {
      resolve(null);
      return;
    }
    // A database that does not exist yet would be created by open(): abort that upgrade instead.
    req.onupgradeneeded = () => {
      try {
        req.transaction?.abort();
      } catch {
        /* ignore */
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/**
 * PERF-3: a big `invoices` table may be stored as chunk records (`rows:<key>` head + `rows:<key>:<i>`,
 * storage.ts). Queue the reads of `key` in `store`; the returned getter gives its stored value: the plain
 * string (old layout, which wins), the text rebuilt from a complete set of chunks, the sealed head (so the
 * caller sees a vault), or undefined (missing, incomplete, or a head of a layout this build does not know).
 */
function readKey(store: IDBObjectStore, key: string): () => unknown {
  const base = store.get(key);
  if (key !== PREFIX + TABLES.invoices) return () => base.result;
  const range = IDBKeyRange.bound(`rows:${key}:`, `rows:${key}:￿`);
  const head = store.get(`rows:${key}`);
  const keys = store.getAllKeys(range);
  const vals = store.getAll(range);
  return () => {
    if (base.result !== undefined || typeof head.result !== 'string') return base.result;
    if (head.result.startsWith('mcv1:')) return head.result;
    let n = -1;
    try {
      const h = JSON.parse(head.result) as { v?: unknown; n?: unknown };
      if (h?.v === 1 && Number.isInteger(h.n)) n = h.n as number;
    } catch {
      /* unreadable head */
    }
    const c: unknown[] = [];
    (keys.result ?? []).forEach((k, j) => {
      const i = String(k).slice(`rows:${key}:`.length);
      if (/^\d+$/.test(i)) c[+i] = vals.result?.[j];
    });
    if (n < 1 || c.length !== n) return undefined;
    for (let i = 0; i < n; i++) if (typeof c[i] !== 'string' || (c[i] as string).startsWith('mcv1:')) return typeof c[i] === 'string' ? c[i] : undefined;
    return `[${c.join(',')}]`;
  };
}

const parse = (v: unknown): unknown[] => {
  if (typeof v !== 'string' || v.startsWith('mcv1:')) return [];
  try {
    const rows = JSON.parse(v);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};

/** Search tables of one other company (empty when it is locked, missing or unreadable). */
export async function peekCompany(dbName: string): Promise<PeekData | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openExisting(dbName);
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains(DATA_STORE)) return null;
    const entries = Object.entries(TABLES) as [keyof typeof TABLES, string][];
    const values = await new Promise<unknown[]>((resolve) => {
      const out: unknown[] = new Array(entries.length).fill(null);
      try {
        const tx = db.transaction(DATA_STORE, 'readonly');
        const store = tx.objectStore(DATA_STORE);
        const got = entries.map(([, t]) => readKey(store, PREFIX + t));
        tx.oncomplete = () => resolve(got.map((g) => g()));
        tx.onerror = () => resolve(out);
        tx.onabort = () => resolve(out);
      } catch {
        resolve(out);
      }
    });
    const data = Object.fromEntries(entries.map(([k], i) => [k, parse(values[i])])) as unknown as PeekData;
    return data;
  } finally {
    db.close();
  }
}

/** Every company except the open one, with its peeked tables (companies that fail are left out). */
export async function peekOtherCompanies(
  reg: { active: string; list: readonly { id: string; name: string }[] },
  dbName: (id: string) => string,
): Promise<{ id: string; name: string; data: PeekData }[]> {
  const out: { id: string; name: string; data: PeekData }[] = [];
  for (const c of reg.list) {
    if (c.id === reg.active) continue;
    const data = await peekCompany(dbName(c.id));
    if (data) out.push({ id: c.id, name: c.name, data });
  }
  return out;
}

/* ── R3-C6 practice desk ─────────────────────────────────────── */

/** Tables the practice board reads from another company (object keys and record tables alike). */
const COMPLIANCE_KEYS = ['settings', 'compliance', 'tds_returns', 'dsc_register', 'client_checklist', 'checklist_template', 'invoices', 'vouchers', 'purchases'] as const;

export type PeekedCompliance = { locked: boolean; tables: Partial<Record<(typeof COMPLIANCE_KEYS)[number], unknown>> };

/**
 * Read-only, version-less peek of one company's compliance tables (never creates or upgrades a
 * database; nothing is written). A vault-sealed company (`__vault__` record or `mcv1:` values) or one
 * that cannot be read comes back `locked`. Null when the database does not exist.
 */
export async function peekCompliance(dbName: string): Promise<PeekedCompliance | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openExisting(dbName);
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains(DATA_STORE)) return { locked: true, tables: {} };
    const keys = [...COMPLIANCE_KEYS.map((k) => PREFIX + k), '__vault__'];
    const values = await new Promise<unknown[] | null>((resolve) => {
      try {
        const tx = db.transaction(DATA_STORE, 'readonly');
        const store = tx.objectStore(DATA_STORE);
        const got = keys.map((k) => readKey(store, k));
        tx.oncomplete = () => resolve(got.map((g) => g()));
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (!values || values[values.length - 1] !== undefined) return { locked: true, tables: {} };
    if (values.some((v) => typeof v === 'string' && v.startsWith('mcv1:'))) return { locked: true, tables: {} };
    const tables: PeekedCompliance['tables'] = {};
    COMPLIANCE_KEYS.forEach((k, i) => {
      const v = values[i];
      if (typeof v !== 'string') return;
      try {
        tables[k] = JSON.parse(v);
      } catch {
        /* unreadable value: left out */
      }
    });
    return { locked: false, tables };
  } finally {
    db.close();
  }
}
