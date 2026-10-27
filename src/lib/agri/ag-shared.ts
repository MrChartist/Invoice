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
  // AG-B: milk_rate_charts, milk_shifts, milk_dispatches, milk_cards
  // AG-C: weighbridge slips (WBS/FY…), custom-milling agreements (deliveries CMR/FY… inside the row)
  weighbridge: 'weighbridge_slips',
  cmr: 'cmr_agreements',
  // AG-D: cold-storage lots (CSR, GPO inside), rent plans, loans against stored produce (LAS), members' share ledger (SHC)
  coldLots: 'cold_lots',
  coldRentPlans: 'cold_rent_plans',
  agriLoans: 'agri_loans',
  memberShares: 'member_shares',
} as const;

/** Company objects (singletons). */
export const AG_OBJECTS = {
  agriSettings: 'agri_settings', // AG-A: centres, cycles, switches (B–D: milk, chambers, licences, principals, seasons)
} as const;

/** New Indian-FY series (`<PREFIX>/FY<yy-yy>/<seq>`, through `series-counters.ts`; never reused after a delete). */
export const AG_SERIES = {
  vouchers: 'FPV', // AG-A3 farmer purchase vouchers (on `purchases`)
  cycles: 'CYB', // AG-A4 pooled cycle bills (on `purchases` and `farmer_cycles`)
  wbs: 'WBS', // AG-C1 weighbridge slips
  cmr: 'CMR', // AG-C3 custom-milled rice deliveries (inside `cmr_agreements`)
  // AG-D
  csr: 'CSR', // cold-storage receipts (lots)
  gpo: 'GPO', // gate passes out (on the lot)
  las: 'LAS', // loans against stored produce
  shc: 'SHC', // share certificates
} as const;
/** Series reserved for AG-B … AG-D (one commit, PRD §5; each package moves its prefix into `AG_SERIES`). */
export const AG_RESERVED_SERIES = ['MDS'] as const;

/** The six Round 12 packs (`industry-packs.ts`): `agri` is the shared farm base every agri kind turns on. */
export const AG_PACKS = ['agri', 'dairy', 'mill', 'coldstore', 'agri_inputs', 'fpo'] as const;

/** The date field each dated table is synced / period-locked by (mirrors the `sync-engine.ts` DATED rows). */
export const AG_DATED: Readonly<Record<string, string>> = {
  farm_batches: 'start',
  farmer_cycles: 'period_to',
  weighbridge_slips: 'date', // AG-C
  // AG-D
  cold_lots: 'date_in',
  agri_loans: 'date',
  member_shares: 'date',
};

/** AG-D numbered tables (`number` field) and their series (mirrors the `sync-engine.ts` NUMBERED rows). */
export const AG_NUMBERED: Readonly<Record<string, string>> = {
  cold_lots: AG_SERIES.csr,
  agri_loans: AG_SERIES.las,
};
