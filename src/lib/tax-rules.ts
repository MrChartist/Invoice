/**
 * Statutory constants that change over time, keyed by the date they take effect.
 *
 * Each rule set lists versions oldest-first; `ruleAt` picks the last version whose
 * `from` date is on or before the document date, so historical documents keep the
 * value that applied when they were issued. Dates are bare `YYYY-MM-DD` strings and
 * compare lexically (never parsed through `new Date(str)`; see AGENTS.md rule 8).
 *
 * These are working-paper defaults — verify with your CA before relying on them.
 */

export interface Versioned<T> {
  /** First day (inclusive) this value applies, `YYYY-MM-DD`. */
  from: string;
  value: T;
  /** Short citation shown in tooltips/docs. */
  source?: string;
}

/** Today as a local `YYYY-MM-DD` day. */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The version in force on `date` (falls back to the oldest version). */
export function ruleAt<T>(versions: readonly Versioned<T>[], date?: string): T {
  const d = (date || todayIso()).slice(0, 10);
  let hit = versions[0];
  for (const v of versions) if (v.from <= d) hit = v;
  return hit.value;
}

// ── GSTR-1: B2C (large) threshold ────────────────────────────────────────────

export const B2CL_THRESHOLD_RULES: readonly Versioned<number>[] = [
  { from: '2017-07-01', value: 250000, source: 'GSTR-1 Table 5 (₹2.5 lakh)' },
  { from: '2024-08-01', value: 100000, source: 'Notification 12/2024-CT (₹1 lakh)' },
];

/** Invoice value above which an unregistered inter-state sale is reported as B2CL. */
export function b2clThreshold(date?: string): number {
  return ruleAt(B2CL_THRESHOLD_RULES, date);
}

/** "₹2.5 lakh" / "₹1 lakh" label for the threshold in force on `date`. */
export function b2clThresholdLabel(date?: string): string {
  const lakh = b2clThreshold(date) / 100000;
  return `₹${lakh} lakh`;
}

// ── TDS sections a customer may deduct ───────────────────────────────────────

export interface TdsSection { section: string; label: string; rate: number }

const TDS_BASE: TdsSection[] = [
  { section: '194C-1', label: '194C Contractor (individual/HUF) 1%', rate: 1 },
  { section: '194C-2', label: '194C Contractor (others) 2%', rate: 2 },
  { section: '194H', label: '194H Commission / brokerage 5%', rate: 5 },
  { section: '194I-A', label: '194I Rent (plant/machinery) 2%', rate: 2 },
  { section: '194I-B', label: '194I Rent (land/building) 10%', rate: 10 },
  { section: '194J-T', label: '194J Technical services 2%', rate: 2 },
  { section: '194J', label: '194J Professional fees 10%', rate: 10 },
  { section: '194Q', label: '194Q Purchase of goods 0.1%', rate: 0.1 },
  { section: 'CUSTOM', label: 'Custom rate', rate: 0 },
];

const withSection = (list: TdsSection[], section: string, patch: Partial<TdsSection>) =>
  list.map((s) => (s.section === section ? { ...s, ...patch } : s));

export const TDS_SECTION_RULES: readonly Versioned<TdsSection[]>[] = [
  { from: '2017-07-01', value: TDS_BASE },
  {
    from: '2024-10-01',
    value: withSection(TDS_BASE, '194H', { label: '194H Commission / brokerage 2%', rate: 2 }),
    source: 'Finance (No. 2) Act 2024',
  },
];

export function tdsSections(date?: string): TdsSection[] {
  return ruleAt(TDS_SECTION_RULES, date);
}

// ── TCS presets ──────────────────────────────────────────────────────────────

export interface TcsPreset { label: string; rate: number }

const TCS_1H: TcsPreset[] = [
  { label: '206C(1H) sale of goods 0.1%', rate: 0.1 },
  { label: '206C(1H) no PAN 1%', rate: 1 },
];
const TCS_1G: TcsPreset = { label: '206C(1G) overseas remittance 20%', rate: 20 };

export const TCS_PRESET_RULES: readonly Versioned<TcsPreset[]>[] = [
  { from: '2017-07-01', value: [...TCS_1H, TCS_1G] },
  // 206C(1H) withdrawn for sales from 1 Apr 2025 (Finance Act 2025).
  { from: '2025-04-01', value: [TCS_1G], source: 'Finance Act 2025' },
];

export function tcsPresets(date?: string): TcsPreset[] {
  return ruleAt(TCS_PRESET_RULES, date);
}

// ── GST rate slabs offered in pickers ────────────────────────────────────────

