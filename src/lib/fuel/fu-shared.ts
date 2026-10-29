/**
 * Round 21 (fuel) shared names — one place for the tables, objects and packs of R21-A … R21-D, so B–D build on the names
 * A registered (backup, sync, open-export schema, rights, audit labels). Round 21 adds NO series (fuel sales use the
 * existing series; slip numbers are typed from the slip book). Data only; no imports. See docs/features/fuel-r21.md.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited, rights in `fu-registry.ts`. */
export const FU_TABLES = {
  // R21-A
  nozzles: 'fuel_nozzles',
  prices: 'fuel_prices',
  // R21-B
  shifts: 'fuel_shifts',
  // R21-C
  logs: 'fuel_tank_logs',
  // R21-D
  slips: 'fuel_slips',
} as const;

/** Company objects (singletons). */
export const FU_OBJECTS = { settings: 'fuel_settings' } as const;

/** The Round 21 packs (`industry-packs.ts`): switched on by the fuel profile, never by a business type. */
export const FU_PACKS = ['fuel', 'lpg'] as const;

/** The date field each dated table is synced / period-locked by (mirrors the `sync-engine.ts` DATED rows). */
export const FU_DATED: Readonly<Record<string, string>> = { fuel_prices: 'date', fuel_shifts: 'date', fuel_tank_logs: 'date', fuel_slips: 'date' };
