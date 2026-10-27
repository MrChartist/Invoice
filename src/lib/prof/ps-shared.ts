/**
 * Round 14 (professional firms) shared names — one place for the tables, objects, series and packs of all four packages
 * (PS-A … PS-D), so B–D build on the names PS-A registered (backup, sync, open-export schema, rights, audit labels).
 * Data only; no imports. See docs/features/prof-r14.md.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited, rights in `ps-registry.ts`. */
export const PS_TABLES = {
  // PS-A: engagements (ENG/FY…, dated by `start`), conflict checks (dated)
  engagements: 'engagements',
  conflicts: 'conflict_checks',
} as const;

/** Company objects (singletons). */
export const PS_OBJECTS = {
  profSettings: 'prof_settings', // PS-A: switches, WIP reasons / buckets / accrual date, legal / CA ids (B–D: their sub-objects)
} as const;

/** New Indian-FY series (`<PREFIX>/FY<yy-yy>/<seq>`, through `series-counters.ts`; never reused after a delete). */
export const PS_SERIES = {
  engagements: 'ENG', // PS-A2 engagements
} as const;
/** Series reserved for PS-B (client-money vouchers): B moves its prefix into `PS_SERIES`. */
export const PS_RESERVED_SERIES: readonly string[] = ['CMV'];

/** The seven Round 14 packs (`industry-packs.ts`): `practice` is the shared core every professional kind turns on. */
export const PS_PACKS = ['practice', 'cafirm', 'legal', 'design', 'media', 'svcexport', 'partners'] as const;

/** The date field each dated table is synced / period-locked by (mirrors the `sync-engine.ts` DATED rows). */
export const PS_DATED: Readonly<Record<string, string>> = {
  engagements: 'start',
  conflict_checks: 'date',
};

/** Numbered tables (`number` field) and their series (mirrors the `sync-engine.ts` NUMBERED rows). */
export const PS_NUMBERED: Readonly<Record<string, string>> = {
  engagements: PS_SERIES.engagements,
};
