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
  /** `false` when the row was not read in a primary text (verify with your CA). */
  verified?: boolean;
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
const withoutSection = (list: TdsSection[], section: string) => list.filter((s) => s.section !== section);
const patchAll = (list: TdsSection[], patches: Record<string, Partial<TdsSection>>) =>
  list.map((s) => (patches[s.section] ? { ...s, ...patches[s.section] } : s));

/**
 * History (verify with your CA):
 *  - 1 Jul 2017: 194J had one 10% rate for professional AND technical fees; 194Q did not exist.
 *  - 1 Apr 2020: 194J technical services 2% (Finance Act 2020).
 *  - 14 May 2020 – 31 Mar 2021: rates for non-salaried payments cut by 25% (Govt press release of
 *    13 May 2020; Taxation and Other Laws (Relaxation and Amendment of Certain Provisions) Act 2020).
 *  - 1 Jul 2021: 194Q purchase of goods 0.1% (Finance Act 2021).
 *  - 1 Oct 2024: 194H 2% (Finance (No. 2) Act 2024).
 */
const TDS_2017 = withoutSection(withSection(TDS_BASE, '194J-T', { label: '194J Technical services 10%', rate: 10 }), '194Q');
const TDS_2020 = withoutSection(TDS_BASE, '194Q');
const TDS_COVID = patchAll(TDS_2020, {
  '194C-1': { label: '194C Contractor (individual/HUF) 0.75%', rate: 0.75 },
  '194C-2': { label: '194C Contractor (others) 1.5%', rate: 1.5 },
  '194H': { label: '194H Commission / brokerage 3.75%', rate: 3.75 },
  '194I-A': { label: '194I Rent (plant/machinery) 1.5%', rate: 1.5 },
  '194I-B': { label: '194I Rent (land/building) 7.5%', rate: 7.5 },
  '194J-T': { label: '194J Technical services 1.5%', rate: 1.5 },
  '194J': { label: '194J Professional fees 7.5%', rate: 7.5 },
});

export const TDS_SECTION_RULES: readonly Versioned<TdsSection[]>[] = [
  { from: '2017-07-01', value: TDS_2017, source: 'Income-tax Act as in force (194J 10%; no 194Q yet)' },
  { from: '2020-04-01', value: TDS_2020, source: 'Finance Act 2020 (194J technical services 2%)' },
  { from: '2020-05-14', value: TDS_COVID, source: 'Press release 13 May 2020: rates cut by 25% to 31 Mar 2021' },
  { from: '2021-04-01', value: TDS_2020, source: 'Reduced rates ended 31 Mar 2021' },
  { from: '2021-07-01', value: TDS_BASE, source: 'Finance Act 2021 (194Q from 1 Jul 2021)' },
  {
    from: '2024-10-01',
    value: withSection(TDS_BASE, '194H', { label: '194H Commission / brokerage 2%', rate: 2 }),
    source: 'Finance (No. 2) Act 2024',
  },
];

export function tdsSections(date?: string): TdsSection[] {
  const base = ruleAt(TDS_SECTION_RULES, date);
  // 7O: sections inserted by later Finance Acts (194-O / 194R / 194S), each with its own dated history.
  const extra = TDS_EXTRA_SECTION_RULES.map((x) => ruleAt(x.versions, date)).filter((v): v is TdsSection => !!v);
  if (!extra.length) return base;
  const i = base.findIndex((x) => x.section === 'CUSTOM');
  return i < 0 ? [...base, ...extra] : [...base.slice(0, i), ...extra, ...base.slice(i)];
}

// ── TCS presets ──────────────────────────────────────────────────────────────

export interface TcsPreset { label: string; rate: number }

const TCS_1H: TcsPreset[] = [
  { label: '206C(1H) sale of goods 0.1%', rate: 0.1 },
  { label: '206C(1H) no PAN 1%', rate: 1 },
];
const TCS_1H_COVID: TcsPreset[] = [
  { label: '206C(1H) sale of goods 0.075%', rate: 0.075 },
  { label: '206C(1H) no PAN 1%', rate: 1 },
];
const TCS_1G: TcsPreset = { label: '206C(1G) overseas remittance 20%', rate: 20 };
const TCS_1G_2020: TcsPreset = { label: '206C(1G) overseas remittance 5%', rate: 5 };
// 23d: Finance Act 2026 (Sec 394(1) Table Sl. No. 7.D(a) / Sl. No. 8). LRS other purposes stays 20 %.
const TCS_1G_EDU: TcsPreset = { label: '206C(1G) LRS education / medical 2%', rate: 2 }; // above ₹10 lakh a year
const TCS_TOUR_2026: TcsPreset = { label: '206C(1G) overseas tour package 2%', rate: 2 };

