/**
 * Statutory values for TDS we DEDUCT from suppliers (payables side) and the TDS / TCS deposit and
 * return calendar, keyed by the date they take effect — the same `Versioned` shape and `ruleAt`
 * lookup as `tax-rules.ts`. Kept in its own module (like `gst-penalties.ts`) so the early-loading
 * shell, which imports `tax-rules.ts` through the invoice types, does not grow; only the TDS page,
 * the bill form and the ledger load it.
 *
 * Section RATES come from `tdsSections(date)` in `tax-rules.ts` (one history for both sides); 194A,
 * which customers never deduct from us, has its own rule here. Add new values as new dated entries —
 * never edit an old one. Working-paper values: verify with your CA.
 */

import { ruleAt, tdsSections, type Versioned } from './tax-rules';

/** Deductee (payee) category; drives the 194C rate and the 26Q deductee code (01 company / 02 other). */
export type DeducteeType = 'COMPANY' | 'INDIVIDUAL' | 'HUF' | 'FIRM' | 'OTHER';

export const DEDUCTEE_TYPES: readonly DeducteeType[] = ['COMPANY', 'INDIVIDUAL', 'HUF', 'FIRM', 'OTHER'];

/**
 * Sections offered on purchase bills / expenses. `family` groups codes that share one threshold
 * (194C individual / others, 194I plant / land). `rpu` is the section code the NSDL Return
 * Preparation Utility uses in Form 26Q (unverified against the current RPU — check before upload).
 */
export interface TdsPayableSection { code: string; family: string; section: string; label: string; rpu: string }

export const TDS_PAYABLE_SECTIONS: readonly TdsPayableSection[] = [
  { code: '194C-1', family: '194C', section: '194C', label: '194C Contractor — individual / HUF', rpu: '94C' },
  { code: '194C-2', family: '194C', section: '194C', label: '194C Contractor — others', rpu: '94C' },
  { code: '194J', family: '194J', section: '194J', label: '194J Professional fees', rpu: '4JB' },
  { code: '194J-T', family: '194J-T', section: '194J', label: '194J Technical services', rpu: '4JA' },
  { code: '194I-A', family: '194I', section: '194I', label: '194I Rent — plant / machinery', rpu: '4IA' },
  { code: '194I-B', family: '194I', section: '194I', label: '194I Rent — land / building / furniture', rpu: '4IB' },
  { code: '194H', family: '194H', section: '194H', label: '194H Commission / brokerage', rpu: '94H' },
  { code: '194Q', family: '194Q', section: '194Q', label: '194Q Purchase of goods', rpu: '94Q' },
  { code: '194A', family: '194A', section: '194A', label: '194A Interest (other than on securities)', rpu: '94A' },
  // 7O (7.97): rates date-keyed in tax-rules.ts (`TDS_EXTRA_SECTION_RULES`); RPU codes UNVERIFIED.
  { code: '194O', family: '194O', section: '194-O', label: '194-O E-commerce operator (participant’s sales)', rpu: '94O' },
  { code: '194R', family: '194R', section: '194R', label: '194R Business perquisite / benefit', rpu: '94R' },
  { code: '194S', family: '194S', section: '194S', label: '194S Virtual digital asset', rpu: '94S' },
  // 7R (7.120): Sec 195 — payments to non-residents, reported in Form 27Q (not 26Q). Act rate by nature from
  // `NR_ACT_RATE_RULES` below; RPU section code '195' UNVERIFIED.
  { code: '195-R', family: '195', section: '195', label: '195 Non-resident — royalty', rpu: '195' },
  { code: '195-F', family: '195', section: '195', label: '195 Non-resident — fees for technical services', rpu: '195' },
  { code: '195-I', family: '195', section: '195', label: '195 Non-resident — interest', rpu: '195' },
  { code: '195-O', family: '195', section: '195', label: '195 Non-resident — other sums', rpu: '195' },
  // R14 (PS-D2): Sec 194T — salary, remuneration, commission, bonus or interest to a partner of a firm / LLP, from
  // 1 Apr 2025 (rate `TDS_194T_RULES`, threshold below). RPU / Form 140 code NOT confirmed (PS19) — verify with your CA.
  { code: '194T', family: '194T', section: '194T', label: '194T Payments to partners', rpu: '94T' },
];

export function payableSection(code: string | undefined): TdsPayableSection | undefined {
  return TDS_PAYABLE_SECTIONS.find((s) => s.code === code);
}

