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
/** RT15: a used device's IMEI is checked on the central blocked-IMEI database before resale; the app keeps a log only. */
export const IMEI_CHECK_RULES: readonly RtRule<{ resaleCheckDays: number }>[] = [
  { from: '2025-10-22', value: { resaleCheckDays: 30 }, source: 'Telecommunications (Telecom Cyber Security) Amendment Rules 2025, GSR 771(E) of 22 Oct 2025 — as reported (conventuslaw, scconline), text not re-read; the 30-day window is the app\'s default', verified: false },
];
/** RT12: value of a second-hand sale = selling price − purchase price (negative ignored), only with no ITC on the purchase. */
export const MARGIN_SCHEME_RULES: readonly RtRule<{ rule: string }>[] = [
  { from: '2017-07-01', value: { rule: 'Rule 32(5), CGST Rules 2017' }, source: 'Rule 32(5) CGST Rules — from memory, not re-read; AAR Karnataka (Aadhya Gold, 2018) denied it where the goods changed nature', verified: false },
];
/** RT13: a part / unit replaced free under warranty is no supply: no GST, no ITC reversal. */
export const WARRANTY_REPLACEMENT_RULES: readonly RtRule<{ noSale: boolean }>[] = [
  { from: '2023-07-17', value: { noSale: true }, source: 'Circular 195/07/2023-GST (warranty replacements) — as understood, not re-read', verified: false },
];
/** What a repair job sheet covers (RT-D4). Round 10 SV-D (workshops) uses `vehicle`. */
export type RepairKind = 'phone' | 'computer' | 'appliance' | 'vehicle' | 'other';
/** RT13: maintenance and repair SAC per kind (group 9987) and the rate. 998714 is transport machinery (SV20). */
export const REPAIR_SERVICE_RULES: readonly RtRule<{ sac: Record<RepairKind, string>; rate: number }>[] = [
  { from: '2017-07-01', value: { sac: { phone: '998716', computer: '998713', appliance: '998715', vehicle: '998714', other: '998719' }, rate: 18 }, source: 'SAC 9987 maintenance and repair: 998716 telecom equipment, 998713 computers, 998715 household appliances, 998714 transport machinery, 998719 other — classification as recalled; 18% unverified', verified: false },
];
/** RT10: the financier's subvention / processing fee billed to the dealer (its own supply; ITC per its invoice). */
export const FINANCE_FEE_RULES: readonly RtRule<{ sac: string; rate: number }>[] = [
  { from: '2017-07-01', value: { sac: '997119', rate: 18 }, source: 'SAC 997119 (other financial services) at 18% — AAR Daimler FS on subvention as quoted (vinodkothari 2019), not re-read', verified: false },
];

/* ── RT-E: jewellery ── */
/** RT16: jewellery (HSN 7113 / 7114 / 7116) on the whole value incl. making; job work on the customer's metal (SAC 9988). */
export const JEWELLERY_GST_RULES: readonly RtRule<{ goodsRate: number; jobWorkRate: number; jobWorkSac: string }>[] = [
  { from: '2017-07-01', value: { goodsRate: 3, jobWorkRate: 5, jobWorkSac: '9988' }, source: 'N 1/2017-CT(R) Sch V ch. 71 (3%); CBIC gems & jewellery FAQ as quoted (making inside the 3% value); job work on the principal\'s metal 5% (N 11/2017-CT(R)) — sub-code not confirmed (RT16)', verified: false },
];
const BIS_LINE = 'Purity of hallmarked jewellery can be verified at any BIS-recognised A&H centre.';
/** RT19: HUID on gold jewellery (notified districts; a warning only) and the bill line of Reg. 5(11). */
export const HALLMARK_RULES: readonly RtRule<{ huidMandatory: boolean; verifyLine: string }>[] = [
  { from: '2021-06-16', value: { huidMandatory: false, verifyLine: BIS_LINE }, source: 'BIS Hallmarking Regulations 2018 Reg. 5(11) as cited; mandatory hallmarking from 16 Jun 2021 (RT19)', verified: false },
  { from: '2023-04-01', value: { huidMandatory: true, verifyLine: BIS_LINE }, source: 'BIS FAQ (bis.gov.in): 6-character HUID from 1 Apr 2023 in notified districts (RT19)', verified: false },
];
/** RT18: Sec 269ST — no cash receipt of this much or more from a person in a day / one transaction / one event. */
export const CASH_RECEIPT_LIMIT_RULES: readonly RtRule<number>[] = [
  { from: '2017-04-01', value: 200000, source: 'IT Act 1961 Sec 269ST (Finance Act 2017; penalty 271DA) — recalled; Income-tax Act 2025 section not confirmed (RT18)', verified: false },
];
/** RT18: Rule 114B — PAN or a Form 60 / 97 declaration on a sale of goods above this per transaction. */
export const PAN_SALE_LIMIT_RULES: readonly RtRule<number>[] = [
  { from: '2016-01-01', value: 200000, source: 'IT Rules 1962 Rule 114B (from 1 Jan 2016) as reported (iifl, taxmann); Form 97 under the 2026 Rules as reported (RT18)', verified: false },
];
/** RT18: PMLA — cash of this much or more from one customer in a day (dealers in precious metals). */
export const PMLA_CASH_RULES: readonly RtRule<number>[] = [
  { from: '2020-12-28', value: 1000000, source: 'PMLA notification of 28 Dec 2020 — recalled, not re-read (RT18)', verified: false },
];
/** RT14: Sec 40A(3) — cash paid to one person in a day above this is disallowed. */
export const CASH_PAYMENT_LIMIT_RULES: readonly RtRule<number>[] = [
  { from: '2017-04-01', value: 10000, source: 'IT Act 1961 Sec 40A(3) (Finance Act 2017) — recalled; 2025-Act section not confirmed (RT14)', verified: false },
];
/** RT22: HSN chapters needing no e-Way bill (Rule 138(14) annexure: precious metals / jewellery). */
export const EWAY_EXEMPT_CHAPTER_RULES: readonly RtRule<readonly string[]>[] = [
  { from: '2018-04-01', value: ['71'], source: 'CGST Rules Rule 138(14)(a) annexure, chapter 71 — recalled (RT22)', verified: false },
];