/**
 * 206C(1H) and 206C(1G) both start on 1 Oct 2020 (Finance Act 2020) — before that neither applies (no
 * preset). 1H was 0.075% until 31 Mar 2021 (the 25% relief), 0.1% after, and is withdrawn for sales
 * from 1 Apr 2025. 1G (LRS remittances above the threshold) went from 5% to 20% on 1 Oct 2023.
 * Verify with your CA.
 */
export const TCS_PRESET_RULES: readonly Versioned<TcsPreset[]>[] = [
  { from: '2017-07-01', value: [], source: '206C(1H) / (1G) not yet in force' },
  { from: '2020-10-01', value: [...TCS_1H_COVID, TCS_1G_2020], source: 'Finance Act 2020; 25% relief to 31 Mar 2021' },
  { from: '2021-04-01', value: [...TCS_1H, TCS_1G_2020], source: 'Finance Act 2020' },
  { from: '2023-10-01', value: [...TCS_1H, TCS_1G], source: 'Finance Act 2023 (206C(1G) 20%)' },
  // 206C(1H) withdrawn for sales from 1 Apr 2025 (Finance Act 2025).
  { from: '2025-04-01', value: [TCS_1G], source: 'Finance Act 2025' },
  // 23d: Finance Act 2026 — LRS education / medical 2 % above ₹10 lakh, overseas tour package 2 % flat. In force from
  // 1 Apr 2026 as reported by an AD bank's LRS notice and the Protean Form 143 file format v1.2 (collection codes 1086 /
  // 1088–1089); the enacted Finance Act 2026 text was not read — verify with your CA. (No `source` string: first paint.)
  { from: '2026-04-01', value: [TCS_1G, TCS_1G_EDU, TCS_TOUR_2026], verified: false },
];

export function tcsPresets(date?: string): TcsPreset[] {
  return ruleAt(TCS_PRESET_RULES, date);
}

// ── GST rate slabs offered in pickers ────────────────────────────────────────

/** Every slab any version below has carried (0 doubles as exempt/nil-rated). For lookups, not for pickers. */
export const GST_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28, 40] as const;

/**
 * Rates (%) a document line may carry on a date. Before 22 Sep 2025: the 2017 schedules (0, 0.1, 0.25, 1, 1.5, 3, 5,
 * 6, 12, 18, 28). From 22 Sep 2025 (GST rate rationalisation, 56th GST Council; Notification 9/2025-CT(R) as
 * understood): 5 / 18 / 40 replace 12 and 28 — 28% stays only for tobacco / pan masala until compensation cess ends.
 * The special rates (0.1, 0.25, 1, 1.5, 3, 6) are kept. A rate outside the list is an exception to REVIEW, not an
 * error (gst-guards). Append a version when the schedule changes; never edit an old one. Verify with your CA.
 */
export const GST_SLAB_RULES: readonly Versioned<readonly number[]>[] = [
  { from: '2017-07-01', value: [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28], source: 'Notifications 1/2017-CT(R), 11/2017-CT(R) and later amendments' },
  { from: '2025-09-22', value: [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 18, 28, 40], source: 'GST rate rationalisation from 22 Sep 2025 (28% only for tobacco / pan masala) — verify' },
];

export const slabsAt = (date?: string): readonly number[] => ruleAt(GST_SLAB_RULES, date);
export const rateInSlabs = (rate: number, date?: string): boolean => slabsAt(date).some((s) => Math.abs(s - rate) < 1e-9);

/**
 * GST rates a picker offers for a document dated `date` (today when absent): the slabs in force that day (QA-3 F9).
 * A `current` rate that is no longer in the table (12% on an old bill being edited) is kept, so the picker still shows
 * what the document holds instead of silently changing it.
 */
