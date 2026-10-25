/**
 * Separate companies on one device (roadmap 6.20): the registry.
 *
 * Each company is its own IndexedDB database with exactly the same keys inside (tables, vault
 * record, folder-backup handle, backup key, undo copy), so nothing else in the app needs to know
 * which company is open. The first company is the existing `mrchartist_inv_kv` database, so a
 * device that never adds a second company is untouched.
 *
 * The registry itself is device-local (localStorage, never in a backup). Pure and dependency-free:
 * `idb-kv.ts` reads it to pick the database before anything is opened.
 */

export const COMPANY_REGISTRY_KEY = 'mrchartist_inv_companies';
export const DEFAULT_COMPANY_ID = 'default';
const BASE_DB = 'mrchartist_inv_kv';

export interface CompanyEntry {
  id: string;
  name: string;
  created: string;
}

export interface CompanyRegistry {
  active: string;
  list: CompanyEntry[];
}

const ID_RE = /^[a-z0-9-]{1,40}$/;

function ls(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The registry, always with the default company first and a valid `active`. */
export function readRegistry(): CompanyRegistry {
  let raw: unknown;
  try {
    raw = JSON.parse(ls()?.getItem(COMPANY_REGISTRY_KEY) ?? 'null');
  } catch {
    raw = null;
  }
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CompanyRegistry>;
  const list: CompanyEntry[] = [];
  const seen = new Set<string>();
  for (const e of Array.isArray(r.list) ? r.list : []) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !ID_RE.test(e.id) || seen.has(e.id)) continue;
    seen.add(e.id);
    list.push({ id: e.id, name: String(e.name ?? '').slice(0, 80) || 'Company', created: String(e.created ?? '') });
  }
  if (!seen.has(DEFAULT_COMPANY_ID)) list.unshift({ id: DEFAULT_COMPANY_ID, name: 'Main business', created: '' });
  const active = typeof r.active === 'string' && seen.has(r.active) ? r.active : DEFAULT_COMPANY_ID;
  return { active, list };
}

export function writeRegistry(reg: CompanyRegistry): void {
  ls()?.setItem(COMPANY_REGISTRY_KEY, JSON.stringify(reg));
}

export function activeCompanyId(): string {
  return readRegistry().active;
}

/** IndexedDB database holding a company's data. */
export function companyDbName(id: string): string {
  return id === DEFAULT_COMPANY_ID ? BASE_DB : `${BASE_DB}__${id}`;
}
