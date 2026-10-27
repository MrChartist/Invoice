/**
 * Retail statutory values (Round 9), keyed by the date they take effect — the same `Versioned` / `ruleAt` shape as
 * `tax-rules.ts`: add a new dated row, never edit an old one. Imported only by lazy screens and engines — never by
 * `tax-rules.ts`, `shop-mode.ts` or the shell (`tests/rt-rules.test.ts` checks the import graph).
 *
 * One section per package (§6 of docs/prd/round-9.md): RT-A committed the headers and types; each package fills its
 * own section. Every row carries a `source` and `verified` (false where the text was not seen). Working papers —
 * verify with your CA (docs/CA_REVIEW.md RT1–RT22).
 */
import type { Versioned } from './tax-rules';

/** A dated retail rule row: `source` (inherited) plus whether the value was confirmed from an official text. */
export type RtRule<T> = Versioned<T> & { verified: boolean };

/* ── RT-A: retail profile and shared pieces ──────────────────────────────────────────────────────────────────────
 * No statutory rows. The GST-cut MRP formula (effective MRP = MRP × (100 + new rate) ÷ (100 + old rate), only when the
 * rate fell; never raised) lives in `retail/rt-mrp.ts` (RT4). The Legal Metrology "no sale above MRP" rule is a guard
 * setting, not a dated value. */

/* ── RT-B: pharmacy ── */
/** Years a register / prescription must be kept (RT7). */
export interface PharmaRetention { h1Years: number; xPrescriptionYears: number; cashMemoYears: number }
export const PHARMA_RETENTION_RULES: readonly RtRule<PharmaRetention>[] = [
  // Schedule H1 (GSR 588(E), 30 Aug 2013, in force 1 Mar 2014): separate H1 register kept 3 years (Rule 65(3));
  // Schedule X: duplicate prescription kept 2 years (Rule 65(9)(a)); sale records / cash memos 3 years (Rule 65).
  // Read in secondary sources only (okcredit guide, Nagaland district order, Wikipedia "Schedule X") — RT7.
  { from: '2014-03-01', value: { h1Years: 3, xPrescriptionYears: 2, cashMemoYears: 3 }, source: 'Drugs & Cosmetics Rules 1945, Rule 65(3) / 65(9)(a) as cited by secondary sources (RT7)', verified: false },
];

/* ── RT-C: apparel, footwear, textiles ── */
export type PriceBandKind = 'apparel' | 'footwear' | 'made_ups';
/** One band table: value per piece ≤ `upTo` → `rate`, else `above` (RT1, RT2). */
export interface PriceBand { upTo: number; rate: number; above: number }
/** The comparison is ≤ (exactly ₹2,500 per piece → the lower rate), on the taxable value per piece / pair (RT1, RT2). */
const APPAREL_BANDS: readonly RtRule<PriceBand>[] = [
  { from: '2017-07-01', value: { upTo: 1000, rate: 5, above: 12 }, source: 'N 1/2017-CT(R) Sch I / II, chapters 61 / 62 / 63 (sale value ≤ ₹1,000 per piece) — from memory', verified: false },
  { from: '2025-09-22', value: { upTo: 2500, rate: 5, above: 18 }, source: 'N 9/2025-CT(R) (56th GST Council): ≤ ₹2,500 per piece 5%, above 18% — as reported (accountune), notification not re-read', verified: false },
];
export const PRICE_BAND_RULES: Readonly<Record<PriceBandKind, readonly RtRule<PriceBand>[]>> = {
  apparel: APPAREL_BANDS,
  footwear: [
    { from: '2017-07-01', value: { upTo: 500, rate: 5, above: 18 }, source: 'N 1/2017-CT(R), chapter 64 (≤ ₹500 per pair) — from memory', verified: false },
    { from: '2018-07-27', value: { upTo: 1000, rate: 5, above: 18 }, source: 'N 18/2018-CT(R) (≤ ₹1,000 per pair) — from memory, low confidence', verified: false },
    { from: '2025-09-22', value: { upTo: 2500, rate: 5, above: 18 }, source: 'N 9/2025-CT(R): ≤ ₹2,500 per pair 5%, above 18% — as reported (bata.com, leatherindia), notification not re-read', verified: false },
  ],
  // Made-ups (chapter 63) follow the apparel bands (RT1, unverified).
  made_ups: APPAREL_BANDS.map((r) => ({ ...r, source: `${r.source}; made-ups as apparel (assumed)` })),
};
export interface AlterationRule { sac: string; rate: number }
export const ALTERATION_RULES: readonly RtRule<AlterationRule>[] = [
  { from: '2017-07-01', value: { sac: '998821', rate: 5 }, source: 'Tailoring service SAC 998821 at 5% — developers\' reading (RT3), not confirmed', verified: false },
];

/* ── RT-D: electronics and mobiles ── */
export const IMEI_CHECK_RULES: readonly RtRule<{ resaleCheckDays: number }>[] = [];
export const MARGIN_SCHEME_RULES: readonly RtRule<{ rule: string }>[] = [];
export const WARRANTY_REPLACEMENT_RULES: readonly RtRule<{ noSale: boolean }>[] = [];

/* ── RT-E: jewellery ── */
export const JEWELLERY_GST_RULES: readonly RtRule<{ goodsRate: number; jobWorkRate: number; jobWorkSac: string }>[] = [];
export const HALLMARK_RULES: readonly RtRule<{ huidMandatory: boolean; verifyLine: string }>[] = [];
export const CASH_RECEIPT_LIMIT_RULES: readonly RtRule<number>[] = [];
export const PAN_SALE_LIMIT_RULES: readonly RtRule<number>[] = [];
export const PMLA_CASH_RULES: readonly RtRule<number>[] = [];
export const CASH_PAYMENT_LIMIT_RULES: readonly RtRule<number>[] = [];
export const EWAY_EXEMPT_CHAPTER_RULES: readonly RtRule<readonly string[]>[] = [];