/** 194A (interest other than on securities): 10%, cut to 7.5% from 14 May 2020 to 31 Mar 2021. */
export const TDS_194A_RATE_RULES: readonly Versioned<number>[] = [
  { from: '2017-07-01', value: 10, source: 'Sec 194A' },
  { from: '2020-05-14', value: 7.5, source: 'Press release 13 May 2020 (25% cut to 31 Mar 2021)' },
  { from: '2021-04-01', value: 10, source: 'Sec 194A' },
];

/**
 * Rate in the Act for `code` on `date` (%), before 206AA / 206AB / a lower-deduction certificate.
 * 194C picks the individual / HUF or the "others" rate from the deductee type. Null when the section
 * did not exist on that day (194Q before 1 Jul 2021).
 */
export function sectionRate(code: string, date?: string, deductee?: DeducteeType): number | null {
  if (code === '194A') return ruleAt(TDS_194A_RATE_RULES, date);
  if (code === '194T') return ruleAt(TDS_194T_RULES, date); // R14 (PS-D2)
  if (code.startsWith('195-')) return nrActRate(nrNatureOf(code), date, deductee).rate;
  let c = code;
  if (code === '194C-1' || code === '194C-2') c = deductee === 'INDIVIDUAL' || deductee === 'HUF' ? '194C-1' : deductee ? '194C-2' : code;
  const hit = tdsSections(date).find((s) => s.section === c);
  return hit ? hit.rate : null;
}

/**
 * Thresholds per section family (₹). `single` = one payment / credit above it attracts TDS;
 * `aggregate` = the FY total to the same payee above it attracts TDS on the whole amount;
 * `exceedOnly` = TDS only on the part above the aggregate (194Q); `perMonth` = the single limit is per
 * month or part of a month (194I from 1 Apr 2025). History (verify with your CA):
 *  - 194C ₹30,000 single / ₹1,00,000 aggregate (from 1 Jun 2016; unchanged by Finance Act 2025).
 *  - 194J ₹30,000 per FY for each of professional and technical fees; ₹50,000 from 1 Apr 2025.
 *  - 194I ₹1,80,000 per FY; ₹2,40,000 from 1 Apr 2019 (Finance Act 2019); ₹50,000 per month from 1 Apr 2025.
 *  - 194H ₹15,000 per FY; ₹20,000 from 1 Apr 2025.
 *  - 194Q above ₹50 lakh per FY per seller (from 1 Jul 2021; only for a buyer whose turnover in the
 *    preceding FY exceeded ₹10 crore).
 *  - 194A (payer other than a bank / co-op / post office) ₹5,000 per FY; ₹10,000 from 1 Apr 2025.
 */
export interface TdsThreshold { single?: number; aggregate?: number; exceedOnly?: boolean; perMonth?: boolean }

const TH_2017: Record<string, TdsThreshold> = {
  '194C': { single: 30000, aggregate: 100000 },
  '194J': { aggregate: 30000 },
  '194J-T': { aggregate: 30000 },
  '194I': { aggregate: 180000 },
  '194H': { aggregate: 15000 },
  '194A': { aggregate: 5000 },
};
const TH_2019: Record<string, TdsThreshold> = { ...TH_2017, '194I': { aggregate: 240000 } };

export const TDS_THRESHOLD_RULES: readonly Versioned<Record<string, TdsThreshold>>[] = [
  { from: '2017-07-01', value: TH_2017, source: 'Income-tax Act as in force' },
  { from: '2019-04-01', value: TH_2019, source: 'Finance Act 2019 (194I ₹2.4 lakh)' },
  { from: '2021-07-01', value: { ...TH_2019, '194Q': { aggregate: 5000000, exceedOnly: true } }, source: 'Finance Act 2021 (194Q above ₹50 lakh)' },
  {
    from: '2025-04-01',
    value: {
      '194C': { single: 30000, aggregate: 100000 },
      '194J': { aggregate: 50000 },
      '194J-T': { aggregate: 50000 },
      '194I': { single: 50000, perMonth: true },
      '194H': { aggregate: 20000 },
      '194A': { aggregate: 10000 },
      '194Q': { aggregate: 5000000, exceedOnly: true },
    },
    source: 'Finance Act 2025 (thresholds rationalised)',
  },
];

