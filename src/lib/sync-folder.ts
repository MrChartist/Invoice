/**
 * Folder sync (5.7), browser side: choosing the folder, the passphrase-derived key, permission and
 * the "Sync now" / scheduled runs. Loaded on demand (Settings panel, SyncRunner).
 *
 * Per company, in that company's IndexedDB `kv` store (like the backup folder): the directory handle,
 * the non-extractable AES key derived from the sync passphrase (the passphrase itself is never stored)
 * and `{ group, folder }`. Erase / Forgot-PIN clear the `kv` store, which disconnects sync.
 */

import { idbDel, idbGet, idbSet } from './idb-kv';
import { localDb } from './localDb';
import { resolvePrefix } from './invoice-number';
import { companySyncPrefs, issuingProfile, setCompanySyncPrefs, syncDevice } from './sync-device';
import { createOrJoinGroup, listGroups, openGroup, SyncFileError, type SyncDir, type SyncKey } from './sync-files';
import { loadConflicts, loadDeviceLogs, loadState, recordReport, runSync, sharedSeries, type SyncReport } from './sync-engine';

const HANDLE_KEY = 'sync-dir-handle';
const KEY_KEY = 'sync-key';
const CONFIG_KEY = 'sync-config';

export interface SyncConfig {
  group: string;
  folder: string;
  connected_at: string;
}

export function isSyncSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export async function getSyncConfig(): Promise<SyncConfig | null> {
  const c = await idbGet<SyncConfig>(CONFIG_KEY);
  return c && typeof c.group === 'string' ? c : null;
}

async function getHandle(): Promise<SyncDir | null> {
  const h = await idbGet<SyncDir>(HANDLE_KEY);
  return h && h.kind === 'directory' ? h : null;
}

async function getKey(): Promise<SyncKey | null> {
  const k = await idbGet<SyncKey>(KEY_KEY);
  return k && k.key && typeof k.salt === 'string' && Number.isInteger(k.iter) ? k : null;
}

export type PickResult = { ok: true; handle: SyncDir; groups: string[] } | { ok: false; reason: 'unsupported' | 'cancelled' | 'failed'; message?: string };

/** Ask for a folder (user gesture) and list the sync groups already in it. */
export async function pickSyncFolder(): Promise<PickResult> {
  if (!isSyncSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const picker = (window as unknown as { showDirectoryPicker(o: { mode: 'readwrite'; id: string }): Promise<SyncDir> }).showDirectoryPicker;
    const handle = await picker.call(window, { mode: 'readwrite', id: 'mrchartist-sync' });
    return { ok: true, handle, groups: await listGroups(handle) };
  } catch (err) {
    return (err as Error)?.name === 'AbortError' ? { ok: false, reason: 'cancelled' } : { ok: false, reason: 'failed', message: (err as Error)?.message };
  }
}

/** Suggested group name for a new group: from the company name, lower-case, dashes. */
export function suggestGroupName(name: string): string {
  const s = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return s.length >= 2 ? s : 'my-books';
}

/**
 * Create a new sync group in the folder (first device) or join an existing one (passphrase checked
 * against its manifest), remember everything, and run the first sync.
 */
export async function connectSync(opts: { handle: SyncDir; group: string; passphrase: string }): Promise<{ ok: true; created: boolean; report: SyncReport } | { ok: false; message: string }> {
  if (opts.passphrase.length < 8) return { ok: false, message: 'Use a sync passphrase of at least 8 characters.' };
  try {
    const dirs = await openGroup(opts.handle, opts.group, true);
    const { key, created } = await createOrJoinGroup(dirs, opts.group, opts.passphrase);
    const saved = (await idbSet(HANDLE_KEY, opts.handle)) && (await idbSet(KEY_KEY, key)) &&
      (await idbSet(CONFIG_KEY, { group: opts.group, folder: opts.handle.name, connected_at: new Date().toISOString() } satisfies SyncConfig));
    if (!saved) return { ok: false, message: 'This browser could not remember the sync folder.' };
    setCompanySyncPrefs({ enabled: true });
    const report = await runSyncNow({ interactive: true });
    return { ok: true, created, report };
  } catch (err) {
    if (err instanceof SyncFileError) return { ok: false, message: err.message };
    return { ok: false, message: (err as Error)?.message || 'Could not set up the sync folder.' };
  }
}

/** Stop syncing on this device. The folder and other devices are untouched; conflicts stay listed. */
export async function disconnectSync(): Promise<void> {
  await idbDel(HANDLE_KEY);
  await idbDel(KEY_KEY);
  await idbDel(CONFIG_KEY);
  setCompanySyncPrefs({ enabled: false });
}

/** The number series new invoices on this device use (its own profile's prefix, else the global one). */
export function devicePrefix(): string {
  const s = localDb.settings.get();
  const profile = issuingProfile(s.profiles, localDb.settings.activeProfile());
  return resolvePrefix('INVOICE', profile?.invoicePrefix || s.invoicePrefix);
}

const fail = (reason: NonNullable<SyncReport['reason']>, message: string): SyncReport => ({
  ok: false, reason, message, at: new Date().toISOString(), added: 0, updated: 0, deleted: 0, conflicts: loadConflicts().length,
  newConflicts: 0, peers: 0, unreadable: [], wrote: false, blobsIn: 0, blobsOut: 0,
});

/**
 * Run one sync. `interactive` only from a click: re-allowing folder access needs a user gesture.
 * Unattended runs (start-up, timer) report `permission` instead of prompting.
 */
export async function runSyncNow(opts: { interactive?: boolean } = {}): Promise<SyncReport> {
  if (!isSyncSupported()) return fail('unsupported', 'This browser cannot use a sync folder.');
  if (!companySyncPrefs().enabled) return fail('no-folder', 'Sync is off for this company on this device.');
  const [config, handle, key] = await Promise.all([getSyncConfig(), getHandle(), getKey()]);
  if (!config || !handle || !key) {
    setCompanySyncPrefs({ enabled: false }); // erased / forgotten elsewhere
    return fail('no-folder', 'No sync folder is connected.');
  }
  try {
    let perm = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (perm !== 'granted' && opts.interactive) perm = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
    if (perm !== 'granted') {
      const r = fail('permission', 'Folder access needs to be allowed again. Click Sync now.');
      recordReport(r);
      return r;
    }
    const d = syncDevice();
    return await runSync({ root: handle, group: config.group, key, device: { id: d.id, name: d.name }, prefix: devicePrefix() });
  } catch (err) {
    const r = fail('error', (err as Error)?.message || 'Sync failed.');
    recordReport(r);
    return r;
  }
}

/** Everything the Settings panel shows (synchronous reads of the sync bookkeeping). */
export function syncOverview() {
  const state = loadState();
  const self = syncDevice().id;
  return { state, conflicts: loadConflicts(), logs: loadDeviceLogs(), shared: sharedSeries(state, self), self };
}
