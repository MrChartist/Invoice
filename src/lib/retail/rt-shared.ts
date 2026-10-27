/**
 * Round 9 (retail shops) shared registrations — one place for the tables, objects and series of all five packages
 * (RT-A … RT-E), so B–E build on the names RT-A registered (backup, sync, open-export schema, rights, audit labels).
 * Data only; no imports. See docs/features/retail-r9.md.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited, rights in `rt-registry.ts`. */
export const RT_TABLES = {
  // RT-A: delivery riders, rider cash settlements, short book
  deliveryRiders: 'delivery_riders',
  riderSettlements: 'rider_settlements',
  shortBook: 'short_book',
  // RT-B: doctors, refill schedules
  doctors: 'doctors',
  rxRefills: 'rx_refills',
  // RT-C: alteration slips
  alterationJobs: 'alteration_jobs',
  // RT-D: blocked-IMEI check log, finance deals (DOs), repair job sheets
  imeiChecks: 'imei_checks',
  financeDeals: 'finance_deals',
  serviceJobs: 'service_jobs',
  // RT-E: metal rate board, jewellery tags, karigar issue / receipt
  metalRates: 'metal_rates',
  jewelTags: 'jewel_tags',
  karigarMoves: 'karigar_moves',
} as const;

/** Company objects (singletons). */
export const RT_OBJECTS = {
  retailSettings: 'retail_settings', // RT-A2: MRP guard, deliveries, short book, free quantity, cash / PAN guard (RT-E3)
} as const;

/** New Indian-FY series (`<PREFIX>/FY<yy-yy>/<seq>`, through `series-counters.ts`; never reused after a delete). */
export const RT_SERIES = {
  /** Self-made purchase voucher for goods bought from an unregistered person (old device, old gold): on `purchases`. */
  urd: 'URD', // RT-A (used by RT-D3 and RT-E3; `rt-urd.ts`)
  alterations: 'ALT', // RT-C3
  serviceJobs: 'SVC', // RT-D4
  karigar: 'KAR', // RT-E4
} as const;

/** The date field each dated table is synced / period-locked by (mirrors the `sync-engine.ts` DATED rows). */
export const RT_DATED: Readonly<Record<string, string>> = {
  rider_settlements: 'date',
  short_book: 'date',
  rx_refills: 'next_due',
  alteration_jobs: 'date',
  imei_checks: 'date',
  finance_deals: 'date',
  service_jobs: 'date',
  metal_rates: 'date',
  karigar_moves: 'date',
};

/** Numbered tables (`number` field) and their series. */
export const RT_NUMBERED: Readonly<Record<string, string>> = {
  alteration_jobs: RT_SERIES.alterations,
  service_jobs: RT_SERIES.serviceJobs,
  karigar_moves: RT_SERIES.karigar,
};

/** RT-A3: the user ledger (group Cash & bank) that holds COD cash collected by delivery riders until settled. */
export const RIDER_CASH_LEDGER = 'Cash with riders'; // = no-cash.ts RIDER_CASH_LEDGER (pinned by tests/rt-registry.test.ts)
