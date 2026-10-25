/**
 * Payroll (Phase 7, Tally parity) — public entry point. Loaded only by the lazy /payroll route;
 * never import this from the app shell (bundle budget). The ledger reads `records.ts` + `postings.ts`.
 */

export * from './compute';
export * from './depth';
export * from './depth-store';
export * from './depth-reports';
export * from './postings';
export * from './reports';
export * from './statutory';
export * from './store';
