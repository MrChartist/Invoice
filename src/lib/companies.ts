/**
 * Separate companies (roadmap 6.20): create / rename / switch / delete. See company-registry.ts.
 * Switching reloads the page so every module starts on the other company's data.
 */

import {
  activeCompanyId,
  DEFAULT_COMPANY_ID,
  DEFAULT_COMPANY_NAME,
  companyDbName,
  readRegistry,
  writeRegistry,
  type CompanyEntry,
  type CompanyRegistry,
} from './company-registry';
import { generateId, reloadAfterFlush, storageBackend } from './storage';
import { requireAccess } from './access';

export type { CompanyEntry, CompanyRegistry };
export { activeCompanyId, readRegistry, realCompanies } from './company-registry';

/** Companies need IndexedDB (each one is its own database). */
export function companiesSupported(): boolean {
  return storageBackend() === 'idb';
}

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) throw new Error('Give the company a name.');
  if (n.length > 80) throw new Error('Keep the name under 80 characters.');
  return n;
}

export function createCompany(name: string, now: Date = new Date()): CompanyEntry {
  // Local roles (6.21): only the owner adds, renames or deletes companies; every role may switch.
  requireAccess('settings.manage');
  if (!companiesSupported()) throw new Error('Separate companies need this browser’s database (IndexedDB).');
  const reg = readRegistry();
  const n = cleanName(name);
  if (reg.list.some((c) => c.name.toLowerCase() === n.toLowerCase())) throw new Error('A company with this name already exists.');
  const entry: CompanyEntry = { id: generateId().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 36), name: n, created: now.toISOString() };
  writeRegistry({ ...reg, list: [...reg.list, entry] });
  return entry;
}

export function renameCompany(id: string, name: string): void {
  requireAccess('settings.manage');
  const reg = readRegistry();
  const n = cleanName(name);
  if (reg.list.some((c) => c.id !== id && c.name.toLowerCase() === n.toLowerCase())) throw new Error('A company with this name already exists.');
  writeRegistry({ ...reg, list: reg.list.map((c) => (c.id === id ? { ...c, name: n } : c)) });
}

/**
 * QA-3 F27: while the main company is open and still carries the placeholder label, label it with
 * its business profile name (what the user knows it by). A label only: never renames a company the
 * user named, and skips a name another company already has. Returns true when it changed.
 */
export function labelMainCompany(profileName: string | null | undefined): boolean {
  const reg = readRegistry();
  const n = (profileName ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!n || activeCompanyId() !== DEFAULT_COMPANY_ID) return false; // the tab's open company (QA7 G1)
  const main = reg.list.find((c) => c.id === DEFAULT_COMPANY_ID);
  if (!main || main.name !== DEFAULT_COMPANY_NAME) return false;
  if (reg.list.some((c) => c.id !== DEFAULT_COMPANY_ID && c.name.toLowerCase() === n.toLowerCase())) return false;
  writeRegistry({ ...reg, list: reg.list.map((c) => (c.id === DEFAULT_COMPANY_ID ? { ...c, name: n } : c)) });
  return true;
}

/** Save pending writes, make `id` the active company and reload into it. */
export function switchCompany(id: string): void {
  const reg = readRegistry();
  if (!reg.list.some((c) => c.id === id) || (reg.active === id && activeCompanyId() === id)) return;
  writeRegistry({ ...reg, active: id });
  reloadAfterFlush();
}

/**
 * Delete a company and its database (not the open one, not the main one). Resolves false when the
 * browser refused (e.g. another tab still has it open: close that tab and try again).
 */
export async function deleteCompany(id: string): Promise<boolean> {
  requireAccess('settings.manage');
  const reg = readRegistry();
  if (id === DEFAULT_COMPANY_ID) throw new Error('The main company cannot be deleted; erase its data instead.');
  if (id === reg.active || id === activeCompanyId()) throw new Error('Switch to another company first.');
  const ok = await new Promise<boolean>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(companyDbName(id));
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
  if (ok) writeRegistry({ ...readRegistry(), list: readRegistry().list.filter((c) => c.id !== id) });
  return ok;
}

/**
 * Forgot-PIN reset: delete every company's database except the open one (whose data the reset
 * itself wipes), so no other company's data stays behind once the registry is gone. Pass the
 * registry read before the reset (the reset clears it).
 */
export async function eraseOtherCompanies(reg: CompanyRegistry = readRegistry()): Promise<void> {
  await Promise.all(
    reg.list
      .filter((c) => c.id !== reg.active)
      .map(
        (c) =>
          new Promise<void>((resolve) => {
            try {
              const req = indexedDB.deleteDatabase(companyDbName(c.id));
              req.onsuccess = req.onerror = req.onblocked = () => resolve();
            } catch {
              resolve();
            }
          }),
      ),
  );
}
