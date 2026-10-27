/**
 * Manufacturing statutory values and practice defaults (Round 13), keyed by the date they take effect — the same
 * `Versioned` / `ruleAt` shape as `tax-rules.ts`: add a new dated row, never edit an old one. Imported only by lazy
 * Round 13 screens and engines (`src/lib/mfg/*`) — never by `tax-rules.ts`, `shop-mode.ts` or the shell
 * (`tests/mf-rules.test.ts` checks the import graph). Values that already live elsewhere stay there and are imported
 * read-only by the packages: TCS on scrap (`trading-rules.ts`), garment price bands (`retail-rules.ts`), export
 * realisation (`trade/trade-rules.ts`), MSME days, the bank rate and ITC-04 frequency (`tax-rules.ts`).
 *
 * One section per package (§6 of docs/prd/round-13.md). Every row carries a `source` and `verified`. Working papers —
 * verify with your CA (docs/CA_REVIEW.md §13).
 */
import type { Versioned } from './tax-rules';

/** A dated manufacturing rule row: `source` plus whether the value was confirmed from an official text. */
export type MfRule<T> = Versioned<T> & { verified: boolean };

/* ── MF-A: shop-floor defaults (practice, not statute) and the paper ─────────────────────────────────────────── */

export interface WorkDefaults {
  /** Work-centre efficiency %, default. */
  efficiency_pct: number;
  /** One 8-hour shift, Monday–Saturday (0 = Sunday). */
  shift_hours: number;
  days: readonly number[];
  /** Reject reasons offered on a job-card entry until the company sets its own. */
  reject_reasons: readonly string[];
}

export const WORK_DEFAULTS: readonly MfRule<WorkDefaults>[] = [
  { from: '2017-07-01', value: { efficiency_pct: 100, shift_hours: 8, days: [1, 2, 3, 4, 5, 6], reject_reasons: ['Dimension', 'Surface', 'Porosity', 'Burr', 'Material', 'Setting', 'Other'] }, source: 'Shop practice (MF-A2); adjust per work centre', verified: false },
];

export interface PaperRule {
  /** The FSSAI licence / registration number must appear on invoices of a food business. */
  fssai_on_invoice: boolean;
}

/** FSSAI number on invoices / cash memos from 1 Oct 2021 (MF13). */
export const PAPER_RULES: readonly MfRule<PaperRule>[] = [
  { from: '2017-07-01', value: { fssai_on_invoice: false }, source: 'Before the FSSAI order of 8 Jun 2021', verified: false },
  { from: '2021-10-01', value: { fssai_on_invoice: true }, source: 'FSSAI order of 8 Jun 2021 (FSSAI number on invoice / cash memo / bill; not on e-way) — MF13', verified: true },
];

/* ── MF-B: SCRAP_CLASS_RULES, PRINT_CLASS_RULES, DENSITY_DEFAULTS ("practice") ──────────────────────────────── */

/* ── MF-C: TEXTILE_CLASS_RULES, RULE_89_5_RULES ──────────────────────────────────────────────────────────────── */

/* ── MF-D: FOOD_CLASS_RULES, MSME_FORM1_RULES, AA_RULES, EPCG_RULES, INVENTORY_HEADS ──────────────────────────── */
