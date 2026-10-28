/**
 * Round 17 (manpower agencies) shared names — one place for the tables, objects and packs of R17-A … R17-D, so B–D
 * build on the names A registered (backup, sync, open-export schema, rights, audit labels). Round 17 adds no series
 * (site codes are the agency's own, on the cost centre; arrears use the existing `DBN`). Data only; no imports.
 * See docs/features/manpower-r17.md.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited, rights in `mp-registry.ts`. B / C add theirs. */
export const MP_TABLES = {
  // R17-B: musters: 'site_musters' (dated by the month's last day)
  // R17-C: compliance: 'site_compliance' (dated by the month's last day)
} as const;

/** Company objects (singletons). */
export const MP_OBJECTS = {
  settings: 'manpower_settings', // R17-A: billing days, shift hours, service charge, bill date (B–D: theirs)
} as const;

/** The two Round 17 packs (`industry-packs.ts`): `manpower` is the core every kind turns on; `security` the PSARA one. */
export const MP_PACKS = ['manpower', 'security'] as const;

/** The date field each dated table is synced / period-locked by (mirrors the `sync-engine.ts` DATED rows). */
export const MP_DATED: Readonly<Record<string, string>> = {};
