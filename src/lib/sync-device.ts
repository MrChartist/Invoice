/**
 * Folder sync (roadmap 5.7): this device's identity and per-company switch.
 *
 * Tiny and dependency-light on purpose: the app shell (SyncRunner) and the invoice editor read it,
 * everything else about sync is loaded on demand (`sync-folder.ts`, `sync-engine.ts`).
 *
 * Stored in the device-local key `mrchartist_inv_sync_device` (localStorage, listed in
 * `DEVICE_LOCAL_KEYS`, never in a backup): a random device id, an editable device name and, per
 * company, whether sync is on and which business profile this device issues documents as (so two
 * devices can number from different series).
 */

import { activeCompanyId } from './company-registry';
import { DB_PREFIX, generateId, readRaw, writeRaw } from './storage';

export const SYNC_DEVICE_KEY = `${DB_PREFIX}sync_device`;

export interface SyncCompanyPrefs {
  enabled: boolean;
  /** Business profile this device issues new documents as (its own number prefix). */
  profile_id?: string;
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

function parse(raw: string | null): SyncDevice | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SyncDevice> | null;
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !ID_RE.test(v.id)) return null;
    const companies: Record<string, SyncCompanyPrefs> = {};
    if (v.companies && typeof v.companies === 'object') {
      for (const [cid, p] of Object.entries(v.companies)) {
        if (!p || typeof p !== 'object') continue;
        companies[cid] = {
          enabled: (p as SyncCompanyPrefs).enabled === true,
          ...(typeof (p as SyncCompanyPrefs).profile_id === 'string' ? { profile_id: (p as SyncCompanyPrefs).profile_id } : {}),
        };
      }
    }
    return { id: v.id, name: String(v.name ?? '').slice(0, 60) || defaultName(), companies };
  } catch {
    return null;
  }
}

/** This device's identity, created (random id) on first use. */
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

function save(d: SyncDevice): void {
  writeRaw(SYNC_DEVICE_KEY, JSON.stringify(d));
}

export function setDeviceName(name: string): void {
  const d = syncDevice();
  save({ ...d, name: name.trim().slice(0, 60) || defaultName() });
}

export function companySyncPrefs(companyId: string = activeCompanyId()): SyncCompanyPrefs {
  return parse(readRaw(SYNC_DEVICE_KEY))?.companies[companyId] ?? { enabled: false };
}

export function setCompanySyncPrefs(patch: Partial<SyncCompanyPrefs>, companyId: string = activeCompanyId()): void {
  const d = syncDevice();
  const next = { ...(d.companies[companyId] ?? { enabled: false }), ...patch };
  if (!next.profile_id) delete next.profile_id;
  save({ ...d, companies: { ...d.companies, [companyId]: next } });
}

/** Cheap check for the shell: is folder sync switched on for the open company on this device? */
export function syncEnabledHere(): boolean {
  try {
    return companySyncPrefs().enabled;
  } catch {
    return false;
  }
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
