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