/** 0 doubles as exempt/nil-rated. 40% is the GST 2.0 demerit slab (from 22 Sep 2025). */
export const GST_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28, 40] as const;

// ── MSME: MSMED Act Sec 15/16 and Income-tax Sec 43B(h) ──────────────────────

/** Payment limits under MSMED Act Sec 15, in days from acceptance (the bill date is used). */
export const MSME_PAYMENT_DAYS = { agreed: 45, noAgreement: 15 } as const;

/** Sec 43B(h) covers sums due to micro and small enterprises from FY 2023-24 (Finance Act 2023). */
export const MSME_43BH_FROM = '2023-04-01';

/**
 * RBI Bank Rate (% p.a.). MSMED Act Sec 16 interest is three times this, compounded
 * monthly. Dated by RBI policy announcement — append new rates, never edit old ones.
 */
export const RBI_BANK_RATE_RULES: readonly Versioned<number>[] = [
  { from: '2022-12-07', value: 6.5, source: 'RBI policy, Dec 2022' },
  { from: '2023-02-08', value: 6.75, source: 'RBI policy, Feb 2023' },
  { from: '2025-02-07', value: 6.5, source: 'RBI policy, Feb 2025' },
  { from: '2025-04-09', value: 6.25, source: 'RBI policy, Apr 2025' },
  { from: '2025-06-06', value: 5.75, source: 'RBI policy, Jun 2025' },
];

export function rbiBankRate(date?: string): number {
  return ruleAt(RBI_BANK_RATE_RULES, date);
}

// ── HSN digits (invoices and GSTR-1 Table 12) ────────────────────────────────

/** Minimum HSN/SAC digits for a preceding-FY aggregate turnover up to `upTo` (₹, inclusive). */
export interface HsnDigitTier { upTo: number; digits: number }

export const HSN_DIGIT_RULES: readonly Versioned<HsnDigitTier[]>[] = [
  {
    from: '2017-07-01',
    value: [{ upTo: 1.5e7, digits: 0 }, { upTo: 5e7, digits: 2 }, { upTo: Infinity, digits: 4 }],
    source: 'Notification 12/2017-CT',
  },
  {
    // GSTR-1 HSN Phase-III applies the same minimum to the B2B and the B2C table.
    from: '2021-04-01',
    value: [{ upTo: 5e7, digits: 4 }, { upTo: Infinity, digits: 6 }],
    source: 'Notification 78/2020-CT (4 digits up to ₹5 crore, 6 above)',
  },
];

/** Minimum HSN/SAC digits on `date` for a preceding-FY aggregate turnover of `turnover` (₹). */
export function hsnMinDigits(turnover: number, date?: string): number {
  const t = Number.isFinite(turnover) && turnover > 0 ? turnover : 0;
  const tiers = ruleAt(HSN_DIGIT_RULES, date);
  return (tiers.find((x) => t <= x.upTo) ?? tiers[tiers.length - 1]).digits;
}

/** GSTR-1 Table 12 is reported as separate B2B and B2C tables for return periods from this rule on. */
export const HSN_TABLE_SPLIT_RULES: readonly Versioned<boolean>[] = [
  { from: '2017-07-01', value: false },
  { from: '2025-01-01', value: true, source: 'GSTN advisory on HSN Phase-III (Table 12 B2B / B2C tabs)' },
];

export function hsnTableSplit(periodStart?: string): boolean {
  return ruleAt(HSN_TABLE_SPLIT_RULES, periodStart);
}

// ── Return due dates (keyed by the first day of the tax period) ──────────────

export interface ReturnDueDays {
  /** Day of the next month: GSTR-1 (monthly filer). */
  gstr1: number;
  /** Day of the month after the quarter: GSTR-1 (QRMP); 0 = QRMP not available yet. */
  gstr1Qrmp: number;
  /** IFF window closes on this day of the next month (months 1 and 2 of a QRMP quarter; optional). */
  iff: number;
  /** PMT-06 monthly tax deposit (months 1 and 2 of a QRMP quarter). */
  pmt06: number;
  /** Day of the next month: GSTR-3B (monthly filer). */
  gstr3b: number;
  /** Day of the month after the quarter: GSTR-3B (QRMP), state category X / Y. */
  gstr3bQrmpX: number;
  gstr3bQrmpY: number;
  /** GSTR-9 (annual): `MM-DD` in the calendar year the FY ends. */
  gstr9: string;
}