export function tdsThreshold(family: string, date?: string): TdsThreshold | undefined {
  return ruleAt(TDS_THRESHOLD_RULES, date)[family] ?? (TDS_EXTRA_THRESHOLD_RULES[family] ? ruleAt(TDS_EXTRA_THRESHOLD_RULES[family], date) ?? undefined : undefined);
}

/**
 * 7O (7.97): thresholds of the later sections, one dated history per family (null = none). UNVERIFIED:
 * 194R ₹20,000 per FY per recipient; 194S ₹10,000 per FY (₹50,000 for a "specified person" buyer — not
 * modelled, the lower figure is used). 194-O has none here: its ₹5 lakh exemption is for individual / HUF
 * participants only and is left to the CA. Append new versions; never edit an old one.
 */
export const TDS_EXTRA_THRESHOLD_RULES: Readonly<Record<string, readonly Versioned<TdsThreshold | null>[]>> = {
  '194R': [{ from: '2022-07-01', value: { aggregate: 20000 }, source: 'Sec 194R — verify' }],
  '194S': [{ from: '2022-07-01', value: { aggregate: 10000 }, source: 'Sec 194S (other than a specified person) — verify' }],
  // R14 (PS-D2): 194T — ₹20,000 per FY per partner across salary, remuneration, commission, bonus and interest.
  '194T': [{ from: '2025-04-01', value: { aggregate: 20000 }, source: 'Finance (No. 2) Act 2024 (Sec 194T) — taxmann, L&S, tdsman' }],
};

/** Sec 206AA: payee without a valid PAN — at least 20% (5% for 194Q from 1 Jul 2021). */
export const TDS_NO_PAN_RULES: readonly Versioned<{ rate: number; overrides: Record<string, number> }>[] = [
  { from: '2017-07-01', value: { rate: 20, overrides: {} }, source: 'Sec 206AA' },
  { from: '2021-07-01', value: { rate: 20, overrides: { '194Q': 5 } }, source: 'Sec 206AA, Finance Act 2021 (194Q 5%)' },
];

/**
 * Sec 206AB: "specified person" (did not file the return) — the higher of twice the rate or 5%.
 * In force 1 Jul 2021 to 31 Mar 2025; omitted by Finance Act 2025.
 */
export const TDS_206AB_RULES: readonly Versioned<{ active: boolean; multiplier: number; floor: number }>[] = [
  { from: '2017-07-01', value: { active: false, multiplier: 2, floor: 5 } },
  { from: '2021-07-01', value: { active: true, multiplier: 2, floor: 5 }, source: 'Finance Act 2021 (Sec 206AB)' },
  { from: '2025-04-01', value: { active: false, multiplier: 2, floor: 5 }, source: 'Finance Act 2025 (Sec 206AB omitted)' },
];

/**
 * Interest, % per month or part of a month. TDS, Sec 201(1A): `lateDeduction` from the day tax was
 * deductible to the day it was deducted, `latePayment` from the day it was deducted to the day it
 * was paid — 1% / 1.5% since 1 Jul 2010 (Finance Act 2010), 1% for both before. TCS, Sec 206C(7):
 * 1% per month for late collection and for late payment; late payment after collection 1.5% from
 * 1 Apr 2025 (Finance (No. 2) Act 2024 — verify with your CA).
 */
export const TDS_INTEREST_RULES: readonly Versioned<{ lateDeduction: number; latePayment: number; tcsLateCollection: number; tcsLatePayment: number }>[] = [
  { from: '2004-04-01', value: { lateDeduction: 1, latePayment: 1, tcsLateCollection: 1, tcsLatePayment: 1 }, source: 'Sec 201(1A) before Finance Act 2010; Sec 206C(7)' },
  { from: '2010-07-01', value: { lateDeduction: 1, latePayment: 1.5, tcsLateCollection: 1, tcsLatePayment: 1 }, source: 'Sec 201(1A) as amended by Finance Act 2010; Sec 206C(7)' },
  { from: '2025-04-01', value: { lateDeduction: 1, latePayment: 1.5, tcsLateCollection: 1, tcsLatePayment: 1.5 }, source: 'Sec 206C(7) as amended by Finance (No. 2) Act 2024' },
];

export function tdsInterestRates(date?: string) {
  return ruleAt(TDS_INTEREST_RULES, date);
}

