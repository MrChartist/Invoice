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

/* ── MF-B: scrap and printing classes, scrap GST mechanics, material densities ("practice") ──────────────────── */

/** What a class suggests on a date: GST rate (%) — `null` = no suggestion (sources conflict; type the rate) — and HSN. */
export interface MfClassRate {
  rate: number | null;
  hsn: string;
}

export type ScrapClass = 'metal_ferrous' | 'metal_nonferrous' | 'paper_waste' | 'plastic_waste' | 'textile_waste' | 'other';

const SEP25 = 'GST rate rationalisation from 22 Sep 2025 (busy.in, carajput summaries; N 9/2025-CT(R) not read)';
const N1 = 'N 1/2017-CT(R) schedules — recalled';
const cr = (from: string, rate: number | null, hsn: string, source: string, verified = false): MfRule<MfClassRate> => ({ from, value: { rate, hsn }, source, verified });

/** B3: scrap classes by document date (append-only per class; PRD §2.3a). A typed rate always wins. */
export const SCRAP_CLASS_RULES: Readonly<Record<ScrapClass, readonly MfRule<MfClassRate>[]>> = {
  metal_ferrous: [cr('2017-07-01', 18, '7204', 'Ch 72 waste and scrap 18% (vjmglobal, taxroutine) — MF7', true)],
  metal_nonferrous: [cr('2017-07-01', 18, '7404', 'Ch 74–81 waste and scrap 18% (vjmglobal, taxroutine) — MF7', true)],
  paper_waste: [cr('2017-07-01', 12, '4707', N1), cr('2025-09-22', 5, '4707', `${SEP25} — MF8`)],
  plastic_waste: [cr('2017-07-01', null, '3915', 'Plastic waste 5% or 18% — sources conflict (busy.in vs carajput); type the rate — MF8')],
  textile_waste: [cr('2017-07-01', 5, '6310', 'Textile waste / rags 5% as reported (unverified) — MF8')],
  other: [cr('2017-07-01', null, '', 'No class: type the rate')],
};

export interface ScrapTaxRule {
  /** RCM on metal scrap bought from an unregistered supplier (Sec 9(3)). */
  rcm_unregistered: boolean;
  /** GST TDS u/s 51 deducted by a registered buyer of metal scrap: rate %, above this taxable value per contract / invoice. */
  gst_tds_pct: number;
  gst_tds_above: number;
  rcm_ref: string;
  tds_ref: string;
}

/** B3: metal-scrap GST mechanics (MF7). Nothing before 10 Oct 2024. */
export const SCRAP_TAX_RULES: readonly MfRule<ScrapTaxRule>[] = [
  { from: '2017-07-01', value: { rcm_unregistered: false, gst_tds_pct: 0, gst_tds_above: 0, rcm_ref: '', tds_ref: '' }, source: 'Before N 6/2024-CT(R) and N 25/2024-CT', verified: true },
  {
    from: '2024-10-10',
    value: { rcm_unregistered: true, gst_tds_pct: 2, gst_tds_above: 250000, rcm_ref: 'N 6/2024-CT(R)', tds_ref: 'Sec 51, N 25/2024-CT' },
    source: 'N 6/2024-CT(R) (RCM, metal scrap from unregistered); N 25/2024-CT (GST TDS 2% above ₹2.5 lakh — one source says 24/2024) — vjmglobal, taxscan (GSTN advisory) — MF7',
    verified: true,
  },
];

export type PrintClass = 'print_goods_own_paper' | 'print_job_ch48_49' | 'cartons_4819' | 'printing_paper_4802' | 'print_other';

/** B5: printing classes by document date (suggestions only; typed rate wins). */
export const PRINT_CLASS_RULES: Readonly<Record<PrintClass, readonly MfRule<MfClassRate>[]>> = {
  print_goods_own_paper: [cr('2017-07-01', null, '4911', 'Printed goods with the printer\'s own paper are goods at the printed product\'s rate (Circular 11/11/2017, recalled) — MF3')],
  print_job_ch48_49: [cr('2017-07-01', 12, '998912', N1), cr('2025-09-22', 5, '998912', 'N 15/2025-CT(R) entry 26 as cited by a Gujarat AAR; the AAR held it not applicable where the paper is 18% — MF3')],
  cartons_4819: [cr('2017-07-01', 12, '4819', N1), cr('2025-09-22', 5, '4819', `${SEP25}; printweek — MF4`)],
  printing_paper_4802: [cr('2017-07-01', 12, '4802', N1), cr('2025-09-22', 18, '4802', `${SEP25} (one source only) — MF4`)],
  print_other: [cr('2017-07-01', 18, '998912', 'Residual job work / other printing 18% — MF5')],
};

/** B2: material densities, g / cc ("practice" values — editable on the quote). */
export const DENSITY_DEFAULTS: readonly MfRule<Readonly<Record<string, number>>>[] = [
  { from: '2017-07-01', value: { MS: 7.85, SS: 7.93, Al: 2.7, Brass: 8.5, Copper: 8.96 }, source: 'Engineering handbooks (practice values)', verified: false },
];

/* ── MF-C: TEXTILE_CLASS_RULES, RULE_89_5_RULES ──────────────────────────────────────────────────────────────── */

/* ── MF-D: FOOD_CLASS_RULES, MSME_FORM1_RULES, AA_RULES, EPCG_RULES, INVENTORY_HEADS ──────────────────────────── */
