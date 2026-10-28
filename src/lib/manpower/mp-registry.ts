/**
 * Round 17 (manpower) table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and
 * `WATCHED_TABLES` (audit-edits.ts) ship with the shell, so the Round 17 rows are added here, at runtime, by a lazy
 * chunk (the R8 `tr-registry.ts` … R15 `tv-registry.ts` pattern; first-paint budget 0). Every module that writes a
 * Round 17 table imports this file for its side effect (`import './mp-registry'`), and so do the lazy writers that
 * touch every table: the folder-sync engine (`sync-engine.ts`) and the recycle bin (`trust/recycle-bin.ts`).
 * `tests/mp-registry.test.ts` pins both maps and the importers. One block per package (§6 of docs/prd/round-17.md).
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Role needed to write each Round 17 table / object (`requireTableWrite`). */
export const MP_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  // R17-A: the settings object is the owner's
  manpower_settings: 'settings.manage',
  // R17-B: duty registers are documents (lock / unlock too)
  site_musters: 'doc.create',
  // R17-C: compliance proof per site × month (status, hold)
  site_compliance: 'doc.create',
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `manpower_settings` is audited on save. */
export const MP_WATCHED: Readonly<Record<string, WatchedTable>> = {
  // R17-B
  site_musters: { entity: 'cost_centre', label: 'Site muster' },
  // R17-C
  site_compliance: { entity: 'cost_centre', label: 'Site compliance' },
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerManpowerTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(MP_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(MP_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerManpowerTables();
