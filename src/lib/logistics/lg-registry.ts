/**
 * Round 19 (logistics) table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and
 * `WATCHED_TABLES` (audit-edits.ts) ship with the shell, so the Round 19 rows are added here, at runtime, by a lazy
 * chunk (the R8 `tr-registry.ts` … R18 `hs-registry.ts` pattern; first-paint budget 0). Every module that writes a
 * Round 19 table imports this file for its side effect (`import './lg-registry'`), and so do the lazy writers that touch
 * every table: the folder-sync engine (`sync-engine.ts`) and the recycle bin (`trust/recycle-bin.ts`). This file stays a
 * lazy leaf outside the `f-logistics` family (`familyRe(…, 'lg-registry')`). `tests/lg-registry.test.ts` pins both maps
 * and the importers. One block per package (§6 of docs/prd/round-19.md).
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Role needed to write each Round 19 table / object (`requireTableWrite`). */
export const LG_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  // R19-A: the settings object is the owner's; jobs are documents (rate sheets: cut 2)
  logistics_settings: 'settings.manage',
  lg_jobs: 'doc.create',
  // R19-D: courier manifests (storage months were cut, PRD §3 cut 1: no `lg_storage` table)
  lg_manifests: 'doc.create',
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `logistics_settings` is audited on save. */
export const LG_WATCHED: Readonly<Record<string, WatchedTable>> = {
  // R19-A
  lg_jobs: { entity: 'invoice', label: 'Job file' },
  // R19-D
  lg_manifests: { entity: 'invoice', label: 'Courier manifest' },
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerLogisticsTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(LG_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(LG_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerLogisticsTables();
