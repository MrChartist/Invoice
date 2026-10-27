/**
 * Round 11 (construction) table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and
 * `WATCHED_TABLES` (audit-edits.ts) ship with the shell, so the Round 11 rows are added here, at runtime, by a lazy
 * chunk (the R8 `tr-registry.ts` / R9 `rt-registry.ts` pattern; Round 11 first-paint budget 0). Every module that
 * writes a Round 11 table imports this file for its side effect (`import './cn-registry'`), and so do the lazy writers
 * that touch every table: the folder-sync engine (`sync-engine.ts`) and the recycle bin (`trust/recycle-bin.ts`).
 * `tests/cn-registry.test.ts` pins both maps and the importers.
 * One block per package (§6 of docs/prd/round-11.md): each package edits only its own block.
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** The company object of CN-A (`mrchartist_inv_construction_settings`). */
export const CN_OBJECTS = { constructionSettings: 'construction_settings' } as const;

/** Role needed to write each Round 11 table / object (`requireTableWrite`). */
export const CN_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  // CN-A: the construction profile switches (owner only)
  construction_settings: 'settings.manage',
  // CN-B: works_contracts, secured_advances, price_variations, bank_guarantees
  // CN-C: realty_projects, realty_units, realty_bookings, payment_plans, stage_certificates, rera_withdrawals
  // CN-D: sub_work_orders, sub_measurements, labour_compliance, site_labour, muster_days, hired_equipment, plant_logs
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `construction_settings` is audited on save. */
export const CN_WATCHED: Readonly<Record<string, WatchedTable>> = {
  // CN-A: none (the settings object is audited on save)
  // CN-B
  // CN-C
  // CN-D
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerConstructionTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(CN_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(CN_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerConstructionTables();
