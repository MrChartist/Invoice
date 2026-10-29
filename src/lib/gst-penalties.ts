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
    source: 'Sec 47(1) (max ₹5,000 per Act); Notification 73/2017-CT (₹25 / ₹10 per Act per day): verify',
  },
  {
    from: '2021-04-01',
    value: { perDay: 50, perDayNil: 20, cap: 2000, capNil: 500 },
    source: 'Notification 21/2021-CT (FY 2021-22 on: max ₹1,000 + ₹1,000, nil ₹250 + ₹250), verify',
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

/* ── RCM self-invoice time limit (7O, 7.92) ───────────────────────── */

/**
 * Days after receipt of the supply within which the recipient issues the self-invoice for a reverse-charge
 * supply from an unregistered supplier (Sec 31(3)(f)). `null` = no time limit in the rules (the invoice was
 * expected on receipt). UNVERIFIED working-paper values — verify with your CA:
 *  - from 1 Nov 2024: 30 days (Rule 47A, inserted by Notification 20/2024-CT as understood).
 * Append new versions; never edit an old one.
 */
export const RCM_SELF_INVOICE_DAYS_RULES: readonly Versioned<number | null>[] = [
  { from: '2017-07-01', value: null, source: 'Sec 31(3)(f): no separate time limit in the rules' },
  { from: '2024-11-01', value: 30, source: 'Rule 47A (Notification 20/2024-CT): verify' },
];

export function rcmSelfInvoiceDays(receivedOn?: string): number | null {
  return ruleAt(RCM_SELF_INVOICE_DAYS_RULES, receivedOn);
}

/* ── 7R (7.121–7.126): refunds, ISD, next-FY cut-off ─────────────────── */

/**
 * GST refund (RFD-01) time values, keyed by the RELEVANT DATE of the claim. UNVERIFIED — verify with your CA:
 *  - `limitYears`: Sec 54(1) — apply before the expiry of two years from the relevant date;
 *  - `provisionalPct`: Sec 54(6) / Rule 91 — provisional refund of zero-rated supplies (90%);
 *  - `sanctionDays`: Sec 54(7) — order within 60 days of a complete application;
 *  - `delayInterestPct`: Sec 56 — interest (% p.a.) when the refund is paid after `sanctionDays`
 *    (6%; 9% on an order in appeal, not modelled).
 * Append new versions; never edit an old one.
 */
export const REFUND_TIME_RULES: readonly Versioned<{ limitYears: number; provisionalPct: number; sanctionDays: number; delayInterestPct: number }>[] = [
  { from: '2017-07-01', value: { limitYears: 2, provisionalPct: 90, sanctionDays: 60, delayInterestPct: 6 }, source: 'Sec 54(1), 54(6), 54(7), Sec 56; Rule 91; Notification 13/2017-CT: verify' },
];

export function refundTimeRules(relevantDate?: string) {
  return ruleAt(REFUND_TIME_RULES, relevantDate);
}

/**
 * GSTR-6 (Input Service Distributor) due day of the month after the tax period, keyed by the period's first day.
 * UNVERIFIED: 13th (Sec 39(4) / Rule 65). Append-only.
 */
export const GSTR6_DUE_RULES: readonly Versioned<{ dueDay: number }>[] = [
  { from: '2017-07-01', value: { dueDay: 13 }, source: 'Sec 39(4), Rule 65: verify' },
];

/** GSTR-6 due date for the month starting `periodStart` (`YYYY-MM-01`). */
export function gstr6DueDate(periodStart: string): string {
  const [y, m] = periodStart.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(ruleAt(GSTR6_DUE_RULES, periodStart).dueDay).padStart(2, '0')}`;
}

/**
 * Last day (MM-DD in the calendar year after the FY ends) up to which credit notes, amendments and ITC of an FY can
 * still be declared — GSTR-9 Part V (Tables 10–13), keyed by the FY's first day. UNVERIFIED:
 *  - FY 2017-18 to 2020-21: the due date of the September return (20 October, `10-20`);
 *  - FY 2021-22 on: 30 November (Sec 16(4) / 34(2) / 37(3) / 39(9) as amended by Finance Act 2022, from 1 Oct 2022).
 * Append-only.
 */
export const NEXT_FY_CUTOFF_RULES: readonly Versioned<string>[] = [
  { from: '2017-07-01', value: '10-20', source: 'Sec 16(4) / 34(2): due date of the September return, verify' },
  { from: '2021-04-01', value: '11-30', source: 'Finance Act 2022 (30 November): verify' },
];

/** Last day (local `YYYY-MM-DD`) of the next-FY window for the FY that starts in April of `fyStart`. */
export function nextFyCutoff(fyStart: number): string {
  return `${fyStart + 1}-${ruleAt(NEXT_FY_CUTOFF_RULES, `${fyStart}-04-01`)}`;
}

/**
 * ISD becomes mandatory for common input services received on behalf of distinct persons (Sec 2(61) / Sec 20 as
 * substituted by Finance Act 2024) from 1 Apr 2025 (Notification 16/2024-CT as understood). UNVERIFIED.
 */
export const ISD_MANDATORY_RULES: readonly Versioned<boolean>[] = [
  { from: '2017-07-01', value: false, source: 'Sec 20 as enacted: ISD optional' },
  { from: '2025-04-01', value: true, source: 'Finance Act 2024, Sec 20 substituted (Notification 16/2024-CT): verify' },
];
