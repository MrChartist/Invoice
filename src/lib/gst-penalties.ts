/**
 * ESTIMATES of Sec 50(1) interest and Sec 47 late fee for GST returns.
 *
 * Pure maths on bare `YYYY-MM-DD` strings. Rates, per-day amounts and caps are
 * date-keyed (`Versioned` / `ruleAt` from `tax-rules.ts`, same convention: append
 * new versions, never edit old ones) and looked up by the tax period's first day.
 * They live here rather than in `tax-rules.ts` because that module is in the
 * entry chunk and only the (lazy) GST reports page needs them. Verify with your CA.
 */

import { ruleAt, type Versioned } from './tax-rules';
import { daysBetween, type ReturnDue } from './compliance';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Sec 50(1): simple interest, % per annum, on the net cash tax paid late. */
export const GST_INTEREST_RULES: readonly Versioned<number>[] = [
  { from: '2017-07-01', value: 18, source: 'Sec 50(1); Notification 13/2017-CT' },
];

/** GSTR-1 / GSTR-3B late fee, CGST + SGST together, ₹. */
export interface ReturnLateFee {
  perDay: number;
  perDayNil: number;
  capNil: number;
  /** Cap by preceding-FY aggregate turnover (₹, inclusive). */
  caps: { upTo: number; cap: number }[];
}

export const RETURN_LATE_FEE_RULES: readonly Versioned<ReturnLateFee>[] = [
  {
    from: '2017-07-01',
    value: { perDay: 50, perDayNil: 20, capNil: 10000, caps: [{ upTo: Infinity, cap: 10000 }] },
    source: 'Sec 47(1) (max ₹5,000 per Act); Notifications 4/2018-CT and 76/2018-CT (₹25 / ₹10 per Act per day)',
  },
  {
    from: '2021-06-01',
    value: {
      perDay: 50,
      perDayNil: 20,
      capNil: 500,
      caps: [{ upTo: 1.5e7, cap: 2000 }, { upTo: 5e7, cap: 5000 }, { upTo: Infinity, cap: 10000 }],
    },
    source: 'Notifications 19/2021-CT (GSTR-3B) and 20/2021-CT (GSTR-1)',
  },
];

/** GSTR-9 late fee per day (CGST + SGST) and cap as % of turnover in the State; keyed by FY start. */
export interface AnnualLateFeeTier { upTo: number; perDay: number; capPct: number }

export const GSTR9_LATE_FEE_RULES: readonly Versioned<AnnualLateFeeTier[]>[] = [
  { from: '2017-04-01', value: [{ upTo: Infinity, perDay: 200, capPct: 0.5 }], source: 'Sec 47(2) CGST Act + SGST Act' },
  {
    from: '2022-04-01',
    value: [
      { upTo: 5e7, perDay: 50, capPct: 0.04 },
      { upTo: 2e8, perDay: 100, capPct: 0.04 },
      { upTo: Infinity, perDay: 200, capPct: 0.5 },
    ],
    source: 'Notification 7/2023-CT (FY 2022-23 onwards)',
  },
];

/**
 * GSTR-4 (composition annual return, FY 2019-20 on) late fee, CGST + SGST together, ₹; keyed by FY start.
 * CMP-08 itself carries no late fee (it is a statement-cum-challan): only Sec 50 interest on tax paid late.
 * Working-paper values — the FY 2019-20 / 2020-21 waivers (Notifications 67/2020 and 19/2021-CT …) are not
 * modelled. Verify with your CA.
 */
export interface CompositionLateFee { perDay: number; perDayNil: number; cap: number; capNil: number }

export const GSTR4_LATE_FEE_RULES: readonly Versioned<CompositionLateFee>[] = [
  {
    from: '2019-04-01',
    value: { perDay: 50, perDayNil: 20, cap: 10000, capNil: 10000 },
    source: 'Sec 47(1) (max ₹5,000 per Act); Notification 73/2017-CT (₹25 / ₹10 per Act per day) — verify',
  },
  {
    from: '2021-04-01',
    value: { perDay: 50, perDayNil: 20, cap: 2000, capNil: 500 },
    source: 'Notification 21/2021-CT (FY 2021-22 on: max ₹1,000 + ₹1,000, nil ₹250 + ₹250) — verify',
  },
];

