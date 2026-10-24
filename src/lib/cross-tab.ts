/**
 * Cross-tab awareness. Every write already re-reads localStorage, so two tabs cannot
 * interleave inside one mutation; the risks are an open editor saving a stale copy over
 * another tab's newer save, and screens showing data that changed elsewhere.
 *
 * The browser fires `storage` only in the OTHER tabs, so anything recorded here is an
 * external change. Autosave drafts and bookkeeping keys are ignored so typing in one tab
 * does not nag the other.
 */

import { DB_PREFIX } from './storage';
import { DEVICE_LOCAL_KEYS } from './auth';

/** Keys that change often without being shared data (autosave draft, PIN session, bookkeeping). */
const IGNORED = new Set([
  ...DEVICE_LOCAL_KEYS,
  ...['draft', 'backup_snooze', 'auto_backup', 'notif_state', 'install_dismissed', 'export_prefs'].map((k) => DB_PREFIX + k),
]);

let version = 0;
const changedAt = new Map<string, number>();
const listeners = new Set<() => void>();
let installed = false;

export function isSharedDataKey(key: string | null): boolean {
  if (key === null) return true; // localStorage.clear() in another tab
  return key.startsWith(DB_PREFIX) && !IGNORED.has(key);
}

/** Record an external change (exported for tests; the `storage` listener calls it). */
export function noteExternalChange(key: string | null, now: number = Date.now()): void {
  if (!isSharedDataKey(key)) return;
  version++;
  changedAt.set(key ?? '*', now);
  for (const fn of listeners) fn();
}

/** True if another tab changed `fullKey` (or cleared storage) after `since` (ms). */
export function changedElsewhereSince(fullKey: string, since: number): boolean {
  return (changedAt.get(fullKey) ?? 0) > since || (changedAt.get('*') ?? 0) > since;
}

export function externalVersion(): number {
  return version;
}

export function subscribeExternal(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Install the `storage` listener once (call at boot). */
export function initCrossTab(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('storage', (e) => {
    if (e.storageArea && typeof localStorage !== 'undefined' && e.storageArea !== localStorage) return;
    noteExternalChange(e.key);
  });
}

/** Test seam. */
export function resetCrossTab(): void {
  version = 0;
  changedAt.clear();
}