/**
 * Deposit and return due dates (Rules 30, 31A, 37CA), keyed by the first day of the period.
 * Deposit: `depositDay` of the next month; TDS deducted in March by `marchTdsDue` (`MM-DD` in April);
 * TCS of March by the 7th of April like every other month. Quarterly returns (Q1..Q4, `MM-DD` in the
 * month after the quarter): 26Q / 27Q by 31 Jul, 31 Oct, 31 Jan, 31 May; 27EQ by 15 Jul, 15 Oct,
 * 15 Jan, 15 May. Form 16A / 27D: `certDays` after the return due date. Ad-hoc CBDT extensions are
 * not tracked.
 */
export interface TdsDueDays {
  depositDay: number;
  marchTdsDue: string;
  tdsReturn: readonly [string, string, string, string];
  tcsReturn: readonly [string, string, string, string];
  certDays: number;
}

export const TDS_DUE_RULES: readonly Versioned<TdsDueDays>[] = [
  {
    from: '2017-07-01',
    value: { depositDay: 7, marchTdsDue: '04-30', tdsReturn: ['07-31', '10-31', '01-31', '05-31'], tcsReturn: ['07-15', '10-15', '01-15', '05-15'], certDays: 15 },
    source: 'Rules 30, 31, 31A and 37CA, Income-tax Rules',
  },
];

export function tdsDueDays(periodStart?: string): TdsDueDays {
  return ruleAt(TDS_DUE_RULES, periodStart);
}

/**
 * Form 27EQ collection codes for the TCS presets the invoice editor offers (RPU "section code";
 * unverified against the current RPU).
 */
export const TCS_27EQ_CODES: readonly { match: RegExp; code: string; label: string }[] = [
  { match: /1H/i, code: '6CR', label: '206C(1H) sale of goods' },
  { match: /1G/i, code: '6CQ', label: '206C(1G) remittance under LRS' },
  // R8-C (TR-C2): 206C(1) specified goods and 206C(1F) — labels of `tradingTcsPresets` (trade/tr-statutory.ts). The
  // luxury-goods code is not confirmed: left blank (TR15) — verify with your CA.
  { match: /206C\(1\) alcoholic liquor/i, code: '6CA', label: '206C(1) alcoholic liquor' },
  { match: /206C\(1\) timber \(forest lease\)/i, code: '6CB', label: '206C(1) timber under a forest lease' },
  { match: /206C\(1\) timber \(other mode\)/i, code: '6CC', label: '206C(1) timber by any other mode' },
  { match: /206C\(1\) other forest produce/i, code: '6CD', label: '206C(1) other forest produce' },
  { match: /206C\(1\) scrap/i, code: '6CE', label: '206C(1) scrap' },
  { match: /206C\(1\) tendu/i, code: '6CI', label: '206C(1) tendu leaves' },
  { match: /206C\(1\) coal/i, code: '6CJ', label: '206C(1) coal / lignite / iron ore' },
  { match: /206C\(1F\) motor vehicle/i, code: '6CL', label: '206C(1F) motor vehicle' },
  { match: /206C\(1F\) notified luxury/i, code: '', label: '206C(1F) notified luxury goods (code to confirm — verify with your CA)' },
];

/* ── 7R (7.120): Form 27Q — payments to non-residents (Sec 195) ───────────── */

/** Nature of a payment to a non-resident (drives the Act rate). */
export type NrNature = 'ROYALTY' | 'FTS' | 'INTEREST' | 'OTHER';

export const NR_NATURES: readonly NrNature[] = ['ROYALTY', 'FTS', 'INTEREST', 'OTHER'];

/** `195-R` → ROYALTY … (`OTHER` for anything else). */
export function nrNatureOf(code: string | undefined): NrNature {
  const c = String(code ?? '');
  if (c === '195-R') return 'ROYALTY';
  if (c === '195-F' || c === '194J-T') return 'FTS';
  if (c === '195-I' || c === '194A') return 'INTEREST';
  return 'OTHER';
}

/**
 * Rates in force under the Act (Part II of the First Schedule / Sec 115A) for TDS u/s 195, % before surcharge,
 * and the health & education cess added on top (`cessPct`). UNVERIFIED working-paper values — verify with your CA:
 *  - royalty / FTS (Sec 115A): 10% from 1 Apr 2015; 20% from 1 Apr 2023 (Finance Act 2023);
 *  - interest (other than Sec 194LB / 194LC / 194LD concessional cases, not modelled): 20%;
 *  - other sums: 30% (non-company), 40% (foreign company); 35% for a foreign company from 1 Apr 2024
 *    (Finance (No. 2) Act 2024 — read as applying to TDS of FY 2024-25 on);
 *  - cess 3% (education + SHE cess) to 31 Mar 2018, 4% health & education cess from 1 Apr 2018.
 * Surcharge (by income slab) is not modelled. Append new versions; never edit an old one.
 */
