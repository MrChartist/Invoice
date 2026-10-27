/**
 * Round 14 PS-D shared names (the D block of PS-A's `ps-shared.ts`, PRD §6): tables, the dated rows the sync engine
 * keys them by, voucher classes and the account names the desk creates on first use. Data only; no imports.
 */

/** Company tables (`mrchartist_inv_<table>`): backed up, synced, audited; rights in `ps-d-registry.ts`. */
export const PS_D_TABLES = {
  partners: 'partners',
  partnerRuns: 'partner_runs',
  udin: 'udin_register',
} as const;

/** The date field each dated D table is synced / period-locked by (mirrors the `sync-engine.ts` DATED rows). */
export const PS_D_DATED: Readonly<Record<string, string>> = { partner_runs: 'date', udin_register: 'date' };

/** Voucher classes written by the firm desk (journals undone only from the desk). */
export const PS_D_CLASSES = {
  appropriation: 'Partners appropriation',
  credit: 'Partner credit',
  drawings: 'Partner drawings',
} as const;

/** Ledgers created by name on first use (PRD §6 storage summary). */
export const PS_D_ACCOUNTS = {
  remuneration: "Partners' remuneration",
  interest: "Interest on partners' capital",
  appropriation: 'Profit & loss appropriation',
  drawingsInterest: 'Interest on drawings',
  tds194t: 'TDS payable — 194T',
} as const;
