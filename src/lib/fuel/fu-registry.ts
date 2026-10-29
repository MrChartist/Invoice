/**
 * Round 21 (fuel) table registrations that live in first-paint maps. `TABLE_ACTIONS` (access.ts) and `WATCHED_TABLES`
 * (audit-edits.ts) ship with the shell, so the Round 21 rows are added here, at runtime, by a lazy chunk (the R19
 * `lg-registry.ts` pattern; first-paint budget 0). Every module that writes a Round 21 table imports this file for its
 * side effect (`import './fu-registry'`), and so do the folder-sync engine and the recycle bin. A registers EVERY Round 21
 * table (B–D's included) so B–D never edit this file; a table a later package cuts stays registered and unused.
 */
import { TABLE_ACTIONS, type AccessAction } from '../access';
import { WATCHED_TABLES, type WatchedTable } from '../audit-edits';

/** Role needed to write each Round 21 table / object (`requireTableWrite`). */
export const FU_TABLE_ACTIONS: Readonly<Record<string, AccessAction>> = {
  fuel_settings: 'settings.manage',
  fuel_nozzles: 'master.edit',
  fuel_prices: 'master.edit',
  fuel_shifts: 'doc.create',
  fuel_tank_logs: 'doc.create',
  fuel_slips: 'doc.create',
};

/** Audited tables (every row change logged; deletes go to the recycle bin). `fuel_settings` is audited on save. */
export const FU_WATCHED: Readonly<Record<string, WatchedTable>> = {
  fuel_nozzles: { entity: 'item', label: 'Nozzle' },
  fuel_prices: { entity: 'item', label: 'Fuel price' },
  fuel_shifts: { entity: 'invoice', label: 'Pump shift' },
  fuel_tank_logs: { entity: 'invoice', label: 'Tank log' },
  fuel_slips: { entity: 'invoice', label: 'Credit slip' },
};

/** Idempotent: adds the rows once (never overwrites a row another module set). */
export function registerFuelTables(): void {
  const actions = TABLE_ACTIONS as Record<string, AccessAction | readonly AccessAction[]>;
  const watched = WATCHED_TABLES as Record<string, WatchedTable>;
  for (const [t, a] of Object.entries(FU_TABLE_ACTIONS)) if (!actions[t]) actions[t] = a;
  for (const [t, w] of Object.entries(FU_WATCHED)) if (!watched[t]) watched[t] = w;
}

registerFuelTables();