export function gstRateOptions(date?: string, current?: number | null): number[] {
  const list = [...slabsAt(date)];
  const c = Number(current);
  if (current !== undefined && current !== null && Number.isFinite(c) && !list.some((s) => Math.abs(s - c) < 1e-9)) list.push(c);
  return list.sort((a, b) => a - b);
}

// ── GST on advances received (time of supply, CGST Act Sec 12 / 13) ───────────

/**
 * Is GST payable when an advance is received for GOODS? Services always pay tax on the advance
 * (Sec 13(2): time of supply is the earlier of invoice and receipt). For goods, Notification
 * 66/2017-CT (15 Nov 2017) moved the time of supply to the invoice for everyone except composition
 * dealers, so no GST is due on a goods advance from that day (Notification 40/2017-CT had done it
 * for turnover up to ₹1.5 crore from 13 Oct 2017; not modelled). Verify with your CA.
 */
export const ADVANCE_GST_ON_GOODS_RULES: readonly Versioned<boolean>[] = [
  { from: '2017-07-01', value: true, source: 'CGST Act Sec 12(2) as enacted' },
  { from: '2017-11-15', value: false, source: 'Notification 66/2017-CT (no GST on advances for goods)' },
];

export const ADVANCE_GST_ON_SERVICES_RULES: readonly Versioned<boolean>[] = [
  { from: '2017-07-01', value: true, source: 'CGST Act Sec 13(2): earlier of invoice and receipt of payment' },
];

/** True when GST is payable on an advance for `supply` received on `date`. */
export function advanceTaxable(supply: 'goods' | 'services', date?: string): boolean {
  return ruleAt(supply === 'goods' ? ADVANCE_GST_ON_GOODS_RULES : ADVANCE_GST_ON_SERVICES_RULES, date);
}

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
  { from: '2025-12-05', value: 5.5, source: 'RBI notification 5 Dec 2025 (repo 5.25%, MSF/Bank Rate 5.50%)' },
  // Later changes: add from the RBI notification itself (a reported Oct 2026 hike is not yet verified here).
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

// ── E-commerce operators (Sec 52 TCS / Sec 9(5)) ─────────────────────────────

/**
 * TCS an e-commerce operator collects under Sec 52 on the net value of taxable supplies made through it, % in
 * total (IGST, or half CGST + half SGST). 1% from 1 Oct 2018 (Notification 52/2018-CT; Notifications 1/2018-IT and
 * 2/2018-CT(R)); 0.5% from 10 Jul 2024 (Finance Act 2024 / Notification 15/2024-CT — verify the citation with your CA).
 * Used only to ESTIMATE the TCS credit a supplier should see from GSTR-8 (GSTR-4 Table 7, the e-commerce tab).
 */
export const ECO_TCS_RATE_RULES: readonly Versioned<number>[] = [
  { from: '2017-07-01', value: 0, source: 'Sec 52 not in force yet' },
  { from: '2018-10-01', value: 1, source: 'Sec 52; Notification 52/2018-CT' },
  { from: '2024-07-10', value: 0.5, source: 'Notification 15/2024-CT (0.25% + 0.25% / 0.5% IGST) — verify' },
];

export function ecoTcsRate(date?: string): number {
  return ruleAt(ECO_TCS_RATE_RULES, date);
}

/**
 * Where supplies made through an e-commerce operator are reported, by the first day of the return period /
 * FY. Working-paper dates, VERIFY WITH YOUR CA (portal availability lagged the notifications):
 *  - `gstr3b311`: GSTR-3B Table 3.1.1 (supplies notified u/s 9(5)) — Notification 14/2022-CT (5 Jul 2022).
 *  - `gstr1Table14`: GSTR-1 Table 14 (supplies through ECOs: (a) TCS u/s 52, (b) tax paid by the ECO u/s 9(5))
 *    and Table 15 — Notification 26/2022-CT (26 Dec 2022). Before that the ECO GSTIN was only a column of
 *    B2B / B2CL / B2CS (B2CS type "E").
 *  - `gstr9Row5C1`: GSTR-9 row 5C1 (supplies on which the ECO pays tax u/s 9(5)) — FY 2024-25 onwards
 *    (Notification 12/2024-CT).
 * The app reports Table 14 / 3.1.1 / 5C1 whenever there is data and raises an info note for earlier periods.
 */
