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
/** Label of the first company until it is named (its profile name replaces it, QA-3 F27). */
export const DEFAULT_COMPANY_NAME = 'Main business';
const BASE_DB = 'mrchartist_inv_kv';

export interface CompanyEntry {
  id: string;
  name: string;
  created: string;
  /** QA7 G1/G2: set only by the Demo-company creator (`demo-company.ts`), never by a name. */
  demo?: true;
  /** The company the Demo company was opened from ("Switch to" goes back there). */
  from?: string;
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
    list.push({ id: e.id, name: String(e.name ?? '').slice(0, 80) || 'Company', created: String(e.created ?? ''), ...(e.demo === true && { demo: true, from: String(e.from ?? '') }) });
  }
  if (!seen.has(DEFAULT_COMPANY_ID)) list.unshift({ id: DEFAULT_COMPANY_ID, name: DEFAULT_COMPANY_NAME, created: '' });
  const active = typeof r.active === 'string' && seen.has(r.active) ? r.active : DEFAULT_COMPANY_ID;
  return { active, list };
}

export function writeRegistry(reg: CompanyRegistry): void {
  ls()?.setItem(COMPANY_REGISTRY_KEY, JSON.stringify(reg));
}

let pinned: string | null = null;

/**
 * The company this tab has open. QA7 G1: fixed when its database is first opened (`pinCompany`, idb-kv.ts), so a
 * switch in another tab, which rewrites the stored registry, never makes this tab think it holds another company.
 */
export function activeCompanyId(): string {
  return pinned ?? readRegistry().active;
}

/** idb-kv: pin the company whose database this tab opens (kept until the page reloads); `null` is for tests. */
export const pinCompany = (id: string | null): string | null => (pinned = id);

/** QA7 G7: the user's own companies, without the Demo company. */
export const realCompanies = (reg: CompanyRegistry = readRegistry()): CompanyEntry[] => reg.list.filter((c) => !c.demo);

/** IndexedDB database holding a company's data. */
export function companyDbName(id: string): string {
  return id === DEFAULT_COMPANY_ID ? BASE_DB : `${BASE_DB}__${id}`;
}
