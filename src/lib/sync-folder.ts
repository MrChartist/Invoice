/**
 * Folder sync (5.7), browser side: choosing the folder, the passphrase-derived key, permission and
 * the "Sync now" / scheduled runs. Loaded on demand (Settings panel, SyncRunner).
 *
 * Per company, in that company's IndexedDB `kv` store (like the backup folder): the directory handle,
 * the sync key (`sync-keystore.ts`: non-extractable, or sealed with the vault key in vault mode; the
 * passphrase itself is never stored) and `{ group, folder }`. Erase / Forgot-PIN clear the `kv` store,
 * which disconnects sync.
 */

import { currentActor, currentRole, deniedMessage, requireAccess, roleCan } from './access';
import { idbDel, idbGet, idbSet } from './idb-kv';
import { localDb } from './localDb';
import { resolvePrefix } from './invoice-number';
import { companiesUsingGroup, companyDevice, companySyncPrefs, issuingProfile, markSyncedThisSession, setCompanySyncPrefs } from './sync-device';
import { createOrJoinGroup, listGroups, openGroup, SyncFileError, type SyncDir } from './sync-files';
import { forgetSyncKey, hasStoredSyncKey, loadSyncKey, storeSyncKey } from './sync-keystore';
import { loadConflicts, loadDeviceLogs, loadState, recordReport, runSync, sharedSeries, type SyncReport } from './sync-engine';

const HANDLE_KEY = 'sync-dir-handle';
const CONFIG_KEY = 'sync-config';

export interface SyncConfig {
  group: string;
  folder: string;
  connected_at: string;
  /**
   * Who connected this device to the group (roles, 6.21). Automatic runs only use a connection the
   * owner made. Absent on connections made before this was recorded: the owner's next run fills it in.
   */
  connected_by?: { id: string; name: string; role: string };
}

/** Folder sync merges other devices' changes into every table: connecting / running it is owner-only. */
const SYNC_ACTION = 'settings.manage' as const;

function connectedBy(): NonNullable<SyncConfig['connected_by']> {
  const a = currentActor();
  return a ? { id: a.id, name: a.name, role: a.role } : { id: 'owner', name: '', role: currentRole() };
}

function denied(): string | null {
  return roleCan(currentRole(), SYNC_ACTION) ? null : deniedMessage(SYNC_ACTION);
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

/** Sync is connected but the key is missing (vault turned on since, or vault locked): ask for the passphrase. */
export async function needsPassphrase(): Promise<boolean> {
  return (await getSyncConfig()) !== null && (await loadSyncKey()) === null;
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
  const refused = denied(); // owner only (6.21): sync can send every table out and bring changes in
  if (refused) return { ok: false, message: refused };
  if (opts.passphrase.length < 8) return { ok: false, message: 'Use a sync passphrase of at least 8 characters.' };
  if (companiesUsingGroup(opts.group).length) {
    return { ok: false, message: 'Another company on this device already syncs with that group. Use a separate group for each company.' };
  }
  try {
    const dirs = await openGroup(opts.handle, opts.group, true);
    const { key, created } = await createOrJoinGroup(dirs, opts.group, opts.passphrase);
    const saved = (await idbSet(HANDLE_KEY, opts.handle)) && (await storeSyncKey(key)) &&
      (await idbSet(CONFIG_KEY, { group: opts.group, folder: opts.handle.name, connected_at: new Date().toISOString(), connected_by: connectedBy() } satisfies SyncConfig));
    if (!saved) return { ok: false, message: 'This browser could not remember the sync folder.' };
    companyDevice(); // allocate this company's device id before the first run
    setCompanySyncPrefs({ enabled: true, group: opts.group });
    const report = await runSyncNow({ interactive: true });
    return { ok: true, created, report };
  } catch (err) {
    if (err instanceof SyncFileError) return { ok: false, message: err.message };
    return { ok: false, message: (err as Error)?.message || 'Could not set up the sync folder.' };
  }
}

/** Type the sync passphrase again (the key was dropped when vault mode was turned on). */
export async function reenterPassphrase(passphrase: string): Promise<{ ok: boolean; message?: string }> {
  const refused = denied();
  if (refused) return { ok: false, message: refused };
  const [config, handle] = await Promise.all([getSyncConfig(), getHandle()]);
  if (!config || !handle) return { ok: false, message: 'No sync folder is connected.' };
  try {
    let perm = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (perm !== 'granted') perm = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
    if (perm !== 'granted') return { ok: false, message: 'Allow access to the sync folder first.' };
    const dirs = await openGroup(handle, config.group, false);
    const { key } = await createOrJoinGroup(dirs, config.group, passphrase);
    if (!(await storeSyncKey(key))) return { ok: false, message: 'This browser could not store the key.' };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error)?.message || 'That passphrase does not open this sync group.' };
  }
}