/** GSTR-4 late fee (CGST + SGST) for the FY starting `fyStart`, filed on `filedOn` against `due`. */
export function gstr4LateFee(due: string, filedOn: string, fyStart: number, nil = false): number {
  const days = lateDays(due, filedOn);
  if (!days) return 0;
  const rule = ruleAt(GSTR4_LATE_FEE_RULES, `${fyStart}-04-01`);
  return nil ? Math.min(days * rule.perDayNil, rule.capNil) : Math.min(days * rule.perDay, rule.cap);
}

/** Days late: after the due date up to and including the filing / payment day (0 if on time). */
export function lateDays(due: string, filedOn: string): number {
  return Math.max(0, daysBetween(due, filedOn));
}

/** Sec 50(1) simple interest on `cashTax` paid on `paidOn` against `due` (rate by tax period). */
export function gstInterest(cashTax: number, due: string, paidOn: string, periodStart?: string): number {
  const amt = Number(cashTax);
  if (!(amt > 0)) return 0;
  return r2((amt * ruleAt(GST_INTEREST_RULES, periodStart ?? due)) / 100 * (lateDays(due, paidOn) / 365));
}

export interface LateFeeInput {
  due: string;
  filedOn: string;
  /** Tax period's first day — picks the rule set. */
  periodStart: string;
  /** Nil return (no supplies, no liability). */
  nil?: boolean;
  /** Preceding-FY aggregate turnover (₹) — picks the cap. 0 / absent = the lowest slab. */
  turnover?: number;
}

/** GSTR-1 / GSTR-3B late fee (CGST + SGST), capped per the notification in force for the period. */
export function returnLateFee(i: LateFeeInput): number {
  const days = lateDays(i.due, i.filedOn);
  if (!days) return 0;
  const rule = ruleAt(RETURN_LATE_FEE_RULES, i.periodStart);
  if (i.nil) return Math.min(days * rule.perDayNil, rule.capNil);
  const t = Number(i.turnover) > 0 ? Number(i.turnover) : 0;
  const cap = (rule.caps.find((c) => t <= c.upTo) ?? rule.caps[rule.caps.length - 1]).cap;
  return Math.min(days * rule.perDay, cap);
}

/**
 * GSTR-9 late fee (CGST + SGST). `turnover` is the FY's turnover in the State: it picks the
 * tier and the % cap. Without it the per-day amount of the lowest tier is returned uncapped.
 */
export function gstr9LateFee(due: string, filedOn: string, fyStart: number, turnover = 0): number {
  const days = lateDays(due, filedOn);
  if (!days) return 0;
  const tiers = ruleAt(GSTR9_LATE_FEE_RULES, `${fyStart}-04-01`);
  const t = turnover > 0 ? turnover : 0;
  const tier = tiers.find((x) => t <= x.upTo) ?? tiers[tiers.length - 1];
  const fee = days * tier.perDay;
  return t > 0 ? Math.min(fee, r2((t * tier.capPct) / 100)) : fee;
}

export interface ReturnEstimate {
  days: number;
  lateFee: number;
  interest: number;
}

/**
 * Late fee + interest for `r` if filed on `filedOn` (default: today). `cashTax` is the net
 * cash liability of the period (GSTR-3B only); `nil` marks a nil return.
 */
export function estimateFor(
  r: ReturnDue,
  o: { filedOn: string; turnover?: number; cashTax?: number; nil?: boolean },
): ReturnEstimate {
  const days = lateDays(r.due, o.filedOn);
  if (!days || r.optional) return { days: r.optional ? 0 : days, lateFee: 0, interest: 0 };
  // CMP-08: no late fee; Sec 50 interest on the tax paid late (cashTax = the quarter's payable).
  if (r.form === 'CMP08') return { days, lateFee: 0, interest: gstInterest(o.cashTax ?? 0, r.due, o.filedOn, r.from) };
  // GSTR-4: late fee only (the tax was paid through the CMP-08s).
  if (r.form === 'GSTR4') return { days, lateFee: gstr4LateFee(r.due, o.filedOn, +r.from.slice(0, 4), o.nil), interest: 0 };
  if (r.form === 'GSTR9') {
    return { days, lateFee: gstr9LateFee(r.due, o.filedOn, +r.from.slice(0, 4), o.turnover), interest: 0 };
  }
  const lateFee = returnLateFee({ due: r.due, filedOn: o.filedOn, periodStart: r.from, nil: o.nil, turnover: o.turnover });
  const interest = r.form === 'GSTR3B' ? gstInterest(o.cashTax ?? 0, r.due, o.filedOn, r.from) : 0;
  return { days, lateFee, interest };
}
