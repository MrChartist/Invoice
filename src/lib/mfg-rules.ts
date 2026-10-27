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

/* ── D1: packaged-food classes (rate suggestions; a typed rate always wins) ──────────────────────────────────────── */

export type FoodClass = 'namkeen' | 'biscuits' | 'sauces' | 'pasta_noodles' | 'sweets' | 'chocolates' | 'spices_packed' | 'pickles' | 'rte_food';

export interface FoodClassRate {
  rate: number;
  hsn: string;
}

const N1 = 'N 1/2017-CT(R) schedules — recalled';
const SEP25 = 'GST rate rationalisation from 22 Sep 2025 (L&S, Business Standard, Petpooja; N 9/2025-CT(R) not read — MF6)';
const fr = (from: string, rate: number, hsn: string, source: string): MfRule<FoodClassRate> => ({ from, value: { rate, hsn }, source, verified: false });
const cut = (hsn: string, before: number, note = '') => [fr('2017-07-01', before, hsn, N1), fr('2025-09-22', 5, hsn, SEP25 + note)];

/** Food class → rate / HSN by document date (append-only per class; §2.3a of the PRD). */
export const FOOD_CLASS_RULES: Readonly<Record<FoodClass, readonly MfRule<FoodClassRate>[]>> = {
  namkeen: cut('2106', 12),
  biscuits: cut('1905', 18, '; one "expected" table conflicts'),
  sauces: cut('2103', 12),
  pasta_noodles: cut('1902', 12),
  sweets: [fr('2017-07-01', 5, '2106', `${N1} (mithai 5%; no change reported)`)],
  chocolates: cut('1806', 18),
  spices_packed: [fr('2017-07-01', 5, '0910', `${N1} (no change reported)`)],
  pickles: cut('2001', 12),
  rte_food: cut('2106', 12),
};

/* ── D3: MSME Form-1 (MCA) ──────────────────────────────────────────────────────────────────────────────────────── */

export interface Form1Rule {
  /** Half-years as [from MM-DD, to MM-DD, due MM-DD of the following month-end]. */
  halves: readonly { from: string; to: string; due: string }[];
  /** Dues outstanding beyond this many days from acceptance are reported. */
  days: number;
  penaltyNote: string;
}

export const MSME_FORM1_RULES: readonly MfRule<Form1Rule>[] = [
  {
    from: '2019-01-22',
    value: {
      halves: [{ from: '04-01', to: '09-30', due: '10-31' }, { from: '10-01', to: '03-31', due: '04-30' }],
      days: 45,
      penaltyNote: 'Penalty section conflicting in the sources (Sec 405(4) vs Sec 450) — verify MF23.',
    },
    source: 'Specified Companies (Furnishing information about payment to MSE suppliers) Order 2019 — taxguru, cleartax, Tally help (MF23)',
    verified: false,
  },
];

/* ── D4: export authorisations and incentives ───────────────────────────────────────────────────────────────────── */

export interface AaRule {
  importValidMonths: number;
  eoMonths: number;
  /** Bell lead times before `eo_due`. */
  bellDays: readonly number[];
  shortfallNote: string;
}

export const AA_RULES: readonly MfRule<AaRule>[] = [
  {
    from: '2023-04-01',
    value: {
      importValidMonths: 12,
      eoMonths: 18,
      bellDays: [90, 30],
      shortfallNote: 'EO shortfall: duty saved on the unfulfilled share with interest, and a penalty (5 × CIF of the shortfall as read in the HBP copy) — verify MF16 with a DGFT consultant.',
    },
    source: 'DGFT HBP Ch. 4 (paras 4.22 / 4.41 as read in the 2026 copy); myscheme.gov.in — periods M (MF16)',
    verified: false,
  },
];

export interface EpcgRule {
  multiple: number;
  years: number;
  /** Block-wise obligation: by the end of year `year`, `pct` % of the EO. */
  blocks: readonly { year: number; pct: number }[];
}

export const EPCG_RULES: readonly MfRule<EpcgRule>[] = [
  { from: '2015-04-01', value: { multiple: 6, years: 6, blocks: [{ year: 4, pct: 50 }, { year: 6, pct: 100 }] }, source: 'FTP EPCG scheme as recalled, not re-read (MF17)', verified: false },
];

export interface IncentiveRule {
  /** Bell: a claim pending longer than this many days after it was claimed. */
  pendingDays: number;
}
export const INCENTIVE_RULES: readonly MfRule<IncentiveRule>[] = [{ from: '2017-04-01', value: { pendingDays: 180 }, source: 'Practice default (PRD MF-D4)', verified: false }];

/* ── D6: Schedule III inventory sub-heads ───────────────────────────────────────────────────────────────────────── */

export type InvClass = 'raw' | 'wip' | 'finished' | 'traded' | 'stores' | 'packing' | 'tools' | 'scrap';

/** Print order and label of each sub-head (Division I as recalled — MF25). */
export const INVENTORY_HEADS: readonly MfRule<readonly { cls: InvClass; label: string }[]>[] = [
  {
    from: '2011-04-01',
    value: [
      { cls: 'raw', label: 'Raw materials' },
      { cls: 'wip', label: 'Work-in-progress' },
      { cls: 'finished', label: 'Finished goods' },
      { cls: 'traded', label: 'Stock-in-trade (goods acquired for trading)' },
      { cls: 'stores', label: 'Stores and spares' },
      { cls: 'tools', label: 'Loose tools' },
      { cls: 'packing', label: 'Others — packing materials' },
      { cls: 'scrap', label: 'Others — scrap' },
    ],
    source: 'Companies Act 2013 Schedule III Division I (recalled — MF25)',
    verified: false,
  },
];