export const ECO_REPORTING_RULES: readonly Versioned<{ gstr3b311: boolean; gstr1Table14: boolean; gstr9Row5C1: boolean }>[] = [
  { from: '2017-07-01', value: { gstr3b311: false, gstr1Table14: false, gstr9Row5C1: false } },
  { from: '2022-07-05', value: { gstr3b311: true, gstr1Table14: false, gstr9Row5C1: false }, source: 'Notification 14/2022-CT (GSTR-3B 3.1.1)' },
  { from: '2022-12-26', value: { gstr3b311: true, gstr1Table14: true, gstr9Row5C1: false }, source: 'Notification 26/2022-CT (GSTR-1 Tables 14 / 15)' },
  { from: '2024-04-01', value: { gstr3b311: true, gstr1Table14: true, gstr9Row5C1: true }, source: 'Notification 12/2024-CT (GSTR-9 5C1, FY 2024-25 on)' },
];

export function ecoReporting(periodStart?: string) {
  return ruleAt(ECO_REPORTING_RULES, periodStart);
}

/**
 * A composition dealer could not supply GOODS through an ECO that collects TCS (Sec 10(2)(d)) until the
 * Finance Act 2023 amendment, in force from 1 Oct 2023 (Notification 28/2023-CT; intra-state only, Notification
 * 36/2023-CT). SERVICES through such an ECO stay barred (Sec 10(2)(d) / 10(2A)(c) as amended). Warning only — verify
 * with your CA.
 */
export const COMPOSITION_ECO_GOODS_FROM = '2023-10-01';

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

// ── GST liability set-off order (WP-6, P0-6) ────────────────────────────────

/**
 * Order in which input tax credit discharges output tax (GSTR-3B Table 6.1 / the set-off journal).
 * Keyed by the first day of the TAX PERIOD. CGST credit never pays SGST and SGST credit never pays CGST
 * (Sec 49(5)(c)/(d)); compensation cess credit pays cess only (Sec 11(2) GST (Compensation to States) Act).
 */
export interface GstSetOffOrder {
  /**
   * IGST credit must be used up in full before any CGST / SGST credit is touched (Sec 49A, from 1 Feb 2019).
   * false = the original Sec 49(5) practice: each head's own credit first, IGST credit after.
   */
  igstFirst: boolean;
  /**
   * What is left of IGST credit after IGST: `cgst_then_sgst` = towards CGST, then SGST (Sec 49(5)(a) "in that
   * order"); `any` = towards CGST and SGST in any order (Rule 88A) — the app then picks the split that leaves
   * the least cash to pay.
   */
  igstRemainder: 'cgst_then_sgst' | 'any';
}

export const GST_SETOFF_RULES: readonly Versioned<GstSetOffOrder>[] = [
  { from: '2017-07-01', value: { igstFirst: false, igstRemainder: 'cgst_then_sgst' }, source: 'Sec 49(5) CGST Act as enacted — verify' },
  {
    from: '2019-02-01',
    value: { igstFirst: true, igstRemainder: 'cgst_then_sgst' },
    source: 'Sec 49(5) and Sec 49A, CGST (Amendment) Act 2018 in force 1 Feb 2019 (Notification 2/2019-CT) — verify',
  },
  {
    from: '2019-03-29',
    value: { igstFirst: true, igstRemainder: 'any' },
    source: 'Rule 88A CGST Rules, Notification 16/2019-CT dated 29 Mar 2019; Circular 98/17/2019-GST — verify',
  },
];

export function gstSetOffOrder(periodStart?: string): GstSetOffOrder {
  return ruleAt(GST_SETOFF_RULES, periodStart);
}

/**
 * Rule 86B: a registered person whose taxable supplies (other than exempt / zero-rated) exceed `monthlyTaxable`
 * in a month may use the electronic credit ledger for at most (100 − `cashPct`)% of the output tax — i.e. at least
 * `cashPct`% in cash. Exceptions (income tax above ₹1 lakh, refunds, government / PSU …) are not modelled: the app
 * only warns. `null` = no such restriction. Verify with your CA.
 */
