/**
 * Round 12 (agriculture) shared registrations — tables, objects and series (the `tr-shared.ts` / `rt-shared.ts`
 * pattern). Data only; no imports. See docs/features/agri-r12.md.
 *
 * Minimum compatible version written by AG-D before AG-A landed: it holds AG-D's names (and the `farmer_cycles` table
 * AG-D reads for share deductions and patronage). AG-A owns this file; on merge AG-A's version wins and keeps these keys.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited, rights in `ag-registry.ts`. */
export const AG_TABLES = {
  // AG-A (read by AG-D)
  farmerCycles: 'farmer_cycles',
  // AG-D: cold-storage lots, rent plans, loans against stored produce, members' share ledger
  coldLots: 'cold_lots',
  coldRentPlans: 'cold_rent_plans',
  agriLoans: 'agri_loans',
  memberShares: 'member_shares',
} as const;

/** Company objects (singletons). */
export const AG_OBJECTS = {
  agriSettings: 'agri_settings',
} as const;

/** New Indian-FY series (`<PREFIX>/FY<yy-yy>/<seq>`, through `series-counters.ts`; never reused after a delete). */
export const AG_SERIES = {
  // AG-D
  csr: 'CSR', // cold-storage receipts (lots)
  gpo: 'GPO', // gate passes out (on the lot)
  las: 'LAS', // loans against stock
  shc: 'SHC', // share certificates
} as const;

/** The date field each dated AG-D table is synced / period-locked by (mirrors `sync-engine.ts` DATED). */
export const AG_DATED: Readonly<Record<string, string>> = {
  cold_lots: 'date_in',
  agri_loans: 'date',
  member_shares: 'date',
};

/** Numbered AG-D tables (`number` field) and their series. */
export const AG_NUMBERED: Readonly<Record<string, string>> = {
  cold_lots: AG_SERIES.csr,
  agri_loans: AG_SERIES.las,
};
