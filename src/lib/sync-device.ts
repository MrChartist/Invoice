/**
 * Folder sync (roadmap 5.7): this device's identity and per-company switch.
 *
 * Tiny and dependency-light on purpose: the app shell (SyncRunner, the recurring runner) and the invoice
 * editor read it; everything else about sync is loaded on demand (`sync-folder.ts`, `sync-engine.ts`).
 *
 * Stored in the device-local key `mrchartist_inv_sync_device` (localStorage, listed in
 * `DEVICE_LOCAL_KEYS`, never in a backup, untouched by a restore): an editable device name and, per
 * company, whether sync is on, the device id used in that company's group (one per company, so two
 * companies on one device can never write the same file), the highest Lamport counter this device has
 * used there (survives a restore / erase of the company data), the profile this device issues
 * documents as, and the last run's outcome for the panel.
 */

import { activeCompanyId } from './company-registry';
import { DB_PREFIX, generateId, readRaw, writeRaw } from './storage';

export const SYNC_DEVICE_KEY = `${DB_PREFIX}sync_device`;

export interface SyncRunSummary {
  at: string;
  ok: boolean;
  reason?: string;
  message?: string;
  conflicts?: number;
}

export interface SyncCompanyPrefs {
  enabled: boolean;
  /** This device's id inside the company's sync group. */
  device_id?: string;
  /** Sync group joined (refuses a second company on this device joining the same group). */
  group?: string;
  /** High-water Lamport counter used in this company's group. */
  hw?: number;
  /** Business profile this device issues new documents as (its own number prefix). */
  profile_id?: string;
  /** Outcome of the last run (also idle runs, which do not rewrite the sync state). */
  last?: SyncRunSummary;
}

export interface SyncDevice {
  id: string;
  name: string;
  companies: Record<string, SyncCompanyPrefs>;
}

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function defaultName(): string {
  try {
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'This device';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : '';
    return browser ? `${os} · ${browser}` : os;
  } catch {
    return 'This device';
  }
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

function parse(raw: string | null): SyncDevice | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SyncDevice> | null;
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !ID_RE.test(v.id)) return null;
    const companies: Record<string, SyncCompanyPrefs> = Object.create(null) as Record<string, SyncCompanyPrefs>;
    if (v.companies && typeof v.companies === 'object') {
      for (const [cid, p] of Object.entries(v.companies)) {
        if (!p || typeof p !== 'object') continue;
        const x = p as SyncCompanyPrefs;
        companies[cid] = {
          enabled: x.enabled === true,
          ...(typeof x.device_id === 'string' && ID_RE.test(x.device_id) ? { device_id: x.device_id } : {}),
          ...(typeof x.group === 'string' ? { group: x.group } : {}),
          ...(isCount(x.hw) ? { hw: x.hw } : {}),
          ...(typeof x.profile_id === 'string' ? { profile_id: x.profile_id } : {}),
          ...(x.last && typeof x.last === 'object' && typeof x.last.at === 'string' ? { last: x.last } : {}),
        };
      }
    }
    return { id: v.id, name: String(v.name ?? '').slice(0, 60) || defaultName(), companies };
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let version = 0;

/** Re-render hooks (SyncRunner) when the switch changes in this tab. */
export function subscribeSyncPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const syncPrefsVersion = (): number => version;

function save(d: SyncDevice): void {
  writeRaw(SYNC_DEVICE_KEY, JSON.stringify({ ...d, companies: { ...d.companies } }));
  version++;
  for (const fn of listeners) fn();
}

/** This device's name (and a random install id), created on first use. */
export function syncDevice(): SyncDevice {
  const found = parse(readRaw(SYNC_DEVICE_KEY));
  if (found) return found;
  const created: SyncDevice = { id: generateId(), name: defaultName(), companies: {} };
  try {
    writeRaw(SYNC_DEVICE_KEY, JSON.stringify(created));
  } catch {
    /* unsaved: a new id next time, which only means "a new device" to the others */
  }
  return created;
}

export function setDeviceName(name: string): void {
  const d = syncDevice();
  save({ ...d, name: name.trim().slice(0, 60) || defaultName() });
}

export function companySyncPrefs(companyId: string = activeCompanyId()): SyncCompanyPrefs {
  const d = parse(readRaw(SYNC_DEVICE_KEY));
  return (d && Object.hasOwn(d.companies, companyId) ? d.companies[companyId] : undefined) ?? { enabled: false };
}

export function setCompanySyncPrefs(patch: Partial<SyncCompanyPrefs>, companyId: string = activeCompanyId()): void {
  const d = syncDevice();
  const prev = Object.hasOwn(d.companies, companyId) ? d.companies[companyId] : { enabled: false };
  const next: SyncCompanyPrefs = { ...prev, ...patch };
  if (!next.profile_id) delete next.profile_id;
  save({ ...d, companies: { ...d.companies, [companyId]: next } });
}

/** This device's id and name in the company's sync group (a separate id per company). */
export function companyDevice(companyId: string = activeCompanyId()): { id: string; name: string } {
  const d = syncDevice();
  const prefs = companySyncPrefs(companyId);
  if (prefs.device_id) return { id: prefs.device_id, name: d.name };
  const id = generateId();
  setCompanySyncPrefs({ device_id: id }, companyId);
  return { id, name: d.name };
}

/** Other companies on this device that have sync switched on for `group`. */
export function companiesUsingGroup(group: string, except: string = activeCompanyId()): string[] {
  const d = parse(readRaw(SYNC_DEVICE_KEY));
  if (!d) return [];
  return Object.entries(d.companies).filter(([cid, p]) => cid !== except && p.enabled && p.group === group).map(([cid]) => cid);
}

/** Cheap check for the shell: is folder sync switched on for the open company on this device? */
export function syncEnabledHere(): boolean {
  try {
    return companySyncPrefs().enabled;
  } catch {
    return false;
  }
}

/* ── First successful sync of this session (the recurring runner waits for it) ── */

let syncedOnce = false;
const waiters = new Set<() => void>();

export function markSyncedThisSession(): void {
  syncedOnce = true;
  for (const fn of waiters) fn();
  waiters.clear();
}

/** Resolves after this tab's first successful sync, or after `timeoutMs`; at once when sync is off. */
export function afterFirstSync(timeoutMs: number): Promise<void> {
  if (syncedOnce || !syncEnabledHere()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      waiters.delete(done);
      resolve();
    };
    const t = setTimeout(done, timeoutMs);
    waiters.add(done);
  });
}

/**
 * The profile new documents are issued as on this device: the device's own choice when sync is on
 * and that profile still exists, otherwise `fallback` (the active profile).
 */
export function issuingProfile<T extends { id?: string }>(profiles: T[], fallback: T | null): T | null {
  try {
    const prefs = companySyncPrefs();
    if (prefs.enabled && prefs.profile_id) return profiles.find((p) => p.id === prefs.profile_id) ?? fallback;
  } catch {
    /* fall back */
  }
  return fallback;
}