/** Stop syncing on this device. The folder and other devices are untouched; conflicts stay listed. */
export async function disconnectSync(): Promise<void> {
  requireAccess(SYNC_ACTION);
  await idbDel(HANDLE_KEY);
  await forgetSyncKey();
  await idbDel(CONFIG_KEY);
  setCompanySyncPrefs({ enabled: false });
}

/** The number series new invoices on this device use (its own profile's prefix, else the global one). */
export function devicePrefix(): string {
  const s = localDb.settings.get();
  const profile = issuingProfile(s.profiles, localDb.settings.activeProfile());
  return resolvePrefix('INVOICE', profile?.invoicePrefix || s.invoicePrefix);
}

const fail = (reason: NonNullable<SyncReport['reason']>, message: string): SyncReport => {
  const r: SyncReport = {
    ok: false, reason, message, at: new Date().toISOString(), added: 0, updated: 0, deleted: 0, conflicts: loadConflicts().length,
    newConflicts: 0, peers: 0, unreadable: [], wrote: false, blobsIn: 0, blobsOut: 0,
  };
  recordReport(r);
  return r;
};

/**
 * Run one sync. `interactive` only from a click: re-allowing folder access needs a user gesture.
 * Unattended runs (start-up, timer) report `permission` instead of prompting.
 */
export async function runSyncNow(opts: { interactive?: boolean } = {}): Promise<SyncReport> {
  // "Sync now" is owner-only (6.21); automatic runs go on whoever is signed in, but only over a
  // connection the owner made (checked below).
  if (opts.interactive) {
    const refused = denied();
    if (refused) return fail('denied', refused);
  }
  if (!isSyncSupported()) return fail('unsupported', 'This browser cannot use a sync folder.');
  if (!companySyncPrefs().enabled) return fail('no-folder', 'Sync is off for this company on this device.');
  const [config, handle] = await Promise.all([getSyncConfig(), getHandle()]);
  if (!config || !handle) {
    setCompanySyncPrefs({ enabled: false }); // erased / forgotten elsewhere
    return fail('no-folder', 'No sync folder is connected.');
  }
  if (!config.connected_by) {
    // Connected before this was recorded: only the owner may run it, and that run vouches for it.
    if (denied()) return fail('denied', 'The owner needs to run Sync now once on this device before sync runs automatically.');
    await idbSet(CONFIG_KEY, { ...config, connected_by: connectedBy() } satisfies SyncConfig);
  } else if (config.connected_by.role !== 'owner') {
    return fail('denied', 'This sync connection was not set up by the owner. The owner must disconnect it and connect again.');
  }
  const key = await loadSyncKey();
  if (!key) {
    return fail('passphrase', (await hasStoredSyncKey()) ? 'Unlock the vault to sync.' : 'Enter the sync passphrase once to resume syncing (vault mode was turned on).');
  }
  try {
    let perm = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (perm !== 'granted' && opts.interactive) perm = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
    if (perm !== 'granted') return fail('permission', 'Folder access needs to be allowed again. Click Sync now.');
    const report = await runSync({ root: handle, group: config.group, key, device: companyDevice(), prefix: devicePrefix() });
    if (report.ok) markSyncedThisSession();
    return report;
  } catch (err) {
    return fail('error', (err as Error)?.message || 'Sync failed.');
  }
}

/** Everything the Settings panel shows (synchronous reads of the sync bookkeeping). */
export function syncOverview() {
  const state = loadState();
  const self = companyDevice().id;
  return { state, conflicts: loadConflicts(), logs: loadDeviceLogs(), shared: sharedSeries(state, self), self, last: companySyncPrefs().last };
}