export const RETURN_DUE_RULES: readonly Versioned<ReturnDueDays>[] = [
  {
    from: '2017-07-01',
    value: { gstr1: 10, gstr1Qrmp: 0, iff: 0, pmt06: 0, gstr3b: 20, gstr3bQrmpX: 0, gstr3bQrmpY: 0, gstr9: '12-31' },
    source: 'Sec 37, 39, 44 CGST Act; Rule 61(5)',
  },
  {
    from: '2021-01-01',
    value: { gstr1: 11, gstr1Qrmp: 13, iff: 13, pmt06: 25, gstr3b: 20, gstr3bQrmpX: 22, gstr3bQrmpY: 24, gstr9: '12-31' },
    source: 'Rules 59, 61 and 61A as amended by Notification 82/2020-CT; Notifications 83/2020, 84/2020, 85/2020-CT (QRMP)',
  },
];

export function returnDueDays(periodStart?: string): ReturnDueDays {
  return ruleAt(RETURN_DUE_RULES, periodStart);
}

/**
 * QRMP GSTR-3B state categories by GST state code (Notification 85/2020-CT, proviso to Rule 61(5)).
 * Category X files by the 22nd, category Y by the 24th; an unknown state is treated as X (the earlier day).
 */
export const QRMP_3B_CATEGORY_X: readonly string[] = ['22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37'];
export const QRMP_3B_CATEGORY_Y: readonly string[] = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '38'];

/** QRMP is open to registrations with preceding-FY aggregate turnover up to this amount (₹). */
export const QRMP_TURNOVER_LIMIT = 5e7;

// ── Composition levy (Sec 10 CGST Act; Rule 7 CGST Rules) ────────────────────

/** Composition taxpayer kinds. Kept as a plain union here so this module stays type-only for `types/invoice`. */
export type CompositionKind = 'manufacturer' | 'trader' | 'restaurant' | 'service';

/**
 * Composition rate (% of turnover, CGST + SGST together; half each) by category, keyed by the first day
 * it applies. `null` = the option did not exist yet. Working-paper values — verify with your CA:
 *  - 1 Jul 2017 (Rule 7 as notified): manufacturers 2%, traders 1%, restaurants 5%.
 *  - 1 Jan 2018 (Notification 3/2018-CT amending Rule 7): manufacturers 1%; traders 1% of the
 *    turnover of TAXABLE supplies only (exempt goods left out of the base); restaurants 5%.
 *  - 1 Apr 2019 (Notification 2/2019-CT(R), Sec 10(2A) after the CGST (Amendment) Act 2018): service
 *    providers / mixed suppliers 6% (3% + 3%).
 */
export const COMPOSITION_RATE_RULES: readonly Versioned<Record<CompositionKind, number | null>>[] = [
  { from: '2017-07-01', value: { manufacturer: 2, trader: 1, restaurant: 5, service: null }, source: 'Rule 7 CGST Rules (as notified)' },
  { from: '2018-01-01', value: { manufacturer: 1, trader: 1, restaurant: 5, service: null }, source: 'Rule 7 as amended by Notification 3/2018-CT' },
  { from: '2019-04-01', value: { manufacturer: 1, trader: 1, restaurant: 5, service: 6 }, source: 'Notification 2/2019-CT(R) (Sec 10(2A), 3% + 3%)' },
];

/** Composition rate (%) for `kind` on `date`; null when that option did not exist on that day. */
export function compositionRate(kind: CompositionKind | undefined, date?: string): number | null {
  return ruleAt(COMPOSITION_RATE_RULES, date)[kind ?? 'trader'] ?? null;
}

/** From this rule on a composition TRADER pays only on taxable supplies (exempt goods are left out of the base). */
export const COMPOSITION_TRADER_TAXABLE_ONLY_FROM = '2018-01-01';

/**
 * Turnover limits for the composition option (preceding-FY aggregate turnover, ₹). Shown as guidance only:
 * the app does not track eligibility. Special-category states have the lower goods limit.
 */
export const COMPOSITION_LIMIT_RULES: readonly Versioned<{ goods: number; goodsSpecial: number; services: number | null }>[] = [
  { from: '2017-07-01', value: { goods: 7.5e6, goodsSpecial: 5e6, services: null }, source: 'Sec 10(1) as enacted' },
  { from: '2017-10-13', value: { goods: 1e7, goodsSpecial: 7.5e6, services: null }, source: 'Notification 46/2017-CT' },
  { from: '2019-04-01', value: { goods: 1.5e7, goodsSpecial: 7.5e6, services: 5e6 }, source: 'Notification 14/2019-CT; Notification 2/2019-CT(R)' },
];

export function compositionLimits(date?: string) {
  return ruleAt(COMPOSITION_LIMIT_RULES, date);
}

