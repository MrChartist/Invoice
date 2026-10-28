/**
 * Round 15 (travel, tour and events) shared names — one place for the tables, objects and packs of R15-B … R15-D, so
 * C / D build on the names B registered (backup, sync, open-export schema, rights, audit labels). Round 15 adds no
 * series (trip codes are the agency's own, on the cost centre). Data only; no imports. See docs/features/travel-r15.md.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited, rights in `tv-registry.ts`. */
export const TV_TABLES = {
  // R15-B: trip / event components (dated by `start`)
  bookings: 'travel_bookings',
  // R15-C: supplier statements (BSP / consolidator / bed-bank; rows inside; dated by `period_end`)
  statements: 'supplier_statements',
} as const;

/** Company objects (singletons). */
export const TV_OBJECTS = {
  settings: 'travel_settings', // R15-B: regime default, IATA / BSP, consolidators, fee defaults, switches (C / D: theirs)
} as const;

/** The two Round 15 packs (`industry-packs.ts`): `travel` is the core every kind turns on; `events` the planners'. */
export const TV_PACKS = ['travel', 'events'] as const;

/** The date field each dated table is synced / period-locked by (mirrors the `sync-engine.ts` DATED rows). */
export const TV_DATED: Readonly<Record<string, string>> = {
  travel_bookings: 'start',
  supplier_statements: 'period_end', // R15-C
};
