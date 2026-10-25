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
];
