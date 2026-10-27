/**
 * Round 13 (manufacturing MSMEs) shared names — one place for the tables, objects, series and packs of all four
 * packages (MF-A … MF-D), so B–D build on the names MF-A registered (backup, sync, open-export schema, rights, audit
 * labels). Data only; no imports. See docs/features/mfg-r13.md.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited, rights in `mf-registry.ts`. */
export const MF_TABLES = {
  // MF-A: work centres, routings, job cards (JCD/FY…, one row per order per operation)
  centres: 'work_centres',
  routings: 'routings',
  jobCards: 'job_cards',
} as const;

/** Company objects (singletons). */
export const MF_OBJECTS = {
  mfgSettings: 'mfg_settings', // MF-A: switches, reject reasons, scrap item (B–D: moulds, presses, absorb switch, e-way note)
} as const;

/** New Indian-FY series (`<PREFIX>/FY<yy-yy>/<seq>`, through `series-counters.ts`; never reused after a delete). */
export const MF_SERIES = {
  jobCards: 'JCD', // MF-A3 job cards
} as const;
/** Series reserved for MF-B … MF-D (one commit, PRD §5; each package moves its prefix into `MF_SERIES`). */
export const MF_RESERVED_SERIES: readonly string[] = ['FAI', 'PES', 'CUT', 'KPB'];

/** The six Round 13 packs (`industry-packs.ts`): `shopfloor` is the shared core every manufacturing kind turns on. */
export const MF_PACKS = ['shopfloor', 'fabrication', 'garments', 'plastics', 'press', 'foodmfg'] as const;

/** The date field each dated table is synced / period-locked by (mirrors the `sync-engine.ts` DATED rows). */
export const MF_DATED: Readonly<Record<string, string>> = {
  job_cards: 'date',
};

/** Numbered tables (`number` field) and their series (mirrors the `sync-engine.ts` NUMBERED rows). */
export const MF_NUMBERED: Readonly<Record<string, string>> = {
  job_cards: MF_SERIES.jobCards,
};