/**
 * Composition return due dates. CMP-08 (quarterly statement-cum-challan): this day of the month after the
 * quarter (Rule 62(1)(i)). GSTR-4 (annual from FY 2019-20): `MM-DD` in the calendar year the FY ends in —
 * 30 April under Rule 62(1)(ii); 30 June from FY 2024-25 (Notification 12/2024-CT). Keyed by the first day of
 * the period. Ad-hoc extensions are not tracked — verify with your CA.
 */
export const COMPOSITION_DUE_RULES: readonly Versioned<{ cmp08: number; gstr4: string }>[] = [
  { from: '2019-04-01', value: { cmp08: 18, gstr4: '04-30' }, source: 'Rule 62 as amended by Notification 20/2019-CT' },
  { from: '2024-04-01', value: { cmp08: 18, gstr4: '06-30' }, source: 'Notification 12/2024-CT (GSTR-4 by 30 June)' },
];

export function compositionDueDays(periodStart?: string) {
  return ruleAt(COMPOSITION_DUE_RULES, periodStart);
}

// Interest / late-fee rates and caps are date-keyed in `gst-penalties.ts` (loaded only by the GST page).

// ── Income-tax Act depreciation (Sec 32, Rule 5 / New Appendix I): WDV block rates ──

/** Blocks of assets the fixed-asset register offers. Rates are % of written-down value. */
export type DepreciationBlock =
  | 'BUILDING_RESIDENTIAL'
  | 'BUILDING_OTHER'
  | 'BUILDING_TEMPORARY'
  | 'FURNITURE'
  | 'PLANT_MACHINERY'
  | 'MOTOR_CAR'
  | 'MOTOR_VEHICLE_HIRE'
  | 'COMPUTER'
  | 'BOOKS_PROFESSIONAL'
  | 'INTANGIBLE'
  | 'ENERGY_SAVING';

export const DEPRECIATION_BLOCK_LABELS: Record<DepreciationBlock, string> = {
  BUILDING_RESIDENTIAL: 'Building — mainly residential',
  BUILDING_OTHER: 'Building — office, factory, shop',
  BUILDING_TEMPORARY: 'Building — temporary structure',
  FURNITURE: 'Furniture & fittings',
  PLANT_MACHINERY: 'Plant & machinery (general)',
  MOTOR_CAR: 'Motor car (not for hire)',
  MOTOR_VEHICLE_HIRE: 'Motor vehicle used in a hire business',
  COMPUTER: 'Computers & software',
  BOOKS_PROFESSIONAL: 'Books (profession)',
  INTANGIBLE: 'Intangibles (patents, licences, trademarks; not goodwill)',
  ENERGY_SAVING: 'Energy-saving / pollution-control devices',
};

/**
 * WDV rates (%) by block, keyed by the first day of the FY they apply to. From FY 2017-18 the
 * highest rate is 40% (Rule 5 as amended). Goodwill is not depreciable from FY 2020-21 (Finance
 * Act 2021), so it has no block here. Working-paper values — verify with your CA.
 */
export const DEPRECIATION_RATE_RULES: readonly Versioned<Record<DepreciationBlock, number>>[] = [
  {
    from: '2003-04-01',
    value: {
      BUILDING_RESIDENTIAL: 5, BUILDING_OTHER: 10, BUILDING_TEMPORARY: 100, FURNITURE: 10, PLANT_MACHINERY: 15,
      MOTOR_CAR: 15, MOTOR_VEHICLE_HIRE: 30, COMPUTER: 60, BOOKS_PROFESSIONAL: 60, INTANGIBLE: 25, ENERGY_SAVING: 80,
    },
    source: 'IT Rules, New Appendix I (AY 2004-05 onwards)',
  },
  {
    from: '2017-04-01',
    value: {
      BUILDING_RESIDENTIAL: 5, BUILDING_OTHER: 10, BUILDING_TEMPORARY: 40, FURNITURE: 10, PLANT_MACHINERY: 15,
      MOTOR_CAR: 15, MOTOR_VEHICLE_HIRE: 30, COMPUTER: 40, BOOKS_PROFESSIONAL: 40, INTANGIBLE: 25, ENERGY_SAVING: 40,
    },
    source: 'IT Rules, New Appendix I as amended (40% cap from AY 2018-19)',
  },
];

/** An asset put to use for fewer than this many days in the FY gets half the rate that year (Sec 32(1), 2nd proviso). */
export const DEPRECIATION_HALF_RATE_DAYS = 180;

/** WDV rate (%) for a block in the FY that contains `date`. */
export function depreciationRate(block: DepreciationBlock, date?: string): number {
  return ruleAt(DEPRECIATION_RATE_RULES, date)[block] ?? 0;
}