export interface NrActRates { ROYALTY: number; FTS: number; INTEREST: number; OTHER: number; OTHER_COMPANY: number; cessPct: number }

export const NR_ACT_RATE_RULES: readonly Versioned<NrActRates>[] = [
  { from: '2017-07-01', value: { ROYALTY: 10, FTS: 10, INTEREST: 20, OTHER: 30, OTHER_COMPANY: 40, cessPct: 3 }, source: 'Sec 115A / First Schedule Part II — verify' },
  { from: '2018-04-01', value: { ROYALTY: 10, FTS: 10, INTEREST: 20, OTHER: 30, OTHER_COMPANY: 40, cessPct: 4 }, source: 'Finance Act 2018 (health & education cess 4%) — verify' },
  { from: '2023-04-01', value: { ROYALTY: 20, FTS: 20, INTEREST: 20, OTHER: 30, OTHER_COMPANY: 40, cessPct: 4 }, source: 'Finance Act 2023 (Sec 115A royalty / FTS 20%) — verify' },
  { from: '2024-04-01', value: { ROYALTY: 20, FTS: 20, INTEREST: 20, OTHER: 30, OTHER_COMPANY: 35, cessPct: 4 }, source: 'Finance (No. 2) Act 2024 (foreign company 35%) — verify' },
];

/** Act rate for a non-resident payment: the base rate and the effective rate with cess (2 decimals). */
export function nrActRate(nature: NrNature, date?: string, deductee?: DeducteeType): { rate: number; base: number; cessPct: number } {
  const r = ruleAt(NR_ACT_RATE_RULES, date);
  const base = nature === 'OTHER' && deductee === 'COMPANY' ? r.OTHER_COMPANY : r[nature];
  return { base, cessPct: r.cessPct, rate: Math.round(base * (100 + r.cessPct)) / 100 };
}

/**
 * 194-O (7R, 7.120): the ₹5 lakh FY exemption for an e-commerce participant who is an individual / HUF and has
 * furnished PAN or Aadhaar (Sec 194-O(2)), and the Sec 206AA rate when no PAN / Aadhaar is furnished (5%, the
 * Sec 206AA(1A)-type cap for 194-O as understood). From 1 Oct 2020. UNVERIFIED — verify with your CA. Append-only.
 */
export const TDS_194O_RULES: readonly Versioned<{ individualExemption: number; noPanRate: number } | null>[] = [
  { from: '2017-07-01', value: null },
  { from: '2020-10-01', value: { individualExemption: 500000, noPanRate: 5 }, source: 'Sec 194-O(2) and Sec 206AA for 194-O (Finance Act 2020) — verify' },
];

/**
 * R5-B3: Sec 194C(6) — no TDS on payments to a contractor in the business of plying, hiring or leasing goods carriages
 * who owns ten or fewer goods carriages at any time in the year and furnishes a declaration with PAN. The limit is
 * date-keyed; the 26Q no-deduction reason code is `T` (as understood). From 1 Apr 2026 the 2025-Act table item applies
 * (labels via `ita2025.ts`). Verify with your CA. Append-only.
 */
export const TDS_194C6_RULES: readonly Versioned<{ maxVehicles: number; reason: string } | null>[] = [
  { from: '2015-06-01', value: { maxVehicles: 10, reason: 'T' }, source: 'Sec 194C(6) as amended by Finance Act 2015 (≤ 10 goods carriages, PAN + declaration) — verify' },
];

/**
 * R14 (PS-D2): Sec 194T — a firm (incl. an LLP) deducts 10% on salary, remuneration, commission, bonus or interest
 * credited / paid to a partner from 1 Apr 2025 (Finance (No. 2) Act 2024; none before: null). Drawings and the exempt
 * share of profit are outside. Rate and date verified in secondary sources; the 2025-Act table entry and the RPU code
 * are not (PS19) — verify with your CA. Append-only.
 */
export const TDS_194T_RULES: readonly Versioned<number | null>[] = [
  { from: '2017-07-01', value: null },
  { from: '2025-04-01', value: 10, source: 'Sec 194T (Finance (No. 2) Act 2024) — taxmann, Lakshmikumaran & Sridharan, tdsman' },
];
