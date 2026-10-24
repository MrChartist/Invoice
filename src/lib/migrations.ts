/**
 * Schema versioning for the localStorage data set.
 *
 * `mrchartist_inv_schema_version` records the last migration applied. On boot
 * (`main.tsx`, before the first render) `runMigrations()` applies every newer
 * migration in order. A restored backup carries its own version and is migrated
 * on the reload that follows the restore.
 *
 * Rules for a migration:
 *  - Additive and idempotent: running it twice must be harmless.
 *  - Never rename `mrchartist_inv_*` keys (AGENTS.md) and never rewrite an
 *    invoice's `sender` snapshot (Critical Rule 3).
 *  - Throw to abort: every key is put back as it was and the version stays put,
 *    so the app keeps reading the old shape through its tolerant readers.
 */

import { DB_PREFIX, SINGLETON_KEYS, collectAppData, getJson, readRaw, removeRaw, setJson, writeRaw } from './storage';

export const SCHEMA_VERSION_KEY = `${DB_PREFIX}schema_version`;

export interface Migration {
  version: number;
  name: string;
  up: () => void;
}

/** Keys that hold user data (a fresh install has none of these). */
const DATA_KEYS = ['invoices', 'clients', 'transactions', 'items_catalog', 'vendors', 'purchases'].map((t) => DB_PREFIX + t);

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'settings: persist the multi-profile shape',
    // Pre-2.1 settings were a flat object; `readSettings` lifted them into `profiles` on every read.
    // Write the lifted shape once so later code can rely on `profiles` being present.
    up: () => {
      const raw = getJson<Record<string, unknown> | null>(SINGLETON_KEYS.settings, null);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw.profiles)) return;
      const companyKeys = ['companyName', 'companyTagline', 'companyEmail', 'companyPhone', 'companyAddress', 'companyGstin', 'companyWebsite'];
      const profile: Record<string, unknown> = { id: `legacy-${Date.now().toString(36)}` };
      for (const k of companyKeys) profile[k] = String(raw[k] ?? '');
      setJson(SINGLETON_KEYS.settings, {
        ...raw,
        profiles: [profile],
        activeProfileId: profile.id,
        onboarded: raw.onboarded ?? Boolean(profile.companyName),
      });
    },
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0);

export function getSchemaVersion(): number {
  const n = Number(readRaw(SCHEMA_VERSION_KEY));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export type MigrationResult =
  | { status: 'current'; version: number }
  | { status: 'fresh'; version: number }
  | { status: 'migrated'; from: number; version: number; applied: string[] }
  /** Data written by a newer app version: left untouched. */
  | { status: 'newer'; version: number; latest: number }
  | { status: 'failed'; version: number; failed: string; message: string };

function hasUserData(): boolean {
  return DATA_KEYS.some((k) => {
    const raw = readRaw(k);
    return !!raw && raw.trim() !== '[]';
  }) || readRaw(SINGLETON_KEYS.settings) !== null;
}

/** Put every app key back exactly as `snapshot` had it. */
function rollback(snapshot: Record<string, string>): void {
  for (const key of Object.keys(collectAppData())) if (!(key in snapshot)) removeRaw(key);
  for (const [key, value] of Object.entries(snapshot)) {
    try {
      writeRaw(key, value);
    } catch {
      /* best effort; the original values were readable a moment ago */
    }
  }
}

export function runMigrations(migrations: Migration[] = MIGRATIONS): MigrationResult {
  const latest = migrations.reduce((m, x) => Math.max(m, x.version), 0);
  const current = getSchemaVersion();
  if (current > latest) return { status: 'newer', version: current, latest };
  if (current === latest) return { status: 'current', version: current };

  try {
    if (current === 0 && !hasUserData()) {
      writeRaw(SCHEMA_VERSION_KEY, String(latest));
      return { status: 'fresh', version: latest };
    }
  } catch (err) {
    return { status: 'failed', version: current, failed: 'stamp', message: (err as Error).message };
  }

  const pending = [...migrations].filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  const applied: string[] = [];
  let version = current;
  for (const m of pending) {
    const snapshot = collectAppData();
    try {
      m.up();
      writeRaw(SCHEMA_VERSION_KEY, String(m.version));
      version = m.version;
      applied.push(`${m.version}: ${m.name}`);
    } catch (err) {
      rollback(snapshot);
      return { status: 'failed', version, failed: `${m.version}: ${m.name}`, message: (err as Error)?.message ?? String(err) };
    }
  }
  return { status: 'migrated', from: current, version, applied };
}
