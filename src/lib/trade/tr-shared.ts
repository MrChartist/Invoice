/**
 * Round 8 (trading) shared registrations — one place for the tables, objects and series of all three packages, so
 * TR-A and TR-B build on the names TR-C registered (backup, access, audit, sync, open-export schema).
 * Data only; no imports. See docs/features/trading-r8.md.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited, in `TABLE_ACTIONS`. */
export const TR_TABLES = {
  // TR-A
  partyRates: 'party_rates',
  claims: 'trade_claims',
  priceDrops: 'price_drops',
  interestRuns: 'interest_runs',
  packagingTypes: 'packaging_types',
  packagingMoves: 'packaging_moves',
  // TR-B
  chargeHeads: 'trade_charge_heads',
  brokeragePostings: 'brokerage_postings',
  // TR-C
  arrivals: 'arrivals',
  pattis: 'sale_pattis',
  indents: 'indents',
} as const;

/** Company objects (singletons). */
export const TR_OBJECTS = {
  interestSettings: 'interest_settings', // TR-A4
  bankStatementSettings: 'bank_statement_settings', // TR-C4 (not audited: viewing terms)
  tdsSettings: 'tds_settings', // TR-C2 (`turnover_by_fy`)
} as const;

/** New Indian-FY series (`<PREFIX>/FY<yy-yy>/<seq>`, through `series-counters.ts`; never reused after delete). */
export const TR_SERIES = {
  claims: 'TCL', // TR-A2 / A3 trade claims
  priceDrops: 'PDR', // TR-A3 price-drop runs
  arrivals: 'ARR', // TR-C1
  pattis: 'PAT', // TR-C1 bikri patti
  indents: 'IND', // TR-C1
} as const;
