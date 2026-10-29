/**
 * Round 19 (logistics) shared names — one place for the tables, objects, packs and the series of R19-A … R19-D, so
 * B–D build on the names A registered (backup, sync, open-export schema, rights, audit labels). Round 19 adds ONE
 * series, `JOB` (job files; invoices use the existing series; dockets, house bills, MBL / MAWB, SB / BOE are typed).
 * Data only; no imports. See docs/features/logistics-r19.md.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited, rights in `lg-registry.ts`. D adds manifests / storage. */
export const LG_TABLES = {
  // R19-A: job files (dated by `date`). The lane rate sheets (`lg_rate_sheets`) were cut at the R19-A cap (PRD §3 cut 2).
  jobs: 'lg_jobs',
  // R19-D: courier manifests (one per account customer × month, dockets inside), dated by the month end. Storage months
  // (`lg_storage`) were cut at the R19-D cap (PRD §3 cut 1): the table is not registered; its type stays declared.
  manifests: 'lg_manifests',
} as const;

/** Company objects (singletons). */
export const LG_OBJECTS = {
  settings: 'logistics_settings', // R19-A: heads, job prefix, currency (B–D: theirs)
} as const;

/** The Round 19 packs (`industry-packs.ts`): switched on by the logistics profile, never by a business type. */
export const LG_PACKS = ['logistics', 'customs', 'courier', 'warehouse'] as const;

/** The one Round 19 series. */
export const LG_SERIES = { jobs: 'JOB' } as const;

/** The date field each dated table is synced / period-locked by (mirrors the `sync-engine.ts` DATED rows). */
export const LG_DATED: Readonly<Record<string, string>> = { lg_jobs: 'date', lg_manifests: 'date' }; // R19-D: the month end
