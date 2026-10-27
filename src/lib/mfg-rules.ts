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

/** A textile tax class: a flat rate, or the R9 price band (`band`) decided per piece on sale lines. */
export interface TextileClass {
  rate?: number;
  band?: 'apparel' | 'made_ups';
  hsn: string;
  ca: string;
}
export type TextileClassId = 'mmf_fibre' | 'mmf_yarn' | 'cotton_yarn' | 'fabric' | 'garment' | 'made_up' | 'textile_waste' | 'jw_textile' | 'jw_print_ch48_49' | 'jw_other';
const AS_REPORTED = 'N 9/2025-CT(R) (22 Sep 2025) as reported (PIB 17 Sep 2025, MATEXIL) — notification not re-read';
export const TEXTILE_CLASS_RULES: Readonly<Record<TextileClassId, readonly MfRule<TextileClass>[]>> = {
  mmf_fibre: [
    { from: '2017-07-01', value: { rate: 18, hsn: '5501-5507', ca: 'MF1' }, source: 'Before 22 Sep 2025 (PRD §2.3a)', verified: false },
    { from: '2025-09-22', value: { rate: 5, hsn: '5501-5507', ca: 'MF1' }, source: AS_REPORTED, verified: false },
  ],
  mmf_yarn: [
    { from: '2017-07-01', value: { rate: 12, hsn: '5401-5406, 5508-5511', ca: 'MF1' }, source: 'Before 22 Sep 2025 (PRD §2.3a); earlier history not modelled', verified: false },
    { from: '2025-09-22', value: { rate: 5, hsn: '5401-5406, 5508-5511', ca: 'MF1' }, source: AS_REPORTED, verified: false },
  ],
  cotton_yarn: [{ from: '2017-07-01', value: { rate: 5, hsn: '5205-5207', ca: 'MF1' }, source: 'No change reported on 22 Sep 2025 (recalled)', verified: false }],
  fabric: [{ from: '2017-07-01', value: { rate: 5, hsn: '50-60 (fabric)', ca: 'MF1' }, source: 'Cotton / MMF fabric 5%, no change reported (recalled)', verified: false }],
  garment: [{ from: '2017-07-01', value: { band: 'apparel', hsn: '61, 62', ca: 'MF1' }, source: 'R9 PRICE_BAND_RULES (retail-rules.ts): ≤ ₹2,500 a piece 5%, above 18% from 22 Sep 2025', verified: false }],
  made_up: [{ from: '2017-07-01', value: { band: 'made_ups', hsn: '63', ca: 'MF1' }, source: 'R9 PRICE_BAND_RULES made-ups (as apparel, assumed)', verified: false }],
  textile_waste: [{ from: '2017-07-01', value: { rate: 5, hsn: '5202, 5505', ca: 'MF8' }, source: 'Textile waste 5% as reported (unverified)', verified: false }],
  jw_textile: [{ from: '2017-10-13', value: { rate: 5, hsn: '9988', ca: 'MF2' }, source: 'N 11/2017-CT(R) entry 26 as amended Oct 2017 (ch 50-63) — as reported (fibre2fashion, CITI 2017)', verified: false }],
  jw_print_ch48_49: [
    { from: '2017-07-01', value: { rate: 12, hsn: '9988', ca: 'MF3' }, source: 'Printing job work on ch 48 / 49 goods before 22 Sep 2025 (as reported)', verified: false },
    { from: '2025-09-22', value: { rate: 5, hsn: '9988', ca: 'MF3' }, source: 'N 15/2025-CT(R) entry 26 as cited by a Gujarat AAR; not where the paper is 18% (AAR) — verify', verified: false },
  ],
  jw_other: [{ from: '2017-07-01', value: { rate: 18, hsn: '9988', ca: 'MF5' }, source: 'Residual job work: 12% / 18% before 22 Sep 2025 (sources conflict), 18% after (busy.in SAC, Maharashtra AAR)', verified: false }],
};

/** Rule 89(5) inverted-duty refund. `ratioOnTax`: the tax payable on the inverted supply is scaled by net ITC ÷ ITC availed. */
export interface Rule895 {
  ratioOnTax: boolean;
  /** ITC on input services counted in "net ITC". */
  inputServices: boolean;
  ca: string;
}
export const RULE_89_5_RULES: readonly MfRule<Rule895>[] = [
  { from: '2017-07-01', value: { ratioOnTax: false, inputServices: false, ca: 'MF26' }, source: 'Rule 89(5) as notified (N 26/2018-CT amended "net ITC" to inputs only) — recalled; VKC Footsteps (SC, 2021) upheld excluding input services', verified: false },
  { from: '2022-07-05', value: { ratioOnTax: true, inputServices: false, ca: 'MF26' }, source: 'N 14/2022-CT (5 Jul 2022): tax payable on inverted supply × (net ITC ÷ ITC availed on inputs and input services) — recalled', verified: false },
];

/* ── MF-D: FOOD_CLASS_RULES, MSME_FORM1_RULES, AA_RULES, EPCG_RULES, INVENTORY_HEADS ──────────────────────────── */