export const RULE_86B_RULES: readonly Versioned<{ monthlyTaxable: number; cashPct: number } | null>[] = [
  { from: '2017-07-01', value: null },
  { from: '2021-01-01', value: { monthlyTaxable: 5e6, cashPct: 1 }, source: 'Rule 86B, Notification 94/2020-CT — verify' },
];

export function rule86b(periodStart?: string): { monthlyTaxable: number; cashPct: number } | null {
  return ruleAt(RULE_86B_RULES, periodStart);
}

/**
 * ITC-04 (job work, Rule 45(3)) frequency, keyed by the first day of the return period. `limit` = aggregate
 * turnover (₹) above which `above` applies; due on `dueDay` of the month after the period. Append-only. Verify.
 */
export const ITC04_RULES: readonly Versioned<{ limit: number; above: 'Q' | 'H'; upTo: 'Q' | 'A'; dueDay: number }>[] = [
  { from: '2017-07-01', value: { limit: 0, above: 'Q', upTo: 'Q', dueDay: 25 }, source: 'Rule 45(3): quarterly' },
  { from: '2021-04-01', value: { limit: 5e7, above: 'H', upTo: 'A', dueDay: 25 }, source: 'Rule 45(3) amended by Notification 35/2021-CT (FY 2021-22 on) — verify' },
];

// ── TDS sections inserted by later Finance Acts (7O, 7.97) ───────────────────
/**
 * One dated history per section (null = not in force), merged into `tdsSections(date)` before "Custom rate".
 * Append new versions at the end of a history — never edit an old one. All UNVERIFIED working-paper values
 * (verify with your CA):
 *  - 194-O (e-commerce operator on the gross sale of an e-commerce participant): 1% from 1 Oct 2020 (Finance
 *    Act 2020), 0.75% while the 25% cut ran (to 31 Mar 2021), 0.1% from 1 Oct 2024 (Finance (No. 2) Act 2024).
 *    The ₹5 lakh exemption for individual / HUF participants and the 5% no-PAN rate are not modelled.
 *  - 194R (benefit / perquisite of a business or profession): 10% from 1 Jul 2022 (Finance Act 2022).
 *  - 194S (transfer of a virtual digital asset): 1% from 1 Jul 2022 (Finance Act 2022).
 */
export const TDS_EXTRA_SECTION_RULES: readonly { section: string; versions: readonly Versioned<TdsSection | null>[] }[] = [
  {
    section: '194O',
    versions: [
      { from: '2017-07-01', value: null },
      { from: '2020-10-01', value: { section: '194O', label: '194-O E-commerce operator 0.75%', rate: 0.75 }, source: 'Finance Act 2020 (Sec 194-O) with the 25% cut to 31 Mar 2021 — verify' },
      { from: '2021-04-01', value: { section: '194O', label: '194-O E-commerce operator 1%', rate: 1 }, source: 'Sec 194-O — verify' },
      { from: '2024-10-01', value: { section: '194O', label: '194-O E-commerce operator 0.1%', rate: 0.1 }, source: 'Finance (No. 2) Act 2024 — verify' },
    ],
  },
  {
    section: '194R',
    versions: [
      { from: '2017-07-01', value: null },
      { from: '2022-07-01', value: { section: '194R', label: '194R Business perquisite / benefit 10%', rate: 10 }, source: 'Finance Act 2022 (Sec 194R) — verify' },
    ],
  },
  {
    section: '194S',
    versions: [
      { from: '2017-07-01', value: null },
      { from: '2022-07-01', value: { section: '194S', label: '194S Virtual digital asset 1%', rate: 1 }, source: 'Finance Act 2022 (Sec 194S) — verify' },
    ],
  },
];

// ── IMS remarks (R2-C3) — which IMS decisions on credit notes need a remark, by return period ─────────
// As understood from GSTN IMS advisories (remarks for credit notes kept Pending / Rejected from the
// Oct 2025 tax period). Verify with your CA; the 2B view lets the user switch the check off.
export const IMS_REMARK_RULES: readonly Versioned<{ pending: boolean; reject: boolean }>[] = [
  { from: '2017-07-01', value: { pending: false, reject: false } },
  { from: '2025-10-01', value: { pending: true, reject: true }, source: 'GSTN IMS advisory (Oct 2025) as understood — verify' },
];
