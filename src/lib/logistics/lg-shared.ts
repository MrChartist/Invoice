/**
 * Round 19 (logistics) shared names — one place for the tables, objects, packs and the series of R19-A … R19-D, so
 * B–D build on the names A registered (backup, sync, open-export schema, rights, audit labels). Round 19 adds ONE
 * series, `JOB` (job files; invoices use the existing series; dockets, house bills, MBL / MAWB, SB / BOE are typed).
 * Data only; no imports. See docs/features/logistics-r19.md.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited, rights in `lg-registry.ts`. D adds manifests / storage. */
export const LG_TABLES = {
  // R19-A: job files (dated by `date`) and rate sheets (not dated)
  jobs: 'lg_jobs',
  rates: 'lg_rate_sheets',
  // R19-D: courier manifests and storage months (dated by the month end)
  manifests: 'lg_manifests',
  storage: 'lg_storage',
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
export const LG_DATED: Readonly<Record<string, string>> = { lg_jobs: 'date', lg_manifests: 'date', lg_storage: 'date' };
