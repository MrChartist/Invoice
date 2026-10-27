/**
 * Round 12 (agriculture and food processing) shared names — one place for the tables, objects, series and packs of all
 * four packages (AG-A … AG-D), so B–D build on the names AG-A registered (backup, sync, open-export schema, rights, audit
 * labels). Data only; no imports. See docs/features/agri-r12.md.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited, rights in `ag-registry.ts`. */
export const AG_TABLES = {
  // AG-A: farm batches, quality-cut tables, pooled farmer cycles (CYB/FY…)
  batches: 'farm_batches',
  quality: 'quality_cut_tables',
  cycles: 'farmer_cycles',
  // AG-B: fat / SNF rate charts, shift collection (one row per centre per shift), dispatches (MDS/FY…), milk cards
  rateCharts: 'milk_rate_charts',
  shifts: 'milk_shifts',
  dispatches: 'milk_dispatches',
  milkCards: 'milk_cards',
  // AG-C: weighbridge_slips, cmr_agreements
  // AG-D: cold_lots, cold_rent_plans, agri_loans, member_shares
} as const;

/** Company objects (singletons). */
export const AG_OBJECTS = {
  agriSettings: 'agri_settings', // AG-A: centres, cycles, switches (B–D: milk, chambers, licences, principals, seasons)
} as const;

/** New Indian-FY series (`<PREFIX>/FY<yy-yy>/<seq>`, through `series-counters.ts`; never reused after a delete). */
export const AG_SERIES = {
  vouchers: 'FPV', // AG-A3 farmer purchase vouchers (on `purchases`)
  cycles: 'CYB', // AG-A4 pooled cycle bills (on `purchases` and `farmer_cycles`)
  dispatches: 'MDS', // AG-B4 milk dispatches
} as const;
/** Series reserved for AG-B … AG-D (one commit, PRD §5; each package moves its prefix into `AG_SERIES`). */
export const AG_RESERVED_SERIES = ['WBS', 'CMR', 'CSR', 'GPO', 'LAS', 'SHC'] as const;

/** The six Round 12 packs (`industry-packs.ts`): `agri` is the shared farm base every agri kind turns on. */
export const AG_PACKS = ['agri', 'dairy', 'mill', 'coldstore', 'agri_inputs', 'fpo'] as const;

/** The date field each dated table is synced / period-locked by (mirrors the `sync-engine.ts` DATED rows). */
export const AG_DATED: Readonly<Record<string, string>> = {
  farm_batches: 'start',
  farmer_cycles: 'period_to',
  // AG-B
  milk_rate_charts: 'effective_from',
  milk_shifts: 'date',
  milk_dispatches: 'date',
};
