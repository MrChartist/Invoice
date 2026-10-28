/**
 * Round 18 (housing societies) shared names — one place for the tables, objects and packs of R18-A … R18-D, so B–D
 * build on the names A registered (backup, sync, open-export schema, rights, audit labels). Round 18 adds no series
 * (unit codes are the society's own; taxable bills use the tax-invoice series, exempt bills `BOS`). Data only; no
 * imports. See docs/features/society-r18.md.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited, rights in `hs-registry.ts`. B adds `society_runs`. */
export const HS_TABLES = {
  // R18-A: units and their members (not dated)
  units: 'society_units',
  // R18-B: billing runs (one per period / levy; dated by the bill date)
  runs: 'society_runs',
} as const;

/** Company objects (singletons). */
export const HS_OBJECTS = {
  settings: 'society_settings', // R18-A: State, cycle, bill day, due days, heads, area unit (B–D: theirs)
} as const;

/** The Round 18 pack (`industry-packs.ts`): every society kind turns it on, never a business type. */
export const HS_PACKS = ['society'] as const;

/** The date field each dated table is synced / period-locked by (mirrors the `sync-engine.ts` DATED rows; B adds runs). */
export const HS_DATED: Readonly<Record<string, string>> = { society_runs: 'date' }; // R18-B
