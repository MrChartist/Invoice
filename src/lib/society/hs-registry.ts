/**
 * Round 18 (housing society) table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and
 * `WATCHED_TABLES` (audit-edits.ts) ship with the shell, so the Round 18 rows are added here, at runtime, by a lazy
 * chunk (the R8 `tr-registry.ts` … R17 `mp-registry.ts` pattern; first-paint budget 0). Every module that writes a
 * Round 18 table imports this file for its side effect (`import './hs-registry'`), and so do the lazy writers that touch
 * every table: the folder-sync engine (`sync-engine.ts`) and the recycle bin (`trust/recycle-bin.ts`). This file stays a
 * lazy leaf outside the `f-society` family (`familyRe(…, 'hs-registry')`). `tests/hs-registry.test.ts` pins both maps
 * and the importers. One block per package (§6 of docs/prd/round-18.md).
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Role needed to write each Round 18 table / object (`requireTableWrite`). */
export const HS_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  // R18-A: the settings object is the owner's; units are a master
  society_settings: 'settings.manage',
  society_units: 'master.edit',
  // R18-B: a billing run issues documents
  society_runs: 'doc.create',
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `society_settings` is audited on save. */
export const HS_WATCHED: Readonly<Record<string, WatchedTable>> = {
  // R18-A
  society_units: { entity: 'client', label: 'Society unit' },
  // R18-B
  society_runs: { entity: 'invoice', label: 'Society run' },
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerSocietyTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(HS_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(HS_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerSocietyTables();
